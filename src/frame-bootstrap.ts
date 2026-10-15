/** Frame-local bridge and optional released visual runtime. No filesystem API. */
import type {VisualAssets,VisualRuntime} from './visual.ts';
interface Init {assets:Record<string,Uint8Array<ArrayBuffer>>;snapshot:{protocol:number;resource:string;session:string;revision:number;sourceHash:string;source:string};requestTimeoutMs:number;visual?:{assets:VisualAssets}}
/** Verified bytes arrive from the constant opaque installer. */
export async function activate(init:Init,port:MessagePort,epoch:string){
 const LIMIT=16*1024*1024;const urls:string[]=[];let disposed=false;let deadline:ReturnType<typeof setTimeout>|null=null;let activeId:number|null=null;let activeRequest:any=null;let commandQueued=false;
 let aiAcceptance:{requestId:string;source:string}|null=null;
 let restoreToken:string|null=null,reloadToken:string|null=null,roleRequestId:string|null=null;
 let visual:VisualRuntime|null=null;let hostSaveToken:string|null=null,hostSaveGeneration=0;const saveTokens:Array<{token:string;generation:number}|null>=[];
 const visualStatus=()=>visual?.setBlocked(aiAcceptance!==null||restoreToken!==null||reloadToken!==null||roleRequestId!==null||['uncertain','conflict','closed'].includes(status),reason??undefined);
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
   if(message.type==='host-alternatives'){
    const expected=message.operation==='capture'?'frameEpoch,operation,protocol,requestId,resource,revision,session,sourceHash,type':message.operation==='check'?'frameEpoch,operation,protocol,requestId,resource,revision,session,sourceHash,token,type':'candidates,frameEpoch,model,operation,protocol,provider,requestId,resource,revision,session,sourceHash,token,type';
    if(Object.keys(message).sort().join()!==expected||!['capture','check','accept'].includes(message.operation)||message.protocol!==1||message.resource!==s.resource||message.session!==s.session||typeof message.requestId!=='string'||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(message.requestId))return;
    const refuse=(reason:string)=>send({type:'alternatives-refused',frameEpoch:epoch,protocol:1,requestId:message.requestId,operation:message.operation,resource:s.resource,session:s.session,reason:reason.slice(0,256)});
    try{
     const before=JSON.parse(engine.snapshot());if(!visual||aiAcceptance||roleRequestId||reloadToken||restoreToken||activeId!==null||commandQueued||['uncertain','conflict','closed'].includes(status)||message.revision!==before.revision||message.sourceHash!==before.sourceHash)throw Error('Alternatives need the current settled frame');
     if(message.operation==='capture'){const selection=visual.captureAlternativeSelection();send({type:'alternatives-result',frameEpoch:epoch,protocol:1,requestId:message.requestId,operation:'capture',resource:s.resource,session:s.session,revision:before.revision,sourceHash:before.sourceHash,selection})}
     else if(message.operation==='check'){visual.checkAlternativePreview(message.token);send({type:'alternatives-result',frameEpoch:epoch,protocol:1,requestId:message.requestId,operation:'check',resource:s.resource,session:s.session,revision:before.revision,sourceHash:before.sourceHash})}
     else{const text=visual.acceptAlternativePreview(message.token,message.candidates,message.provider,message.model);aiAcceptance={requestId:message.requestId,source:text};visualStatus();if(activeId===null){const after=JSON.parse(engine.snapshot());if(after.source!==text)throw Error('Alternative proposal was not accepted');send({type:'alternatives-result',frameEpoch:epoch,protocol:1,requestId:message.requestId,operation:'accept',resource:s.resource,session:s.session,revision:after.revision,sourceHash:after.sourceHash});aiAcceptance=null;visualStatus()}}
    }catch(error){aiAcceptance=null;visualStatus();refuse(error instanceof Error?error.message:'Alternatives refused')}return;
   }
   if(message.type==='host-role'){
    const expected=message.operation==='import'?'frameEpoch,operation,protocol,requestId,resource,revision,session,snapshot,sourceHash,type':'frameEpoch,operation,protocol,requestId,resource,revision,session,sourceHash,type';
    if(Object.keys(message).sort().join()!==expected||!['import','export'].includes(message.operation)||message.protocol!==1||message.resource!==s.resource||message.session!==s.session||typeof message.requestId!=='string'||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(message.requestId))return;
    const refuse=(reason:string)=>send({type:'role-refused',frameEpoch:epoch,protocol:1,requestId:message.requestId,operation:message.operation,resource:s.resource,session:s.session,reason:reason.slice(0,256)});
    const before=JSON.parse(engine.snapshot());
    if(!visual||aiAcceptance||roleRequestId||reloadToken||restoreToken||activeId!==null||commandQueued||status==='closed'||(message.operation==='import'&&['uncertain','conflict'].includes(status))||message.revision!==before.revision||message.sourceHash!==before.sourceHash){refuse('Role operation needs the current settled frame');return;}
    const bounded=(value:any)=>{if(typeof value!=='string'||new TextEncoder().encode(value).byteLength>4*1024*1024||new TextDecoder().decode(new TextEncoder().encode(value))!==value)throw Error('Invalid role snapshot size or encoding')};
    const visualBefore=visual.source();roleRequestId=message.requestId;visualStatus();void(async()=>{
     try{if(message.operation==='import')bounded(message.snapshot);const snapshot=message.operation==='import'?await visual!.importGraphSnapshot(message.snapshot):await visual!.graphSnapshot();if(disposed||roleRequestId!==message.requestId)return;bounded(snapshot);const after=JSON.parse(engine.snapshot());if(after.revision!==before.revision||after.sourceHash!==before.sourceHash||visual!.source()!==visualBefore)throw Error('Role operation changed the document');send({type:'role-result',frameEpoch:epoch,protocol:1,requestId:message.requestId,operation:message.operation,resource:s.resource,session:s.session,revision:after.revision,sourceHash:after.sourceHash,snapshot})}
     catch(error){if(!disposed&&roleRequestId===message.requestId)refuse(error instanceof Error?error.message:'Role operation refused')}
     finally{if(!disposed&&roleRequestId===message.requestId){roleRequestId=null;visualStatus()}}
    })();return;
   }
   if(['host-reload','host-reload-failed','host-reload-complete'].includes(message.type)){
    if(message.protocol!==1||message.resource!==s.resource||message.session!==s.session||typeof message.token!=='string'||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(message.token))return;
    if(message.type==='host-reload'){
     if(Object.keys(message).sort().join()!=='frameEpoch,protocol,resource,session,token,type')return;
     if(aiAcceptance||roleRequestId||reloadToken||restoreToken||activeId!==null||commandQueued||status==='closed'){send({type:'host-reload-refused',frameEpoch:epoch,protocol:1,resource:s.resource,session:s.session,token:message.token,reason:'Frame operation is still unsettled'});return;}
     reloadToken=message.token;visualStatus();const current=JSON.parse(engine.snapshot());send({type:'host-reload-ready',frameEpoch:epoch,protocol:1,resource:s.resource,session:s.session,token:reloadToken,revision:current.revision,sourceHash:current.sourceHash});return;
    }
    if(message.token!==reloadToken)return;
    if(message.type==='host-reload-failed'){
     if(Object.keys(message).sort().join()!=='frameEpoch,protocol,reason,resource,session,token,type'||typeof message.reason!=='string'||message.reason.length>256)return;
     reloadToken=null;status='uncertain';reason=message.reason;visualStatus();return;
    }
    try{
     if(Object.keys(message).sort().join()!=='frameEpoch,projection,protocol,resource,revision,session,source,sourceHash,token,type')throw Error('Invalid reload completion');
     source.sourceBytes(message.source);const before=JSON.parse(engine.snapshot());if(message.revision!==before.revision+1)throw Error('Stale reload completion');
     bridge.receive({...message,type:'sync'});const current=JSON.parse(engine.snapshot());if(current.source!==message.source||current.sourceHash!==message.sourceHash)throw Error('Reload adoption mismatch');
     bridge.resume();conflictDraft=null;reloadToken=null;status='ready';reason=null;visualStatus();send({type:'host-reload-applied',frameEpoch:epoch,protocol:1,resource:s.resource,session:s.session,token:message.token,revision:current.revision,sourceHash:current.sourceHash});
    }catch{status='uncertain';reason='Invalid reload completion';visualStatus();}
    return;
   }
   if(message.type==='host-read-draft'){
    if(Object.keys(message).sort().join()!=='frameEpoch,protocol,requestId,resource,session,type'||message.protocol!==1||message.resource!==s.resource||message.session!==s.session||typeof message.requestId!=='string'||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(message.requestId))return;
    try{const text=conflictDraft??visual?.source()??bridge.latest;source.sourceBytes(text);send({type:'draft-snapshot',frameEpoch:epoch,protocol:1,requestId:message.requestId,resource:s.resource,session:s.session,acceptedRevision:JSON.parse(engine.snapshot()).revision,source:text})}
    catch(error){send({type:'draft-read-refused',frameEpoch:epoch,protocol:1,requestId:message.requestId,resource:s.resource,session:s.session,reason:(error instanceof Error?error.message:'Current draft unavailable').slice(0,256)})}return;
   }
   if(message.type==='host-restore'){
    if(Object.keys(message).sort().join()!=='frameEpoch,protocol,resource,session,token,type'||message.protocol!==1||message.resource!==s.resource||message.session!==s.session||typeof message.token!=='string'||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(message.token))return;
    const refuse=(reason:string)=>send({type:'host-restore-refused',frameEpoch:epoch,protocol:1,resource:s.resource,session:s.session,token:message.token,reason:reason.slice(0,256)});
    if(aiAcceptance||roleRequestId||reloadToken||restoreToken||commandQueued||['uncertain','conflict','closed'].includes(status)){refuse('Frame is not ready for recovery restoration');return;}
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
    if(aiAcceptance&&completing){const pending=aiAcceptance,current=JSON.parse(engine.snapshot());aiAcceptance=null;if(message.type==='ack'&&current.source===pending.source)send({type:'alternatives-result',frameEpoch:epoch,protocol:1,requestId:pending.requestId,operation:'accept',resource:s.resource,session:s.session,revision:current.revision,sourceHash:current.sourceHash});else send({type:'alternatives-refused',frameEpoch:epoch,protocol:1,requestId:pending.requestId,operation:'accept',resource:s.resource,session:s.session,reason:'The host refused the accepted alternatives'})}
   }catch{status='uncertain';reason='Invalid authoritative response';}finally{visualStatus();}
  };port.start();addEventListener('pagehide',()=>cleanup(),{once:true});
  const client={
   submit(text:string){if(aiAcceptance)throw Error('Alternative acceptance is in progress');if(roleRequestId)throw Error('Role operation is in progress');if(reloadToken)throw Error('Explicit reload is in progress');if(restoreToken)throw Error('Recovery restoration is in progress');if(disposed||status==='uncertain'||status==='conflict')throw Error('Frame is not editable');source.sourceBytes(text);bridge.submit(text);},
   save(){if(aiAcceptance)throw Error('Alternative acceptance is in progress');if(roleRequestId)throw Error('Role operation is in progress');if(reloadToken)throw Error('Explicit reload is in progress');if(restoreToken)throw Error('Recovery restoration is in progress');if(disposed||status==='uncertain'||status==='conflict')throw Error('Frame is not writable');if(commandQueued)return;commandQueued=true;saveTokens.push(null);try{bridge.command('save');}catch(error){saveTokens.pop();commandQueued=false;throw error;}},
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
