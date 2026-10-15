/** Reconstructed opaque transport. Visual editor shell and native CSP remain separate gates. */
import type {DraftSelection} from './recovery.ts';
import {sourceBytes,sha256Utf8} from './source.ts';
import {verifyVisualAssets,type VisualAssets,type VisualManifest} from './visual.ts';
import type {ParentController,Envelope,Proposal,SaveReceipt} from './controller.ts';
export const FRAME_ASSET_NAMES=['bootstrap','source','engineGlue','engineWasm','hostBridge'] as const;
export type FrameAssetName=typeof FRAME_ASSET_NAMES[number];
export type FrameAssets=Record<FrameAssetName,Uint8Array<ArrayBuffer>>;
export type FrameManifest=Record<FrameAssetName,{sha256:string;bytes:number}>;
export interface FrameOptions {container:HTMLElement;controller:ParentController;isCurrent:()=>boolean;signal?:AbortSignal;assets:FrameAssets;manifest:FrameManifest;visual?:{assets:VisualAssets;manifest:VisualManifest};startupTimeoutMs?:number;requestTimeoutMs?:number}
const LIMIT=16*1024*1024;
const digest=async(bytes:Uint8Array<ArrayBuffer>)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
/** Bound serialized UTF-8 control data, including JSON overhead, before transport. */
export function serializeFrameControl(value:unknown):string {const text=JSON.stringify(value);if(typeof text!=='string'||text.length>LIMIT||new TextEncoder().encode(text).length>LIMIT)throw Error('Frame message too large');return text;}
function parsed(value:unknown):Record<string,unknown> {if(typeof value!=='string'||value.length>LIMIT||new TextEncoder().encode(value).length>LIMIT)throw Error('Invalid frame message size');const result=JSON.parse(value);if(!result||typeof result!=='object'||Array.isArray(result))throw Error('Invalid frame message');return result;}
function manifestCopy(manifest:FrameManifest):FrameManifest {if(!manifest||Object.keys(manifest).sort().join()!==[...FRAME_ASSET_NAMES].sort().join())throw Error('Invalid frame manifest');const copy={} as FrameManifest;for(const name of FRAME_ASSET_NAMES){const item=manifest[name];if(!item||Object.keys(item).sort().join()!=='bytes,sha256'||!Number.isSafeInteger(item.bytes)||item.bytes<=0||!(/^[a-f0-9]{64}$/).test(item.sha256))throw Error('Invalid frame manifest');copy[name]={bytes:item.bytes,sha256:item.sha256};}return copy;}
/** Copy all bytes before awaiting any digest; verify before executable object URLs exist. */
export async function verifyFrameAssets(assets:FrameAssets,manifest:FrameManifest,isCurrent=()=>true):Promise<FrameAssets>{
 const expected=manifestCopy(manifest);if(!assets||Object.keys(assets).sort().join()!==[...FRAME_ASSET_NAMES].sort().join())throw Error('Invalid frame asset names');
 const checked={} as FrameAssets;let total=0;
 for(const name of FRAME_ASSET_NAMES){const source=assets[name];if(!(source instanceof Uint8Array)||source.byteLength!==expected[name].bytes||(total+=source.byteLength)>LIMIT)throw Error('Invalid frame asset size');checked[name]=new Uint8Array(source);}
 for(const name of FRAME_ASSET_NAMES){if(!isCurrent())throw Error('Frame owner changed');const hash=await digest(checked[name]);if(!isCurrent())throw Error('Frame owner changed');if(hash!==expected[name].sha256)throw Error('Frame asset hash mismatch');}
 return checked;
}
/** Constant installer: document text is transferred on the private port, never interpolated. */
function opaqueInstaller(nonce:string):void {
 let used=false;
 const onInit=async(event:MessageEvent)=>{
  if(used||event.source!==parent||event.data?.type!=='terraphim-init'||event.data?.nonce!==nonce||event.ports.length!==1)return;
  used=true;removeEventListener('message',onInit);const port=event.ports[0];let bootstrapUrl:string|null=null;
  try{
   const init=event.data;const names=['bootstrap','source','engineGlue','engineWasm','hostBridge'];
   if(Object.keys(init.assets).sort().join()!==[...names].sort().join()||Object.keys(init.manifest).sort().join()!==[...names].sort().join())throw Error('Invalid assets');let total=0;
   for(const name of names){const bytes=init.assets[name] as Uint8Array<ArrayBuffer>,expected=init.manifest[name];if(!(bytes instanceof Uint8Array)||!expected||bytes.length!==expected.bytes||!(/^[a-f0-9]{64}$/).test(expected.sha256)||(total+=bytes.length)>16*1024*1024)throw Error('Invalid asset');const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==expected.sha256)throw Error('Asset integrity failure');}
   if(init.visual){
    const visualNames=['runtime','components','styles','wrapper','graphWorker','graphGlue','graphWasm','defaultRole'];
    if(Object.keys(init.visual.assets).sort().join()!==[...visualNames].sort().join()||Object.keys(init.visual.manifest).sort().join()!==[...visualNames].sort().join())throw Error('Invalid visual assets');
    for(const name of visualNames){const bytes=init.visual.assets[name] as Uint8Array<ArrayBuffer>,expected=init.visual.manifest[name];if(!(bytes instanceof Uint8Array)||!expected||Object.keys(expected).sort().join()!=='bytes,sha256'||!Number.isSafeInteger(expected.bytes)||expected.bytes<=0||bytes.length!==expected.bytes||!(/^[a-f0-9]{64}$/).test(expected.sha256)||(total+=bytes.length)>16*1024*1024)throw Error('Invalid visual asset');const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==expected.sha256)throw Error('Visual asset integrity failure');}
   }
   bootstrapUrl=URL.createObjectURL(new Blob([init.assets.bootstrap],{type:'text/javascript'}));
   const module=await import(bootstrapUrl);const client=await module.activate(init,port,nonce);
   Object.defineProperty(globalThis,'TerraphimFrameClient',{value:client,configurable:true});
  }catch{port.postMessage(JSON.stringify({type:'frame-error',frameEpoch:nonce,reason:'Frame initialization failed'}));port.close();}
  finally{if(bootstrapUrl)URL.revokeObjectURL(bootstrapUrl);}
 };
 addEventListener('message',onInit);parent.postMessage({type:'terraphim-frame-ready',protocol:1,nonce},'*');
}
interface HostSave {token:string;promise:Promise<SaveReceipt>;resolve:(receipt:SaveReceipt)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;timedOut:boolean;inFlight:boolean;generation:number;scheduled:boolean;refused:Error|null}
interface HostRestore {token:string;selection:DraftSelection;promise:Promise<Envelope>;resolve:(receipt:Envelope)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;timedOut:boolean;receipt:Envelope|null}
interface RoleRequest {requestId:string;operation:'export'|'import';before:Envelope;promise:Promise<string>;resolve:(value:string)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;timedOut:boolean}
function boundedRoleSnapshot(value:unknown):asserts value is string {if(typeof value!=='string'||new TextEncoder().encode(value).byteLength>4*1024*1024||new TextDecoder().decode(new TextEncoder().encode(value))!==value)throw Error('Invalid role snapshot size or encoding')}
interface HostReload {token:string;promise:Promise<Envelope>;resolve:(value:Envelope)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;timedOut:boolean;inFlight:boolean;receipt:Envelope|null;failure:Error|null}
/** Captured text for explicit copying; acceptedRevision does not make it a saved/ACKed source. */
export interface CurrentDraft {resource:string;session:string;acceptedRevision:number;source:string;sourceHash:string}
interface DraftRead {requestId:string;resource:string;session:string;promise:Promise<CurrentDraft>;resolve:(value:CurrentDraft)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}
/** One owned sandbox, private port, bounded latest proposal and one explicit Save barrier. */
export class FrameTransport {
 readonly element:HTMLIFrameElement;readonly epoch=crypto.randomUUID();
 private port:MessagePort|null=null;private disposed=false;private initialized=false;private started=false;private busy=false;private lastId=0;
 private roleRequest:RoleRequest|null=null;private hostReload:HostReload|null=null;private hostSave:HostSave|null=null;private hostRestore:HostRestore|null=null;private draftRead:DraftRead|null=null;
 private options:FrameOptions;private readyListener:((event:MessageEvent)=>void)|null=null;private startupTimer:ReturnType<typeof setTimeout>|null=null;private ownerTimer:ReturnType<typeof setInterval>|null=null;
 private rejectStart:((error:Error)=>void)|null=null;private abortListener:()=>void;
 private constructor(options:FrameOptions){this.options=options;this.element=document.createElement('iframe');this.element.title='Terraphim editor';this.element.setAttribute('sandbox','allow-scripts');this.abortListener=()=>this.dispose();}
 static async start(options:FrameOptions):Promise<FrameTransport>{
  const current=()=>!options.signal?.aborted&&options.isCurrent()&&options.container.isConnected;
  if(!(options.container instanceof HTMLElement)||typeof options.isCurrent!=='function'||!current())throw Error('Frame owner unavailable');
  for(const ms of [options.startupTimeoutMs??10000,options.requestTimeoutMs??30000])if(!Number.isSafeInteger(ms)||ms<50||ms>60000)throw Error('Invalid frame deadline');
  const manifest=manifestCopy(options.manifest);const [assets,visual]=await Promise.all([verifyFrameAssets(options.assets,manifest,current),options.visual?verifyVisualAssets(options.visual.assets,options.visual.manifest,current):Promise.resolve(undefined)]);if(Object.values(assets).reduce((n,value)=>n+value.byteLength,0)+Object.values(visual?.assets??{}).reduce((n,value)=>n+value.byteLength,0)>LIMIT)throw Error('Combined frame assets exceed limit');if(!current())throw Error('Frame owner changed');const snapshot=options.controller.snapshot();sourceBytes(snapshot.source);serializeFrameControl(snapshot);
  const transport=new FrameTransport({...options,manifest,visual});await transport.mount(assets,snapshot);return transport;
 }
 private current():boolean {try{return !this.disposed&&!this.options.signal?.aborted&&this.options.isCurrent()&&this.options.container.isConnected;}catch{return false;}}
 private mount(assets:FrameAssets,snapshot:Envelope):Promise<void>{
  return new Promise((resolve,reject)=>{
   this.rejectStart=reject;const fail=(reason:string)=>{reject(Error(reason));this.dispose();};
   this.options.signal?.addEventListener('abort',this.abortListener,{once:true});if(!this.current()){fail('Frame owner changed');return;}
   this.ownerTimer=setInterval(()=>{if(!this.current())this.dispose();},50);
   this.startupTimer=setTimeout(()=>fail('Frame startup timed out'),this.options.startupTimeoutMs??10000);
   this.readyListener=(event:MessageEvent)=>{
    if(!this.current()||this.initialized||event.source!==this.element.contentWindow||event.origin!=='null'||event.data?.type!=='terraphim-frame-ready'||event.data?.protocol!==1||event.data?.nonce!==this.epoch)return;
    this.initialized=true;removeEventListener('message',this.readyListener!);this.readyListener=null;const channel=new MessageChannel();this.port=channel.port1;
    this.port.onmessage=(message:MessageEvent)=>{
     if(!this.current()){this.dispose();return;}let data:Record<string,unknown>;try{data=parsed(message.data);}catch{this.reply({type:'transport-error',reason:'Invalid frame message size or syntax',id:null});return;}
     if(data.frameEpoch!==this.epoch)return;
     if(data.type==='frame-error'){fail('Frame refused its local assets');return;}
     if(data.type==='frame-started'){
      if(this.started)return;
      if(data.protocol!==1||data.resource!==snapshot.resource||data.session!==snapshot.session||data.revision!==snapshot.revision||data.sourceHash!==snapshot.sourceHash){fail('Frame session mismatch');return;}
      let actual:Envelope;try{actual=this.options.controller.snapshot();}catch{fail('Frame owner changed during startup');return;}
      if(actual.resource!==snapshot.resource||actual.session!==snapshot.session||actual.revision!==snapshot.revision||actual.sourceHash!==snapshot.sourceHash){fail('Parent changed during frame startup');return;}
      this.started=true;if(this.startupTimer)clearTimeout(this.startupTimer);this.startupTimer=null;this.rejectStart=null;resolve();return;
     }
     if(!this.started)return;
     void this.receive(data).catch(()=>this.dispose());
    };
    this.port.start();this.element.contentWindow!.postMessage({type:'terraphim-init',nonce:this.epoch,assets,manifest:this.options.manifest,visual:this.options.visual,snapshot,requestTimeoutMs:this.options.requestTimeoutMs??30000},'*',[channel.port2]);
   };
   addEventListener('message',this.readyListener);const nonce=this.epoch;const script=`(${opaqueInstaller.toString()})(${JSON.stringify(nonce)});`;
   const localResources=this.options.visual?"style-src 'unsafe-inline'; connect-src blob: data:; worker-src blob:; img-src blob: data:; font-src data:":"style-src 'none'; connect-src 'none'; worker-src 'none'; img-src 'none'; font-src 'none'";
   this.element.srcdoc=`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' blob: 'wasm-unsafe-eval'; ${localResources}; frame-src 'none'; base-uri 'none'; form-action 'none'"><script nonce="${nonce}">${script}</script>`;
   this.options.container.append(this.element);
  });
 }
 private reply(message:Record<string,unknown>):void {if(!this.current()){this.dispose();return;}try{this.port?.postMessage(serializeFrameControl({...message,frameEpoch:this.epoch}));}catch{this.port?.postMessage(serializeFrameControl({type:'transport-error',frameEpoch:this.epoch,id:null,reason:'Authoritative reply exceeds transport limit'}));}}
 /** Capture the frame's latest source through its existing bridge before the parent Save. */
 requestSave():Promise<SaveReceipt>{
  if(this.roleRequest)return Promise.reject(Error('Role operation is in progress'));
  if(this.hostReload)return Promise.reject(Error('Explicit reload is in progress'));
  if(this.hostRestore)return Promise.reject(Error('Recovery restoration is in progress'));
  if(!this.current()||!this.started)return Promise.reject(Error('Frame unavailable'));
  if(this.hostSave){
   const pending=this.hostSave;
   if(!pending.timedOut&&!pending.refused){
    if(pending.generation>=Number.MAX_SAFE_INTEGER){pending.timedOut=true;pending.reject(Error('Save request sequence exhausted'));}
    else {pending.generation++;this.queueHostSave(pending);}
   }
   return pending.promise;
  }
  try{this.options.controller.snapshot();}catch(error){return Promise.reject(error);}
  let resolve!:(receipt:SaveReceipt)=>void,reject!:(error:Error)=>void;
  const promise=new Promise<SaveReceipt>((yes,no)=>{resolve=yes;reject=no;});
  const pending:HostSave={token:crypto.randomUUID(),promise,resolve,reject,timer:setTimeout(()=>{
   if(this.hostSave!==pending)return;pending.timedOut=true;
   reject(Error('Host Save timed out; its outcome is not cancellation'));
   this.reply({type:'transport-error',reason:'Host Save timed out; its outcome is not cancellation',id:null});
  },this.options.requestTimeoutMs??30000),timedOut:false,inFlight:false,generation:1,scheduled:false,refused:null};
  this.hostSave=pending;
  this.queueHostSave(pending);
  return promise;
 }
 private queueHostSave(pending:HostSave):void {
  if(pending.scheduled)return;pending.scheduled=true;
  queueMicrotask(()=>{pending.scheduled=false;if(this.hostSave===pending&&!pending.timedOut&&!pending.refused)this.dispatchHostSave(pending);});
 }
 private dispatchHostSave(pending:HostSave):void {
  if(this.hostSave!==pending)return;
  let snapshot:Envelope;try{snapshot=this.options.controller.snapshot();}catch(error){this.finishHostSave(pending,undefined,error instanceof Error?error:Error('Frame unavailable'));return;}
  this.reply({type:'host-save',protocol:1,resource:snapshot.resource,session:snapshot.session,token:pending.token,generation:pending.generation});
 }
 private finishHostSave(pending:HostSave,receipt?:SaveReceipt,error?:Error):void {
  if(this.hostSave!==pending)return;clearTimeout(pending.timer);this.hostSave=null;
  if(error)pending.reject(error);else if(receipt&&!pending.timedOut)pending.resolve(receipt);
 }
 /** Read-only capture remains reachable when recovery storage or normal editing is blocked. */
 readDraft():Promise<CurrentDraft>{
  if(!this.current()||!this.started)return Promise.reject(Error('Frame unavailable'));
  if(this.draftRead)return this.draftRead.promise;
  let snapshot:Envelope;try{snapshot=this.options.controller.snapshot()}catch(error){return Promise.reject(error)}
  let resolve!:(value:CurrentDraft)=>void,reject!:(error:Error)=>void;const promise=new Promise<CurrentDraft>((yes,no)=>{resolve=yes;reject=no});
  const pending:DraftRead={requestId:crypto.randomUUID(),resource:snapshot.resource,session:snapshot.session,promise,resolve,reject,timer:setTimeout(()=>this.finishDraftRead(pending,undefined,Error('Current draft read timed out')),this.options.requestTimeoutMs??30000)};
  this.draftRead=pending;this.reply({type:'host-read-draft',protocol:1,requestId:pending.requestId,resource:pending.resource,session:pending.session});return promise;
 }
 private finishDraftRead(pending:DraftRead,value?:CurrentDraft,error?:Error):void {if(this.draftRead!==pending)return;clearTimeout(pending.timer);this.draftRead=null;if(error)pending.reject(error);else if(value)pending.resolve(value);}
 /** Export the active role only; document alternatives never become shared-role input. */
 exportRoleSnapshot():Promise<string>{return this.requestRole('export')}
 /** The released coordinator validates and activates snapshots transactionally. */
 importRoleSnapshot(snapshot:string):Promise<string>{try{boundedRoleSnapshot(snapshot)}catch(error){return Promise.reject(error)}return this.requestRole('import',snapshot)}
 private requestRole(operation:'export'|'import',snapshot?:string):Promise<string>{
  if(!this.current()||!this.started)return Promise.reject(Error('Frame unavailable'));
  if(this.roleRequest||this.hostReload||this.hostSave||this.hostRestore||this.busy)return Promise.reject(Error('Another frame operation is in progress'));
  let before:Envelope;try{before=this.options.controller.snapshot()}catch(error){return Promise.reject(error)}
  let resolve!:(value:string)=>void,reject!:(error:Error)=>void;const promise=new Promise<string>((yes,no)=>{resolve=yes;reject=no});
  const pending:RoleRequest={requestId:crypto.randomUUID(),operation,before,promise,resolve,reject,timedOut:false,timer:setTimeout(()=>{if(this.roleRequest!==pending)return;pending.timedOut=true;reject(Error('Role operation timed out; its outcome is not cancellation'));this.reply({type:'transport-error',id:null,reason:'Role operation timed out; its outcome is not cancellation'})},this.options.requestTimeoutMs??30000)};
  this.roleRequest=pending;this.reply({type:'host-role',protocol:1,requestId:pending.requestId,operation,resource:before.resource,session:before.session,revision:before.revision,sourceHash:before.sourceHash,...(operation==='import'?{snapshot}:{})});return promise;
 }
 private finishRole(pending:RoleRequest,value?:string,error?:Error):void {if(this.roleRequest!==pending)return;clearTimeout(pending.timer);this.roleRequest=null;if(error)pending.reject(error);else if(value!==undefined&&!pending.timedOut)pending.resolve(value);}
 /** Explicitly replace the frozen buffer with actual disk bytes; never writes the file. */
 reload(choice:{confirmed:boolean}):Promise<Envelope>{
  if(choice?.confirmed!==true)return Promise.reject(Error('Reload needs explicit confirmation'));
  if(!this.current()||!this.started)return Promise.reject(Error('Frame unavailable'));
  if(this.roleRequest||this.hostReload||this.hostSave||this.hostRestore||this.busy)return Promise.reject(Error('Another frame operation is in progress'));
  let snapshot:Envelope;try{snapshot=this.options.controller.snapshot()}catch(error){return Promise.reject(error)}
  let resolve!:(value:Envelope)=>void,reject!:(error:Error)=>void;const promise=new Promise<Envelope>((yes,no)=>{resolve=yes;reject=no});
  const pending:HostReload={token:crypto.randomUUID(),promise,resolve,reject,timedOut:false,inFlight:false,receipt:null,failure:null,timer:setTimeout(()=>{if(this.hostReload!==pending)return;pending.timedOut=true;reject(Error('Reload timed out; its outcome is not cancellation'));this.reply({type:'transport-error',id:null,reason:'Reload timed out; its outcome is not cancellation'})},this.options.requestTimeoutMs??30000)};
  this.hostReload=pending;this.reply({type:'host-reload',protocol:1,resource:snapshot.resource,session:snapshot.session,token:pending.token});return promise;
 }
 private finishReload(pending:HostReload,error?:Error):void {if(this.hostReload!==pending)return;clearTimeout(pending.timer);this.hostReload=null;if(error)pending.reject(error);else if(pending.failure)pending.reject(pending.failure);else if(pending.receipt&&!pending.timedOut)pending.resolve(pending.receipt);}
 /** Explicit restoration flushes/fixes the owned frame before changing its dirty buffer. */
 restoreDraft(selection:DraftSelection,choice:{confirmed:boolean}):Promise<Envelope>{
  if(choice?.confirmed!==true)return Promise.reject(Error('Recovery restoration needs explicit confirmation'));
  if(!this.current()||!this.started)return Promise.reject(Error('Frame unavailable'));
  if(this.roleRequest||this.hostRestore||this.hostSave||this.hostReload)return Promise.reject(Error('Recovery restoration, reload or Save is already in progress'));
  let snapshot:Envelope;try{snapshot=this.options.controller.snapshot()}catch(error){return Promise.reject(error)}
  let resolve!:(receipt:Envelope)=>void,reject!:(error:Error)=>void;const promise=new Promise<Envelope>((yes,no)=>{resolve=yes;reject=no});
  const pending:HostRestore={token:crypto.randomUUID(),selection,promise,resolve,reject,timedOut:false,receipt:null,timer:setTimeout(()=>{if(this.hostRestore!==pending)return;pending.timedOut=true;pending.reject(Error('Recovery restoration timed out; its outcome is not cancellation'));this.reply({type:'transport-error',id:null,reason:'Recovery restoration timed out'})},this.options.requestTimeoutMs??30000)};
  this.hostRestore=pending;this.reply({type:'host-restore',protocol:1,resource:snapshot.resource,session:snapshot.session,token:pending.token});return promise;
 }
 private finishRestore(pending:HostRestore,error?:Error):void {
  if(this.hostRestore!==pending)return;clearTimeout(pending.timer);this.hostRestore=null;
  if(error)pending.reject(error);else if(pending.receipt&&!pending.timedOut)pending.resolve(pending.receipt);
 }
 private async receive(message:Record<string,unknown>):Promise<void>{
  if(!this.current()){this.dispose();return;}
  if(message.type==='role-result'||message.type==='role-refused'){
   const pending=this.roleRequest;if(!pending||message.protocol!==1||message.requestId!==pending.requestId||message.resource!==pending.before.resource||message.session!==pending.before.session||message.operation!==pending.operation)return;
   try{
    if(message.type==='role-refused'){if(Object.keys(message).sort().join()!=='frameEpoch,operation,protocol,reason,requestId,resource,session,type'||typeof message.reason!=='string'||message.reason.length>256)throw Error('Invalid role refusal');this.finishRole(pending,undefined,Error(message.reason));return;}
    if(Object.keys(message).sort().join()!=='frameEpoch,operation,protocol,requestId,resource,revision,session,snapshot,sourceHash,type')throw Error('Invalid role result');
    const current=this.options.controller.snapshot();if(message.revision!==pending.before.revision||message.sourceHash!==pending.before.sourceHash||current.revision!==message.revision||current.sourceHash!==message.sourceHash)throw Error('Role result belongs to a changed document');boundedRoleSnapshot(message.snapshot);
    this.finishRole(pending,message.snapshot);if(pending.timedOut)this.reply({type:'transport-error',id:null,reason:'Role operation completed after its deadline'});
   }catch(error){this.reply({type:'transport-error',id:null,reason:'Invalid role result'});this.finishRole(pending,undefined,error instanceof Error?error:Error('Invalid role result'))}return;
  }
  if(['host-reload-ready','host-reload-refused','host-reload-applied'].includes(String(message.type))){
   const pending=this.hostReload;if(!pending)return;const before=this.options.controller.snapshot();if(message.protocol!==1||message.resource!==before.resource||message.session!==before.session||message.token!==pending.token)return;
   const keys=Object.keys(message).sort().join();
   if(message.type==='host-reload-refused'){if(keys==='frameEpoch,protocol,reason,resource,session,token,type'&&typeof message.reason==='string'&&message.reason.length<=256&&!pending.inFlight)this.finishReload(pending,Error(message.reason));return;}
   if(keys!=='frameEpoch,protocol,resource,revision,session,sourceHash,token,type')return;
   if(message.type==='host-reload-applied'){if(pending.receipt&&message.revision===pending.receipt.revision&&message.sourceHash===pending.receipt.sourceHash&&before.revision===message.revision&&before.sourceHash===message.sourceHash)this.finishReload(pending);return;}
   if(pending.inFlight)return;
   if(this.busy||pending.timedOut||message.revision!==before.revision||message.sourceHash!==before.sourceHash){this.reply({type:'host-reload-failed',protocol:1,resource:before.resource,session:before.session,token:pending.token,reason:'Stale or expired reload'});this.finishReload(pending,Error('Stale or expired reload'));return;}
   pending.inFlight=true;this.busy=true;
   try{pending.receipt=await this.options.controller.reload();}
   catch(error){pending.failure=error instanceof Error?error:Error('Reload refused');if(this.current()){const after=this.options.controller.snapshot();if(after.revision===before.revision+1&&this.options.controller.state().error==='host_state_failed')pending.receipt=after;}}
   finally{this.busy=false;}
   if(!this.current()){this.dispose();return;}
   if(pending.receipt){this.reply({...pending.receipt,type:'host-reload-complete',token:pending.token});if(pending.timedOut||pending.failure)this.reply({type:'transport-error',id:null,reason:pending.failure?.message??'Reload completed after its deadline'});}
   else{this.reply({type:'host-reload-failed',protocol:1,resource:before.resource,session:before.session,token:pending.token,reason:(pending.failure?.message??'Reload refused').slice(0,256)});this.finishReload(pending,pending.failure??Error('Reload refused'));}
   return;
  }
  if(message.type==='draft-snapshot'||message.type==='draft-read-refused'){
   const pending=this.draftRead;if(!pending||message.protocol!==1||message.requestId!==pending.requestId||message.resource!==pending.resource||message.session!==pending.session)return;
   try{
    if(message.type==='draft-read-refused'){if(Object.keys(message).sort().join()!=='frameEpoch,protocol,reason,requestId,resource,session,type'||typeof message.reason!=='string'||message.reason.length>256)throw Error('Invalid draft refusal');this.finishDraftRead(pending,undefined,Error(message.reason));return;}
    if(Object.keys(message).sort().join()!=='acceptedRevision,frameEpoch,protocol,requestId,resource,session,source,type'||!Number.isSafeInteger(message.acceptedRevision)||(message.acceptedRevision as number)<0)throw Error('Invalid draft snapshot');
    sourceBytes(message.source as string);const sourceHash=await sha256Utf8(message.source as string);if(!this.current()){this.dispose();return;}
    this.finishDraftRead(pending,{resource:pending.resource,session:pending.session,acceptedRevision:message.acceptedRevision as number,source:message.source as string,sourceHash});
   }catch(error){this.finishDraftRead(pending,undefined,error instanceof Error?error:Error('Invalid draft snapshot'))}return;
  }
  if(message.type==='host-restore-refused'||message.type==='host-restore-applied'){
   const pending=this.hostRestore;if(!pending)return;const snapshot=this.options.controller.snapshot();
   if(message.protocol!==1||message.resource!==snapshot.resource||message.session!==snapshot.session||message.token!==pending.token)return;
   if(message.type==='host-restore-refused'&&Object.keys(message).sort().join()==='frameEpoch,protocol,reason,resource,session,token,type'&&typeof message.reason==='string'&&message.reason.length<=256)this.finishRestore(pending,Error(message.reason));
   if(message.type==='host-restore-applied'&&Object.keys(message).sort().join()==='frameEpoch,protocol,resource,revision,session,sourceHash,token,type'&&pending.receipt&&message.revision===pending.receipt.revision&&message.sourceHash===pending.receipt.sourceHash&&snapshot.revision===message.revision&&snapshot.sourceHash===message.sourceHash)this.finishRestore(pending);
   return;
  }
  if(message.type==='host-save-refused'){
   const pending=this.hostSave,before=this.options.controller.snapshot();
   if(pending&&Object.keys(message).sort().join()==='frameEpoch,generation,protocol,reason,resource,session,token,type'&&message.protocol===1&&message.resource===before.resource&&message.session===before.session&&message.token===pending.token&&message.generation===pending.generation&&typeof message.reason==='string'&&message.reason.length<=256){const error=Error(message.reason);if(pending.inFlight){pending.refused=error;pending.reject(error);}else this.finishHostSave(pending,undefined,error);}
   return;
  }
  const allowed=['type','frameEpoch','protocol','id','resource','session','revision','sourceHash','source','beforeHash','saveToken','saveGeneration','restoreToken'];const id=message.id;
  const restoring=message.type==='export'&&message.restoreToken===this.hostRestore?.token?this.hostRestore:null;
  if((message.restoreToken!==undefined||message.type==='export')&&!restoring){this.reply({type:'transport-error',id:Number.isSafeInteger(id)?id:null,reason:'Invalid recovery restoration token'});return;}
  const pending=message.type==='save'&&message.saveToken===this.hostSave?.token?this.hostSave:null;
  if((message.saveToken!==undefined||message.saveGeneration!==undefined)&&(!pending||message.type!=='save'||!Number.isSafeInteger(message.saveGeneration)||(message.saveGeneration as number)<1||(message.saveGeneration as number)>pending.generation)){this.reply({type:'transport-error',id:Number.isSafeInteger(id)?id:null,reason:'Invalid Save barrier token'});return;}
  if(Object.keys(message).some(key=>!allowed.includes(key))||message.protocol!==1||!Number.isSafeInteger(id)||(id as number)<=this.lastId||!['proposal','save','open','export'].includes(String(message.type))){this.reply({type:'transport-error',id:Number.isSafeInteger(id)?id:null,reason:'Invalid frame request'});return;}
  let before:Envelope;try{before=this.options.controller.snapshot();}catch{this.dispose();return;}
  if(message.resource!==before.resource||message.session!==before.session||message.revision!==before.revision||(message.type!=='proposal'&&message.sourceHash!==before.sourceHash)||this.busy){this.reply({...before,type:'reject',id,reason:'Stale or busy frame request'});return;}
  if(pending?.timedOut){this.reply({...before,type:'reject',id,reason:'Host Save deadline expired'});this.finishHostSave(pending,undefined,Error('Host Save deadline expired'));return;}
  if(restoring?.timedOut){this.reply({...before,type:'reject',id,reason:'Recovery restoration deadline expired'});this.finishRestore(restoring,Error('Recovery restoration deadline expired'));return;}
  if(this.hostRestore&&!restoring&&message.type!=='proposal'){this.reply({...before,type:'reject',id,reason:'Recovery restoration is in progress'});return;}
  this.lastId=id as number;this.busy=true;
  try{
   if(message.type==='proposal'){sourceBytes(message.source as string);const accepted=await this.options.controller.accept(message as unknown as Proposal);this.reply({...accepted,type:'ack',id});if(this.options.controller.state().error==='host_state_failed')this.reply({type:'transport-error',id,reason:'host_state_failed'});}
   else if(message.type==='save'){if(pending)pending.inFlight=true;const receipt=await this.options.controller.save();if(!this.current()){this.dispose();return;}this.reply({...this.options.controller.snapshot(),type:'command-complete',id,receipt});if(pending){
    pending.inFlight=false;
    if(pending.refused)this.finishHostSave(pending,undefined,pending.refused);
    else if(pending.timedOut||message.saveGeneration===pending.generation)this.finishHostSave(pending,receipt);
   }}
   else if(restoring){const receipt=await this.options.controller.restoreDraft(restoring.selection,before,{confirmed:true});if(!this.current()){this.dispose();return;}restoring.receipt=receipt;this.reply({...receipt,type:'command-complete',id,restoreToken:restoring.token});if(this.options.controller.state().error==='host_state_failed')this.reply({type:'transport-error',id,reason:'host_state_failed'});}
   else throw Error('Open is unsupported by the released host contract');
  }catch(error){if(this.current()){let snapshot:Envelope;try{snapshot=this.options.controller.snapshot();}catch{this.dispose();return;}this.reply({...snapshot,type:'reject',id,reason:error instanceof Error?error.message.slice(0,256):'Frame request refused'});}else this.dispose();if(pending)this.finishHostSave(pending,undefined,error instanceof Error?error:Error('Host Save refused'));if(restoring)this.finishRestore(restoring,error instanceof Error?error:Error('Recovery restoration refused'));}
  finally{this.busy=false;}
 }
 /** Explicit owner synchronization; blocking states never replace an unsaved frame draft. */
 synchronize():void {if(this.hostReload)return;if(!this.current()){this.dispose();throw Error('Frame disposed');}const state=this.options.controller.state();if(['conflict','uncertain','recovery_pending'].includes(state.mode)||state.error==='host_state_failed'){this.reply({type:'transport-error',reason:state.error==='host_state_failed'?state.error:state.mode,id:null});return;}this.reply({...this.options.controller.snapshot(),type:'sync'});}
 dispose():void {
  if(this.disposed)return;this.disposed=true;if(this.roleRequest)this.finishRole(this.roleRequest,undefined,Error('Frame disposed'));if(this.hostReload)this.finishReload(this.hostReload,Error('Frame disposed'));if(this.draftRead)this.finishDraftRead(this.draftRead,undefined,Error('Frame disposed'));if(this.hostRestore)this.finishRestore(this.hostRestore,Error('Frame disposed'));if(this.hostSave)this.finishHostSave(this.hostSave,undefined,Error('Frame disposed'));if(this.startupTimer)clearTimeout(this.startupTimer);this.startupTimer=null;if(this.ownerTimer)clearInterval(this.ownerTimer);this.ownerTimer=null;
  this.options.signal?.removeEventListener('abort',this.abortListener);if(this.readyListener)removeEventListener('message',this.readyListener);this.readyListener=null;
  try{this.port?.postMessage(serializeFrameControl({type:'dispose',frameEpoch:this.epoch}));}catch{}this.port?.close();this.port=null;this.element.remove();this.options.controller.dispose();this.rejectStart?.(Error('Frame disposed'));this.rejectStart=null;
 }
}
