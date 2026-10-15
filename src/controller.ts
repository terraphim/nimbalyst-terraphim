/** Newly reconstructed parent authority. Uses the released Rust host session, never a replacement parser/history. */
import type { EditorHost } from '@nimbalyst/extension-sdk/types/editor';
import { readSource, sourceBytes, sourceIdentity, type SourceHost, type SourceReadOptions, type SourceSnapshot } from './source.ts';
import { DraftRecovery, RecoveryError, type DraftRecord } from './recovery.ts';
export interface RustSession {
 snapshot():string; propose(message:string):string; acknowledge(id:number,revision:number,source:string):string;
 reject(id:number):void; synchronize(revision:number,source:string):string; free():void;
}
export interface Envelope {protocol:1;resource:string;session:string;revision:number;sourceHash:string;source:string;projection:unknown}
export interface Proposal extends Envelope {id:number;beforeHash:string}
export type ControllerMode='editing'|'saving'|'saved'|'recovery_pending'|'conflict'|'save_failed'|'uncertain'|'closed';
export type ControllerErrorCode='closed'|'stale'|'unsupported'|'busy'|'invalid_proposal'|'recovery_pending'|'conflict'|'save_failed'|'timeout'|'uncertain'|'revision_exhausted'|'host_state_failed';
export class ControllerError extends Error {constructor(readonly code:ControllerErrorCode){super(`Controller ${code}`);this.name='ControllerError';}}
export interface SaveReceipt {resource:string;session:string;revision:number;source:string;sourceHash:string;verification:'active-resource-raw-utf8'}
export type ControllerHost=SourceHost&Pick<EditorHost,'setDirty'|'onSaveRequested'>;
export interface ControllerOptions {
 host:ControllerHost;isCurrent:()=>boolean;supports:SourceReadOptions['supports'];recovery:DraftRecovery;
 createSession:(resource:string,session:string,revision:number,source:string)=>RustSession;
 /** Native host Save must flush the owned frame before calling this controller. */
 requestSave?:()=>Promise<SaveReceipt>;timeoutMs?:number;
}
/** Acknowledged edits are durable in parent IndexedDB; Saved requires exact host/raw-file readback. */
export class ParentController {
 private mode:ControllerMode='editing';private closed=false;private epoch=0;private error:ControllerErrorCode|null=null;
 private readonly host:ControllerHost;private readonly options:ControllerOptions;private readonly rust:RustSession;
 private readonly identity:SourceSnapshot['identity'];private accepted:Envelope;private persisted:SourceSnapshot;
 private pendingSource:string|null=null;private draft:DraftRecord|null=null;
 private accepting:Promise<Envelope>|null=null;private saving:Promise<void>|null=null;private publicSave:Promise<SaveReceipt>|null=null;
 private saveQueued=false;private timedOut=false;private capturedSave:Envelope|null=null;private observing:Promise<void>|null=null;private observationGeneration=0;private observeQueued=false;
 private unsubscribers:Array<()=>void>=[];
 private constructor(options:ControllerOptions,source:SourceSnapshot){
  this.options=options;this.host=options.host;this.identity=source.identity;this.persisted=source;
  this.rust=options.createSession(source.identity.resource,crypto.randomUUID(),0,source.source);this.accepted=JSON.parse(this.rust.snapshot());
  if(this.accepted.source!==source.source||this.accepted.sourceHash!==source.sha256){this.rust.free();throw new ControllerError('invalid_proposal');}
 }
 static async admit(options:ControllerOptions):Promise<ParentController>{
  if(typeof options.host.setDirty!=='function'||typeof options.host.onSaveRequested!=='function'||!Number.isFinite(options.timeoutMs??30000)||(options.timeoutMs??30000)<=0||(options.requestSave!==undefined&&typeof options.requestSave!=='function'))throw new ControllerError('unsupported');
  const initialIdentity=sourceIdentity(options.host,{supports:options.supports,isCurrent:options.isCurrent});
  const current=()=>options.isCurrent()&&options.host.filePath===initialIdentity.resource&&options.host.workspaceId===initialIdentity.workspace;
  const source=await readSource(options.host,{supports:options.supports,isCurrent:current});
  await options.recovery.probe({...source.identity,session:crypto.randomUUID()});
  const after=await readSource(options.host,{supports:options.supports,isCurrent:current});
  if(after.source!==source.source||after.sha256!==source.sha256)throw new ControllerError('stale');
  const controller=new ParentController(options,after);
  try{
   controller.unsubscribers.push(options.host.onFileChanged(()=>{void controller.observeDisk().catch(()=>{});}));
   controller.unsubscribers.push(options.host.onSaveRequested(()=>Promise.resolve().then(()=>options.requestSave?options.requestSave():controller.save()).then(()=>{},()=>{})));
   controller.notify();return controller;
  }catch(error){controller.dispose();throw error;}
 }
 private guard(epoch=this.epoch):void {
  if(this.closed)throw new ControllerError('closed');if(epoch!==this.epoch||!this.options.isCurrent())throw new ControllerError('stale');
  const id=sourceIdentity(this.host,{supports:this.options.supports,isCurrent:()=>!this.closed&&this.options.isCurrent()&&epoch===this.epoch});
  if(id.workspace!==this.identity.workspace||id.resource!==this.identity.resource)throw new ControllerError('stale');
 }
 private readable():SourceReadOptions {const epoch=this.epoch;return{supports:this.options.supports,isCurrent:()=>!this.closed&&this.options.isCurrent()&&epoch===this.epoch&&this.host.filePath===this.identity.resource&&this.host.workspaceId===this.identity.workspace};}
 private editable():void {this.guard();if(this.conflicted())throw new ControllerError('conflict');if(this.mode==='recovery_pending'||this.mode==='uncertain')throw new ControllerError(this.mode);if(this.error==='host_state_failed')throw new ControllerError(this.error);}
 private recoveryPending():boolean {return this.mode==='recovery_pending';}
 private conflicted():boolean {return this.mode==='conflict';}
 private nextRevision():number {if(this.accepted.revision>=0xffffffff)throw new ControllerError('revision_exhausted');return this.accepted.revision+1;}
 private dirty():boolean {return this.pendingSource!==null||this.accepted.source!==this.persisted.source||this.mode==='conflict'||this.mode==='uncertain';}
 private ownsHost():boolean {return !this.closed&&this.options.isCurrent()&&this.host.filePath===this.identity.resource&&this.host.workspaceId===this.identity.workspace;}
 private notify():void {if(!this.ownsHost())return;try{this.host.setDirty(this.dirty());}catch{this.error='host_state_failed';this.mode='save_failed';throw new ControllerError('host_state_failed');}}
 snapshot():Envelope {this.guard();return JSON.parse(this.rust.snapshot());}
 state(){return{mode:this.mode,error:this.error,dirty:this.dirty(),revision:this.accepted.revision,acceptedSource:this.accepted.source,persistedSource:this.persisted.source,pendingSource:this.pendingSource,saveInFlight:this.saving!==null};}
 /** Receives a complete proposal from the real frame session. One proposal at a time. */
 accept(input:Proposal):Promise<Envelope>{
  try{this.editable();if(this.accepting)throw new ControllerError('busy');}catch(error){return Promise.reject(error);}
  let proposal:Proposal;try{sourceBytes(input.source);proposal={protocol:input.protocol,resource:input.resource,session:input.session,revision:input.revision,sourceHash:input.sourceHash,source:input.source,id:input.id,beforeHash:input.beforeHash,projection:undefined};}catch{return Promise.reject(new ControllerError('invalid_proposal'));}
  const epoch=this.epoch;
  const task=Promise.resolve().then(()=>this.acceptOne(proposal,epoch));this.accepting=task;
  void task.finally(()=>{if(this.accepting===task)this.accepting=null;}).catch(()=>{});return task;
 }
 private async acceptOne(proposal:Proposal,epoch:number):Promise<Envelope>{
  this.editable();let proposed=false,stored=false;
  try{
   const before=this.accepted;
   if(!proposal||proposal.protocol!==1||proposal.resource!==before.resource||proposal.session!==before.session||proposal.revision!==before.revision||proposal.beforeHash!==before.sourceHash||!Number.isSafeInteger(proposal.id)||proposal.id<1)throw new ControllerError('invalid_proposal');
   sourceBytes(proposal.source);const revision=this.nextRevision();
   const canonical:Proposal=JSON.parse(this.rust.propose(JSON.stringify({protocol:1,resource:before.resource,session:before.session,revision:before.revision,sourceHash:before.sourceHash,id:proposal.id,command:'replace_source',args:{source:proposal.source}})));proposed=true;
   if(canonical.source!==proposal.source||canonical.sourceHash!==proposal.sourceHash||canonical.beforeHash!==proposal.beforeHash)throw new ControllerError('invalid_proposal');
   this.pendingSource=canonical.source;this.notify();this.guard(epoch);
   const draft=await this.options.recovery.put({identity:{...this.identity,session:before.session},revision,source:canonical.source,baselineHash:this.persisted.sha256});stored=true;this.guard(epoch);
   if(this.conflicted())throw new ControllerError('conflict');if(this.mode==='uncertain')throw new ControllerError('uncertain');
   this.accepted=JSON.parse(this.rust.acknowledge(canonical.id,revision,canonical.source));proposed=false;this.draft=draft;this.pendingSource=null;
   if(this.mode!=='saving')this.mode='editing';this.error=null;try{this.notify();}catch{/* Rust already committed: return its ACK; visible host-state error freezes further work. */}return structuredClone(this.accepted);
  }catch(error){
   if(proposed&&!this.closed)this.rust.reject(proposal.id);
   if(error instanceof RecoveryError){this.mode='recovery_pending';this.error='recovery_pending';}
   else if(!stored&&this.mode!=='recovery_pending')this.pendingSource=null;
   if(!this.closed)this.notify();throw error;
  }
 }
 /** Explicit save requests share one bounded queue. Timeout retains the actual in-flight operation. */
 save():Promise<SaveReceipt>{
  try{this.editable();}catch(error){return Promise.reject(error);}
  if(this.saving){this.saveQueued=true;return this.publicSave!;}
  let resolve!:(value:SaveReceipt)=>void,reject!:(reason:unknown)=>void;
  const publicSave=new Promise<SaveReceipt>((yes,no)=>{resolve=yes;reject=no;});this.publicSave=publicSave;
  this.timedOut=false;const epoch=this.epoch;
  const timer=setTimeout(()=>{if(this.saving&&!this.closed){this.timedOut=true;this.mode='uncertain';this.error='timeout';try{this.notify();}catch{/* Visible host-state failure also refuses further writes. */}reject(new ControllerError('timeout'));}},this.options.timeoutMs??30000);
  const task=Promise.resolve().then(async()=>{
   let receipt:SaveReceipt|undefined,failure:unknown;
   try{do{this.saveQueued=false;if(this.accepting)await this.accepting;this.guard(epoch);if(this.timedOut)throw new ControllerError('timeout');this.editable();receipt=await this.saveOne(epoch);}while(this.saveQueued&&!this.timedOut);}
   catch(error){failure=error;}
   finally{clearTimeout(timer);this.capturedSave=null;if(this.saving===task){this.saving=null;this.publicSave=null;}try{this.notify();}catch(error){failure??=error;}}
   if(failure!==undefined)reject(failure);else resolve(receipt!);
  });this.saving=task;return publicSave;
 }
 private saveStateCurrent(generation:number):void {
  if(this.conflicted())throw new ControllerError('conflict');
  if(this.error==='host_state_failed')throw new ControllerError('host_state_failed');
  if(this.mode==='recovery_pending')throw new ControllerError('recovery_pending');
  if(generation!==this.observationGeneration||(this.mode==='uncertain'&&this.error!=='timeout'))throw new ControllerError('uncertain');
 }
 private async saveOne(epoch:number):Promise<SaveReceipt>{
  const captured=structuredClone(this.accepted),draft=this.draft;this.capturedSave=captured;this.mode='saving';this.error=null;this.notify();
  let writeStarted=false;
  try{
   const before=await readSource(this.host,this.readable());this.guard(epoch);
   if(before.source!==this.persisted.source||before.sha256!==this.persisted.sha256)throw new ControllerError('conflict');
   if(this.timedOut)throw new ControllerError('timeout');
   if(this.conflicted())throw new ControllerError('conflict');
   writeStarted=true;await this.host.saveContent(captured.source);this.guard(epoch);
   const generation=this.observationGeneration;const actual=await readSource(this.host,this.readable());this.guard(epoch);if(this.observing)await this.observing;this.guard(epoch);this.saveStateCurrent(generation);
   if(actual.source!==captured.source||actual.sha256!==captured.sourceHash||this.conflicted())throw new ControllerError('conflict');
   this.persisted=actual;
   if(this.accepted.revision===captured.revision&&this.pendingSource===null&&draft){
    const removed=await this.options.recovery.removeIf(draft,()=>{try{this.saveStateCurrent(generation);}catch{return false;}return this.ownsHost()&&this.observing===null&&this.accepted.revision===captured.revision&&this.pendingSource===null;});this.guard(epoch);if(removed&&this.draft===draft)this.draft=null;
   }
   if(this.observing)await this.observing;this.guard(epoch);this.saveStateCurrent(generation);
   this.mode=this.accepted.source===actual.source&&this.pendingSource===null?'saved':'editing';this.error=null;this.notify();
   return{resource:captured.resource,session:captured.session,revision:captured.revision,source:actual.source,sourceHash:actual.sha256,verification:actual.verification};
  }catch(error){
   if(this.closed)throw error;
   const preserved=this.recoveryPending()?'recovery_pending':this.error==='host_state_failed'?'host_state_failed':this.error==='uncertain'?'uncertain':null;
   let actual:SourceSnapshot|null=null;
   // Rejection/timeout is not proof that a writer stopped. Re-read only after its promise settles.
   try{actual=await readSource(this.host,this.readable());this.guard(epoch);}catch{if(writeStarted){this.mode='uncertain';this.error='uncertain';}else{this.mode='save_failed';this.error='save_failed';}}
   if(actual){if(this.conflicted()||(actual.source!==this.persisted.source&&actual.source!==captured.source)){this.mode='conflict';this.error='conflict';}else{this.mode='save_failed';this.error='save_failed';}}
   if(error instanceof ControllerError&&error.code==='conflict'){this.mode='conflict';this.error='conflict';}
   if(error instanceof ControllerError&&error.code==='uncertain'){this.mode='uncertain';this.error='uncertain';}
   if(preserved){this.mode=preserved==='recovery_pending'?'recovery_pending':preserved==='uncertain'?'uncertain':'save_failed';this.error=preserved;}
   this.notify();throw error;
  }
 }
 /** File-event text is untrusted: always re-read the active resource before deciding. */
 observeDisk():Promise<void>{
  this.observeQueued=true;
  if(this.observing)return this.observing;
  const epoch=this.epoch,task=Promise.resolve().then(async()=>{
   do {
    this.observeQueued=false;this.guard(epoch);const actual=await readSource(this.host,this.readable());this.guard(epoch);
    if(this.observeQueued)continue; // An event arrived during this read; inspect the newest actual bytes.
    if(actual.source===this.persisted.source&&actual.sha256===this.persisted.sha256)return;
    if(this.saving&&this.capturedSave?.source===actual.source&&this.capturedSave.sourceHash===actual.sha256)return;
    this.observationGeneration++;
    if(this.accepting||this.pendingSource!==null||this.accepted.source!==this.persisted.source||this.saving){this.mode='conflict';this.error='conflict';this.notify();return;}
    this.accepted=JSON.parse(this.rust.synchronize(this.nextRevision(),actual.source));this.persisted=actual;this.mode='editing';this.error=null;this.notify();
   }while(this.observeQueued);
  }).catch(error=>{if(this.ownsHost()){this.observationGeneration++;this.mode='uncertain';this.error='uncertain';this.notify();}throw error;});this.observing=task;void task.finally(()=>{if(this.observing===task)this.observing=null;}).catch(()=>{});return task;
 }
 /** Explicit reload starts a new history boundary; an unsettled writer cannot be cancelled by reload. */
 async reload():Promise<Envelope>{
  this.guard();if(this.saving||this.accepting||this.observing)throw new ControllerError('busy');const epoch=this.epoch;
  const actual=await readSource(this.host,this.readable());this.guard(epoch);if(this.saving||this.accepting)throw new ControllerError('busy');
  this.accepted=JSON.parse(this.rust.synchronize(this.nextRevision(),actual.source));this.persisted=actual;this.pendingSource=null;this.mode='editing';this.error=null;this.notify();return structuredClone(this.accepted);
 }
 open():never {throw new ControllerError('unsupported');}
 dispose():void {if(this.closed)return;this.closed=true;this.epoch++;this.mode='closed';for(const unsubscribe of this.unsubscribers){try{unsubscribe();}catch{}}this.unsubscribers=[];this.rust.free();}
}
