"""Real candidate bytes and local HTTP responses; no native-host success fixtures."""
import functools
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import tempfile
from threading import Thread
import unittest
import zipfile

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/release'))
import candidate
import deliver


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*args):
        pass


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.addCleanup(self.temporary.cleanup);self.root=Path(self.temporary.name)

    def start_server(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(self.root)))
        thread=Thread(target=server.serve_forever,daemon=True);thread.start()
        def stop():server.shutdown();server.server_close();thread.join(timeout=5)
        self.addCleanup(stop);return f'http://127.0.0.1:{server.server_port}'

    def test_actual_http_digest_success_and_mismatch_are_recorded(self):
        content=b'Actual public-readback transport fixture\n';(self.root/'served.bin').write_bytes(content)
        url=self.start_server()+'/served.bin';expected={'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()}
        result=deliver.download_exact(url,self.root/'downloaded.bin',expected)
        self.assertEqual(result['status'],'PASS');self.assertEqual(result['sha256'],expected['sha256']);self.assertEqual((self.root/'downloaded.bin').read_bytes(),content)
        mismatch=deliver.download_exact(url,self.root/'different.bin',{**expected,'sha256':'0'*64})
        self.assertEqual(mismatch['status'],'FAIL');self.assertEqual(mismatch['sha256'],expected['sha256'])
        oversized=deliver.download_exact(url,self.root/'bounded.bin',{**expected,'bytes':2})
        self.assertEqual(oversized['status'],'FAIL');self.assertEqual(oversized['bytes'],3)
        with self.assertRaisesRegex(ValueError,'HTTP 404'):deliver.download_exact(self.start_server()+'/absent.bin',self.root/'missing.bin',expected)
        self.assertFalse((self.root/'missing.bin').exists())

    def test_partial_or_extra_existing_release_refuses_before_download(self):
        (self.root/'preflight.json').write_text(json.dumps({'tag':'v0.1.0','assets':[{'name':'a.nimext','bytes':1,'sha256':'1'*64}]}))
        for assets in [[],[{'name':'a.nimext'},{'name':'extra'}],[{'name':'wrong'}]]:
            with self.assertRaisesRegex(ValueError,'partial or has extra'):deliver.verify_public(self.root,dict(id=1,tag_name='v0.1.0',draft=False,prerelease=False,assets=assets))
        self.assertFalse((self.root/'anonymous-readback').exists())

    def test_actual_compiled_candidate_seal_preserves_all_bytes_and_refuses_replacement(self):
        source=Path(os.environ.get('NIMBALYST_TEST_CANDIDATE',str(ROOT/'.artifacts/native-package/terraphim-editor-0.1.0-dev.1.nimext')))
        self.assertTrue(source.is_file(),'Build the actual package before release tests, or point NIMBALYST_TEST_CANDIDATE at a retained actual package')
        before=source.read_bytes();sidecar=Path(str(source)+'.json').read_bytes()
        record=candidate.seal(source,self.root/'sealed','1'*40,123,1)
        actual=self.root/'sealed'/record['archive'];self.assertEqual(actual.read_bytes(),before)
        self.assertEqual(Path(str(actual)+'.json').read_bytes(),sidecar)
        self.assertEqual(record['archiveSha256'],hashlib.sha256(before).hexdigest())
        with self.assertRaisesRegex(ValueError,'fresh'):candidate.seal(source,self.root/'sealed','1'*40,123,1)
        actual.write_bytes(before[:-1]+bytes([before[-1]^1]))
        with self.assertRaisesRegex(ValueError,'digest'):candidate.package_identity(actual,json.loads(sidecar))
        self.assertEqual(source.read_bytes(),before)

    def test_actual_candidate_with_undeclared_backend_is_refused(self):
        source=Path(os.environ.get('NIMBALYST_TEST_CANDIDATE',str(ROOT/'.artifacts/native-package/terraphim-editor-0.1.0-dev.1.nimext')))
        with zipfile.ZipFile(source) as archive:files={x.filename:archive.read(x) for x in archive.infolist()}
        files['dist/backend.js']=b'undeclared executable fixture'
        package=candidate.load('package_test',ROOT/'scripts/package-native.py')
        data=package.archive(files);path=self.root/'extra.nimext';path.write_bytes(data)
        with self.assertRaisesRegex(ValueError,'Undeclared'):
            candidate.package_identity(path,package.verify(data,files))

    def test_workflow_boundaries_and_legacy_native_route_remain_explicit(self):
        workflow=(ROOT/'.github/workflows/release.yml').read_text()
        self.assertIn('ref: ${{ github.workflow_sha }}',workflow)
        self.assertNotIn('ref: ${{ inputs.',workflow)
        self.assertNotIn('pull_request_target',workflow)
        self.assertNotIn('workflow_run:',workflow)
        self.assertEqual(workflow.count('contents: write'),1)
        self.assertIn('needs: admission',workflow)
        self.assertIn('environment: nimbalyst-release',workflow)
        self.assertIn('cancel-in-progress: false',workflow)
        self.assertNotIn('--clobber',workflow)
        native=(ROOT/'.github/workflows/native-windows.yml').read_text()
        self.assertIn('node scripts/native/verify-candidate.mjs $env:CANDIDATE_RUN $env:SOURCE_SHA $env:CANDIDATE_SHA256 .artifacts/native-windows',native)
        self.assertIn('fetch-shared-candidate.py',native)
        self.assertEqual(json.loads((ROOT/'release/qualified.json').read_text())['releases'],[])

if __name__=='__main__':unittest.main()
