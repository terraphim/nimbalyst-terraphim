"""Actual disposable Git histories, without network or host acceptance claims."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/release'))
import deliver


class LineageTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.addCleanup(self.temporary.cleanup);self.root=Path(self.temporary.name)
        self.git('init','-q','--initial-branch=main')
        for name in ('.github/workflows/release.yml','scripts/release/admission.py','scripts/package-native.py','scripts/native/extract-artifact.py'):
            p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('Fixed test source\n')
        self.source=self.commit();self.git('tag','v0.1.0')
        (self.root/'release').mkdir();(self.root/'release/qualified.json').write_text('{"schemaVersion":1,"releases":[]}\n');self.admission=self.commit()

    def git(self,*args):
        return subprocess.check_output(['git',*args],cwd=self.root,stderr=subprocess.PIPE).decode().strip()

    def commit(self):
        self.git('add','.')
        self.git('-c','user.name=Release contract test','-c','user.email=contract@example.invalid','-c','commit.gpgsign=false','commit','-qm','test fixture')
        return self.git('rev-parse','HEAD')

    def test_later_data_only_admission_is_accepted(self):
        deliver.verify_lineage(self.root,self.source,self.admission,self.admission,'v0.1.0')

    def test_changed_publishing_code_refuses(self):
        (self.root/'scripts/release/admission.py').write_text('Different test source\n');changed=self.commit()
        with self.assertRaisesRegex(ValueError,'different'):deliver.verify_lineage(self.root,self.source,changed,changed,'v0.1.0')

    def test_wrong_tag_or_non_main_admission_refuses(self):
        self.git('tag','v0.2.0',self.admission)
        with self.assertRaisesRegex(ValueError,'Tag'):deliver.verify_lineage(self.root,self.source,self.admission,self.admission,'v0.2.0')
        self.git('checkout','-qb','unmerged',self.source);(self.root/'unmerged.txt').write_text('not main\n');unmerged=self.commit()
        with self.assertRaisesRegex(ValueError,'canonical main'):deliver.verify_lineage(self.root,self.source,unmerged,self.admission,'v0.1.0')

if __name__=='__main__':unittest.main()
