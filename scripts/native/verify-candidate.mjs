/** Bind an actual successful main component run to the requested native package. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export function qualifyRun(run,sourceSha){
 if(!/^[a-f0-9]{40}$/.test(sourceSha)||run.repository?.full_name!=='terraphim/nimbalyst-terraphim'||run.head_sha!==sourceSha||run.head_branch!=='main'||run.event!=='push'||run.conclusion!=='success'||run.status!=='completed'||run.path!=='.github/workflows/component-ci.yml')throw Error('Native qualification requires the exact successful main component run');
 return `component-evidence-windows-2025-${sourceSha}`;
}
export function qualifyArtifact(response,name){const matches=response.artifacts?.filter(a=>a.name===name&&!a.expired&&Number.isSafeInteger(a.id)&&a.id>0&&/^sha256:[a-f0-9]{64}$/.test(a.digest));if(matches?.length!==1)throw Error('Missing, ambiguous or expired candidate artifact');return matches[0]}
async function main(){
 const [runId,sourceSha,candidateSha,destination]=process.argv.slice(2);if(!/^\d+$/.test(runId??'')||!Number.isSafeInteger(Number(runId))||!Number(runId)||!(/^[a-f0-9]{64}$/).test(candidateSha??'')||!destination)throw Error('Explicit immutable native qualification inputs required');
 const dir=resolve(destination);await mkdir(dir,{recursive:true});
 const api=path=>JSON.parse(execFileSync('gh',['api',path],{encoding:'utf8',maxBuffer:2*1024*1024,timeout:120000}));
 const run=api(`repos/terraphim/nimbalyst-terraphim/actions/runs/${runId}`),name=qualifyRun(run,sourceSha),artifact=qualifyArtifact(api(`repos/terraphim/nimbalyst-terraphim/actions/runs/${runId}/artifacts`),name);
 await writeFile(join(dir,'run.json'),JSON.stringify(run,null,2)+'\n');await writeFile(join(dir,'artifact.json'),JSON.stringify(artifact,null,2)+'\n');
 const archivePath=join(dir,'component-artifact.zip'),fd=openSync(archivePath,'wx');
 try{execFileSync('gh',['api',`repos/terraphim/nimbalyst-terraphim/actions/artifacts/${artifact.id}/zip`],{stdio:['ignore',fd,'pipe'],timeout:300000})}finally{closeSync(fd)}
 execFileSync(process.platform==='win32'?'python':'python3',['scripts/native/extract-artifact.py',archivePath,join(dir,'candidate'),artifact.digest.slice(7),join(dir,'artifact-extraction.json')],{stdio:'pipe',timeout:120000});
 const runtime=JSON.parse(await readFile(join(dir,'candidate/runtime.json'),'utf8'));if(runtime.source!==sourceSha||runtime.platform!=='win32')throw Error('Artifact runtime identity mismatch');
 const packagePath=join(dir,'candidate/native-package/terraphim-editor-0.1.0-dev.1.nimext'),bytes=await readFile(packagePath),actual=createHash('sha256').update(bytes).digest('hex');if(actual!==candidateSha)throw Error('Requested candidate hash mismatch');
 await writeFile(join(dir,'input-receipt.json'),JSON.stringify({scope:'Inputs only; no native success',sourceSha,runId:Number(runId),artifactId:artifact.id,artifactDigest:artifact.digest,toolingSource:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),packagePath,packageSha256:actual,packageBytes:bytes.length},null,2)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
