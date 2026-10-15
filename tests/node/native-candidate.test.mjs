import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {qualifyRun,qualifyArtifact} from '../../scripts/native/verify-candidate.mjs';
const observed=JSON.parse(await readFile(new URL('../fixtures/native/observed-run.json',import.meta.url),'utf8'));
test('actual successful public main run binds its exact Windows artifact',()=>{
 const name=qualifyRun(observed.run,observed.run.head_sha);assert.equal(name,observed.artifact.name);assert.deepEqual(qualifyArtifact({artifacts:[observed.artifact]},name),observed.artifact);
});
test('untrusted source, incomplete CI and ambiguous or expired candidates are refused',()=>{
 for(const patch of [{repository:{full_name:'another/repo'}},{head_branch:'feature'},{event:'pull_request'},{conclusion:'failure'},{status:'in_progress'},{path:'.github/workflows/other.yml'},{head_sha:'0'.repeat(40)}])assert.throws(()=>qualifyRun({...observed.run,...patch},observed.run.head_sha));
 const item=observed.artifact;for(const artifacts of [[],[item,item],[{...item,expired:true}],[{...item,digest:null}],[{...item,id:-1}]])assert.throws(()=>qualifyArtifact({artifacts},item.name));
});
