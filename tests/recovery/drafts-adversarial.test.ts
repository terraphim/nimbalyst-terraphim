// Independent reviewer regression cases, preserved in the durable adapter test suite.
import {test, expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.goto('/tests/recovery/index.html');});
for (const kind of ['cycle','bigint','invalid-session-key'] as const) {
 test(`corrupt ${kind} row preserves readable sibling and explicit selected discard`,async({page})=>{
  const actual=await page.evaluate(async kind=>{
   const u='/src/recovery.ts';const {DraftRecovery}=await import(u);
   const databaseName='independent:'+crypto.randomUUID(),s=new DraftRecovery({indexedDB,databaseName});
   const identity={workspace:'w',resource:'/brief.terraphim.md',session:'good'};
   const good=await s.put({identity,source:'Valid sibling must remain recoverable',baselineHash:'a'.repeat(64),revision:1});
   const key=[1,'terraphim-editor','w',identity.resource,kind==='invalid-session-key'?'':'broken'];
   const broken:any={...good,identity:{...identity,session:'broken'}};
   if(kind==='cycle')broken.extra=broken;
   if(kind==='bigint')broken.extra=1n;
   await new Promise<void>((resolve,reject)=>{const q=indexedDB.open(databaseName,1);q.onerror=()=>reject(q.error);q.onsuccess=()=>{const db=q.result,tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(broken,key);tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error);};});
   let rows:any[]=[],listError:string|null=null,discarded:boolean|null=null,discardError:string|null=null;
   try{rows=await s.list(identity);}catch(e){listError=(e as any).code??String(e);}
   const corrupt=rows.find(r=>r.status==='corrupt');
   if(corrupt)try{discarded=await s.discard(corrupt);}catch(e){discardError=(e as any).code??String(e);}
   s.close();return{kind,listError,statuses:rows.map(r=>r.status),validSiblingReadable:rows.some(r=>r.record?.source===good.source),discarded,discardError};
  },kind);
  await test.info().attach('actual-corrupt-readback',{body:JSON.stringify(actual,null,2),contentType:'application/json'});
  expect(actual.listError).toBe(null);expect(actual.validSiblingReadable).toBe(true);expect(actual.statuses).toContain('corrupt');expect(actual.discardError).toBe(null);expect(actual.discarded).toBe(true);
 });
}
test('two real pages race last capacity slot without eviction',async({page,context})=>{
 const databaseName='race:'+crypto.randomUUID();
 await page.evaluate(async databaseName=>{const u='/src/recovery.ts';const {DraftRecovery}=await import(u);const s=new DraftRecovery({indexedDB,databaseName});for(let n=0;n<127;n++)await s.put({identity:{workspace:'w',resource:'/brief.terraphim.md',session:String(n)},source:String(n),baselineHash:'a'.repeat(64),revision:1});s.close();},databaseName);
 const second=await context.newPage();await second.goto('/tests/recovery/index.html');
 const put=(p:typeof page,session:string)=>p.evaluate(async({databaseName,session})=>{const u='/src/recovery.ts';const {DraftRecovery}=await import(u);const s=new DraftRecovery({indexedDB,databaseName});const result=await s.put({identity:{workspace:'w',resource:'/brief.terraphim.md',session},source:session,baselineHash:'a'.repeat(64),revision:1}).then(()=> 'saved',(e:any)=>e.code);s.close();return result;},{databaseName,session});
 const outcomes=await Promise.all([put(page,'a'),put(second,'b')]);
 const rows=await page.evaluate(async databaseName=>{const u='/src/recovery.ts';const {DraftRecovery}=await import(u);const s=new DraftRecovery({indexedDB,databaseName});const rows=await s.list({workspace:'w'});s.close();return rows;},databaseName);
 expect(outcomes.sort()).toEqual(['capacity','saved']);expect(rows).toHaveLength(128);expect(rows.filter((r:any)=>Number.isInteger(Number(r.record.identity.session)))).toHaveLength(127);await second.close();
});
test('closing during a pending hashed write does not commit it',async({page})=>{
 const actual=await page.evaluate(async()=>{const u='/src/recovery.ts';const {DraftRecovery}=await import(u);const databaseName='close:'+crypto.randomUUID(),s=new DraftRecovery({indexedDB,databaseName});const identity={workspace:'w',resource:'/brief.terraphim.md',session:'one'};await s.put({identity,revision:1,source:'original',baselineHash:'a'.repeat(64)});const pending=s.put({identity,revision:2,source:'x'.repeat(1024*1024),baselineHash:'a'.repeat(64)});s.close();const error=await pending.then(()=>null,(e:any)=>e.code);const reopened=new DraftRecovery({indexedDB,databaseName});const rows=await reopened.list(identity);reopened.close();return{error,rows};});expect(actual.error).toBe('closed');expect(actual.rows[0].record.source).toBe('original');
});
for(const kind of ['graph-types','alias-change','bigint-string','array-length','blob','depth-bound'] as const)test(`structured-clone comparison is exact and bounded: ${kind}`,async({page})=>{
 const r=await page.evaluate(async kind=>{const u='/src/recovery.ts';const {DraftRecovery}=await import(u);const name='clone:'+crypto.randomUUID(),s=new DraftRecovery({indexedDB,databaseName:name});const identity={workspace:'w',resource:'/brief.terraphim.md',session:'good'};await s.put({identity,source:'readable sibling',baselineHash:'a'.repeat(64),revision:1});const key=[1,'terraphim-editor','w',identity.resource,'bad'];
 const shared={n:1};let extra:any;
 if(kind==='graph-types'){const buffer=new Uint8Array([1,2,3]).buffer;extra={date:new Date(123),set:new Set([1n,NaN]),map:new Map([[shared,new Int8Array(buffer)]]),buffer,view:new DataView(buffer),regexp:/x/gi};}
 if(kind==='alias-change')extra=[shared,shared];if(kind==='bigint-string')extra=1n;if(kind==='array-length')extra=Array(2);if(kind==='blob')extra=new Blob(['opaque']);if(kind==='depth-bound'){extra={};let tail=extra;for(let n=0;n<200;n++){tail.next={};tail=tail.next;}}
 const write=async(value:any)=>new Promise<void>((resolve,reject)=>{const q=indexedDB.open(name,1);q.onsuccess=()=>{const db=q.result,tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(value,key);tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error);};q.onerror=()=>reject(q.error);});
 await write({extra});const selected=(await s.list(identity)).find((v:any)=>v.status==='corrupt');
 if(kind==='alias-change')await write({extra:[{n:1},{n:1}]});if(kind==='bigint-string')await write({extra:'1'});if(kind==='array-length')await write({extra:[]});
 const start=performance.now(),discarded=await s.discard(selected),elapsed=performance.now()-start;const remaining=await s.list(identity);s.close();return{discarded,elapsed,readable:remaining.some((v:any)=>v.record?.source==='readable sibling')};},kind);
 expect(r.discarded).toBe(kind==='graph-types');expect(r.readable).toBe(true);expect(r.elapsed).toBeLessThan(2000);
});

test('newest list invalidates earlier selections; concurrent or closed lists cannot resurrect them',async({page})=>{
 const actual=await page.evaluate(async()=>{
  const u='/src/recovery.ts';const {DraftRecovery}=await import(u);const databaseName='generations:'+crypto.randomUUID(),s=new DraftRecovery({indexedDB,databaseName});
  const identity={workspace:'w',resource:'/brief.terraphim.md',session:'good'};const saved=await s.put({identity,source:'x'.repeat(1024*1024),baselineHash:'a'.repeat(64),revision:1});
  const first=(await s.list(identity))[0];for(let i=0;i<20;i++)await s.list(identity);
  const stale=await s.discard(first).then(()=>null,(e:any)=>e.code);
  const pending=s.list(identity).then(()=> 'resolved',(e:any)=>e.code);const latest=await s.list(identity);const superseded=await pending;
  const readback=await s.recover(latest[0],'a'.repeat(64));
  // Save completion uses its exact record directly and does not invalidate a current recovery selection.
  const other=await s.put({identity:{...identity,session:'other'},source:'other',baselineHash:'b'.repeat(64),revision:1});await s.removeIf(other);
  const stillCurrent=await s.recover(latest[0],'a'.repeat(64));
  const closing=s.list(identity).then(()=> 'resolved',(e:any)=>e.code);s.close();const closed=await closing;
  const afterClose=await s.discard(latest[0]).then(()=>null,(e:any)=>e.code);
  const reopened=new DraftRecovery({indexedDB,databaseName});const final=await reopened.list(identity);reopened.close();return{stale,superseded,readbackHash:readback.record.sha256,expectedHash:saved.sha256,stillCurrent:stillCurrent.record.revision,closed,afterClose,finalCount:final.length};
 });
 expect(actual.stale).toBe('stale');expect(actual.superseded).toBe('stale');expect(actual.readbackHash).toBe(actual.expectedHash);expect(actual.stillCurrent).toBe(1);expect(actual.closed).toBe('closed');expect(actual.afterClose).toBe('stale');expect(actual.finalCount).toBe(1);
});
