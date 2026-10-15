#!/usr/bin/env python3
"""Deterministic development-candidate archive; it never publishes a release."""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import struct
import zipfile

MAX_ARCHIVE = 24 * 1024 * 1024
MAX_FILES = 80


def sha(data):
    return hashlib.sha256(data).hexdigest()


def safe_name(name):
    if not isinstance(name, str):
        raise ValueError('Noncanonical package path')
    parts = PurePosixPath(name).parts
    if not isinstance(name, str) or not parts or name != '/'.join(parts) or name.startswith('/') or '\\' in name or ':' in name or any(part in ('', '.', '..') for part in parts) or any(ord(c) < 32 or ord(c) == 127 for c in name):
        raise ValueError('Noncanonical package path')
    return name


def collect(root):
    root = Path(root)
    manifest_path = root / 'manifest.json'
    if not stat.S_ISREG(manifest_path.lstat().st_mode):
        raise ValueError('Manifest is not a regular file')
    manifest = json.loads(manifest_path.read_bytes())
    if set(manifest) != {'id', 'name', 'version', 'description', 'main', 'styles', 'apiVersion', 'permissions', 'contributions'} or manifest['id'] != 'terraphim-editor' or manifest['version'] != '0.1.0-dev.1' or manifest['main'] != 'dist/index.js' or manifest['styles'] != 'dist/index.css' or manifest['apiVersion'] != '1.0.0' or manifest['permissions'] != {'filesystem': True} or manifest['contributions'] != {'customEditors': [{'filePatterns': ['*.terraphim.md'], 'displayName': 'Terraphim Editor', 'component': 'TerraphimEditor', 'supportsSourceMode': False, 'supportsDiffMode': False, 'supportsTranscriptEmbed': False, 'collaboration': {'supported': False}}]}:
        raise ValueError('Unreviewed native manifest or permissions')
    files = {'manifest.json': manifest_path.read_bytes()}
    dist = root / 'dist'
    if not stat.S_ISDIR(dist.lstat().st_mode):
        raise ValueError('Package dist is not a directory')
    for directory, dirs, names in os.walk(dist, followlinks=False):
        for name in dirs + names:
            path = Path(directory) / name
            mode = path.lstat().st_mode
            if stat.S_ISLNK(mode) or not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
                raise ValueError('Package links or special files refused')
            if stat.S_ISDIR(mode):
                continue
            relative = safe_name(path.relative_to(root).as_posix())
            if relative not in ('dist/index.js', 'dist/index.css', 'dist/assets.json') and not relative.startswith('dist/licenses/'):
                raise ValueError('Undeclared native package file')
            files[relative] = path.read_bytes()
    if not {'dist/index.js', 'dist/index.css', 'dist/assets.json'} <= files.keys() or len(files) > MAX_FILES or sum(map(len, files.values())) > MAX_ARCHIVE:
        raise ValueError('Incomplete or oversized native package')
    assets = json.loads(files['dist/assets.json'])
    if assets['editorArchiveSha256'] != 'daa104aecdca43df5ca6dcf36b420351be09784a8436ab61bd3fc9acb1504e73' or assets['sdk'] != '0.7.0' or len(assets['embeddedAssets']) != 13:
        raise ValueError('Unreviewed embedded assets')
    # Cross-check the build metadata against actual verified build inputs, not its own hashes alone.
    expected_embedded = []
    for group in ('frame', 'visual'):
        inputs = json.loads((root / '.cache/contracts' / group / 'manifest.json').read_bytes())
        for name, entry in inputs.items():
            filename = entry['url'].split('/')[-1]
            path = root / '.cache/contracts' / group / filename
            if not stat.S_ISREG(path.lstat().st_mode):
                raise ValueError('Embedded input is not a regular file')
            data = path.read_bytes()
            if sha(data) != entry['sha256'] or len(data) != entry['bytes'] or base64.b64encode(data) not in files['dist/index.js']:
                raise ValueError('Compiled embedded asset mismatch')
            expected_embedded.append({'group': group, 'name': name, 'sha256': sha(data), 'bytes': len(data)})
    if sorted(assets['embeddedAssets'], key=lambda item: (item['group'], item['name'])) != sorted(expected_embedded, key=lambda item: (item['group'], item['name'])):
        raise ValueError('Embedded manifest mismatch')
    release = json.loads((root / 'docs/recovery/released-assets-manifest.json').read_bytes())
    original_licenses = {'dist/licenses/terraphim.txt': root / 'LICENSE', 'dist/licenses/terraphim-host-bridge.txt': root / 'vendor/terraphim-host-bridge/LICENSE', 'dist/licenses/nimbalyst-sdk.txt': root / 'node_modules/@nimbalyst/extension-sdk/LICENSE'}
    for name, expected_hash in release['assets'].items():
        if any(part.upper().startswith(('LICENSE', 'COPYING', 'NOTICE')) for part in PurePosixPath(name).parts):
            source = root / '.cache/released-editor' / name
            if not stat.S_ISREG(source.lstat().st_mode) or sha(source.read_bytes()) != expected_hash:
                raise ValueError('Original release license changed')
            original_licenses['dist/licenses/released/' + name] = source
    expected_licenses = {entry['path'] for entry in assets['licenses']}
    if set(original_licenses) != expected_licenses or any(files[name] != source.read_bytes() for name, source in original_licenses.items()):
        raise ValueError('License provenance mismatch')
    if {name for name in files if name.startswith('dist/licenses/')} != expected_licenses or len(expected_licenses) != 15:
        raise ValueError('Incomplete license notices')
    for entry in assets['licenses']:
        data = files[safe_name(entry['path'])]
        if len(data) != entry['bytes'] or sha(data) != entry['sha256']:
            raise ValueError('Changed license notice')
    return files


def archive(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as target:
        for name, data in sorted(files.items()):
            entry = zipfile.ZipInfo(safe_name(name), date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = (stat.S_IFREG | 0o644) << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            target.writestr(entry, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return output.getvalue()


def verify(data, files):
    if len(data) > MAX_ARCHIVE:
        raise ValueError('Archive too large')
    if not data.startswith(b'PK\x03\x04') or len(data) < 22 or data[-22:-18] != b'PK\x05\x06' or data[-2:] != b'\x00\x00':
        raise ValueError('Noncanonical archive envelope')
    with zipfile.ZipFile(io.BytesIO(data)) as package:
        members = package.infolist()
        if len(members) != len(files) or len({member.filename for member in members}) != len(members):
            raise ValueError('Duplicate or missing archive members')
        if {member.filename for member in members} != set(files):
            raise ValueError('Unexpected archive paths')
        offset = 0
        for member in members:
            safe_name(member.filename)
            if member.header_offset != offset or member.extra or member.comment or member.flag_bits & ~0x800:
                raise ValueError('Noncanonical archive member')
            header = struct.unpack_from('<4s5H3I2H', data, offset)
            if header[0] != b'PK\x03\x04' or header[-1] != 0:
                raise ValueError('Invalid local archive header')
            offset += 30 + header[-2] + header[-1] + member.compress_size
            if member.file_size != len(files[member.filename]) or not stat.S_ISREG(member.external_attr >> 16) or member.flag_bits & 1:
                raise ValueError('Invalid archive member')
            if package.read(member) != files[member.filename]:
                raise ValueError('Changed archive content')
        central_offset = struct.unpack_from('<I', data, len(data) - 6)[0]
        if offset != central_offset:
            raise ValueError('Unexpected archive gap')
    return {'archiveSha256': sha(data), 'archiveBytes': len(data), 'files': [{'path': name, 'sha256': sha(value), 'bytes': len(value)} for name, value in sorted(files.items())]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default='.')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    files = collect(args.root)
    data = archive(files)
    receipt = verify(data, files)
    if archive(files) != data:
        raise ValueError('Nondeterministic package bytes')
    destination = Path(args.output)
    receipt_path = Path(str(destination) + '.json')
    if destination.exists() or destination.is_symlink() or receipt_path.exists() or receipt_path.is_symlink():
        raise ValueError('Candidate destination already exists')
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Existing candidates are immutable; select a fresh path rather than replacing one.
    with destination.open('xb') as output:
        output.write(data)
    with receipt_path.open('x') as output:
        json.dump({'scope': 'development candidate; native three-OS and all41 qualification pending', **receipt}, output, indent=2)
        output.write('\n')
    print(json.dumps({'path': str(destination), 'sha256': receipt['archiveSha256'], 'files': len(files)}))


if __name__ == '__main__':
    main()
