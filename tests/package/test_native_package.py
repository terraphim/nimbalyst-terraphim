"""Actual compiled package regressions, not a hand-made golden bundle."""
import importlib.util
import io
import json
from pathlib import Path
import shutil
import stat
import tempfile
import subprocess
import sys
import unittest
import zipfile

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('native_package',ROOT/'scripts/package-native.py')
pkg=importlib.util.module_from_spec(spec);spec.loader.exec_module(pkg)

class NativePackageTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.files=pkg.collect(ROOT);cls.data=pkg.archive(cls.files)
 def test_actual_compiled_candidate_is_exact_and_deterministic(self):
  self.assertEqual(self.data,pkg.archive(self.files));self.assertEqual(19,len(self.files));self.assertEqual(19,len(pkg.verify(self.data,self.files)['files']))
 def test_preserves_all_actual_license_bytes(self):
  with zipfile.ZipFile(io.BytesIO(self.data))as z:
   metadata=json.loads(z.read('dist/assets.json'));self.assertEqual(15,len(metadata['licenses']))
   for item in metadata['licenses']:self.assertEqual(item['sha256'],pkg.sha(z.read(item['path'])))
 def test_refuses_trailing_or_prefixed_bytes(self):
  for data in (self.data+b'tail',b'prefix'+self.data,self.data+self.data):
   with self.assertRaises(ValueError):pkg.verify(data,self.files)
 def test_refuses_changed_content(self):
  changed=dict(self.files);changed['dist/index.js']+=b'\n// changed'
  with self.assertRaises(ValueError):pkg.verify(pkg.archive(changed),self.files)
 def test_refuses_missing_or_additional_members(self):
  for changed in ({k:v for k,v in self.files.items()if k!='dist/index.css'},{**self.files,'extra.txt':b'not allowed'}):
   with self.assertRaises(ValueError):pkg.verify(pkg.archive(changed),self.files)
 def test_refuses_noncanonical_paths(self):
  for name in ('../outside','/absolute','a//b','a/../b','C:/drive','a\\b','a\nfile','a/./b'):
   with self.assertRaises(ValueError):pkg.archive({name:b'data'})
 def test_refuses_duplicate_member(self):
  stream=io.BytesIO(self.data)
  import warnings
  with warnings.catch_warnings():
   warnings.simplefilter('ignore',UserWarning)
   with zipfile.ZipFile(stream,'a')as z:z.writestr('manifest.json',self.files['manifest.json'])
  with self.assertRaises(ValueError):pkg.verify(stream.getvalue(),self.files)
 def test_refuses_link_mode_in_archive(self):
  stream=io.BytesIO()
  with zipfile.ZipFile(stream,'w')as z:
   for name,data in sorted(self.files.items()):
    item=zipfile.ZipInfo(name);item.create_system=3;item.external_attr=((stat.S_IFLNK if name=='manifest.json'else stat.S_IFREG)|0o644)<<16;z.writestr(item,data)
  with self.assertRaises(ValueError):pkg.verify(stream.getvalue(),self.files)
 def test_refuses_oversized_archive(self):
  with self.assertRaises(ValueError):pkg.verify(b'x'*(pkg.MAX_ARCHIVE+1),self.files)
 def test_existing_sidecar_is_refused_before_creating_archive(self):
  with tempfile.TemporaryDirectory(prefix='native-destination-')as d:
   destination=Path(d)/'candidate.nimext';sidecar=Path(str(destination)+'.json');sidecar.write_bytes(b'preserve')
   result=subprocess.run([sys.executable,str(ROOT/'scripts/package-native.py'),'--root',str(ROOT),'--output',str(destination)],capture_output=True)
   self.assertNotEqual(0,result.returncode);self.assertFalse(destination.exists());self.assertEqual(b'preserve',sidecar.read_bytes())
 def test_actual_cli_package_is_exclusive_and_reverified(self):
  with tempfile.TemporaryDirectory(prefix='native-destination-')as d:
   destination=Path(d)/'candidate.nimext';args=[sys.executable,str(ROOT/'scripts/package-native.py'),'--root',str(ROOT),'--output',str(destination)]
   subprocess.run(args,capture_output=True,check=True);before=destination.read_bytes();receipt=json.loads(Path(str(destination)+'.json').read_bytes());self.assertEqual(pkg.verify(before,self.files)['archiveSha256'],receipt['archiveSha256'])
   result=subprocess.run(args,capture_output=True);self.assertNotEqual(0,result.returncode);self.assertEqual(before,destination.read_bytes())
 def altered_source(self,change):
  with tempfile.TemporaryDirectory(prefix='native-source-')as d:
   root=Path(d)
   for name in ('manifest.json','dist','.cache/contracts/frame','.cache/contracts/visual','.cache/released-editor','docs/recovery/released-assets-manifest.json','LICENSE','vendor/terraphim-host-bridge/LICENSE','node_modules/@nimbalyst/extension-sdk/LICENSE'):
    source=ROOT/name;target=root/name;target.parent.mkdir(parents=True,exist_ok=True)
    if source.is_dir():shutil.copytree(source,target)
    else:shutil.copyfile(source,target)
   change(root)
   with self.assertRaises((ValueError,KeyError)):pkg.collect(root)
 def test_refuses_changed_notice_even_if_self_manifest_is_rehashed(self):
  def change(root):
   path=root/'dist/licenses/terraphim.txt';path.write_text('altered licence');m=json.loads((root/'dist/assets.json').read_bytes())
   for row in m['licenses']:
    if row['path']=='dist/licenses/terraphim.txt':row.update(bytes=path.stat().st_size,sha256=pkg.sha(path.read_bytes()))
   (root/'dist/assets.json').write_text(json.dumps(m))
  self.altered_source(change)
 def test_refuses_missing_ai_permission(self):
  def change(root):
   path=root/'manifest.json';m=json.loads(path.read_bytes());m['permissions'].pop('ai');path.write_text(json.dumps(m))
  self.altered_source(change)
 def test_refuses_extra_permissions(self):
  def change(root):
   path=root/'manifest.json';m=json.loads(path.read_bytes());m['permissions']['shell']=True;path.write_text(json.dumps(m))
  self.altered_source(change)
 def test_refuses_missing_actual_embedded_asset(self):
  self.altered_source(lambda root:(root/'dist/index.js').write_text('export const components={};'))
 def test_refuses_symlink_in_dist(self):
  def change(root):
   path=root/'dist/index.css';path.unlink();path.symlink_to(root/'LICENSE')
  self.altered_source(change)

if __name__=='__main__':unittest.main()
