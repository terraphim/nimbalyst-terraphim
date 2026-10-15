"""Repository-specific admission, immutable publication and public byte readback."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from admission import (REPOSITORY, MAX_EVIDENCE_FILE, MAX_EVIDENCE_TOTAL, is_sha,
                       require, select_record, safe_evidence_path, validate_record,
                       validate_environment, version_tag, sha)
from candidate import api, fetch

ROOT=Path(__file__).resolve().parents[2]


def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,timeout=120,stderr=subprocess.PIPE)


def read_at(commit,path,maximum=1024*1024):
    size=int(git('cat-file','-s',f'{commit}:{path}'))
    require(size<=maximum,'Oversized reviewed record')
    return git('show',f'{commit}:{path}')


def verify_lineage(root,source,admission_commit,main,tag):
    def local_git(*args):return subprocess.check_output(['git',*args],cwd=root,timeout=120,stderr=subprocess.PIPE)
    require(all(is_sha(value,40) for value in (source,admission_commit,main)),'Invalid commit identity')
    version_tag(tag)
    for commit in (source,admission_commit):
        require(subprocess.run(['git','merge-base','--is-ancestor',commit,main],cwd=root,capture_output=True).returncode==0,'Source and admission must be on canonical main')
    require(local_git('rev-parse','refs/tags/'+tag+'^{commit}').decode().strip()==source,'Tag does not resolve to candidate source')
    for path in ['.github/workflows/release.yml','scripts/release','scripts/package-native.py','scripts/native/extract-artifact.py']:
        before=local_git('ls-tree','-r',source,'--',path);after=local_git('ls-tree','-r',admission_commit,'--',path)
        require(bool(before) and before==after,'Admission reviewed different or missing publication code')


def trusted_context(admission_commit):
    require(os.environ.get('GITHUB_REPOSITORY')==REPOSITORY,'Wrong release repository')
    ref=os.environ.get('GITHUB_REF','');require(ref.startswith('refs/tags/'),'Dispatch must use the reviewed immutable tag')
    tag=ref[len('refs/tags/'):];version_tag(tag)
    source=git('rev-parse','HEAD').decode().strip()
    require(source==os.environ.get('GITHUB_WORKFLOW_SHA')==os.environ.get('GITHUB_SHA'),'Workflow/source identity differs')
    require(os.environ.get('GITHUB_WORKFLOW_REF')==f'{REPOSITORY}/.github/workflows/release.yml@{ref}','Unexpected workflow ref')
    require(is_sha(admission_commit,40),'Admission commit must be immutable')
    main=api('commits/main')['sha'];require(is_sha(main,40),'Invalid canonical main identity')
    # Only fixed public repository objects are fetched; input code is never checked out/executed.
    for commit in (main,admission_commit):
        subprocess.run(['git','fetch','--no-tags',f'https://github.com/{REPOSITORY}.git',commit],cwd=ROOT,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=120)
    verify_lineage(ROOT,source,admission_commit,main,tag)
    return tag,source,main


def materialize_evidence(commit,version,destination):
    prefix=f'release/evidence/{version}/';rows=git('ls-tree','-r','-l','-z',commit,'--',prefix).split(b'\0')
    total=0;count=0
    for row in rows:
        if not row:continue
        metadata,rawpath=row.split(b'\t',1);mode,kind,_,size=metadata.decode().split();name=rawpath.decode('utf-8');safe_evidence_path(name,version)
        size=int(size);total+=size;count+=1
        require(mode=='100644' and kind=='blob' and size<=MAX_EVIDENCE_FILE and total<=MAX_EVIDENCE_TOTAL and count<=512,'Unsafe or oversized public qualification evidence')
        target=destination/name;target.parent.mkdir(parents=True,exist_ok=True)
        with target.open('xb') as output:output.write(read_at(commit,name,MAX_EVIDENCE_FILE))
    require(count>0,'No reviewed native evidence')


def prepare(admission_commit,destination):
    require(not destination.exists() and not destination.is_symlink(),'Preflight requires fresh directory')
    tag,source,main=trusted_context(admission_commit)
    registry=json.loads(read_at(admission_commit,'release/qualified.json'))
    record=select_record(registry,tag)  # Empty registry refuses before environment or upload.
    require(record.get('sourceSha')==source,'Tag does not match admitted candidate source')
    environment=api('environments/nimbalyst-release');policies=api('environments/nimbalyst-release/deployment-branch-policies')
    validate_environment(environment,policies,tag)
    destination.mkdir(parents=True)
    materialize_evidence(admission_commit,record['version'],destination/'evidence')
    validate_record(record,destination/'evidence',source,tag)
    fetched=fetch(record,destination/'original')
    package=Path(fetched['packagePath']);public=destination/'public';public.mkdir()
    shutil.copyfile(package,public/package.name);shutil.copyfile(Path(str(package)+'.json'),public/(package.name+'.json'))
    summary=dict(scope='Independently reviewed native qualification; catalogue admission remains separate',repository=REPOSITORY,tag=tag,sourceSha=source,admissionCommit=admission_commit,candidate=record['candidate'],hosts=record['hosts'],independentReview=record['independentReview'],synonymSearch=record['synonymSearch'],demo=record['demo'],evidenceBase=f'https://github.com/{REPOSITORY}/blob/{admission_commit}/')
    (public/'qualification.json').write_text(json.dumps(summary,indent=2)+'\n')
    assets=[dict(name=p.name,bytes=p.stat().st_size,sha256=sha(p.read_bytes())) for p in sorted(public.iterdir())]
    (public/'SHA256SUMS').write_text(''.join(f'{r["sha256"]}  {r["name"]}\n' for r in assets))
    assets.append(dict(name='SHA256SUMS',bytes=(public/'SHA256SUMS').stat().st_size,sha256=sha((public/'SHA256SUMS').read_bytes())))
    receipt=dict(status='ADMITTED_INPUTS_ONLY',tag=tag,sourceSha=source,canonicalMain=main,admissionCommit=admission_commit,assets=assets,candidate=record['candidate'],environmentPolicy=policies)
    (destination/'preflight.json').write_text(json.dumps(receipt,indent=2)+'\n');return receipt


def download_exact(url,path,expected):
    """Read anonymous response bytes, enforcing size and recording actual hash before comparison."""
    digest=hashlib.sha256();count=0
    try:
        response=urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'terraphim-nimbalyst-release-check'}),timeout=60)
    except urllib.error.HTTPError as error:
        status=error.code;error.close();raise ValueError(f'Public asset HTTP {status}') from error
    with response, path.open('xb') as output:
        require(response.status==200,'Public asset HTTP failure')
        while chunk:=response.read(min(1024*1024,expected['bytes']+1-count)):
            count+=len(chunk);digest.update(chunk);output.write(chunk)
            if count>expected['bytes']:break
    result=dict(url=url,bytes=count,sha256=digest.hexdigest(),expected=expected)
    result['status']='PASS' if count==expected['bytes'] and result['sha256']==expected['sha256'] else 'FAIL'
    return result


def verify_public(directory,release=None):
    receipt=json.loads((directory/'preflight.json').read_bytes());tag=receipt['tag'];assets=receipt['assets']
    if release is None:
        url=f'https://api.github.com/repos/{REPOSITORY}/releases/tags/{urllib.parse.quote(tag,safe="")}'
        with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'terraphim-nimbalyst-release-check'}),timeout=60) as response:release=json.load(response)
    require(release.get('tag_name')==tag and release.get('draft') is False and release.get('prerelease') is False,'Public stable release identity mismatch')
    actual=release.get('assets',[]);require(len(actual)==len(assets) and {a['name'] for a in actual}=={a['name'] for a in assets},'Existing public release is partial or has extra assets; replacement refused')
    destination=directory/'anonymous-readback';destination.mkdir(exist_ok=False);rows=[]
    try:
        for expected in assets:
            url=f'https://github.com/{REPOSITORY}/releases/download/{urllib.parse.quote(tag,safe="")}/{urllib.parse.quote(expected["name"],safe="")}'
            row=download_exact(url,destination/expected['name'],expected);rows.append(row);require(row['status']=='PASS','Anonymous public bytes differ')
    finally:
        (directory/'public-readback.json').write_text(json.dumps(dict(status='PASS' if len(rows)==len(assets) and all(r['status']=='PASS' for r in rows) else 'FAIL',releaseId=release['id'],assets=rows),indent=2)+'\n')
    return rows


def publish(directory):
    receipt=json.loads((directory/'preflight.json').read_bytes());tag=receipt['tag'];public=directory/'public'
    for row in receipt['assets']:
        p=public/row['name'];require(p.is_file() and p.stat().st_size==row['bytes'] and sha(p.read_bytes())==row['sha256'],'Prepared public bytes changed')
    # A fresh prepare runs inside this job immediately before publish. Never rebuild or replace assets.
    query=subprocess.run(['gh','api',f'repos/{REPOSITORY}/releases/tags/{tag}'],capture_output=True,text=True,timeout=120)
    if query.returncode==0:
        print('Existing release: no create, upload or replacement; exact anonymous verification required.')
    else:
        require('HTTP 404' in query.stderr,'Cannot establish that release is absent')
        notes=directory/'release-notes.md';notes.write_text('Terraphim Editor for Nimbalyst '+receipt['tag']+'\n\nOriginal CI artifact and independently reviewed native qualification. See qualification.json. Central catalogue admission is separate.\n')
        subprocess.run(['gh','release','create',tag,'--repo',REPOSITORY,'--verify-tag','--title','Terraphim Editor '+tag,'--notes-file',str(notes),*[str(public/r['name']) for r in receipt['assets']]],check=True,timeout=300)
    # No authorization header/token is used for the mandatory public response checks.
    return verify_public(directory)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('command',choices=['prepare','publish']);parser.add_argument('--admission-commit');parser.add_argument('--destination',type=Path,required=True);args=parser.parse_args()
    try:
        if args.command=='prepare':prepare(args.admission_commit,args.destination)
        else:publish(args.destination)
    except Exception as error:
        args.destination.mkdir(parents=True,exist_ok=True)
        (args.destination/'failure.json').write_text(json.dumps(dict(status='FAIL',step=args.command,error=str(error)),indent=2)+'\n')
        raise

if __name__=='__main__':main()
