/** Reconstructed opaque transport. Visual editor shell and native CSP remain separate gates. */
import {sourceBytes} from './source.ts';
import type {ParentController,Envelope,Proposal} from './controller.ts';
export const FRAME_ASSET_NAMES=['bootstrap','source','engineGlue','engineWasm','hostBridge'] as const;
export type FrameAssetName=typeof FRAME_ASSET_NAMES[number];
export type FrameAssets=Record<FrameAssetName,Uint8Array<ArrayBuffer>>;
export type FrameManifest=Record<FrameAssetName,{sha256:string;bytes:number}>;
export interface FrameOptions {container:HTMLElement;controller:ParentController;isCurrent:()=>boolean;signal?:AbortSignal;assets:FrameAssets;manifest:FrameManifest;startupTimeoutMs?:number;requestTimeoutMs?:number}
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
   bootstrapUrl=URL.createObjectURL(new Blob([init.assets.bootstrap],{type:'text/javascript'}));
   const module=await import(bootstrapUrl);const client=await module.activate(init,port,nonce);
   Object.defineProperty(globalThis,'TerraphimFrameClient',{value:client,configurable:true});
  }catch{port.postMessage(JSON.stringify({type:'frame-error',frameEpoch:nonce,reason:'Frame initialization failed'}));port.close();}
  finally{if(bootstrapUrl)URL.revokeObjectURL(bootstrapUrl);}
 };
 addEventListener('message',onInit);parent.postMessage({type:'terraphim-frame-ready',protocol:1,nonce},'*');
}
/** One owned sandbox, private port, bounded latest proposal and one explicit Save barrier. */
export class FrameTransport {
 readonly element:HTMLIFrameElement;readonly epoch=crypto.randomUUID();
 private port:MessagePort|null=null;private disposed=false;private initialized=false;private started=false;private busy=false;private lastId=0;
 private options:FrameOptions;private readyListener:((event:MessageEvent)=>void)|null=null;private startupTimer:ReturnType<typeof setTimeout>|null=null;private ownerTimer:ReturnType<typeof setInterval>|null=null;
 private rejectStart:((error:Error)=>void)|null=null;private abortListener:()=>void;
 private constructor(options:FrameOptions){this.options=options;this.element=document.createElement('iframe');this.element.title='Terraphim editor';this.element.setAttribute('sandbox','allow-scripts');this.abortListener=()=>this.dispose();}
 static async start(options:FrameOptions):Promise<FrameTransport>{
  const current=()=>!options.signal?.aborted&&options.isCurrent()&&options.container.isConnected;
  if(!(options.container instanceof HTMLElement)||typeof options.isCurrent!=='function'||!current())throw Error('Frame owner unavailable');
  for(const ms of [options.startupTimeoutMs??10000,options.requestTimeoutMs??30000])if(!Number.isSafeInteger(ms)||ms<50||ms>60000)throw Error('Invalid frame deadline');
  const manifest=manifestCopy(options.manifest);const assets=await verifyFrameAssets(options.assets,manifest,current);if(!current())throw Error('Frame owner changed');const snapshot=options.controller.snapshot();sourceBytes(snapshot.source);serializeFrameControl(snapshot);
  const transport=new FrameTransport({...options,manifest});await transport.mount(assets,snapshot);return transport;
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
    this.port.start();this.element.contentWindow!.postMessage({type:'terraphim-init',nonce:this.epoch,assets,manifest:this.options.manifest,snapshot,requestTimeoutMs:this.options.requestTimeoutMs??30000},'*',[channel.port2]);
   };
   addEventListener('message',this.readyListener);const nonce=this.epoch;const script=`(${opaqueInstaller.toString()})(${JSON.stringify(nonce)});`;
   this.element.srcdoc=`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' blob: 'wasm-unsafe-eval'; style-src 'none'; connect-src 'none'; worker-src 'none'; img-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><script nonce="${nonce}">${script}</script>`;
   this.options.container.append(this.element);
  });
 }
 private reply(message:Record<string,unknown>):void {if(!this.current()){this.dispose();return;}try{this.port?.postMessage(serializeFrameControl({...message,frameEpoch:this.epoch}));}catch{this.port?.postMessage(serializeFrameControl({type:'transport-error',frameEpoch:this.epoch,id:null,reason:'Authoritative reply exceeds transport limit'}));}}
 private async receive(message:Record<string,unknown>):Promise<void>{
  if(!this.current()){this.dispose();return;}
  const allowed=['type','frameEpoch','protocol','id','resource','session','revision','sourceHash','source','beforeHash'];const id=message.id;
  if(Object.keys(message).some(key=>!allowed.includes(key))||message.protocol!==1||!Number.isSafeInteger(id)||(id as number)<=this.lastId||!['proposal','save','open'].includes(String(message.type))){this.reply({type:'transport-error',id:Number.isSafeInteger(id)?id:null,reason:'Invalid frame request'});return;}
  let before:Envelope;try{before=this.options.controller.snapshot();}catch{this.dispose();return;}
  if(message.resource!==before.resource||message.session!==before.session||message.revision!==before.revision||(message.type!=='proposal'&&message.sourceHash!==before.sourceHash)||this.busy){this.reply({...before,type:'reject',id,reason:'Stale or busy frame request'});return;}
  this.lastId=id as number;this.busy=true;
  try{
   if(message.type==='proposal'){sourceBytes(message.source as string);const accepted=await this.options.controller.accept(message as unknown as Proposal);this.reply({...accepted,type:'ack',id});if(this.options.controller.state().error==='host_state_failed')this.reply({type:'transport-error',id,reason:'host_state_failed'});}
   else if(message.type==='save'){const receipt=await this.options.controller.save();if(!this.current()){this.dispose();return;}this.reply({...this.options.controller.snapshot(),type:'command-complete',id,receipt});}
   else throw Error('Open is unsupported by the released host contract');
  }catch(error){if(this.current()){let snapshot:Envelope;try{snapshot=this.options.controller.snapshot();}catch{this.dispose();return;}this.reply({...snapshot,type:'reject',id,reason:error instanceof Error?error.message.slice(0,256):'Frame request refused'});}else this.dispose();}
  finally{this.busy=false;}
 }
 /** Explicit owner synchronization; blocking states never replace an unsaved frame draft. */
 synchronize():void {if(!this.current()){this.dispose();throw Error('Frame disposed');}const state=this.options.controller.state();if(['conflict','uncertain','recovery_pending'].includes(state.mode)||state.error==='host_state_failed'){this.reply({type:'transport-error',reason:state.error==='host_state_failed'?state.error:state.mode,id:null});return;}this.reply({...this.options.controller.snapshot(),type:'sync'});}
 dispose():void {
  if(this.disposed)return;this.disposed=true;if(this.startupTimer)clearTimeout(this.startupTimer);this.startupTimer=null;if(this.ownerTimer)clearInterval(this.ownerTimer);this.ownerTimer=null;
  this.options.signal?.removeEventListener('abort',this.abortListener);if(this.readyListener)removeEventListener('message',this.readyListener);this.readyListener=null;
  try{this.port?.postMessage(serializeFrameControl({type:'dispose',frameEpoch:this.epoch}));}catch{}this.port?.close();this.port=null;this.element.remove();this.options.controller.dispose();this.rejectStart?.(Error('Frame disposed'));this.rejectStart=null;
 }
}
