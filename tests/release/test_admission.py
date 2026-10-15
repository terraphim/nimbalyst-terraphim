"""Pure release-admission contract tests; constructed records are not native acceptance."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('admission', ROOT / 'scripts/release/admission.py')
admission = importlib.util.module_from_spec(spec)
spec.loader.exec_module(admission)


class AdmissionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.version = '0.1.0'
        self.source = '1' * 40
        self.archive = '2' * 64
        self.inventory = [{'path': 'manifest.json', 'sha256': '3' * 64, 'bytes': 20}]
        self.candidate = dict(runId=10, attempt=1, artifactId=20, artifactDigest='sha256:'+'4'*64,
                              archive='terraphim-editor-0.1.0.nimext', archiveSha256=self.archive,
                              archiveBytes=100, manifestSha256='3'*64, files=self.inventory)
        self.record = dict(version=self.version, tag='v0.1.0', sourceSha=self.source,
                           candidate=self.candidate, hosts={}, independentReview=None, synonymSearch=None, demo=None)
        self.host_hashes = {}
        for platform in admission.PLATFORMS:
            output = self.write(f'{platform}/actual.md', b'Actual validator fixture only.\n')
            receipt = dict(status='PASS', scope='actual-application', platform=platform, appVersion='0.80.6', architecture='arm64',
                           sourceSha=self.source, archiveSha256=self.archive, candidateArtifactId=20,
                           installedFiles=self.inventory, postRunFiles=self.inventory,
                           requirements=[dict(id=i,status='VERIFIED_FOR_TESTED_HOST',scenario='Constructed validator test',observed='not native evidence',evidenceClassification='actual-output',evidence=[output]) for i in admission.REQUIREMENTS],
                           clauses=[dict(id=i,status='PASS',scenario='Constructed validator test',observed='not native evidence',evidenceClassification='actual-output',evidence=[output]) for i in admission.CLAUSES],
                           externalProvider=dict(enabled=False,refusalEvidence=output))
            ref=self.write(f'{platform}/receipt.json',json.dumps(receipt).encode());self.record['hosts'][platform]=ref;self.host_hashes[platform]=ref['sha256']
        self.record['independentReview']=self.write('review.json',json.dumps(dict(status='PASS',kind='independent',reviewer='contract-test-only',sourceSha=self.source,archiveSha256=self.archive,hostReceiptSha256=self.host_hashes)).encode())
        self.record['synonymSearch']=self.write('search.json',json.dumps(dict(status='PASS',sourceSha=self.source,archiveSha256=self.archive,baselinePassages=0,sharedPassages=3,synthesisSamePassages=True,provider='contract-test',model='test',outputs=[self.write('retrieved.json',b'[]')])).encode())
        self.record['demo']=self.write('demo.json',json.dumps(dict(status='PASS',sourceSha=self.source,archiveSha256=self.archive,durationSeconds=75,narration='British female',captionsVerified=True,readabilityVerified=True,video=self.write('demo.mp4',b'validator video reference only'),captions=self.write('captions.vtt',b'WEBVTT\n'),download=self.write('example.zip',b'validator download reference only'),outputs=[self.write('demo-readback.json',b'{}')])).encode())

    def write(self,name,data):
        name=f'release/evidence/{self.version}/{name}';p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
        return dict(path=name,sha256=hashlib.sha256(data).hexdigest(),bytes=len(data))

    def validate(self,record=None):
        return admission.validate_record(record or self.record,self.root,self.source,'v0.1.0')

    def rewrite_host(self,fn):
        ref=self.record['hosts']['linux'];p=self.root/ref['path'];d=json.loads(p.read_text());fn(d);self.record['hosts']['linux']=self.write('linux/receipt.json',json.dumps(d).encode())

    def test_empty_production_registry_refuses(self):
        with self.assertRaisesRegex(ValueError,'not admitted'):
            admission.select_record({'schemaVersion':1,'releases':[]},'v0.1.0')

    def test_constructed_complete_contract_is_accepted_only_as_validator_data(self):
        self.validate()

    def test_missing_host_or_required_row_or_blocked_receipt_is_refused(self):
        for alter in [lambda r:r['hosts'].pop('windows'),lambda r:r.update(sourceSha='9'*40)]:
            r=copy.deepcopy(self.record);alter(r)
            with self.assertRaises(ValueError):self.validate(r)
        original=copy.deepcopy(self.record);host_path=self.root/self.record['hosts']['linux']['path'];host_bytes=host_path.read_bytes()
        for alter in [lambda r:r['requirements'].pop(),lambda r:r['requirements'].append(r['requirements'][0]),lambda r:r.update(status='BLOCKED_ONBOARDING'),lambda r:r.update(scope='component'),lambda r:r['clauses'].pop(),lambda r:r['requirements'][0].update(evidenceClassification='input')]:
            self.record=copy.deepcopy(original);host_path.write_bytes(host_bytes);self.rewrite_host(alter)
            with self.assertRaises(ValueError):self.validate()

    def test_changed_output_or_unsafe_path_is_refused(self):
        ref=self.record['hosts']['linux'];p=self.root/ref['path'];p.write_bytes(p.read_bytes()+b' ')
        with self.assertRaisesRegex(ValueError,'digest'):self.validate()
        with self.assertRaises(ValueError):admission.read_ref(self.root,dict(path='../outside',bytes=1,sha256='0'*64),'0.1.0')

    def test_missing_independent_review_or_wrong_host_binding_is_refused(self):
        self.record['independentReview']=self.write('review.json',json.dumps(dict(status='PASS',kind='independent',reviewer='test',sourceSha=self.source,archiveSha256=self.archive,hostReceiptSha256={})).encode())
        with self.assertRaises(ValueError):self.validate()

    def test_environment_requires_tag_boundary_not_new_reviewer_policy(self):
        env={'name':'nimbalyst-release','deployment_branch_policy':{'custom_branch_policies':True,'protected_branches':False},'protection_rules':[]}
        policies={'branch_policies':[{'name':'v0.1.0','type':'tag'}]}
        admission.validate_environment(env,policies,'v0.1.0')
        for e,p in [(None,policies),(env,{'branch_policies':[]}),(env,{'branch_policies':[{'name':'main','type':'branch'}]}),(dict(env,deployment_branch_policy=None),policies)]:
            with self.assertRaises(ValueError):admission.validate_environment(e,p,'v0.1.0')

    def test_candidate_run_attempt_and_artifact_identity(self):
        run=dict(repository={'full_name':'terraphim/nimbalyst-terraphim'},head_sha=self.source,head_branch='main',event='push',conclusion='success',status='completed',path='.github/workflows/component-ci.yml',run_attempt=1,id=10)
        artifact=dict(id=20,name=f'qualified-input-{self.source}-1',expired=False,digest=self.candidate['artifactDigest'],workflow_run={'id':10,'head_sha':self.source})
        admission.validate_candidate_metadata(self.record,run,artifact)
        for key,value in [('run_attempt',2),('event','pull_request'),('head_sha','9'*40),('conclusion','failure')]:
            changed={**run,key:value}
            with self.assertRaises(ValueError):admission.validate_candidate_metadata(self.record,changed,artifact)
        for key,value in [('expired',True),('id',21),('digest','sha256:'+'5'*64)]:
            with self.assertRaises(ValueError):admission.validate_candidate_metadata(self.record,run,{**artifact,key:value})

if __name__=='__main__':unittest.main()
