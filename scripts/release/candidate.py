"""Seal or fetch this repository's original CI candidate without rebuilding it."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile
from admission import REPOSITORY, require, sha, is_sha, positive, validate_candidate_metadata

ROOT=Path(__file__).resolve().parents[2]


def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


def api(path):
    return json.loads(subprocess.check_output(['gh','api',f'repos/{REPOSITORY}/{path}'],timeout=120,stderr=subprocess.PIPE))


def package_identity(path, sidecar):
    package=load('native_package',ROOT/'scripts/package-native.py')
    require(path.stat().st_size<=package.MAX_ARCHIVE,'Oversized candidate')
    data=path.read_bytes();require(sha(data)==sidecar['archiveSha256'] and len(data)==sidecar['archiveBytes'],'Candidate sidecar digest mismatch')
    with zipfile.ZipFile(path) as z:
        members=z.infolist();require(len(members)<=package.MAX_FILES and sum(x.file_size for x in members)<=package.MAX_ARCHIVE,'Oversized candidate members')
        files={x.filename:z.read(x) for x in members}
    verified=package.verify(data,files);require(verified['files']==sidecar['files'],'Candidate inventory differs')
    require(all(name in ('manifest.json','dist/index.js','dist/index.css','dist/assets.json') or name.startswith('dist/licenses/') for name in files),'Undeclared package content')
    manifest=json.loads(files['manifest.json']);expected_manifest=json.loads((ROOT/'manifest.json').read_bytes())
    require(set(manifest)==set(expected_manifest) and all(manifest.get(key)==expected_manifest[key] for key in ('id','main','styles','apiVersion','permissions','contributions')),'Candidate extension identity/permissions mismatch')
    return manifest,verified


def seal(path,destination,source,run_id,attempt):
    require(is_sha(source,40) and positive(run_id) and positive(attempt),'Invalid producer identity')
    require(not destination.exists() and not destination.is_symlink(),'Seal requires fresh destination')
    sidecar_path=Path(str(path)+'.json');sidecar=json.loads(sidecar_path.read_bytes());manifest,identity=package_identity(path,sidecar)
    version=manifest['version'];require(isinstance(version,str) and __import__('re').fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.]+)?',version),'Invalid candidate version')
    name=f'terraphim-editor-{version}.nimext';destination.mkdir(parents=True)
    shutil.copyfile(path,destination/name);shutil.copyfile(sidecar_path,destination/(name+'.json'))
    record=dict(scope='CI inputs only; no native qualification or publication',repository=REPOSITORY,sourceSha=source,runId=run_id,attempt=attempt,archive=name,version=version,**identity)
    (destination/'candidate.json').write_text(json.dumps(record,indent=2)+'\n')
    require((destination/name).read_bytes()==path.read_bytes(),'Sealed bytes changed')
    return record


def fetch(record,destination):
    require(not destination.exists() and not destination.is_symlink(),'Fetch requires fresh destination')
    c=record['candidate'];run=api(f'actions/runs/{c["runId"]}/attempts/{c["attempt"]}');artifact=api(f'actions/artifacts/{c["artifactId"]}')
    validate_candidate_metadata(record,run,artifact)
    destination.mkdir(parents=True)
    for name,data in [('run.json',run),('artifact.json',artifact)]:
        (destination/name).write_text(json.dumps(data,indent=2)+'\n')
    archive=destination/'artifact.zip'
    with archive.open('xb') as output:
        subprocess.run(['gh','api',f'repos/{REPOSITORY}/actions/artifacts/{c["artifactId"]}/zip'],stdout=output,stderr=subprocess.PIPE,check=True,timeout=300)
    extractor=load('artifact_extract',ROOT/'scripts/native/extract-artifact.py')
    rows=extractor.extract(archive,destination/'candidate',c['artifactDigest'].removeprefix('sha256:'))
    input_root=destination/'candidate';expected={c['archive'],c['archive']+'.json','candidate.json'}
    require({x['path'] for x in rows}==expected,'Candidate artifact has missing or extra files')
    sealed=json.loads((input_root/'candidate.json').read_bytes())
    require(all(sealed.get(k)==v for k,v in {'repository':REPOSITORY,'sourceSha':record['sourceSha'],'runId':c['runId'],'attempt':c['attempt'],'archive':c['archive'],'archiveSha256':c['archiveSha256']}.items()),'Sealed candidate source identity mismatch')
    sidecar=json.loads((input_root/(c['archive']+'.json')).read_bytes());manifest,identity=package_identity(input_root/c['archive'],sidecar)
    require(identity['archiveSha256']==c['archiveSha256'],'Requested package bytes differ')
    if 'files' in c:require(identity['files']==c['files'] and identity['archiveBytes']==c['archiveBytes'],'Admission package inventory differs')
    if 'version' in record:require(manifest['version']==record['version'],'Version differs from original package; repacking refused')
    receipt=dict(scope='Inputs only; not native success',sourceSha=record['sourceSha'],runId=c['runId'],runAttempt=c['attempt'],artifactId=c['artifactId'],artifactDigest=c['artifactDigest'],packagePath=str((input_root/c['archive']).resolve()),packageSha256=identity['archiveSha256'],packageBytes=identity['archiveBytes'])
    (destination/'input-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    return receipt


def main():
    parser=argparse.ArgumentParser(description=__doc__);commands=parser.add_subparsers(dest='command',required=True)
    s=commands.add_parser('seal');s.add_argument('--package',type=Path,required=True);s.add_argument('--destination',type=Path,required=True)
    f=commands.add_parser('fetch');f.add_argument('--record',type=Path,required=True);f.add_argument('--destination',type=Path,required=True)
    args=parser.parse_args()
    if args.command=='seal':result=seal(args.package,args.destination,os.environ['GITHUB_SHA'],int(os.environ['GITHUB_RUN_ID']),int(os.environ['GITHUB_RUN_ATTEMPT']))
    else:result=fetch(json.loads(args.record.read_bytes()),args.destination)
    print(json.dumps(result))

if __name__=='__main__':main()
