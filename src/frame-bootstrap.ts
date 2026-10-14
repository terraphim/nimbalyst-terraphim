/** Reconstructed frame-local bootstrap. No filesystem API or visual editor implementation. */
interface Init {assets:Record<string,Uint8Array<ArrayBuffer>>;snapshot:{protocol:number;resource:string;session:string;revision:number;sourceHash:string;source:string};requestTimeoutMs:number}
/** Verified bytes arrive from the constant opaque installer. */
export async function activate(init:Init,port:MessagePort,epoch:string){
 const LIMIT=16*1024*1024;const urls:string[]=[];let disposed=false;let deadline:ReturnType<typeof setTimeout>|null=null;let activeId:number|null=null;let activeRequest:any=null;let commandQueued=false;
 let status='starting',reason:string|null=null,conflictDraft:string|null=null;let bridge:any=null;let engine:any=null;
 const send=(value:unknown)=>{const text=JSON.stringify(value);if(text.length>LIMIT||new TextEncoder().encode(text).length>LIMIT)throw Error('Frame request too large');port.postMessage(text);};
 const parse=(value:unknown)=>{if(typeof value!=='string'||value.length>LIMIT||new TextEncoder().encode(value).length>LIMIT)throw Error('Invalid authoritative message size');const data=JSON.parse(value);if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid authoritative message');return data;};
 const url=(bytes:Uint8Array<ArrayBuffer>)=>{const value=URL.createObjectURL(new Blob([bytes],{type:'text/javascript'}));urls.push(value);return value;};
 const cleanup=(closePort=true)=>{if(disposed)return;disposed=true;if(deadline)clearTimeout(deadline);deadline=null;if(bridge)bridge.dispose();else engine?.free();if(closePort)port.close();for(const value of urls)URL.revokeObjectURL(value);urls.length=0;status='closed';};
 try{
  const source=await import(url(init.assets.source));const wasm=await import(url(init.assets.engineGlue));wasm.initSync({module:init.assets.engineWasm});
  const bridgeUrl=url(init.assets.hostBridge);await new Promise<void>((resolve,reject)=>{const script=document.createElement('script');script.src=bridgeUrl;script.onload=()=>{script.remove();resolve();};script.onerror=()=>{script.remove();reject(Error('Host bridge refused'));};document.head.append(script);});
  const s=init.snapshot;source.sourceBytes(s.source);engine=new wasm.TerraphimHostSession(s.resource,s.session,s.revision,s.source);
  const snapshot=JSON.parse(engine.snapshot());if(snapshot.source!==s.source||snapshot.sourceHash!==s.sourceHash)throw Error('Initial Rust session mismatch');
  const Bridge=(globalThis as any).TerraphimHostBridge;
  bridge=new Bridge({engine,send:(message:any)=>{
   if(disposed||activeId!==null)throw Error('Frame request already active');activeId=message.id;activeRequest={type:message.type,id:message.id,revision:message.revision,sourceHash:message.sourceHash,source:message.source};status='pending';reason=null;
   deadline=setTimeout(()=>{if(!disposed&&activeId===message.id){status='uncertain';reason='Request timed out; its outcome is not cancellation';}},init.requestTimeoutMs);
   const {projection,...request}=message;send({...request,frameEpoch:epoch});
  },adopt:()=>{},conflict:(failure:any)=>{source.sourceBytes(failure.draft);conflictDraft=failure.draft;status='conflict';reason=String(failure.reason??'Source conflict').slice(0,256);}});
  port.onmessage=(event:MessageEvent)=>{
   if(disposed)return;let message:any;try{message=parse(event.data);}catch{status='uncertain';reason='Invalid authoritative message';return;}
   if(message.frameEpoch!==epoch)return;if(message.type==='dispose'){cleanup();return;}
   if(message.type==='transport-error'){status='uncertain';reason=String(message.reason??'Request refused').slice(0,256);return;}
   if(!['ack','reject','sync','command-complete'].includes(message.type)||message.protocol!==1||message.resource!==s.resource||message.session!==s.session)return;
   const completing=message.id===activeId&&['ack','reject','command-complete'].includes(message.type);
   try{
    source.sourceBytes(message.source);
    if(message.type==='ack'&&(!completing||activeRequest?.type!=='proposal'||message.revision!==activeRequest.revision+1||message.sourceHash!==activeRequest.sourceHash||message.source!==activeRequest.source))throw Error('Stale proposal acknowledgement');
    if(message.type==='command-complete'){
     const current=JSON.parse(engine.snapshot());
     if(!completing||message.revision!==current.revision||message.sourceHash!==current.sourceHash||message.source!==current.source)throw Error('Stale command completion');
    }
    if(completing){if(deadline)clearTimeout(deadline);deadline=null;activeId=null;activeRequest=null;if(message.type==='command-complete'||message.type==='reject')commandQueued=false;status=message.type==='reject'?'refused':'ready';reason=message.type==='reject'?String(message.reason??'Refused').slice(0,256):null;}
    bridge.receive(message);
   }catch{status='uncertain';reason='Invalid authoritative response';}
  };port.start();addEventListener('pagehide',()=>cleanup(),{once:true});status='ready';send({type:'frame-started',frameEpoch:epoch,protocol:1,resource:s.resource,session:s.session,revision:s.revision,sourceHash:s.sourceHash});
  return Object.freeze({
   submit(text:string){if(disposed||status==='uncertain'||status==='conflict')throw Error('Frame is not editable');source.sourceBytes(text);bridge.submit(text);},
   save(){if(disposed||status==='uncertain'||status==='conflict')throw Error('Frame is not writable');if(commandQueued)return;commandQueued=true;try{bridge.command('save');}catch(error){commandQueued=false;throw error;}},
   open(){throw Error('Open is unsupported by the released host contract');},
   snapshot(){if(disposed)throw Error('Frame disposed');return JSON.parse(engine.snapshot());},
   state(){return{status,reason,pending:activeId!==null,commandQueued,latest:conflictDraft??bridge?.latest,conflictDraft,assetUrls:urls.length};},
   dispose:()=>cleanup(),
  });
 }catch(error){cleanup(false);throw error;}
}
