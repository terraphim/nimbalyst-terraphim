import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSource, SourceError, sourceBytes } from '../../src/source.ts';
import { ProjectFileService } from '../../.cache/contracts/ProjectFileService.mjs';
import { editorHostSupports } from '../../node_modules/@nimbalyst/extension-sdk/dist/editorHostCapabilities.js';

await mkdir(new URL('../../.artifacts/',import.meta.url),{recursive:true});

async function fixture(t,content='Risk — café 漢字 🦀\r\n') {
 const workspace=await mkdtemp(join(tmpdir(),'nimbalyst-source-'));t.after(()=>rm(workspace,{recursive:true,force:true}));
 const filePath=join(workspace,'brief.terraphim.md');await writeFile(filePath,content);
 // Upstream read() is real. These unused write-history/dirty hooks are fail-closed.
 const service=new ProjectFileService({createSnapshot(){throw Error('No write permitted by source tests');}},()=>{throw Error('No write permitted');});
 const callbacks=new Set();
 const host={filePath,workspaceId:workspace,fs:{read:paths=>service.read(workspace,paths)},loadBinaryContent:async()=>{const bytes=await readFile(host.filePath);return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);},saveContent:async()=>{throw Error('No save permitted');},onFileChanged:callback=>{callbacks.add(callback);return()=>callbacks.delete(callback);},setDirty:()=>{},isDiffModeActive:()=>false};
 return {workspace,filePath,host,service,read:(current=()=>true)=>readSource(host,{supports:editorHostSupports,isCurrent:current})};
}

test('real upstream filesystem and raw bytes admit Unicode, CRLF and existing empty source exactly',async t=>{
 const f=await fixture(t);const before=await readFile(f.filePath);const a=await f.read();assert.equal(a.source,before.toString());assert.equal(a.bytes,before.length);assert.equal(a.identity.resource,f.filePath);await writeFile(new URL('../../.artifacts/admission-readback.json',import.meta.url),JSON.stringify(a,null,2)+'\n');
 await writeFile(f.filePath,'');const b=await f.read();assert.equal(b.source,'');assert.equal(b.bytes,0);
});
for(const [name,bytes,code] of [['BOM',Buffer.from([239,187,191,97]),'bom'],['invalid UTF-8',Buffer.from([0xc3,0x28]),'invalid_utf8'],['oversized',Buffer.alloc(1024*1024+1,97),'too_large']])test(`refuses actual ${name} without modifying bytes`,async t=>{
 const f=await fixture(t,bytes);await assert.rejects(f.read(),e=>e instanceof SourceError&&e.code===code);assert.deepEqual(await readFile(f.filePath),bytes);
});
test('missing, directory and workspace-escaping symlink fail on actual upstream reads',async t=>{
 const f=await fixture(t);await rm(f.filePath);await assert.rejects(f.read(),e=>e.code==='missing');
 await mkdir(f.filePath);await assert.rejects(f.read(),e=>e.code==='read_failed');await rm(f.filePath,{recursive:true});
 const outside=await mkdtemp(join(tmpdir(),'nimbalyst-outside-'));t.after(()=>rm(outside,{recursive:true,force:true}));await writeFile(join(outside,'secret.md'),'outside');await symlink(join(outside,'secret.md'),f.filePath);await assert.rejects(f.read(),e=>e.code==='read_failed');
});
test('real write between text and binary reads is refused',async t=>{
 const f=await fixture(t,'before');const original=f.host.loadBinaryContent;
 f.host.loadBinaryContent=async()=>{await writeFile(f.filePath,'after');return original();};
 await assert.rejects(f.read(),e=>e.code==='inconsistent_read');assert.equal(await readFile(f.filePath,'utf8'),'after');
});
test('resource/workspace/lifecycle change during actual read cannot finish admission',async t=>{
 for(const kind of ['resource','workspace','dispose']) {
  const f=await fixture(t);let current=true;const raw=f.host.loadBinaryContent;
  f.host.loadBinaryContent=async()=>{const bytes=await raw();if(kind==='resource')f.host.filePath=join(f.workspace,'renamed.terraphim.md');if(kind==='workspace')f.host.workspaceId='different';if(kind==='dispose')current=false;return bytes;};
  await assert.rejects(f.read(()=>current),e=>e.code==='stale');
 }
});
test('read-only, diff, virtual, ordinary Markdown, missing capabilities and fileless inputs stay refused',async t=>{
 for(const change of [h=>h.readOnly=true,h=>h.isDiffModeActive=()=>true,h=>h.filePath='virtual://brief.terraphim.md',h=>h.filePath=join(h.workspaceId,'brief.md'),h=>delete h.workspaceId,h=>delete h.fs,h=>h.capabilities={environment:'browser',supports:()=>false,unavailable:[]}]) {
  const f=await fixture(t);change(f.host);await assert.rejects(f.read(),e=>e.code==='unsupported');
 }
});

test('document byte bound admits below/at limit and refuses above; lone surrogate is never replaced',()=>{
 assert.equal(sourceBytes('a'.repeat(1024*1024-1)).length,1024*1024-1);
 assert.equal(sourceBytes('a'.repeat(1024*1024)).length,1024*1024);
 assert.throws(()=>sourceBytes('a'.repeat(1024*1024+1)),e=>e.code==='too_large');
 assert.throws(()=>sourceBytes('\ud800'),e=>e.code==='invalid_utf8');
});
