/** Newly reconstructed parent-renderer document drafts. No filesystem writes or automatic restore. */
import { sha256Utf8, sourceBytes } from './source.ts';
export interface DraftIdentity { workspace:string; resource:string; session:string }
export interface DraftInput { identity:DraftIdentity; source:string; baselineHash:string; revision:number }
export interface DraftRecord extends DraftInput { schema:1; extensionId:string; sha256:string; updatedAt:string }
export interface DraftSelection { status:'candidate'|'corrupt'; key:IDBValidKey; raw:string; token:string; record?:DraftRecord }
export type RecoveryErrorCode='invalid_input'|'unavailable'|'closed'|'stale'|'corrupt'|'capacity';
export class RecoveryError extends Error {
 readonly code:RecoveryErrorCode;
 constructor(code:RecoveryErrorCode){super(`Recovery ${code}`);this.name='RecoveryError';this.code=code;}
}
const hash=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const validPart=(s:unknown):s is string=>typeof s==='string'&&s.length>0&&!s.includes('\0')&&new TextEncoder().encode(s).length<=4096&&new TextDecoder().decode(new TextEncoder().encode(s))===s;
const identity=(v:DraftIdentity):DraftIdentity=>{if(!v||![v.workspace,v.resource,v.session].every(validPart))throw new RecoveryError('invalid_input');return{workspace:v.workspace,resource:v.resource,session:v.session};};
const json=(v:unknown):string=>{try {const text=JSON.stringify(v);if(typeof text!=='string')throw Error();return text;}catch{throw new RecoveryError('corrupt');}};
const keyFor=(extension:string,v:DraftIdentity):IDBValidKey=>[1,extension,v.workspace,v.resource,v.session];
const sameKey=(a:IDBValidKey,b:IDBValidKey)=>json(a)===json(b);


/** Compare supported structured-clone data with graph/alias identity, without JSON coercion. */
function sameStoredValue(a:unknown,b:unknown,left=new Map<object,object>(),right=new Map<object,object>(),budget={remaining:65536,bytes:16*1024*1024},depth=0):boolean {
 if(--budget.remaining<0||depth>128)return false;
 if(typeof a==='string'){budget.bytes-=a.length*2;if(budget.bytes<0)return false;}
 if(Object.is(a,b))return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
 if(left.has(a)||right.has(b))return left.get(a)===b&&right.get(b)===a;
 if(Object.prototype.toString.call(a)!==Object.prototype.toString.call(b))return false;
 left.set(a,b);right.set(b,a);
 const compare=(x:unknown,y:unknown)=>sameStoredValue(x,y,left,right,budget,depth+1);
 if(a instanceof Date&&b instanceof Date)return Object.is(a.getTime(),b.getTime());
 if(a instanceof RegExp&&b instanceof RegExp)return a.source===b.source&&a.flags===b.flags&&a.lastIndex===b.lastIndex;
 if(a instanceof ArrayBuffer&&b instanceof ArrayBuffer){budget.bytes-=a.byteLength;if(budget.bytes<0||a.byteLength!==b.byteLength)return false;const x=new Uint8Array(a),y=new Uint8Array(b);return x.length===y.length&&x.every((v,i)=>v===y[i]);}
 if(ArrayBuffer.isView(a)&&ArrayBuffer.isView(b))return a.constructor.name===b.constructor.name&&a.byteOffset===b.byteOffset&&a.byteLength===b.byteLength&&compare(a.buffer,b.buffer);
 if(a instanceof Map&&b instanceof Map){if(a.size>32768||b.size>32768)return false;const x=[...a],y=[...b];return x.length===y.length&&x.every(([k,v],i)=>compare(k,y[i][0])&&compare(v,y[i][1]));}
 if(a instanceof Set&&b instanceof Set){if(a.size>32768||b.size>32768)return false;const x=[...a],y=[...b];return x.length===y.length&&x.every((v,i)=>compare(v,y[i]));}
 // Hidden-state browser objects (for example CryptoKey) cannot safely be guessed equal.
 if(!Array.isArray(a)&&Object.getPrototypeOf(a)!==Object.prototype&&Object.getPrototypeOf(a)!==null)return false;
 if(Array.isArray(a)&&Array.isArray(b)&&a.length!==b.length)return false;
 const x=Object.keys(a),y=Object.keys(b);
 if(x.length>32768||y.length>32768)return false;
 return x.length===y.length&&x.every((k,i)=>k===y[i]&&compare((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k]));
}
function inspectionSummary(value:unknown):string {
 if(!value||typeof value!=='object')return `[Corrupt recovery value: ${typeof value}]`;
 const keys=Object.keys(value).slice(0,16);
 const source=(value as {source?:unknown}).source;
 return JSON.stringify({warning:'Corrupt recovery data; inspection summary only',type:Object.prototype.toString.call(value),fields:keys.map(k=>({name:k.slice(0,128),type:typeof (value as Record<string,unknown>)[k]})),...(typeof source==='string'?{sourceExcerpt:source.slice(0,4096)}:{})},null,2);
}

/** Every mutation waits for transaction completion; admission failure leaves read/discard usable. */
export class DraftRecovery {
 readonly databaseName:string;
 readonly extensionId:string;
 private factory:IDBFactory;
 private db:IDBDatabase|null=null;
 private opening:Promise<IDBDatabase>|null=null;
 private closed=false;
 private transactions=new Set<IDBTransaction>();
 private selections=new Map<string,{key:IDBValidKey;value:unknown}>();
 private listGeneration=0;
 constructor(options:{indexedDB:IDBFactory;databaseName?:string;extensionId?:string}) {
  this.factory=options.indexedDB;this.databaseName=options.databaseName??'terraphim:nimbalyst:document-drafts:v1';this.extensionId=options.extensionId??'terraphim-editor';
  if(!this.factory||!validPart(this.databaseName)||!validPart(this.extensionId))throw new RecoveryError('invalid_input');
 }
 private open():Promise<IDBDatabase> {
  if(this.closed)return Promise.reject(new RecoveryError('closed'));
  if(this.db)return Promise.resolve(this.db);
  if(this.opening)return this.opening;
  const pending=new Promise<IDBDatabase>((resolve,reject)=>{
   let request:IDBOpenDBRequest;let failed=false;
   try{request=this.factory.open(this.databaseName,1);}catch{reject(new RecoveryError('unavailable'));return;}
   request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('drafts'))request.result.createObjectStore('drafts');};
   request.onerror=()=>{failed=true;reject(new RecoveryError('unavailable'));};
   request.onblocked=()=>{failed=true;reject(new RecoveryError('unavailable'));};
   request.onsuccess=()=>{const db=request.result;if(this.closed||failed){db.close();reject(new RecoveryError('closed'));return;}this.db=db;db.onversionchange=()=>{db.close();if(this.db===db)this.db=null;};resolve(db);};
  });
  this.opening=pending;void pending.finally(()=>{if(this.opening===pending)this.opening=null;}).catch(()=>{});return pending;
 }
 private async transaction<T>(mode:IDBTransactionMode,operation:(store:IDBObjectStore,result:(value:T)=>void,fail:(code:RecoveryErrorCode)=>void)=>void):Promise<T> {
  const db=await this.open();if(this.closed)throw new RecoveryError('closed');
  return new Promise<T>((resolve,reject)=>{let tx:IDBTransaction;
   try{tx=db.transaction('drafts',mode);}catch{reject(new RecoveryError('unavailable'));return;}
   this.transactions.add(tx);let output:T,hasOutput=false,error:RecoveryError|null=null;
   const fail=(code:RecoveryErrorCode)=>{error=new RecoveryError(code);try{tx.abort();}catch{reject(error);}};
   tx.oncomplete=()=>{this.transactions.delete(tx);if(hasOutput)resolve(output);else reject(new RecoveryError('unavailable'));};
   tx.onabort=tx.onerror=()=>{this.transactions.delete(tx);reject(error??new RecoveryError(this.closed?'closed':'unavailable'));};
   try{operation(tx.objectStore('drafts'),value=>{output=value;hasOutput=true;},fail);}catch{fail('unavailable');}
  });
 }
 private selection(value:unknown,key:IDBValidKey,status:'candidate'|'corrupt',record?:DraftRecord):DraftSelection {
  const token=crypto.randomUUID();this.selections.set(token,{key:structuredClone(key),value});
  if(this.selections.size>128)this.selections.delete(this.selections.keys().next().value!);
  return{status,key:structuredClone(key),raw:status==='candidate'?json(value):inspectionSummary(value),token,...(record?{record}:{})};
 }
 private selected(input:DraftSelection):{key:IDBValidKey;value:unknown} {
  const saved=this.selections.get(input.token);
  if(!saved)throw new RecoveryError('stale');
  try{if(this.factory.cmp(saved.key,input.key)!==0)throw Error();}catch{throw new RecoveryError('invalid_input');}
  return saved;
 }
 private readKey(key:IDBValidKey):Promise<unknown> {return this.transaction('readonly',(store,result)=>{const q=store.get(key);q.onsuccess=()=>result(q.result);});}
 private async validated(value:unknown,key:IDBValidKey):Promise<DraftRecord> {
  try{
   if(!value||typeof value!=='object'||Array.isArray(value))throw Error();
   const v=value as DraftRecord,id=identity(v.identity);
   if(Object.keys(v).sort().join(',')!=='baselineHash,extensionId,identity,revision,schema,sha256,source,updatedAt'||v.schema!==1||v.extensionId!==this.extensionId||!sameKey(key,keyFor(this.extensionId,id))||!hash(v.sha256)||!hash(v.baselineHash)||!Number.isInteger(v.revision)||v.revision<0||v.revision>0xffffffff||typeof v.updatedAt!=='string'||!Number.isFinite(Date.parse(v.updatedAt)))throw Error();
   sourceBytes(v.source);if(await sha256Utf8(v.source)!==v.sha256)throw Error();return structuredClone(v);
  }catch{throw new RecoveryError('corrupt');}
 }
 async put(input:DraftInput):Promise<DraftRecord> {
  const id=identity(input.identity),source=input.source,baselineHash=input.baselineHash,revision=input.revision;
  try{sourceBytes(source);}catch{throw new RecoveryError('invalid_input');}
  if(!hash(baselineHash)||!Number.isInteger(revision)||revision<0||revision>0xffffffff)throw new RecoveryError('invalid_input');
  const record:DraftRecord={schema:1,extensionId:this.extensionId,identity:id,source,baselineHash,revision,sha256:await sha256Utf8(source),updatedAt:new Date().toISOString()};
  const key=keyFor(this.extensionId,id),previous=await this.readKey(key);
  let unchanged:DraftRecord|undefined;
  if(previous!==undefined){const old=await this.validated(previous,key);if(old.revision>=revision){if(old.revision===revision&&old.source===source&&old.sha256===record.sha256&&old.baselineHash===baselineHash)unchanged=old;else throw new RecoveryError('stale');}}
  const previousRaw=previous===undefined?undefined:json(previous);
  return this.transaction('readwrite',(store,result,fail)=>{const request=store.get(key);request.onsuccess=()=>{
   const current=request.result;if((current===undefined?undefined:json(current))!==previousRaw){fail('stale');return;}
   if(unchanged){result(unchanged);return;}
   const all=store.getAll();all.onsuccess=()=>{try{
    const values=all.result as unknown[];const count=values.length+(previous===undefined?1:0);
    const bytes=values.reduce<number>((sum,v)=>sum+new TextEncoder().encode(json(v)).length,0)-(previousRaw===undefined?0:new TextEncoder().encode(previousRaw).length)+new TextEncoder().encode(json(record)).length;
    if(count>128||bytes>16*1024*1024){fail('capacity');return;}
    store.put(record,key);result(structuredClone(record));
   }catch{fail('corrupt');}};
  };});
 }
 async list(scope:{workspace:string;resource?:string}):Promise<DraftSelection[]> {
  if(!validPart(scope.workspace)||(scope.resource!==undefined&&!validPart(scope.resource)))throw new RecoveryError('invalid_input');
  const workspace=scope.workspace,resource=scope.resource,generation=++this.listGeneration;
  this.selections.clear(); // Only the newest list owns selection snapshots; refresh invalidates earlier rows.
  const rows=await this.transaction<Array<{key:IDBValidKey;value:unknown}>>('readonly',(store,result)=>{const rows:Array<{key:IDBValidKey;value:unknown}>=[];const q=store.openCursor();q.onsuccess=()=>{const c=q.result;if(!c){result(rows);return;}const k=c.key;if(Array.isArray(k)&&k[0]===1&&k[1]===this.extensionId&&k[2]===workspace&&(resource===undefined||k[3]===resource))rows.push({key:k,value:c.value});c.continue();};});
  const checked=await Promise.all(rows.map(async row=>{try{return{...row,record:await this.validated(row.value,row.key)};}catch{return{...row,record:undefined};}}));
  if(this.closed)throw new RecoveryError('closed');
  if(generation!==this.listGeneration)throw new RecoveryError('stale');
  return checked.map(row=>this.selection(row.value,row.key,row.record?'candidate':'corrupt',row.record));
 }
 /** Re-read selected bytes before offering a dirty buffer; never writes the source document. */
 async recover(selection:DraftSelection,currentDiskHash:string):Promise<{status:'recoverable'|'conflict';source:string;record:DraftRecord}> {
  if(!hash(currentDiskHash))throw new RecoveryError('invalid_input');
  const {key,value}=this.selected(selection);
  const current=await this.readKey(key);
  this.selected(selection);
  if(current===undefined||!sameStoredValue(current,value))throw new RecoveryError('stale');
  const record=await this.validated(current,key);this.selected(selection);
  return{status:currentDiskHash===record.baselineHash?'recoverable':'conflict',source:record.source,record};
 }
 /** Caller supplies the exact selected row; a newer write is never deleted. */
 async discard(selection:DraftSelection):Promise<boolean> {
  const {key,value}=this.selected(selection);
  return this.deleteSelected(key,value,()=>this.selected(selection));
 }
 private deleteSelected(key:IDBValidKey,value:unknown,current?:()=>unknown):Promise<boolean> {
  return this.transaction('readwrite',(store,result,fail)=>{const q=store.get(key);q.onsuccess=()=>{try{if(current?.()===false){result(false);return;}}catch{fail('stale');return;}if(q.result===undefined||!sameStoredValue(q.result,value)){result(false);return;}store.delete(key);result(true);};});
 }
 async removeIf(record:DraftRecord,isCurrent?:()=>boolean):Promise<boolean> {
  const selected=structuredClone(record),key=keyFor(this.extensionId,identity(selected.identity));
  await this.validated(selected,key);return this.deleteSelected(key,selected,isCurrent);
 }
 /** Real write/transaction/read/delete probe, using only this attempt's new session key. */
 async probe(id:DraftIdentity):Promise<void> {
  const probeId={...identity(id),session:'probe:'+crypto.randomUUID()};
  const saved=await this.put({identity:probeId,revision:0,source:'',baselineHash:await sha256Utf8('')});
  const key=keyFor(this.extensionId,probeId);await this.validated(await this.readKey(key),key);
  if(!await this.removeIf(saved))throw new RecoveryError('stale');
 }
 close():void {if(this.closed)return;this.closed=true;for(const tx of this.transactions){try{tx.abort();}catch{}}this.db?.close();this.db=null;this.selections.clear();}
}
