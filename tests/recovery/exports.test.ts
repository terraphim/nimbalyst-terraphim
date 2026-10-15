import { test, expect } from '@playwright/test';
import { readFile, writeFile, access, symlink, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { exportFixture } from './export-fixture.ts';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

// These are actual Chromium / released Rust / upstream filesystem component checks.
// They do not qualify an installed native Nimbalyst application.
test('saved annotated Rust output produces exact clean Markdown and same-ID synonym graph in new sibling files', async ({page}) => {
 const f = await exportFixture(page);
 try {
  const authored = await page.evaluate(() => (window as any).author());
  const clean = await page.evaluate(() => (window as any).exporter.export('clean', 'brief.clean.md'));
  const graph = await page.evaluate(() => (window as any).exporter.export('knowledgeGraph', 'brief.knowledge-graph.json'));
  expect(await f.read()).toBe(authored);
  expect(await f.readDestination('brief.clean.md')).toBe('Concern requires a Decision.\n');
  const actualGraph = await f.readDestination('brief.knowledge-graph.json'), parsed = JSON.parse(actualGraph);
  expect(parsed.data.risk.id).toBe(parsed.data.concern.id);
  expect(clean.sourceHash).toBe(hash(authored)); expect(graph.sourceHash).toBe(hash(authored));
  expect(clean.sha256).toBe(hash(await f.readDestination('brief.clean.md')));
  expect(graph.sha256).toBe(hash(actualGraph));
  expect(clean.verification).toBe('host-utf8-text-snapshot');
  expect(f.edits).toHaveLength(2);
  expect(await page.evaluate(() => (window as any).wasm.save_document())).toBe(authored);
  expect((await readdir(f.historyDirectory)).length).toBe(4);
  await test.info().attach('actual-clean.md', {body: await readFile(f.destination('brief.clean.md')), contentType: 'text/markdown'});
  await test.info().attach('actual-knowledge-graph.json', {body: actualGraph, contentType: 'application/json'});
  await test.info().attach('actual-annotated.md', {body: authored, contentType: 'text/markdown'});
 } finally {await f.cleanup();}
});

test('invalid sibling names and source aliases are rejected before saving or writing', async ({page}) => {
 const f = await exportFixture(page);
 try {
  const names = ['', '.', '..', '../escape.md', 'dir/file.md', 'dir\\file.md', 'https:evil.md', 'CON.txt', 'Lpt9.json', 'COM¹.txt', 'NUL .txt', 'x\ud800.md', 'bad?.md', 'trailing.md.', ' spaced.md', 'x\u0000.md', 'brief.terraphim.md'];
  for (const name of names) {
   const result = await page.evaluate(async name => {try {await (window as any).exporter.export('clean', name); return 'unexpected';} catch (e) {return (e as any).code;}}, name);
   expect(['invalid_name', 'source_alias']).toContain(result);
  }
  expect(f.writes).toHaveLength(0); expect(f.edits).toHaveLength(0);
 } finally {await f.cleanup();}
});

test('existing file, symlink alias and dirty destination preserve their actual bytes', async ({page}) => {
 const f = await exportFixture(page);
 try {
  await writeFile(f.destination('existing.md'), 'Preserve existing.');
  await symlink(f.filePath, f.destination('alias.md'));
  f.dirty.add(f.destination('dirty.md'));
  for (const name of ['existing.md', 'alias.md', 'dirty.md']) {
   const result = await page.evaluate(async name => {try {await (window as any).exporter.export('clean', name); return 'unexpected';} catch (e) {return (e as Error).message;}}, name);
   expect(result).not.toBe('unexpected');
  }
  expect(await f.readDestination('existing.md')).toBe('Preserve existing.');
  expect(await f.readDestination('alias.md')).toBe(await f.read());
  await expect(access(f.destination('dirty.md'))).rejects.toThrow();
 } finally {await f.cleanup();}
});

test('concurrent destination creation is refused by actual exclusive host write', async ({page}) => {
 const f = await exportFixture(page);
 try {
  f.beforeWrite(() => writeFile(f.destination('race.md'), 'Concurrent winner.'));
  const result = await page.evaluate(async () => {try {await (window as any).exporter.export('clean', 'race.md'); return 'unexpected';} catch (e) {return (e as any).code;}});
  expect(result).toBe('write_failed'); expect(f.edits).toHaveLength(1);
  expect(await f.readDestination('race.md')).toBe('Concurrent winner.');
 } finally {await f.cleanup();}
});

test('edit accepted during derivation refuses stale export and retains the newer draft', async ({page}) => {
 const f = await exportFixture(page);
 try {
  await page.evaluate(() => {const w = window as any; w.deriveGate = new Promise(r => w.releaseDerive = r);
   w.pendingExport = w.exporter.export('clean', 'stale.md').then(() => 'unexpected', (e: any) => e.code);});
  await expect.poll(() => f.writes.length).toBe(1);
  await page.evaluate(async () => {const w = window as any; await w.controller.accept(w.propose('Newer actual draft.\n', 1)); w.releaseDerive();});
  expect(await page.evaluate(() => (window as any).pendingExport)).toBe('stale');
  expect(f.edits).toHaveLength(0); await expect(access(f.destination('stale.md'))).rejects.toThrow();
  expect(await page.evaluate(() => (window as any).controller.state().dirty)).toBe(true);
 } finally {await f.cleanup();}
});

test('external source change after save is read back and blocks export', async ({page}) => {
 const f = await exportFixture(page);
 try {
  await page.evaluate(() => {const w = window as any; w.deriveGate = new Promise(r => w.releaseDerive = r);
   w.pendingExport = w.exporter.export('clean', 'external.md').then(() => 'unexpected', (e: any) => e.code);});
  await expect.poll(() => f.writes.length).toBe(1);
  await f.write('External actual writer.\n'); await page.evaluate(() => (window as any).releaseDerive());
  expect(await page.evaluate(() => (window as any).pendingExport)).toBe('stale');
  expect(f.edits).toHaveLength(0); expect(await f.read()).toBe('External actual writer.\n');
 } finally {await f.cleanup();}
});

test('altered output readback is refused without deleting or retrying the created file', async ({page}) => {
 const f = await exportFixture(page);
 try {
  f.afterWrite(destination => writeFile(destination, 'External changed output.'));
  const result = await page.evaluate(async () => {try {await (window as any).exporter.export('clean', 'changed.md'); return null;} catch (e) {return {code:(e as any).code, destination:(e as any).destination, mayExist:(e as any).mayExist};}});
  expect(result).toEqual({code:'readback_failed', destination:f.destination('changed.md'), mayExist:true});
  expect(f.edits).toHaveLength(1); expect(await f.readDestination('changed.md')).toBe('External changed output.');
 } finally {await f.cleanup();}
});

test('dispose while derivation waits refuses the operation without an output write', async ({page}) => {
 const f = await exportFixture(page);
 try {
  await page.evaluate(() => {const w = window as any; w.deriveGate = new Promise(r => w.releaseDerive = r);
   w.pendingExport = w.exporter.export('clean', 'disposed.md').then(() => 'unexpected', (e: any) => e.code);});
  await expect.poll(() => f.writes.length).toBe(1);
  await page.evaluate(() => {const w = window as any; w.exporter.dispose(); w.releaseDerive();});
  expect(await page.evaluate(() => (window as any).pendingExport)).toBe('closed');
  expect(f.edits).toHaveLength(0);
 } finally {await f.cleanup();}
});


test('timeout retains the in-flight operation and refuses a second export until it settles', async ({page}) => {
 const f = await exportFixture(page, 100);
 try {
  await page.evaluate(() => {const w = window as any; w.deriveGate = new Promise(r => w.releaseDerive = r);
   w.pendingExport = w.exporter.export('clean', 'timeout.md').then(() => 'unexpected', (e: any) => e.code);});
  await expect.poll(() => page.evaluate(() => (window as any).deriveStarted)).toBe(true);
  expect(await page.evaluate(() => (window as any).pendingExport)).toBe('timeout');
  expect(await page.evaluate(async () => {try {await (window as any).exporter.export('clean', 'second.md'); return 'unexpected';} catch (e) {return (e as any).code;}})).toBe('busy');
  await page.evaluate(() => (window as any).releaseDerive());
  await expect.poll(() => page.evaluate(async () => {try {await (window as any).exporter.export('clean', 'second.md'); return 'saved';} catch (e) {return (e as any).code;}})).toBe('saved');
  await expect(access(f.destination('timeout.md'))).rejects.toThrow();
  expect(await f.readDestination('second.md')).toBe('Risk requires a Decision.\n');
  expect(f.edits).toHaveLength(1);
 } finally {await f.cleanup();}
});

test('an edit after the exclusive write starts leaves the export bound to its saved revision', async ({page}) => {
 const f = await exportFixture(page);
 try {
  f.beforeWrite(() => page.evaluate(async () => {const w = window as any; await w.controller.accept(w.propose('Newer draft after export started.\n', 1));}));
  const receipt = await page.evaluate(() => (window as any).exporter.export('clean', 'captured.md'));
  expect(receipt.revision).toBe(0);
  expect(await f.readDestination('captured.md')).toBe('Risk requires a Decision.\n');
  expect(await page.evaluate(() => (window as any).controller.state().acceptedSource)).toBe('Newer draft after export started.\n');
  expect(await page.evaluate(() => (window as any).controller.state().dirty)).toBe(true);
 } finally {await f.cleanup();}
});

test('portable sibling calculation preserves actual Unicode names and Windows directory spelling', async ({page}) => {
 const f = await exportFixture(page);
 try {
  const receipt = await page.evaluate(() => (window as any).exporter.export('clean', 'décision-🦀.md'));
  expect(await f.readDestination('décision-🦀.md')).toBe('Risk requires a Decision.\n');
  expect(receipt.bytes).toBe(Buffer.byteLength('Risk requires a Decision.\n'));
  const windows = await page.evaluate(async () => {const module='/src/exports.ts'; const {siblingDestination}=await import(module); return siblingDestination('C:\\project\\brief.terraphim.md', 'clean.md');});
  expect(windows).toBe('C:\\project\\clean.md');
 } finally {await f.cleanup();}
});

test('timeout during the actual host write retains busy state and leaves a created file visible', async ({page}) => {
 const f = await exportFixture(page, 250);
 let release!: () => void;
 const gate = new Promise<void>(resolve => {release = resolve;});
 try {
  f.beforeWrite(() => gate);
  await page.evaluate(() => {const w = window as any;
   w.pendingExport = w.exporter.export('clean', 'late.md').then(() => null, (e: any) => ({code:e.code, mayExist:e.mayExist}));});
  await expect.poll(() => f.edits.length).toBe(1);
  expect(await page.evaluate(() => (window as any).pendingExport)).toEqual({code:'timeout', mayExist:true});
  expect(await page.evaluate(async () => {try {await (window as any).exporter.export('clean', 'other.md'); return 'unexpected';} catch(e) {return (e as any).code;}})).toBe('busy');
  release();
  await expect.poll(() => f.readDestination('late.md').catch(() => null)).toBe('Risk requires a Decision.\n');
  expect(f.edits).toHaveLength(1);
 } finally {release(); await f.cleanup();}
});

test('save conflict stops export and preserves the real external source', async ({page}) => {
 const f = await exportFixture(page);
 try {
  f.externalAfterSave('Different actual disk writer.\n');
  expect(await page.evaluate(async () => {try {await (window as any).exporter.export('clean', 'blocked.md'); return 'unexpected';} catch(e) {return (e as any).code;}})).toBe('conflict');
  expect(f.edits).toHaveLength(0);
  expect(await f.read()).toBe('Different actual disk writer.\n');
  await expect(access(f.destination('blocked.md'))).rejects.toThrow();
 } finally {await f.cleanup();}
});


for (const change of ['resource', 'current', 'capability'] as const) {
 test(`owner ${change} changes after actual write retains destination and uncertain-file evidence`, async ({page}) => {
  const f = await exportFixture(page);
  try {
   f.afterWrite(() => page.evaluate(change => {
    const w = window as any;
    if (change === 'resource') w.host.filePath = w.host.filePath.replace('brief.terraphim.md', 'other.terraphim.md');
    else if (change === 'current') w.active = false;
    else w.host.capabilities = {supports: () => false, unavailable: []};
   }, change));
   const result = await page.evaluate(async () => {try {await (window as any).exporter.export('clean', 'owner-changed.md'); return null;}
    catch (e) {return {code:(e as any).code, destination:(e as any).destination, mayExist:(e as any).mayExist};}});
   expect(result).toEqual({code:change === 'capability' ? 'unsupported' : 'stale', destination:f.destination('owner-changed.md'), mayExist:true});
   expect(await f.readDestination('owner-changed.md')).toBe('Risk requires a Decision.\n');
   expect(f.edits).toHaveLength(1);
  } finally {await f.cleanup();}
 });
}

test('one caller can await clean then graph export without a stale busy operation',async({page})=>{
 const f=await exportFixture(page);try{await page.evaluate(()=>(window as any).author());const receipts=await page.evaluate(async()=>{const e=(window as any).exporter;return[await e.export('clean','sequential.clean.md'),await e.export('knowledgeGraph','sequential.knowledge-graph.json')]});expect(receipts.map((r:any)=>r.kind)).toEqual(['clean','knowledgeGraph']);expect(await f.readDestination('sequential.clean.md')).toBe('Concern requires a Decision.\n');const graph=JSON.parse(await f.readDestination('sequential.knowledge-graph.json'));expect(graph.data.risk.id).toBe(graph.data.concern.id);expect(f.edits).toHaveLength(2);
 }finally{await f.cleanup()}
});
