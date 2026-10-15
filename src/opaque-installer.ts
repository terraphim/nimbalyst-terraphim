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
  }catch(error){const reason=error instanceof Error?error.message:'Frame initialization failed';port.postMessage(JSON.stringify({type:'frame-error',frameEpoch:nonce,reason:reason.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,256)}));port.close();}
  finally{if(bootstrapUrl)URL.revokeObjectURL(bootstrapUrl);}
 };
 addEventListener('message',onInit);parent.postMessage({type:'terraphim-frame-ready',protocol:1,nonce},'*');
}

const installerScript=document.currentScript;
const installerNonce=installerScript instanceof HTMLScriptElement?installerScript.nonce:undefined;
if(typeof installerNonce!=='string'||!(/^[a-f0-9-]{36}$/).test(installerNonce))throw Error('Invalid installer nonce');
opaqueInstaller(installerNonce);
