/** Frame-local bridge and optional released visual runtime. No filesystem API. */
import type {VisualAssets,VisualRuntime} from './visual.ts';
interface Init {assets:Record<string,Uint8Array<ArrayBuffer>>;snapshot:{protocol:number;resource:string;session:string;revision:number;sourceHash:string;source:string};requestTimeoutMs:number;visual?:{assets:VisualAssets}}
/** Verified bytes arrive from the constant opaque installer. */
export async function activate(init:Init,port:MessagePort,epoch:string){
 const LIMIT=16*1024*1024;const urls:string[]=[];let disposed=false;let deadline:ReturnType<typeof setTimeout>|null=null;let activeId:number|null=null;let activeRequest:any=null;let commandQueued=false;
 let restoreToken:string|null=null;
 let visual:VisualRuntime|null=null;let hostSaveToken:string|null=null,hostSaveGeneration=0;const saveTokens:Array<{token:string;generation:number}|null>=[];
 const visualStatus=()=>visual?.setBlocked(restoreToken!==null||['uncertain','conflict','closed'].includes(status),reason??undefined);
 let status='starting',reason:string|null=null,conflictDraft:string|null=null;let bridge:any=null;let engine:any=null;
 const send=(value:unknown)=>{const text=JSON.stringify(value);if(text.length>LIMIT||new TextEncoder().encode(text).length>LIMIT)throw Error('Frame request too large');port.postMessage(text);};
 const parse=(value:unknown)=>{if(typeof value!=='string'||value.length>LIMIT||new TextEncoder().encode(value).length>LIMIT)throw Error('Invalid authoritative message size');const data=JSON.parse(value);if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid authoritative message');return data;};
 const url=(bytes:Uint8Array<ArrayBuffer>)=>{const value=URL.createObjectURL(new Blob([bytes],{type:'text/javascript'}));urls.push(value);return value;};
 const cleanup=(closePort=true)=>{if(disposed)return;disposed=true;if(deadline)clearTimeout(deadline);deadline=null;try{visual?.dispose();}catch{}visual=null;if(bridge)bridge.dispose();else engine?.free();if(closePort)port.close();for(const value of urls)URL.revokeObjectURL(value);urls.length=0;status='closed';};
 try{
  const source=await import(url(init.assets.source));const wasm=await import(url(init.assets.engineGlue));wasm.initSync({module:init.assets.engineWasm});
  const bridgeUrl=url(init.assets.hostBridge);await new Promise<void>((resolve,reject)=>{const script=document.createElement('script');script.src=bridgeUrl;script.onload=()=>{script.remove();resolve();};script.onerror=()=>{script.remove();reject(Error('Host bridge refused'));};document.head.append(script);});
  const s=init.snapshot;source.sourceBytes(s.source);engine=new wasm.TerraphimHostSession(s.resource,s.session,s.revision,s.source);
  const snapshot=JSON.parse(engine.snapshot());if(snapshot.source!==s.source||snapshot.sourceHash!==s.sourceHash)throw Error('Initial Rust session mismatch');
  const refuseHostSave=(message:string)=>{if(!hostSaveToken)return;send({type:'host-save-refused',frameEpoch:epoch,protocol:1,resource:s.resource,session:s.session,token:hostSaveToken,generation:hostSaveGeneration,reason:message.slice(0,256)});hostSaveToken=null;};
  const Bridge=(globalThis as any).TerraphimHostBridge;
  bridge=new Bridge({engine,send:(message:any)=>{
   if(disposed||activeId!==null)throw Error('Frame request already active');activeId=message.id;activeRequest={type:message.type,id:message.id,revision:message.revision,sourceHash:message.sourceHash,source:message.source,saveBarrier:message.type==='save'?saveTokens.shift():undefined,restoreToken:message.type==='export'?restoreToken:undefined};status='pending';reason=null;
   deadline=setTimeout(()=>{if(!disposed&&activeId===message.id){status='uncertain';reason='Request timed out; its outcome is not cancellation';visualStatus();}},init.requestTimeoutMs);
   const {projection,...request}=message;send({...request,...(activeRequest.saveBarrier?{saveToken:activeRequest.saveBarrier.token,saveGeneration:activeRequest.saveBarrier.generation}:{}),...(activeRequest.restoreToken?{restoreToken:activeRequest.restoreToken}:{}),frameEpoch:epoch});
  },adopt:(value:string,meta:any)=>visual?.adopt(value,meta),conflict:(failure:any)=>{source.sourceBytes(failure.draft);conflictDraft=failure.draft;status='conflict';reason=String(failure.reason??'Source conflict').slice(0,256);saveTokens.length=0;commandQueued=false;refuseHostSave(reason);visualStatus();}});
  port.onmessage=(event:MessageEvent)=>{
   if(disposed)return;let message:any;try{message=parse(event.data);}catch{status='uncertain';reason='Invalid authoritative message';visualStatus();return;}
   if(message.frameEpoch!==epoch)return;if(message.type==='dispose'){cleanup();return;}
   if(message.type==='host-restore'){
    if(Object.keys(message).sort().join()!=='frameEpoch,protocol,resource,session,token,type'||message.protocol!==1||message.resource!==s.resource||message.session!==s.session||typeof message.token!=='string'||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(message.token))return;
    const refuse=(reason:string)=>send({type:'host-restore-refused',frameEpoch:epoch,protocol:1,resource:s.resource,session:s.session,token:message.token,reason:reason.slice(0,256)});
    if(restoreToken||commandQueued||['uncertain','conflict','closed'].includes(status)){refuse('Frame is not ready for recovery restoration');return;}
    try{client.submit(visual?.source()??bridge.latest);restoreToken=message.token;visualStatus();bridge.command('export')}catch(error){restoreToken=null;visualStatus();refuse(error instanceof Error?error.message:'Recovery restoration refused')}
    return;
   }
   if(message.type==='host-save'){
    if(Object.keys(message).sort().join()!=='frameEpoch,generation,protocol,resource,session,token,type'||message.protocol!==1||message.resource!==s.resource||message.session!==s.session||!Number.isSafeInteger(message.generation)||message.generation<1||typeof message.token!=='string'||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(message.token))return;
    if(hostSaveToken!==null&&(message.token!==hostSaveToken||message.generation<=hostSaveGeneration))return;
    hostSaveToken=message.token;hostSaveGeneration=message.generation;
    try{
     client.submit(visual?.source()??bridge.latest);
     const queued=saveTokens.find(value=>value?.token===hostSaveToken);
     if(queued)queued.generation=hostSaveGeneration;
     else {saveTokens.push({token:hostSaveToken!,generation:hostSaveGeneration});commandQueued=true;bridge.command('save');}
    }
    catch(error){refuseHostSave(error instanceof Error?error.message:'Frame Save refused');}
    return;
   }
   if(message.type==='transport-error'){status='uncertain';reason=String(message.reason??'Request refused').slice(0,256);visualStatus();return;}
   if(!['ack','reject','sync','command-complete'].includes(message.type)||message.protocol!==1||message.resource!==s.resource||message.session!==s.session)return;
   const completing=message.id===activeId&&['ack','reject','command-complete'].includes(message.type);
   const completedRestore=completing?activeRequest?.restoreToken:null;
   try{
    source.sourceBytes(message.source);
    if(message.type==='ack'&&(!completing||activeRequest?.type!=='proposal'||message.revision!==activeRequest.revision+1||message.sourceHash!==activeRequest.sourceHash||message.source!==activeRequest.source))throw Error('Stale proposal acknowledgement');
    if(message.type==='command-complete'){
     const current=JSON.parse(engine.snapshot());
     if(completedRestore){if(message.restoreToken!==completedRestore||message.revision!==current.revision+1)throw Error('Stale recovery completion')}
     else if(!completing||message.revision!==current.revision||message.sourceHash!==current.sourceHash||message.source!==current.source)throw Error('Stale command completion');
    }
    if(completing){const completedBarrier=activeRequest?.saveBarrier;if(deadline)clearTimeout(deadline);deadline=null;activeId=null;activeRequest=null;if(message.type==='command-complete'){if(completedBarrier?.token===hostSaveToken&&completedBarrier?.generation===hostSaveGeneration)hostSaveToken=null;commandQueued=saveTokens.length>0;}if(message.type==='reject'){saveTokens.length=0;commandQueued=false;refuseHostSave(String(message.reason??'Frame Save refused'));}status=message.type==='reject'?'refused':'ready';reason=message.type==='reject'?String(message.reason??'Refused').slice(0,256):null;}
    bridge.receive(message);
    if(completedRestore){
     if(message.type==='command-complete'){const current=JSON.parse(engine.snapshot());if(current.sourceHash!==message.sourceHash||current.source!==message.source)throw Error('Recovery adoption mismatch');send({type:'host-restore-applied',frameEpoch:epoch,protocol:1,resource:s.resource,session:s.session,token:completedRestore,revision:current.revision,sourceHash:current.sourceHash})}
     restoreToken=null;
    }
   }catch{status='uncertain';reason='Invalid authoritative response';}finally{visualStatus();}
  };port.start();addEventListener('pagehide',()=>cleanup(),{once:true});
  const client={
   submit(text:string){if(restoreToken)throw Error('Recovery restoration is in progress');if(disposed||status==='uncertain'||status==='conflict')throw Error('Frame is not editable');source.sourceBytes(text);bridge.submit(text);},
   save(){if(restoreToken)throw Error('Recovery restoration is in progress');if(disposed||status==='uncertain'||status==='conflict')throw Error('Frame is not writable');if(commandQueued)return;commandQueued=true;saveTokens.push(null);try{bridge.command('save');}catch(error){saveTokens.pop();commandQueued=false;throw error;}},
   open(){throw Error('Open is unsupported by the released host contract');},
  };
  if(init.visual){const module=await import(url(init.visual.assets.runtime));if(disposed)throw Error('Frame disposed');visual=await module.createVisualRuntime(init.visual.assets,wasm,{source:s.source,resource:s.resource,isCurrent:()=>!disposed,onChange:(text:string)=>client.submit(text),onCommand:(command:'save'|'open')=>client[command]()});if(disposed){visual?.dispose();throw Error('Frame disposed')}}
  status='ready';send({type:'frame-started',frameEpoch:epoch,protocol:1,resource:s.resource,session:s.session,revision:s.revision,sourceHash:s.sourceHash});
  return Object.freeze({
   ...client,
   visualState(){return visual?.state()??null},
   graphSnapshot(){if(!visual)throw Error('Visual editor unavailable');return visual.graphSnapshot()},
   snapshot(){if(disposed)throw Error('Frame disposed');return JSON.parse(engine.snapshot());},
   state(){return{status,reason,pending:activeId!==null,commandQueued,latest:conflictDraft??bridge?.latest,conflictDraft,assetUrls:urls.length};},
   dispose:()=>cleanup(),
  });
 }catch(error){cleanup(false);throw error;}
}
