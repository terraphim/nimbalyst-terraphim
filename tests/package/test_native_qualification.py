"""Actual package verification/extraction and refusal checks, no host-success mocks."""
import hashlib
import importlib.util
import io
import json
import stat
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


package = load('actual_native_package', ROOT / 'scripts/package-native.py')
qualification = load('actual_native_qualification', ROOT / 'scripts/native/verify-candidate.py')


class QualificationTests(unittest.TestCase):
    def test_actual_candidate_is_extracted_exactly_and_existing_files_are_preserved(self):
        files = package.collect(ROOT)
        data = package.archive(files)
        receipt = package.verify(data, files)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'candidate.nimext'
            source.write_bytes(data)
            Path(str(source) + '.json').write_text(json.dumps(receipt))
            destination = root / 'profile/extensions/terraphim-editor'
            rows = qualification.verify_and_extract(source, destination, receipt['archiveSha256'])
            self.assertEqual(len(rows), len(files))
            for name, expected in files.items():
                actual = (destination / name).read_bytes()
                self.assertEqual(actual, expected)
                self.assertEqual(next(row for row in rows if row['path'] == name), {'path': name, 'bytes': len(actual), 'sha256': hashlib.sha256(actual).hexdigest()})
            with self.assertRaisesRegex(ValueError, 'fresh extension directory'):
                qualification.verify_and_extract(source, destination, receipt['archiveSha256'])
            self.assertEqual((destination / 'dist/index.js').read_bytes(), files['dist/index.js'])

    def test_post_run_readback_rejects_actual_file_changes_and_added_files(self):
        files = package.collect(ROOT)
        data = package.archive(files)
        receipt = package.verify(data, files)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'candidate.nimext'
            source.write_bytes(data)
            Path(str(source) + '.json').write_text(json.dumps(receipt))
            destination = root / 'installed'
            rows = qualification.verify_and_extract(source, destination, receipt['archiveSha256'])
            self.assertEqual(qualification.verify_and_extract(source, destination, receipt['archiveSha256'], verify_only=True), rows)
            target = destination / 'dist/index.js'
            target.write_bytes(target.read_bytes() + b'\nchanged on disk')
            with self.assertRaisesRegex(ValueError, 'Installed file digest mismatch'):
                qualification.verify_and_extract(source, destination, receipt['archiveSha256'], verify_only=True)
            target.write_bytes(files['dist/index.js'])
            (destination / 'unexpected.txt').write_bytes(b'unexpected actual file')
            with self.assertRaisesRegex(ValueError, 'Installed file inventory mismatch'):
                qualification.verify_and_extract(source, destination, receipt['archiveSha256'], verify_only=True)
            self.assertTrue((destination / 'unexpected.txt').exists())

    def test_actual_candidate_tampering_is_refused_before_creating_a_profile(self):
        files = package.collect(ROOT)
        data = package.archive(files)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'candidate.nimext'
            source.write_bytes(data[:-1] + bytes([data[-1] ^ 1]))
            destination = root / 'profile/extensions/terraphim-editor'
            with self.assertRaisesRegex(ValueError, 'explicit qualification input'):
                qualification.verify_and_extract(source, destination, hashlib.sha256(data).hexdigest())
            self.assertFalse(destination.exists())

    def test_altered_actual_member_inventory_is_refused_before_extraction(self):
        files = package.collect(ROOT)
        data = package.archive(files)
        receipt = package.verify(data, files)
        receipt['files'][0]['sha256'] = '0' * 64
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'candidate.nimext'
            source.write_bytes(data)
            Path(str(source) + '.json').write_text(json.dumps(receipt))
            destination = root / 'profile/extensions/terraphim-editor'
            with self.assertRaisesRegex(ValueError, 'member digest mismatch'):
                qualification.verify_and_extract(source, destination, receipt['archiveSha256'])
            self.assertFalse(destination.exists())


class ArtifactTests(unittest.TestCase):
    @staticmethod
    def archive(rows):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as target:
            for name, data, mode in rows:
                entry = zipfile.ZipInfo(name)
                entry.create_system = 3
                entry.external_attr = mode << 16
                target.writestr(entry, data)
        return output.getvalue()

    def test_actual_artifact_digest_and_all_file_bytes_are_preserved(self):
        extractor = load('artifact_extract', ROOT / 'scripts/native/extract-artifact.py')
        files = [('runtime.json', b'{"platform":"win32"}', stat.S_IFREG | 0o644),
                 ('native-package/candidate.nimext', b'actual candidate content', stat.S_IFREG | 0o644)]
        data = self.archive(files)
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / 'input.zip'
            source.write_bytes(data)
            destination = Path(temporary) / 'extracted'
            rows = extractor.extract(source, destination, hashlib.sha256(data).hexdigest())
            self.assertEqual(len(rows), 2)
            for name, content, _ in files:
                self.assertEqual((destination / name).read_bytes(), content)
            with self.assertRaisesRegex(ValueError, 'fresh'):
                extractor.extract(source, destination, hashlib.sha256(data).hexdigest())

    def test_artifact_digest_paths_links_and_case_collisions_are_refused_before_write(self):
        extractor = load('artifact_extract', ROOT / 'scripts/native/extract-artifact.py')
        bad_sets = [
            [('../escape', b'no', stat.S_IFREG | 0o644)],
            [('inside/link', b'../../escape', stat.S_IFLNK | 0o777)],
            [('same', b'a', stat.S_IFREG | 0o644), ('SAME', b'b', stat.S_IFREG | 0o644)],
            [('CON.txt', b'no', stat.S_IFREG | 0o644)],
            [('file./value', b'no', stat.S_IFREG | 0o644)],
            [('inside:stream', b'no', stat.S_IFREG | 0o644)],
        ]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for index, rows in enumerate(bad_sets):
                source = root / f'{index}.zip'
                data = self.archive(rows)
                source.write_bytes(data)
                destination = root / f'out-{index}'
                with self.assertRaises(ValueError):
                    extractor.extract(source, destination, hashlib.sha256(data).hexdigest())
                self.assertFalse(destination.exists())
            good = root / 'good.zip'
            good.write_bytes(self.archive([('safe', b'ok', stat.S_IFREG | 0o644)]))
            with self.assertRaisesRegex(ValueError, 'digest'):
                extractor.extract(good, root / 'bad-digest', '0' * 64)
            self.assertFalse((root / 'bad-digest').exists())
