"""Validate the public Actions artifact digest and safe members before extraction."""
import argparse
import hashlib
import json
import re
import stat
import zipfile
from pathlib import Path, PurePosixPath

MAX_ARCHIVE = 256 * 1024 * 1024
MAX_EXPANDED = 512 * 1024 * 1024
MAX_MEMBERS = 2048


def extract(source, destination, expected_sha):
    if not re.fullmatch(r"[a-f0-9]{64}", expected_sha):
        raise ValueError('Invalid artifact digest')
    if source.stat().st_size > MAX_ARCHIVE:
        raise ValueError('Oversized artifact')
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected_sha:
        raise ValueError('Actual artifact digest differs from GitHub metadata')
    if destination.exists() or destination.is_symlink():
        raise ValueError('Artifact requires a fresh destination')
    with zipfile.ZipFile(source) as archive:
        members = archive.infolist()
        if not members or len(members) > MAX_MEMBERS or sum(m.file_size for m in members) > MAX_EXPANDED:
            raise ValueError('Invalid artifact size or member count')
        seen = set()
        files = {}
        for member in members:
            name = member.filename
            parts = PurePosixPath(name).parts
            mode = member.external_attr >> 16
            if (not parts or name != '/'.join(parts) or name.startswith('/') or chr(92) in name or ':' in name
                    or any(ord(c) < 32 or ord(c) == 127 for c in name)
                    or any(part in ('.', '..') or part.endswith((' ', '.')) or re.fullmatch(r"(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?", part) for part in parts)
                    or stat.S_IFMT(mode) not in (0, stat.S_IFREG) or member.flag_bits & 1
                    or name.casefold() in seen):
                raise ValueError('Unsafe or ambiguous artifact member')
            seen.add(name.casefold())
            files[name] = archive.read(member)
        for name in files:
            if any('/'.join(PurePosixPath(name).parts[:index]).casefold() in seen for index in range(1, len(PurePosixPath(name).parts))):
                raise ValueError('Artifact file/directory collision')
    destination.mkdir(parents=True)
    rows = []
    for name, content in sorted(files.items()):
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as output:
            output.write(content)
        actual = target.read_bytes()
        if actual != content:
            raise ValueError('Extracted artifact readback differs')
        rows.append({'path': name, 'bytes': len(actual), 'sha256': hashlib.sha256(actual).hexdigest()})
    return rows


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    parser.add_argument('sha256')
    parser.add_argument('receipt', type=Path)
    args = parser.parse_args()
    rows = extract(args.source, args.destination, args.sha256)
    args.receipt.write_text(json.dumps({'scope': 'Verified Actions artifact inputs only', 'archiveSha256': args.sha256, 'files': rows}, indent=2) + '\n')
