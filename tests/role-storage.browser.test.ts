import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

declare global {
  interface Window {
    roles: typeof import('../src/role-storage.ts') & {
      Storage: import('../src/role-storage.ts').StorageConstructor;
      createEditorFrame: typeof import('../src/frame.ts').createEditorFrame;
      storageInput: (role:string,payload:string)=>string;
    };
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/index.html');
  await page.evaluate(async () => {
    const moduleUrl = '/src/role-storage.ts', storageUrl = '/vendor/role-storage.js', frameUrl = '/src/frame.ts';
    const module = await import(moduleUrl), storage = await import(storageUrl), frame = await import(frameUrl);
    window.roles = { ...module, Storage: storage.default, createEditorFrame: frame.createEditorFrame,
      storageInput:(role,payload)=>JSON.stringify({graphJson:JSON.stringify({role,thesaurus:{name:role},testStoragePayload:payload})}) }; 
  });
});

test('disabled persistence cannot write; real engine snapshot survives close/new connection/page', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { RoleCheckpoints, Storage, createEditorFrame } = window.roles;
    const databaseName = 'roles-test:' + crypto.randomUUID();
    const store = new RoleCheckpoints({ Storage, indexedDB, databaseName });
    const identity = { workspace: 'workspace-A', role: 'terraphim-editor-default', session: crypto.randomUUID() };
    const disabled = await store.checkpoint(identity, window.roles.storageInput(identity.role,'disabled')).then(() => 'unexpected', error => error.code);
    const frame = await createEditorFrame(document.body, { resource: '/brief.terraphim.md', source: 'Risk remains.\n' });
    const snapshot = await frame.request('role-snapshot') as string;
    store.setEnabled(true); const saved = await store.checkpoint(identity, snapshot);
    store.setEnabled(false);
    const noRead = await store.list(identity).then(() => 'unexpected', error => error.code);
    store.close(); frame.dispose();
    const other = new RoleCheckpoints({ Storage, indexedDB, databaseName, enabled: true });
    const rows = await other.list(identity); other.close();
    return { databaseName, identity, saved, rows, disabled, noRead, snapshot };
  });
  expect(result.disabled).toBe('disabled'); expect(result.noRead).toBe('disabled');
  expect(result.rows).toEqual([result.saved]); expect(result.saved.status).toBe('candidate');
  expect(result.saved.validation).toBe('requires-engine-import');
  await page.reload();
  const reopened = await page.evaluate(async result => {
    const moduleUrl='/src/role-storage.ts',storageUrl='/vendor/role-storage.js';
    const { RoleCheckpoints }=await import(moduleUrl),{default:Storage}=await import(storageUrl);
    const store=new RoleCheckpoints({Storage,indexedDB,databaseName:result.databaseName,enabled:true});
    const rows=await store.list(result.identity);store.close();return rows;
  }, result);
  expect(reopened).toEqual(result.rows);
});

test('actual concurrent connections preserve separate writers; duplicate session cannot replace a checkpoint', async ({ page, context }) => {
  const databaseName='roles-test:'+crypto.randomUUID();
  const second=await context.newPage();await second.goto('/tests/index.html');
  const save=async (p:typeof page,session:string) => p.evaluate(async ({databaseName,session})=>{
    const moduleUrl='/src/role-storage.ts',storageUrl='/vendor/role-storage.js';
    const {RoleCheckpoints}=await import(moduleUrl),{default:Storage}=await import(storageUrl);
    const store=new RoleCheckpoints({Storage,indexedDB,databaseName,enabled:true});
    // Labelled envelope inputs exercise storage only; semantic engine proof is in the restore test.
    const result=await store.checkpoint({workspace:'w',role:'r',session},JSON.stringify({graphJson:JSON.stringify({role:'r',thesaurus:{name:'r'},testStoragePayload:session})}));
    store.close();return result;
  },{databaseName,session});
  const [a,b]=await Promise.all([save(page,'writer-a'),save(second,'writer-b')]);
  expect(a.namespace).not.toBe(b.namespace);
  const results=await page.evaluate(async ({databaseName,a})=>{
    const {RoleCheckpoints,Storage}=window.roles;const store=new RoleCheckpoints({Storage,indexedDB,databaseName,enabled:true});
    const duplicate=await store.checkpoint(a.identity,window.roles.storageInput('r','replacement')).then(()=>'unexpected',error=>error.code);
    const rows=await store.list({workspace:'w',role:'r'});const isolated=await store.list({workspace:'another',role:'r'});
    store.close();return {duplicate,rows,isolated};
  },{databaseName,a});
  expect(results.duplicate).toBe('writer_conflict');expect(results.rows).toHaveLength(2);expect(results.isolated).toEqual([]);
  expect(results.rows).toEqual(expect.arrayContaining([a,b]));await second.close();
});

test('explicit selection restores through actual Rust client into a new session, never automatically', async ({ page }) => {
  const result=await page.evaluate(async()=>{
    const {RoleCheckpoints,Storage,createEditorFrame}=window.roles;
    const store=new RoleCheckpoints({Storage,indexedDB,databaseName:'roles-test:'+crypto.randomUUID(),enabled:true});
    const identity={workspace:'w',role:'terraphim-editor-default',session:crypto.randomUUID()};
    const frame=await createEditorFrame(document.body,{resource:'/brief.terraphim.md',source:'Risk remains.\n'});
    const client={importSnapshot:(snapshot:string)=>frame.request('role-import',{snapshot})};
    const snapshot=await frame.request('role-snapshot') as string;
    const saved=await store.checkpoint(identity,snapshot);const before=await frame.request('snapshot');
    const rows=await store.list(identity);const afterList=await frame.request('snapshot');
    const target={...identity,session:crypto.randomUUID()};
    const unconfirmed=await store.restore(saved,target,client,{confirmed:false}).then(()=>'unexpected',error=>error.code);
    const reused=await store.restore(saved,identity,client,{confirmed:true}).then(()=>'unexpected',error=>error.code);
    const restored=await store.restore(saved,target,client,{confirmed:true});
    const actual=await frame.request('role-snapshot');const after=await store.list(identity);
    frame.dispose();store.close();return {saved,rows,before,afterList,unconfirmed,reused,restored,snapshot,actual,after};
  });
  expect(result.rows).toEqual([result.saved]);expect(result.afterList).toEqual(result.before);
  expect(result.unconfirmed).toBe('explicit_choice_required');expect(result.reused).toBe('new_session_required');
  const before=JSON.parse(result.snapshot), after=JSON.parse(result.actual as string);
  const beforeGraph=JSON.parse(before.graphJson), afterGraph=JSON.parse(after.graphJson);
  // Rust advances generation and rebuilds hash-map/automaton iteration order on import.
  expect(BigInt(after.generation)).toBe(BigInt(before.generation)+1n);
  expect(after.revision).toBe(before.revision);expect(after.documents).toEqual(before.documents);
  expect(after.triggerThreshold).toBe(before.triggerThreshold);expect(after.version).toBe(before.version);
  expect(after.rolegraphVersion).toBe(before.rolegraphVersion);
  delete beforeGraph.aho_corasick_values;delete afterGraph.aho_corasick_values;
  expect(afterGraph).toEqual(beforeGraph);
  expect(result.restored.sha256).toBe(result.saved.sha256);expect(result.restored.bytes).toBe(result.saved.bytes);
  expect(result.restored.identity.session).not.toBe(result.saved.identity.session);
  expect(result.after).toHaveLength(2);
  const output=test.info().outputPath('actual-role-restore-readback.json');
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
  await test.info().attach('actual-role-restore-readback',{path:output,contentType:'application/json'});
});

test('real Rust refuses malformed snapshot while preserving current role; failed restore stays unavailable', async ({ page }) => {
  const result=await page.evaluate(async()=>{
    const {RoleCheckpoints,Storage,createEditorFrame}=window.roles;
    const store=new RoleCheckpoints({Storage,indexedDB,databaseName:'roles-test:'+crypto.randomUUID(),enabled:true});
    const identity={workspace:'w',role:'terraphim-editor-default',session:crypto.randomUUID()};
    const bad=await store.checkpoint(identity,window.roles.storageInput(identity.role,'invalid semantic snapshot'));
    const frame=await createEditorFrame(document.body,{resource:'/brief.terraphim.md',source:'Risk remains.\n'});
    const before=await frame.request('role-snapshot');
    const error=await store.restore(bad,{...identity,session:crypto.randomUUID()},
      {importSnapshot:(snapshot:string)=>frame.request('role-import',{snapshot})},{confirmed:true}).then(()=>'unexpected',error=>({code:error.code,roleImported:error.roleImported}));
    const after=await frame.request('role-snapshot');const rows=await store.list(identity);
    frame.dispose();store.close();return {before,after,error,rows};
  });
  expect(result.after).toBe(result.before);expect(result.error).toEqual({code:'import_refused',roleImported:false});
  expect(result.rows.filter(row=>row.status==='unavailable')).toHaveLength(1);
});

test('missing and corrupted actual IndexedDB snapshots are unavailable without changing stored data', async ({ page }) => {
  const result=await page.evaluate(async()=>{
    const {RoleCheckpoints,Storage}=window.roles;const databaseName='roles-test:'+crypto.randomUUID();
    const store=new RoleCheckpoints({Storage,indexedDB,databaseName,enabled:true});
    const a=await store.checkpoint({workspace:'w',role:'r',session:'a'},window.roles.storageInput('r','saved a'));
    const b=await store.checkpoint({workspace:'w',role:'r',session:'b'},window.roles.storageInput('r','saved b'));
    async function corrupt(namespace:string,remove:boolean) {
      await new Promise<void>((resolve,reject)=>{const r=indexedDB.open('te-rolegraph:'+namespace,1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{
        const db=r.result,tx=db.transaction('snapshots','readwrite');
        if(remove)tx.objectStore('snapshots').delete('checkpoint:v1');else tx.objectStore('snapshots').put('corrupted data','checkpoint:v1');
        tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};
      };});
    }
    await corrupt(a.namespace,true);await corrupt(b.namespace,false);
    const rows=await store.list(a.identity);
    const read=new Storage({enabled:true,indexedDB,namespace:b.namespace});const preserved=await read.load();read.close();
    store.close();return {rows,preserved};
  });
  expect(result.rows.map(row=>row.status)).toEqual(['unavailable','unavailable']);
  expect(result.preserved).toBe('corrupted data');
});

test('failed actual storage open is indexed before write and never reported as durable', async ({ page }) => {
  const result=await page.evaluate(async()=>{
    const {RoleCheckpoints,Storage,roleNamespace}=window.roles;const databaseName='roles-test:'+crypto.randomUUID();
    const identity={workspace:'w',role:'r',session:crypto.randomUUID()};
    const namespace=await roleNamespace('terraphim-editor',identity);
    await new Promise<void>((resolve,reject)=>{const r=indexedDB.open('te-rolegraph:'+namespace,2);
      r.onupgradeneeded=()=>r.result.createObjectStore('future');r.onerror=()=>reject(r.error);r.onsuccess=()=>{r.result.close();resolve();};});
    const store=new RoleCheckpoints({Storage,indexedDB,databaseName,enabled:true});
    const error=await store.checkpoint(identity,window.roles.storageInput('r','bounded storage-only test input')).then(()=>'unexpected',error=>error.code);
    const rows=await store.list(identity);store.setEnabled(false);store.close();return {error,rows};
  });
  expect(result.error).toBe('storage_unavailable');expect(result.rows).toHaveLength(1);expect(result.rows[0].status).toBe('unavailable');
});

test('mutated caller input and stale explicit selection cannot cross identities or replace checkpoints', async ({ page }) => {
  const result=await page.evaluate(async()=>{
    const {RoleCheckpoints,Storage}=window.roles;const store=new RoleCheckpoints({Storage,indexedDB,databaseName:'roles-test:'+crypto.randomUUID(),enabled:true});
    const identity={workspace:'w',role:'r',session:'s'};const pending=store.checkpoint(identity,window.roles.storageInput('r','one'));identity.workspace='other';
    const saved=await pending;const next=await store.checkpoint(saved.identity,window.roles.storageInput('r','two'));
    const stale=await store.restore(saved,{...saved.identity,session:'new'}, {importSnapshot:async()=>{throw new Error('Must not reach importer');}}, {confirmed:true})
      .then(()=>'unexpected',error=>error.code);
    const mismatch=await store.restore(next,{...saved.identity,role:'other',session:'new'}, {importSnapshot:async()=>{throw new Error('Must not reach importer');}}, {confirmed:true})
      .then(()=>'unexpected',error=>error.code);
    const rows=await store.list({workspace:'w',role:'r'});store.close();return {saved,next,stale,mismatch,rows};
  });
  expect(result.saved.identity.workspace).toBe('w');expect(result.stale).toBe('stale_selection');expect(result.mismatch).toBe('identity_mismatch');
  expect(result.rows).toEqual([result.next]);
});


test('workspace discovery lists distinct role names without activating them and excludes another workspace', async ({ page }) => {
  const result=await page.evaluate(async()=>{
    const {RoleCheckpoints,Storage}=window.roles;
    const store=new RoleCheckpoints({Storage,indexedDB,databaseName:'roles-test:'+crypto.randomUUID(),enabled:true});
    const a=await store.checkpoint({workspace:'w',role:'terraphim-editor-default',session:'a'},window.roles.storageInput('terraphim-editor-default','role one storage input'));
    const b=await store.checkpoint({workspace:'w',role:'Technical',session:'b'},window.roles.storageInput('Technical','role two storage input'));
    await store.checkpoint({workspace:'other',role:'Private',session:'c'},window.roles.storageInput('Private','different workspace input'));
    const all=await store.list({workspace:'w'}), scoped=await store.list({workspace:'w',role:'Technical'});
    store.close();return {a,b,all,scoped};
  });
  expect(result.all).toHaveLength(2);expect(result.all).toEqual(expect.arrayContaining([result.a,result.b]));
  expect(result.scoped).toEqual([result.b]);
});


test('actual import followed by a real storage failure reports imported role and unavailable checkpoint', async ({ page }) => {
  const result=await page.evaluate(async()=>{
    const {RoleCheckpoints,Storage,createEditorFrame,roleNamespace}=window.roles;
    const store=new RoleCheckpoints({Storage,indexedDB,databaseName:'roles-test:'+crypto.randomUUID(),enabled:true});
    const source={workspace:'w',role:'terraphim-editor-default',session:'source'},target={...source,session:'restored'};
    const frame=await createEditorFrame(document.body,{resource:'/brief.terraphim.md',source:'Risk remains.\n'});
    const snapshot=await frame.request('role-snapshot') as string, saved=await store.checkpoint(source,snapshot);
    const namespace=await roleNamespace('terraphim-editor',target);
    const error=await store.restore(saved,target,{importSnapshot:async text=>{
      await frame.request('role-import',{snapshot:text});
      // Real incompatible IDB version makes the subsequent released storage open fail.
      await new Promise<void>((resolve,reject)=>{const r=indexedDB.open('te-rolegraph:'+namespace,2);
        r.onupgradeneeded=()=>r.result.createObjectStore('future');r.onerror=()=>reject(r.error);r.onsuccess=()=>{r.result.close();resolve();};});
    }},{confirmed:true}).then(()=>'unexpected',error=>({code:error.code,roleImported:error.roleImported}));
    const actual=await frame.request('role-snapshot') as string, rows=await store.list({workspace:'w'});
    frame.dispose();store.close();return {error,rows,snapshot,actual};
  });
  expect(result.error).toEqual({code:'storage_unavailable',roleImported:true});
  expect(BigInt(JSON.parse(result.actual).generation)).toBe(BigInt(JSON.parse(result.snapshot).generation)+1n);
  expect(result.rows.filter(row=>row.status==='unavailable')).toHaveLength(1);
});


test('role metadata binding rejects a different choice before actual import without parsing graph semantics', async ({ page }) => {
  const result=await page.evaluate(async()=>{
    const {assertSnapshotRole,createEditorFrame}=window.roles;
    const frame=await createEditorFrame(document.body,{resource:'/brief.terraphim.md',source:'Risk remains.\n'});
    const snapshot=await frame.request('role-snapshot') as string;
    const actual=await frame.request('snapshot') as {roleName:string};
    assertSnapshotRole(snapshot,actual.roleName);
    const capture=(text:string,name:string)=>{try{assertSnapshotRole(text,name);return 'accepted';}catch(error){return (error as {code:string}).code;}};
    const mismatched=capture(snapshot,'different-role'), malformed=capture('{}',actual.roleName);
    const envelope=JSON.parse(snapshot),graph=JSON.parse(envelope.graphJson);
    graph.thesaurus.name='different-role';envelope.graphJson=JSON.stringify(graph);
    const inconsistent=capture(JSON.stringify(envelope),actual.roleName);
    const large=capture('x'.repeat(4*1024*1024+1),actual.roleName);
    const after=await frame.request('role-snapshot');frame.dispose();return {snapshot,after,mismatched,malformed,inconsistent,large};
  });
  expect(result.after).toBe(result.snapshot);
  expect(result.mismatched).toBe('identity_mismatch');expect(result.inconsistent).toBe('identity_mismatch');
  expect(result.malformed).toBe('invalid_input');expect(result.large).toBe('invalid_input');
});


test('checkpoint and tampered exact-byte restore refuse role-name mismatch before engine import', async ({ page }) => {
  const result=await page.evaluate(async()=>{
    const {RoleCheckpoints,Storage,createEditorFrame}=window.roles;
    const databaseName='roles-test:'+crypto.randomUUID(),store=new RoleCheckpoints({Storage,indexedDB,databaseName,enabled:true});
    const frame=await createEditorFrame(document.body,{resource:'/brief.terraphim.md',source:'Risk remains.\n'});
    const original=await frame.request('role-snapshot') as string;
    const role=(await frame.request('snapshot') as {roleName:string}).roleName;
    const source={workspace:'w',role,session:'original'};
    const checkpointMismatch=await store.checkpoint({...source,role:'wrong'},original).then(()=>'unexpected',e=>e.code);
    const saved=await store.checkpoint(source,original),envelope=JSON.parse(original),graph=JSON.parse(envelope.graphJson);
    graph.role='altered';graph.thesaurus.name='altered';envelope.graphJson=JSON.stringify(graph);
    const tampered=JSON.stringify(envelope),bytes=new TextEncoder().encode(tampered);
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
    const storage=new Storage({enabled:true,indexedDB,namespace:saved.namespace});await storage.save(tampered);storage.close();
    await new Promise<void>((resolve,reject)=>{const r=indexedDB.open(databaseName,1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{
      const db=r.result,tx=db.transaction('checkpoints','readwrite'),index=tx.objectStore('checkpoints');
      const key=[1,'terraphim-editor','w',role,'original'],get=index.get(key);get.onsuccess=()=>index.put({...get.result,sha256:hash,bytes:bytes.length},key);
      tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};
    };});
    const selected=(await store.list({workspace:'w'}))[0];let called=false;
    if(selected.status!=='candidate')throw new Error('Expected byte-valid tampered fixture');
    const restoreMismatch=await store.restore(selected,{...source,session:'new'}, {importSnapshot:async snapshot=>{called=true;await frame.request('role-import',{snapshot});}}, {confirmed:true}).then(()=>'unexpected',e=>e.code);
    const after=await frame.request('role-snapshot'),rows=await store.list({workspace:'w'});frame.dispose();store.close();
    return {checkpointMismatch,restoreMismatch,called,original,after,rows};
  });
  expect(result.checkpointMismatch).toBe('identity_mismatch');expect(result.restoreMismatch).toBe('identity_mismatch');
  expect(result.called).toBe(false);expect(result.after).toBe(result.original);expect(result.rows).toHaveLength(1);
});
