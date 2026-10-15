"""Closed release admission over reviewed evidence; never native acceptance by itself."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat

REPOSITORY = 'terraphim/nimbalyst-terraphim'
WORKFLOW = '.github/workflows/component-ci.yml'
PLATFORMS = ('macos', 'windows', 'linux')
REQUIREMENTS = tuple(f'R-{chapter}.{number}' for chapter, count in [(2,7),(3,6),(4,6),(5,3),(6,5),(7,4),(8,7),(9,3)] for number in range(1,count+1))
CLAUSES = ('source-admission', 'opaque-frame-identity', 'role-graph', 'draft-recovery',
           'save-readback', 'save-races', 'external-conflicts', 'exports', 'open',
           'history', 'provider-boundary', 'synonym-search')
MAX_EVIDENCE_FILE = 32 * 1024 * 1024
MAX_EVIDENCE_TOTAL = 128 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def is_sha(value, size=64):
    return isinstance(value, str) and re.fullmatch(r'[0-9a-f]{'+str(size)+'}', value) is not None


def positive(value):
    return type(value) is int and 0 < value <= 2**53-1


def version_tag(tag):
    require(isinstance(tag,str) and re.fullmatch(r'v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)',tag), 'Only reviewed stable version tags can publish')
    return tag[1:]


def select_record(registry, tag):
    version=version_tag(tag)
    require(isinstance(registry,dict) and set(registry)=={'schemaVersion','releases'} and type(registry['schemaVersion']) is int and registry['schemaVersion']==1 and isinstance(registry['releases'],list), 'Invalid admission registry')
    require(len(registry['releases'])<=100, 'Oversized admission registry')
    matches=[r for r in registry['releases'] if isinstance(r,dict) and r.get('version')==version and r.get('tag')==tag]
    require(len(matches)==1, 'Release is not admitted or admission is ambiguous')
    return matches[0]


def safe_evidence_path(name, version):
    require(isinstance(name,str) and 0<len(name)<=240 and not any(ord(c)<32 or ord(c)==127 for c in name), 'Invalid evidence path')
    parts=PurePosixPath(name).parts
    require(name=='/'.join(parts) and '\\' not in name and ':' not in name and all(p not in ('.','..') for p in parts), 'Invalid evidence path')
    require(name.startswith(f'release/evidence/{version}/') and len(parts)>=4, 'Evidence must belong to this admitted version')
    return name


def read_ref(root, ref, version):
    require(isinstance(ref,dict) and set(ref)=={'path','bytes','sha256'}, 'Invalid evidence reference')
    name=safe_evidence_path(ref['path'],version)
    require(type(ref['bytes']) is int and 0<ref['bytes']<=MAX_EVIDENCE_FILE and is_sha(ref['sha256']), 'Invalid evidence size or digest')
    root=Path(root).resolve();p=root/name
    for parent in [p,*p.parents]:
        if parent==root:break
        require(not parent.is_symlink(), 'Evidence links refused')
    require(p.is_file() and stat.S_ISREG(p.lstat().st_mode), 'Missing evidence file')
    require(p.stat().st_size==ref['bytes'], 'Evidence size/digest mismatch')
    data=p.read_bytes();require(sha(data)==ref['sha256'], 'Evidence digest mismatch')
    return data


def read_json_ref(root, ref, version):
    return json.loads(read_ref(root,ref,version))


def check_rows(rows, expected, status, root, version):
    require(isinstance(rows,list) and len(rows)==len(expected), 'Missing required acceptance rows')
    require(all(isinstance(r,dict) for r in rows) and {r.get('id') for r in rows}==set(expected), 'Duplicate or unknown acceptance row')
    for row in rows:
        require(row.get('status')==status, 'Required acceptance row has not passed')
        require(all(isinstance(row.get(k),str) and 0<len(row[k])<=4096 for k in ('scenario','observed')), 'Acceptance needs actual scenario and observed outcome')
        require(row.get('evidenceClassification') in ('actual-output','actual-capture'),'Input fixtures cannot qualify an observed outcome')
        refs=row.get('evidence');require(isinstance(refs,list) and 0<len(refs)<=32,'Acceptance needs observed output evidence')
        for ref in refs:read_ref(root,ref,version)


def check_inventory(rows):
    require(isinstance(rows,list) and 0<len(rows)<=80,'Invalid package inventory')
    names=[]
    for row in rows:
        require(isinstance(row,dict) and set(row)=={'path','bytes','sha256'}, 'Invalid package member')
        name=row['path'];require(isinstance(name,str) and name==str(PurePosixPath(name)) and not name.startswith('/') and '\\' not in name and ':' not in name and not any(p in ('.','..') for p in PurePosixPath(name).parts), 'Invalid package member path')
        require(type(row['bytes']) is int and 0<=row['bytes']<=24*1024*1024 and is_sha(row['sha256']),'Invalid member digest/size')
        names.append(name)
    require(names==sorted(set(names)) and 'manifest.json' in names,'Package inventory must be unique/sorted/complete')


def validate_record(record, root, source, tag):
    version=version_tag(tag)
    require(is_sha(source,40) and record.get('sourceSha')==source and record.get('tag')==tag and record.get('version')==version,'Admission source/tag mismatch')
    candidate=record.get('candidate',{})
    require(all(positive(candidate.get(k)) for k in ('runId','attempt','artifactId','archiveBytes')),'Invalid immutable candidate identity')
    require(is_sha(candidate.get('archiveSha256')) and is_sha(candidate.get('manifestSha256')) and isinstance(candidate.get('artifactDigest'),str) and re.fullmatch(r'sha256:[0-9a-f]{64}',candidate['artifactDigest']), 'Invalid candidate hashes')
    require(candidate.get('archive')==f'terraphim-editor-{version}.nimext' and candidate['archiveBytes']<=24*1024*1024,'Unreviewed archive identity')
    check_inventory(candidate.get('files'))
    require(candidate['manifestSha256']==next(f['sha256'] for f in candidate['files'] if f['path']=='manifest.json'),'Manifest digest not bound to inventory')
    hosts=record.get('hosts');require(isinstance(hosts,dict) and set(hosts)==set(PLATFORMS),'Exactly three actual native hosts required')
    host_hashes={}
    for platform,ref in hosts.items():
        host=read_json_ref(root,ref,version);host_hashes[platform]=ref['sha256']
        require(host.get('status')=='PASS' and host.get('scope')=='actual-application' and host.get('platform')==platform,'Native host is blocked or unqualified')
        require(all(isinstance(host.get(k),str) and 0<len(host[k])<=128 for k in ('appVersion','architecture')),'Missing native runtime identity')
        require(host.get('sourceSha')==source and host.get('archiveSha256')==candidate['archiveSha256'] and host.get('candidateArtifactId')==candidate['artifactId'],'Host used a different candidate')
        require(host.get('installedFiles')==candidate['files'] and host.get('postRunFiles')==candidate['files'],'Actual installed bytes not preserved')
        check_rows(host.get('requirements'),REQUIREMENTS,'VERIFIED_FOR_TESTED_HOST',root,version)
        check_rows(host.get('clauses'),CLAUSES,'PASS',root,version)
        provider=host.get('externalProvider',{})
        require(type(provider.get('enabled')) is bool,'Provider qualification boundary missing')
        if provider['enabled']:
            require(provider.get('status')=='PASS' and all(isinstance(provider.get(k),str) and provider[k] for k in ('provider','model')),'Enabled provider unqualified')
            read_ref(root,provider.get('evidence'),version)
        else:read_ref(root,provider.get('refusalEvidence'),version)
    review=read_json_ref(root,record.get('independentReview'),version)
    require(review.get('status')=='PASS' and review.get('kind')=='independent' and isinstance(review.get('reviewer'),str) and bool(review['reviewer']),'Independent evidence review missing')
    require(review.get('sourceSha')==source and review.get('archiveSha256')==candidate['archiveSha256'] and review.get('hostReceiptSha256')==host_hashes,'Review binds different host receipts')
    for kind in ('synonymSearch','demo'):
        result=read_json_ref(root,record.get(kind),version)
        require(result.get('status')=='PASS' and result.get('sourceSha')==source and result.get('archiveSha256')==candidate['archiveSha256'],'Unqualified demo/search package')
        refs=result.get('outputs');require(isinstance(refs,list) and 0<len(refs)<=32,'Missing actual demo/search outputs')
        for ref in refs:read_ref(root,ref,version)
        if kind=='synonymSearch':
            require(type(result.get('baselinePassages')) is int and result['baselinePassages']==0 and type(result.get('sharedPassages')) is int and result['sharedPassages']>0 and result.get('synthesisSamePassages') is True and all(isinstance(result.get(k),str) and result[k] for k in ('provider','model')),'Synonym/synthesis comparison incomplete')
        else:
            require(type(result.get('durationSeconds')) in (int,float) and 60<=result['durationSeconds']<=90 and result.get('narration')=='British female' and result.get('captionsVerified') is True and result.get('readabilityVerified') is True,'Required narrated/captioned demo incomplete')
            for field,suffix in (('video','.mp4'),('captions','.vtt'),('download','.zip')):
                ref=result.get(field);read_ref(root,ref,version);require(ref['path'].endswith(suffix),'Missing actual demo media/download reference')
    return record


def validate_environment(environment, policies, tag):
    require(isinstance(environment,dict) and environment.get('name')=='nimbalyst-release','Protected release environment must already exist')
    require(environment.get('deployment_branch_policy')=={'protected_branches':False,'custom_branch_policies':True},'Release environment must enforce selected tags')
    rows=policies.get('branch_policies') if isinstance(policies,dict) else None
    require(isinstance(rows,list) and len(rows)==1 and rows[0].get('type')=='tag' and rows[0].get('name')==tag,'Only the exact reviewed tag may deploy')
    # Existing reviewer/custom policies remain GitHub-enforced. No new reviewer or self-review rule is imposed.


def validate_candidate_metadata(record, run, artifact):
    c=record['candidate'];source=record['sourceSha']
    require(run.get('repository',{}).get('full_name')==REPOSITORY and run.get('path')==WORKFLOW and run.get('head_sha')==source and run.get('head_branch')=='main' and run.get('event')=='push' and run.get('status')=='completed' and run.get('conclusion')=='success' and run.get('run_attempt')==c['attempt'] and run.get('id')==c['runId'],'Candidate requires exact successful main source/run/attempt')
    require(artifact.get('id')==c['artifactId'] and artifact.get('name')==f'qualified-input-{source}-{c["attempt"]}' and artifact.get('expired') is False and artifact.get('digest')==c['artifactDigest'] and artifact.get('workflow_run',{}).get('id')==c['runId'] and artifact.get('workflow_run',{}).get('head_sha')==source,'Candidate artifact identity mismatch')
