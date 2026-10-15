"""Check a hash-pinned CI candidate before extracting it into a fresh app profile."""
import argparse
import hashlib
import importlib.util
import json
import os
import stat
import zipfile
from pathlib import Path


def read_installed_files(destination, files):
    if destination.is_symlink() or not destination.is_dir():
        raise ValueError('Installed extension is not a regular directory')
    actual_paths = set()
    for directory, directories, names in os.walk(destination, followlinks=False):
        for name in directories + names:
            target = Path(directory) / name
            mode = target.lstat().st_mode
            if stat.S_ISLNK(mode) or not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
                raise ValueError('Installed link or special file refused')
            if stat.S_ISREG(mode):
                actual_paths.add(target.relative_to(destination).as_posix())
    if actual_paths != set(files):
        raise ValueError('Installed file inventory mismatch')
    rows = []
    for name, expected in sorted(files.items()):
        actual = (destination / name).read_bytes()
        if actual != expected:
            raise ValueError('Installed file digest mismatch: ' + name)
        rows.append({'path': name, 'bytes': len(actual), 'sha256': hashlib.sha256(actual).hexdigest()})
    return rows


def verify_and_extract(package_path, destination, expected_sha, *, verify_only=False):
    data = package_path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected_sha:
        raise ValueError('Candidate bytes differ from explicit qualification input')
    sidecar = json.loads(Path(str(package_path) + '.json').read_bytes())
    if sidecar['archiveSha256'] != expected_sha or sidecar['archiveBytes'] != len(data):
        raise ValueError('Candidate sidecar mismatch')
    spec = importlib.util.spec_from_file_location('native_package', Path(__file__).parents[1] / 'package-native.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if len(data) > module.MAX_ARCHIVE:
        raise ValueError('Oversized candidate archive')
    with zipfile.ZipFile(package_path) as archive:
        members = archive.infolist()
        if len(members) > module.MAX_FILES or sum(member.file_size for member in members) > module.MAX_ARCHIVE:
            raise ValueError('Oversized expanded candidate')
        for member in members:
            module.safe_name(member.filename)
        files = {member.filename: archive.read(member) for member in archive.infolist()}
    module.verify(data, files)
    if sorted(files) != sorted(row['path'] for row in sidecar['files']):
        raise ValueError('Candidate file inventory mismatch')
    for row in sidecar['files']:
        if len(files[row['path']]) != row['bytes'] or hashlib.sha256(files[row['path']]).hexdigest() != row['sha256']:
            raise ValueError('Candidate member digest mismatch')
    manifest = json.loads(files['manifest.json'])
    if manifest['id'] != 'terraphim-editor' or manifest['main'] != 'dist/index.js':
        raise ValueError('Unexpected extension identity')
    if verify_only:
        return read_installed_files(destination, files)
    if destination.exists() or destination.is_symlink():
        raise ValueError('Native qualification requires a fresh extension directory')
    destination.mkdir(parents=True)
    for name, content in files.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    return read_installed_files(destination, files)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--destination', type=Path, required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--receipt', type=Path, required=True)
    parser.add_argument('--verify-installed', action='store_true')
    args = parser.parse_args()
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    result = {'scope': 'Actual installed-file readback; separate from native functionality qualification', 'phase': 'post-run' if args.verify_installed else 'installation', 'archiveSha256': args.sha256}
    try:
        files = verify_and_extract(args.package, args.destination, args.sha256, verify_only=args.verify_installed)
        result.update(status='PASS', files=files)
    except Exception as error:
        result.update(status='FAIL', error=str(error))
        args.receipt.write_text(json.dumps(result, indent=2) + '\n')
        raise
    args.receipt.write_text(json.dumps(result, indent=2) + '\n')
