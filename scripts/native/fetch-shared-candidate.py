"""Opt-in original shared CI artifact; the existing Windows candidate route is unchanged."""
import argparse
from pathlib import Path
import re
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'release'))
from admission import is_sha, require, positive
from candidate import fetch


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for key in ('run','attempt','artifact'):parser.add_argument('--'+key,type=int,required=True)
    for key in ('source','digest','archive','sha256'):parser.add_argument('--'+key,required=True)
    parser.add_argument('--destination',type=Path,required=True);a=parser.parse_args()
    require(all(positive(v) for v in (a.run,a.attempt,a.artifact)) and is_sha(a.source,40) and is_sha(a.sha256) and re.fullmatch(r'sha256:[a-f0-9]{64}',a.digest),'Explicit immutable candidate identity required')
    require(re.fullmatch(r'terraphim-editor-[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.]+)?\.nimext',a.archive),'Invalid original archive name')
    fetch(dict(sourceSha=a.source,candidate=dict(runId=a.run,attempt=a.attempt,artifactId=a.artifact,artifactDigest=a.digest,archive=a.archive,archiveSha256=a.sha256)),a.destination)

if __name__=='__main__':main()
