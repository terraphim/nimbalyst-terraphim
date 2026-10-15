import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,cp,writeFile,rm,symlink,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildVisualAssets} from '../../scripts/prepare-visual-assets.mjs';
const release=resolve('.cache/released-editor');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('real bundler preserves pinned released runtime bytes and supplies only verified local dependencies',async()=>{
 const result=await buildVisualAssets(release);
 assert.equal(result.provenance.release,'v0.1.0-rc.2');
 assert.equal(result.provenance.verifiedReleaseFiles,132);
 assert.equal(result.provenance.bundler.version,'0.28.2');
 assert.ok(result.provenance.bundledModules.length>=9);
 for(const [name,item] of Object.entries(result.manifest)){
  assert.equal(item.sha256,sha(result.assets[name]));assert.equal(item.bytes,result.assets[name].length);
 }
 for(const [name,original] of Object.entries(result.provenance.unchangedAssets))
  assert.deepEqual(result.assets[name],await readFile(join(release,original)));
 assert.match(result.assets.styles.toString(),/data:font\/woff2;base64,/);
 for(const value of result.assets.styles.toString().matchAll(/url\(([^)]*)\)/g))assert.match(value[1],/^data:font\/(?:woff2|ttf);base64,/);
 assert.doesNotMatch(result.assets.styles.toString(),/@import\s/i);
 const second=await buildVisualAssets(release);
 for(const name of Object.keys(result.assets))assert.deepEqual(result.assets[name],second.assets[name]);
});

test('tampered actual released dependency is refused before bundling',async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'nimbalyst-visual-tamper-'));
 try{await cp(release,scratch,{recursive:true});await writeFile(join(scratch,'roles/default.json'),'{}');
  await assert.rejects(buildVisualAssets(scratch),/Release asset hash mismatch: roles\/default.json/);
 }finally{await rm(scratch,{recursive:true,force:true});}
});

test('an equal-byte symlink escaping the verified release root is refused',async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'nimbalyst-visual-link-')),fixture=join(scratch,'release');
 try{await cp(release,fixture,{recursive:true});const target='roles/default.json';const bytes=await readFile(join(fixture,target));await writeFile(join(scratch,'outside.json'),bytes);await unlink(join(fixture,target));await symlink(join(scratch,'outside.json'),join(fixture,target));
  await assert.rejects(buildVisualAssets(fixture),/Release asset escapes root/);
 }finally{await rm(scratch,{recursive:true,force:true});}
});
