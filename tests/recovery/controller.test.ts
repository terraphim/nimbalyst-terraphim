import {test,expect} from '@playwright/test';
import {rm,mkdir,chmod} from 'node:fs/promises';
import {controllerFixture as fixture} from './controller-fixture.ts';
test('real Rust proposal, durable draft, verified Unicode/CRLF save, empty-file readback and fresh Rust session',async({page})=>{
 const f=await fixture(page);try{
  const result=await page.evaluate(async()=>{const w=window as any;const proposed=w.propose('Concern — café 🦀\r\n',1),ack=await w.controller.accept(proposed);const draft=await w.recovery.list({workspace:w.host.workspaceId});return{proposed,ack,draft,state:w.controller.state()};});
  expect(result.ack.source).toBe(result.proposed.source);expect(result.state.dirty).toBe(true);expect(result.draft[0].record.source).toBe(result.ack.source);expect(await f.read()).toBe('Risk — café 🦀\r\n');
  const receipt=await page.evaluate(async()=>await(window as any).controller.save());const actualSavedSource=await f.read();expect(actualSavedSource).toBe(receipt.source);expect(f.writes).toEqual([receipt.source]);
  const state=await page.evaluate(async()=>{const w=window as any;return{state:w.controller.state(),drafts:await w.recovery.list({workspace:w.host.workspaceId})}});expect(state.state.dirty).toBe(false);expect(state.drafts).toEqual([]);
  await page.evaluate(async()=>{const w=window as any;await w.controller.accept(w.propose('',2));await w.controller.save();});expect(await f.read()).toBe('');const reopened=await page.evaluate(async()=>{const w=window as any;w.controller.dispose();w.controller=await w.ParentController.admit(w.controllerOptions);return w.controller.snapshot();});expect(reopened.source).toBe('');
  await test.info().attach('actual-controller-save-readback',{body:JSON.stringify({receipt,actualSavedSource,emptyReadback:await f.read(),freshSession:reopened,attemptedSaveInputs:f.writes},null,2),contentType:'application/json'});
 }finally{await f.cleanup()}
});
test('stale hashes, foreign identity, repeated IDs and concurrent proposals cannot change authority',async({page})=>{
 const f=await fixture(page);try{
  const actual=await page.evaluate(async()=>{const w=window as any;const original=w.controller.snapshot(),p=w.propose('one',1);const bad=[];for(const changed of [{...p,beforeHash:'0'.repeat(64)},{...p,resource:'/other.terraphim.md'},{...p,session:'other'},{...p,sourceHash:'0'.repeat(64)}])bad.push(await w.controller.accept(changed).then(()=> 'accepted',(e:any)=>e.code??String(e)));
   const a=w.propose('one',2),b=w.propose('two',3);const concurrent=await Promise.all([w.controller.accept(a).then(()=> 'accepted'),w.controller.accept(b).then(()=> 'accepted',(e:any)=>e.code)]);
   const duplicate=await w.controller.accept(w.propose('duplicate',2)).then(()=> 'accepted',(e:any)=>e.code??String(e));const rows=await w.recovery.list({workspace:w.host.workspaceId});return{original,bad,concurrent,duplicate,snapshot:w.controller.snapshot(),rows};});
  expect(actual.bad.every((s:string)=>s!=='accepted')).toBe(true);expect(actual.concurrent).toEqual(['accepted','busy']);expect(actual.duplicate).not.toBe('accepted');expect(actual.snapshot.source).toBe('one');expect(actual.rows).toHaveLength(1);expect(actual.rows[0].record.revision).toBe(1);expect(await f.read()).toBe(actual.original.source);
 }finally{await f.cleanup()}
});
test('real recovery closure prevents Rust ACK and preserves proposed text for copying',async({page})=>{
 const f=await fixture(page);try{
  const actual=await page.evaluate(async()=>{const w=window as any;const before=w.controller.snapshot();w.recovery.close();const proposed=w.propose('Unacknowledged concern',1),error=await w.controller.accept(proposed).then(()=>null,(e:any)=>e.code);const after=w.controller.snapshot(),state=w.controller.state();const retry=await w.controller.accept(w.propose('retry',2)).then(()=>null,(e:any)=>e.code);const save=await w.controller.save().then(()=>null,(e:any)=>e.code);return{before,after,state,error,retry,save};});
  expect(actual.error).toBe('closed');expect(actual.before).toEqual(actual.after);expect(actual.state.pendingSource).toBe('Unacknowledged concern');expect(actual.state.dirty).toBe(true);expect(actual.state.mode).toBe('recovery_pending');expect(actual.retry).toBe('recovery_pending');expect(actual.save).toBe('recovery_pending');expect(f.writes).toHaveLength(0);
 }finally{await f.cleanup()}
});
test('newer edit and recovery draft survive completion of an older real file save',async({page})=>{
 const f=await fixture(page);try{
  await page.evaluate(async()=>{const w=window as any;await w.controller.accept(w.propose('first saved source',1));});f.blockSave();
  await page.evaluate(()=>{const w=window as any;w.pendingSave=w.controller.save().then((receipt:any)=>({receipt}),(e:any)=>({error:e.code}));});await expect.poll(()=>f.writes.length).toBe(1);
  await page.evaluate(async()=>{const w=window as any;await w.controller.accept(w.propose('newer unsaved source',2));});f.release();
  const actual=await page.evaluate(async()=>{const w=window as any;const result=await w.pendingSave;return{result,state:w.controller.state(),rows:await w.recovery.list({workspace:w.host.workspaceId})};});
  expect(actual.result.receipt.source).toBe('first saved source');expect(await f.read()).toBe('first saved source');expect(actual.state.dirty).toBe(true);expect(actual.state.acceptedSource).toBe('newer unsaved source');expect(actual.rows[0].record.source).toBe('newer unsaved source');await test.info().attach('actual-newer-draft-readback',{body:JSON.stringify({...actual,actualDiskSource:await f.read()},null,2),contentType:'application/json'});
  await page.evaluate(async()=>await(window as any).controller.save());expect(await f.read()).toBe('newer unsaved source');
 }finally{await f.cleanup()}
});
test('repeated explicit saves coalesce to latest accepted source with no concurrent writer',async({page})=>{
 const f=await fixture(page);try{
  await page.evaluate(async()=>{const w=window as any;await w.controller.accept(w.propose('first',1));});f.blockSave();await page.evaluate(()=>{const w=window as any;w.firstSave=w.controller.save();w.saveResult=w.firstSave.then((r:any)=>({receipt:r}),(e:any)=>({error:e.code}));});await expect.poll(()=>f.writes.length).toBe(1);
  const same=await page.evaluate(async()=>{const w=window as any;await w.controller.accept(w.propose('second',2));const second=w.controller.save();await w.controller.accept(w.propose('latest',3));const third=w.controller.save();return second===third&&second===w.firstSave;});expect(same).toBe(true);expect(f.writes).toHaveLength(1);f.release();
  const result=await page.evaluate(async()=>await(window as any).saveResult);expect(result.receipt.source).toBe('latest');expect(f.writes).toEqual(['first','latest']);expect(await f.read()).toBe('latest');
 }finally{await f.cleanup()}
});
test('timeout retains real in-flight write, freezes further writes and verifies late success',async({page})=>{
 const f=await fixture(page,'original',80);try{
  await page.evaluate(async()=>{const w=window as any;await w.controller.accept(w.propose('late success',1));});f.blockSave();await page.evaluate(()=>{const w=window as any;w.result=w.controller.save().then((r:any)=>({receipt:r}),(e:any)=>({error:e.code}));});await expect.poll(()=>f.writes.length).toBe(1);
  const uncertain=await page.evaluate(async()=>{const w=window as any;const result=await w.result;return{result,state:w.controller.state(),again:await w.controller.save().then(()=>null,(e:any)=>e.code),edit:await w.controller.accept(w.propose('forbidden',2)).then(()=>null,(e:any)=>e.code)};});
  expect(uncertain.result.error).toBe('timeout');expect(uncertain.state.saveInFlight).toBe(true);expect(uncertain.again).toBe('uncertain');expect(uncertain.edit).toBe('uncertain');expect(await f.read()).toBe('original');f.release();
  await expect.poll(()=>page.evaluate(()=>(window as any).controller.state().saveInFlight)).toBe(false);expect(await f.read()).toBe('late success');const state=await page.evaluate(()=>(window as any).controller.state());expect(state.mode).toBe('saved');expect(state.dirty).toBe(false);await test.info().attach('actual-timeout-late-write-readback',{body:JSON.stringify({timeout:uncertain,settledState:state,actualDiskSource:await f.read()},null,2),contentType:'application/json'});
 }finally{await f.cleanup()}
});
test('late actual write/read failure stays uncertain until explicit verified reload',async({page})=>{
 const f=await fixture(page,'original',80);try{
  await page.evaluate(async()=>{const w=window as any;await w.controller.accept(w.propose('will fail on disk',1));});f.blockSave();await page.evaluate(()=>{const w=window as any;w.result=w.controller.save().then(()=>null,(e:any)=>e.code);});await expect.poll(()=>f.writes.length).toBe(1);expect(await page.evaluate(async()=>await(window as any).result)).toBe('timeout');
  await rm(f.filePath);await mkdir(f.filePath);f.release();await expect.poll(()=>page.evaluate(()=>(window as any).controller.state().saveInFlight)).toBe(false);
  const state=await page.evaluate(()=>(window as any).controller.state());expect(state.mode).toBe('uncertain');expect(state.dirty).toBe(true);expect(await page.evaluate(async()=>await(window as any).controller.save().then(()=>null,(e:any)=>e.code))).toBe('uncertain');
  await rm(f.filePath,{recursive:true});await f.write('restored disk');await page.evaluate(async()=>await(window as any).controller.reload());expect(await page.evaluate(()=>(window as any).controller.state().acceptedSource)).toBe('restored disk');
 }finally{await f.cleanup()}
});
test('external disk changes reload only clean state; dirty conflicts preserve recovery and require explicit reload',async({page})=>{
 const f=await fixture(page,'original');try{
  await f.write('clean external');await page.evaluate(async()=>await(window as any).controller.observeDisk());expect(await page.evaluate(()=>(window as any).controller.state().acceptedSource)).toBe('clean external');
  await page.evaluate(async()=>{const w=window as any;await w.controller.accept(w.propose('local draft',1));});await f.write('different external');await page.evaluate(async()=>await(window as any).controller.observeDisk());
  const conflict=await page.evaluate(async()=>{const w=window as any;return{state:w.controller.state(),rows:await w.recovery.list({workspace:w.host.workspaceId}),save:await w.controller.save().then(()=>null,(e:any)=>e.code)};});expect(conflict.state.mode).toBe('conflict');expect(conflict.rows[0].record.source).toBe('local draft');expect(conflict.save).toBe('conflict');expect(await f.read()).toBe('different external');await page.evaluate(async()=>await(window as any).controller.reload());expect(await page.evaluate(()=>(window as any).controller.state().dirty)).toBe(false);
 }finally{await f.cleanup()}
});
test('reentrant save waits for draft ACK; disposal unsubscribes and ignores late write completion',async({page})=>{
 const f=await fixture(page,'original');try{
  f.blockSave();await page.evaluate(async()=>{const w=window as any;w.reenter=(dirty:boolean)=>{if(dirty){w.reenter=null;w.result=w.controller.save().then((r:any)=>({receipt:r}),(e:any)=>({error:e.code??String(e)}));}};await w.controller.accept(w.propose('reentrant accepted',1));});await expect.poll(()=>f.writes.length).toBe(1);
  const disposed=await page.evaluate(()=>{const w=window as any;w.controller.dispose();return{state:w.controller.state(),changes:w.events.changes.size,saves:w.events.saves.size};});expect(disposed.changes).toBe(0);expect(disposed.saves).toBe(0);expect(disposed.state.mode).toBe('closed');f.release();
  const result=await page.evaluate(async()=>await(window as any).result);expect(result.error).toBe('closed');expect(await f.read()).toBe('reentrant accepted');expect(await page.evaluate(()=>(window as any).controller.state().mode)).toBe('closed');
 }finally{await f.cleanup()}
});

test('actual external write between save and readback refuses Saved and preserves the accepted draft',async({page})=>{
 const f=await fixture(page,'original');try{
  await page.evaluate(async()=>{const w=window as any;await w.controller.accept(w.propose('local accepted',1));});f.externalAfterSave('external winner');
  const actual=await page.evaluate(async()=>{const w=window as any;const error=await w.controller.save().then(()=>null,(e:any)=>e.code);return{error,state:w.controller.state(),drafts:await w.recovery.list({workspace:w.host.workspaceId})};});expect(actual.error).toBe('conflict');expect(actual.state.mode).toBe('conflict');expect(actual.state.dirty).toBe(true);expect(actual.drafts[0].record.source).toBe('local accepted');expect(await f.read()).toBe('external winner');
 }finally{await f.cleanup()}
});
test('actual removal before readback freezes writes; lifecycle changes and unsupported Open are refused',async({page})=>{
 const f=await fixture(page,'original');try{
  await page.evaluate(async()=>{const w=window as any;await w.controller.accept(w.propose('accepted but unreadable',1));});f.deleteAfterSave();
  const actual=await page.evaluate(async()=>{const w=window as any;const error=await w.controller.save().then(()=>null,(e:any)=>e.code);const state=w.controller.state();let open:string|null=null;try{w.controller.open()}catch(e){open=(e as any).code}w.active=false;const stale=await w.controller.save().then(()=>null,(e:any)=>e.code);return{error,state,open,stale};});expect(actual.error).toBe('missing');expect(actual.state.mode).toBe('uncertain');expect(actual.state.dirty).toBe(true);expect(actual.open).toBe('unsupported');expect(actual.stale).toBe('stale');await expect(f.read()).rejects.toThrow();
 }finally{await f.cleanup()}
});

test('cancelled admission after a real pending raw read installs no controller or subscriptions',async({page})=>{
 const f=await fixture(page,'original');try{
  f.blockRaw();const count=f.rawCalls();await page.evaluate(()=>{const w=window as any;w.admission=w.ParentController.admit(w.controllerOptions).then(()=> 'admitted',(e:any)=>e.code);w.beforeAdmissionDirty=w.dirty.length;});await expect.poll(()=>f.rawCalls()).toBeGreaterThan(count);await page.evaluate(()=>(window as any).active=false);f.releaseRaw();
  const actual=await page.evaluate(async()=>{const w=window as any;return{result:await w.admission,dirtyDelta:w.dirty.length-w.beforeAdmissionDirty,changes:w.events.changes.size,saves:w.events.saves.size}});expect(actual).toEqual({result:'stale',dirtyDelta:0,changes:1,saves:1});
 }finally{await f.cleanup()}
});
for(const kind of ['resource','workspace'] as const)test(`late save after ${kind} rebinding cannot notify the new host resource`,async({page})=>{
 const f=await fixture(page,'original');try{
  await page.evaluate(async()=>{const w=window as any;await w.controller.accept(w.propose('old resource write',1));});f.blockSave();await page.evaluate(()=>{const w=window as any;w.result=w.controller.save().then(()=>null,(e:any)=>e.code);});await expect.poll(()=>f.writes.length).toBe(1);
  await page.evaluate(kind=>{const w=window as any;w.beforeRebindDirty=w.dirty.length;if(kind==='resource')w.host.filePath='/other.terraphim.md';else w.host.workspaceId='other';},kind);f.release();
  const actual=await page.evaluate(async()=>{const w=window as any;return{error:await w.result,dirtyDelta:w.dirty.length-w.beforeRebindDirty,accepted:w.controller.state().acceptedSource,persisted:w.controller.state().persistedSource}});expect(actual.error).toBe('stale');expect(actual.dirtyDelta).toBe(0);expect(actual.persisted).toBe('original');expect(await f.read()).toBe('old resource write');
 }finally{await f.cleanup()}
});
for(const kind of ['removed','directory'] as const)test(`actual external ${kind} file event surfaces uncertainty without inventing saved content`,async({page})=>{
 const f=await fixture(page,'original');try{
  await rm(f.filePath);if(kind==='directory')await mkdir(f.filePath);await page.evaluate(()=>{const w=window as any;for(const fn of w.events.changes)fn('untrusted event text');});await expect.poll(()=>page.evaluate(()=>(window as any).controller.state().mode)).toBe('uncertain');
  const state=await page.evaluate(()=>(window as any).controller.state());expect(state.acceptedSource).toBe('original');expect(state.persistedSource).toBe('original');expect(state.error).toBe('uncertain');expect(state.dirty).toBe(true);expect(f.writes).toEqual([]);
 }finally{await f.cleanup()}
});
test('final dirty callback failure rejects the save consistently without an unhandled task rejection',async({page})=>{
 const f=await fixture(page,'original'),pageErrors:string[]=[];page.on('pageerror',e=>pageErrors.push(String(e)));try{
  await page.evaluate(async()=>{const w=window as any;await w.controller.accept(w.propose('actual saved bytes',1));w.reenter=()=>{const state=w.controller.state();if(!state.saveInFlight&&state.mode==='saved')throw Error('Final dirty callback failed');};});
  const actual=await page.evaluate(async()=>{const w=window as any;const error=await w.controller.save().then(()=>null,(e:any)=>e.code);return{error,state:w.controller.state()};});expect(actual.error).toBe('host_state_failed');expect(actual.state.error).toBe('host_state_failed');expect(actual.state.mode).toBe('save_failed');expect(await f.read()).toBe('actual saved bytes');await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,20)));expect(pageErrors).toEqual([]);
 }finally{await f.cleanup()}
});
test('actual file permission failure leaves original bytes and recovery draft available',async({page})=>{
 const f=await fixture(page,'original');try{
  await page.evaluate(async()=>{const w=window as any;await w.controller.accept(w.propose('permission denied',1));});f.blockSave();await page.evaluate(()=>{const w=window as any;w.result=w.controller.save().then(()=>null,(e:any)=>e.code??String(e));});await expect.poll(()=>f.writes.length).toBe(1);await chmod(f.filePath,0o400);f.release();
  const actual=await page.evaluate(async()=>{const w=window as any;const error=await w.result;return{error,state:w.controller.state(),drafts:await w.recovery.list({workspace:w.host.workspaceId})};});expect(actual.error).not.toBe(null);expect(actual.state.mode).toBe('save_failed');expect(actual.drafts[0].record.source).toBe('permission denied');expect(await f.read()).toBe('original');
 }finally{await chmod(f.filePath,0o600).catch(()=>{});await f.cleanup()}
});

test('external conflict during real IndexedDB cleanup lock keeps the draft and cannot become Saved',async({page})=>{
 const f=await fixture(page,'original');try{
  await page.evaluate(async()=>{const w=window as any;await w.controller.accept(w.propose('local kept draft',1));w.keepLock=true;await new Promise<void>((resolve,reject)=>{const q=indexedDB.open(w.recovery.databaseName,1);q.onerror=()=>reject(q.error);q.onsuccess=()=>{const db=q.result,tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts');tx.oncomplete=()=>{db.close();w.lockComplete=true};tx.onerror=()=>reject(tx.error);const loop=()=>{const read=store.get('irrelevant-lock-key');read.onsuccess=()=>{if(w.keepLock)loop()}};loop();resolve()};});w.result=w.controller.save().then(()=>null,(e:any)=>e.code);});
  await expect.poll(()=>f.writes.length).toBe(1);await expect.poll(()=>f.read()).toBe('local kept draft');
  // Wait for verified disk baseline, which occurs immediately before the blocked cleanup transaction.
  await expect.poll(()=>page.evaluate(()=>(window as any).controller.state().persistedSource)).toBe('local kept draft');
  await f.write('external content');await page.evaluate(async()=>await(window as any).controller.observeDisk());expect(await page.evaluate(()=>(window as any).controller.state().mode)).toBe('conflict');
  await page.evaluate(()=>(window as any).keepLock=false);const actual=await page.evaluate(async()=>{const w=window as any;return{error:await w.result,state:w.controller.state(),drafts:await w.recovery.list({workspace:w.host.workspaceId})};});expect(actual.error).toBe('conflict');expect(actual.state.mode).toBe('conflict');expect(actual.state.dirty).toBe(true);expect(actual.drafts[0].record.source).toBe('local kept draft');const actualDiskSource=await f.read();expect(actualDiskSource).toBe('external content');await test.info().attach('actual-cleanup-conflict-readback',{body:JSON.stringify({...actual,actualDiskSource},null,2),contentType:'application/json'});
 }finally{await page.evaluate(()=>(window as any).keepLock=false).catch(()=>{});await f.cleanup()}
});
test('dirty callback failure after actual Rust commit returns its ACK and freezes later edits',async({page})=>{
 const f=await fixture(page,'original');try{
  const actual=await page.evaluate(async()=>{const w=window as any;w.reenter=()=>{if(w.controller.state().revision===1)throw Error('Post-ACK dirty update failed')};const ack=await w.controller.accept(w.propose('committed draft',1));const state=w.controller.state();const next=await w.controller.accept(w.propose('must pause',2)).then(()=>null,(e:any)=>e.code);return{ack,state,next,drafts:await w.recovery.list({workspace:w.host.workspaceId})};});expect(actual.ack.source).toBe('committed draft');expect(actual.state.acceptedSource).toBe('committed draft');expect(actual.state.error).toBe('host_state_failed');expect(actual.next).toBe('host_state_failed');expect(actual.drafts[0].record.source).toBe('committed draft');expect(await f.read()).toBe('original');
 }finally{await f.cleanup()}
});

test('actual external unreadable event during IndexedDB cleanup retains draft and cannot become Saved',async({page})=>{
 const f=await fixture(page,'original');try{
  await page.evaluate(async()=>{const w=window as any;await w.controller.accept(w.propose('recover this draft',1));w.keepLock=true;await new Promise<void>((resolve,reject)=>{const q=indexedDB.open(w.recovery.databaseName,1);q.onerror=()=>reject(q.error);q.onsuccess=()=>{const db=q.result,tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts');tx.oncomplete=()=>db.close();tx.onerror=()=>reject(tx.error);const loop=()=>{const read=store.get('lock');read.onsuccess=()=>{if(w.keepLock)loop()}};loop();resolve()};});w.result=w.controller.save().then(()=>null,(e:any)=>e.code);});
  await expect.poll(()=>f.writes.length).toBe(1);await expect.poll(()=>page.evaluate(()=>(window as any).controller.state().persistedSource)).toBe('recover this draft');await rm(f.filePath);
  await page.evaluate(()=>{const w=window as any;for(const fn of w.events.changes)fn('ignored');});await expect.poll(()=>page.evaluate(()=>(window as any).controller.state().mode)).toBe('uncertain');await page.evaluate(()=>(window as any).keepLock=false);
  const actual=await page.evaluate(async()=>{const w=window as any;return{error:await w.result,state:w.controller.state(),drafts:await w.recovery.list({workspace:w.host.workspaceId}),nextSave:await w.controller.save().then(()=>null,(e:any)=>e.code)}});expect(actual.error).toBe('uncertain');expect(actual.state.mode).toBe('uncertain');expect(actual.state.dirty).toBe(true);expect(actual.drafts[0].record.source).toBe('recover this draft');expect(actual.nextSave).toBe('uncertain');await expect(f.read()).rejects.toThrow();await test.info().attach('actual-cleanup-unreadable-readback',{body:JSON.stringify({...actual,actualFileExists:false},null,2),contentType:'application/json'});
 }finally{await page.evaluate(()=>(window as any).keepLock=false).catch(()=>{});await f.cleanup()}
});

test('matching actual self-save notification during cleanup is an acknowledgment and settles Saved',async({page})=>{
 const f=await fixture(page,'original');try{
  await page.evaluate(async()=>{const w=window as any;await w.controller.accept(w.propose('matching saved source',1));w.keepLock=true;await new Promise<void>((resolve,reject)=>{const q=indexedDB.open(w.recovery.databaseName,1);q.onerror=()=>reject(q.error);q.onsuccess=()=>{const db=q.result,tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts');tx.oncomplete=()=>db.close();tx.onerror=()=>reject(tx.error);const loop=()=>{const read=store.get('lock');read.onsuccess=()=>{if(w.keepLock)loop()}};loop();resolve()};});w.result=w.controller.save().then((receipt:any)=>({receipt}),(e:any)=>({error:e.code}));});
  await expect.poll(()=>page.evaluate(()=>(window as any).controller.state().persistedSource)).toBe('matching saved source');expect(await f.read()).toBe('matching saved source');
  await page.evaluate(async()=>{const w=window as any;for(const fn of w.events.changes)fn('event text is ignored');await w.controller.observeDisk();w.keepLock=false;});const actual=await page.evaluate(async()=>{const w=window as any;return{result:await w.result,state:w.controller.state(),drafts:await w.recovery.list({workspace:w.host.workspaceId})}});expect(actual.result.receipt.source).toBe('matching saved source');expect(actual.state.mode).toBe('saved');expect(actual.state.dirty).toBe(false);expect(actual.drafts).toEqual([]);await test.info().attach('actual-cleanup-self-save-readback',{body:JSON.stringify({...actual,actualDiskSource:await f.read()},null,2),contentType:'application/json'});
 }finally{await page.evaluate(()=>(window as any).keepLock=false).catch(()=>{});await f.cleanup()}
});
