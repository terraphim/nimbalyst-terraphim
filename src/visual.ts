/** Local visual runtime for one opaque frame. Rust/editor code stays unchanged. */
export const VISUAL_ASSET_NAMES = ['runtime','components','styles','wrapper','graphWorker','graphGlue','graphWasm','defaultRole'] as const;
export type VisualAssetName = typeof VISUAL_ASSET_NAMES[number];
export type VisualAssets = Record<VisualAssetName,Uint8Array<ArrayBuffer>>;
export type VisualManifest = Record<VisualAssetName,{sha256:string;bytes:number}>;
const LIMIT=16*1024*1024;
const digest=async(bytes:Uint8Array<ArrayBuffer>)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
export async function verifyVisualAssets(assets:VisualAssets,manifest:VisualManifest,isCurrent=()=>true):Promise<{assets:VisualAssets;manifest:VisualManifest}>{
 const names=[...VISUAL_ASSET_NAMES].sort().join();
 if(!assets||!manifest||Object.keys(assets).sort().join()!==names||Object.keys(manifest).sort().join()!==names)throw Error('Invalid visual asset names');
 const copy={} as VisualAssets,expected={} as VisualManifest;let total=0;
 for(const name of VISUAL_ASSET_NAMES){
  const value=assets[name],item=manifest[name];
  if(!(value instanceof Uint8Array)||!item||Object.keys(item).sort().join()!=='bytes,sha256'||!Number.isSafeInteger(item.bytes)||item.bytes<=0||value.byteLength!==item.bytes||!(/^[a-f0-9]{64}$/).test(item.sha256)||(total+=item.bytes)>LIMIT)throw Error('Invalid visual asset size');
  copy[name]=new Uint8Array(value);expected[name]={sha256:item.sha256,bytes:item.bytes};
 }
 for(const name of VISUAL_ASSET_NAMES){if(!isCurrent())throw Error('Visual owner changed');const hash=await digest(copy[name]);if(!isCurrent())throw Error('Visual owner changed');if(hash!==expected[name].sha256)throw Error('Visual asset hash mismatch');}
 return{assets:copy,manifest:expected};
}
interface Surface {historyOwner:unknown;history:unknown[];historyIndex:number;onChange(callback:()=>void):()=>void;getText():string;undo():boolean;redo():boolean}
interface Editor {
 markdownEditor:{surface:Surface;graphRoleSync:Promise<unknown>;loadThesaurus(text:string):unknown;alignDocumentModel(bindings:Bindings):void;documentKey:string;persistence?:unknown};
 rolegraph:{ready:Promise<unknown>;exportSnapshot():Promise<string>};
 openDocument(source:string,name?:string):unknown;destroy():unknown;
}
interface Bindings {save_document():string;host_presentation_source(source:string):string}
interface VisualOptions {source:string;resource:string;isCurrent:()=>boolean;onChange:(source:string)=>void;onCommand:(command:'save'|'open')=>void}
export interface VisualRuntime {
 source():string;adopt(source:string,options:{canonical?:boolean;external?:boolean;recovery?:boolean}):void;
 setBlocked(blocked:boolean,reason?:string):void;graphSnapshot():Promise<string>;
 state():{historyOwner:unknown;historyEntries:number;historyIndex:number;blocked:boolean;workers:number;urls:number};dispose():void;
}
/** Called only after installer integrity verification, inside the isolated frame. */
export async function createVisualRuntime(assets:VisualAssets,bindings:Bindings,options:VisualOptions):Promise<VisualRuntime>{
 let disposed=false,blocked=false,suppress=false,editor:Editor|null=null,unsubscribe:(()=>void)|null=null;
 const urls:string[]=[],workers:Worker[]=[],abort=new AbortController();
 const root=document.createElement('main');root.className='terraphim-native-editor';
 const notice=document.createElement('div');notice.setAttribute('role','status');notice.className='terraphim-native-status';notice.hidden=true;
 const styles=document.createElement('style');styles.textContent=new TextDecoder('utf-8',{fatal:true}).decode(assets.styles)+'\nhtml,body{margin:0;min-height:100%;} .terraphim-native-status{padding:8px;font:14px system-ui;background:#fff3bf;color:#222;}';
 const guard=()=>{if(disposed||!options.isCurrent())throw Error('Visual owner unavailable');};
 const url=(bytes:Uint8Array<ArrayBuffer>,type='text/javascript')=>{guard();const value=URL.createObjectURL(new Blob([bytes],{type}));urls.push(value);return value;};
 const cleanup=()=>{
  if(disposed)return;disposed=true;abort.abort();unsubscribe?.();unsubscribe=null;
  try{editor?.destroy();}finally{for(const worker of workers)worker.terminate();workers.length=0;for(const value of urls)URL.revokeObjectURL(value);urls.length=0;root.remove();notice.remove();styles.remove();}
 };
 const source=()=>{guard();if(!editor)throw Error('Visual editor unavailable');editor.markdownEditor.alignDocumentModel(bindings);return bindings.save_document();};
 const setBlocked=(value:boolean,reason='Editing paused until the host state is recovered.')=>{blocked=value;root.inert=value;notice.hidden=!value;notice.textContent=value?reason:'';};
 try{
  guard();document.head.append(styles);document.body.append(notice,root);
  await import(url(assets.components));guard();
  await new Promise<void>((resolve,reject)=>{
   const script=document.createElement('script');script.src=url(assets.wrapper);
   const cleanupScript=()=>{script.onload=null;script.onerror=null;script.remove();abort.signal.removeEventListener('abort',cancel);};
   const cancel=()=>{cleanupScript();reject(Error('Visual owner unavailable'));};
   script.onload=()=>{cleanupScript();resolve();};script.onerror=()=>{cleanupScript();reject(Error('Released editor wrapper refused'));};
   abort.signal.addEventListener('abort',cancel,{once:true});document.head.append(script);
  });guard();
  const factory=(globalThis as unknown as {TeraphimEditor:{create(target:HTMLElement,options:unknown):Promise<Editor>}}).TeraphimEditor;
  if(!factory)throw Error('Released editor factory unavailable');
  editor=await factory.create(root,{bindings,loadShoelace:false,value:options.source,standalone:false,dirtyTitle:false,
   rolegraphAssetBase:'about:srcdoc',rolegraph:{workerUrl:url(assets.graphWorker),glueUrl:url(assets.graphGlue),wasmUrl:url(assets.graphWasm,'application/wasm'),
    workerFactory:(workerUrl:string,settings:WorkerOptions)=>{guard();const worker=new Worker(workerUrl,{...settings,type:'classic'});workers.push(worker);return worker;}},
   config:{hostManaged:true,historyOwner:null}});guard();
  editor.markdownEditor.documentKey=options.resource;
  // The mount value is plain surface text; the existing Open API restores
  // annotated source into the Rust model and displays only its active body.
  editor.openDocument(options.source,options.resource);
  editor.markdownEditor.loadThesaurus(new TextDecoder('utf-8',{fatal:true}).decode(assets.defaultRole));
  await editor.rolegraph.ready;guard();await editor.markdownEditor.graphRoleSync;guard();
  unsubscribe=editor.markdownEditor.surface.onChange(()=>{
   if(suppress||blocked||disposed)return;
   try{options.onChange(source());}catch(error){setBlocked(true,error instanceof Error?error.message:'The host refused this edit.');}
  });
  document.addEventListener('keydown',event=>{
   if(blocked||disposed||!(event.metaKey||event.ctrlKey)||event.altKey||event.shiftKey)return;
   const key=event.key.toLowerCase();if(key!=='s'&&key!=='o')return;
   event.preventDefault();event.stopPropagation();
   try{options.onChange(source());options.onCommand(key==='s'?'save':'open');}
   catch(error){notice.hidden=false;notice.textContent=error instanceof Error?error.message:'The host refused the command.';}
  },{capture:true,signal:abort.signal});
  return{
   source,
   adopt(value,meta){guard();if(!meta.recovery&&bindings.host_presentation_source(value)===source())return;
    if(!meta.external&&!meta.recovery)throw Error('Canonical host output differs; retain the current editor draft.');
    suppress=true;try{editor!.openDocument(value,options.resource);}finally{suppress=false;}
   },
   setBlocked,
   async graphSnapshot(){guard();const value=await editor!.rolegraph.exportSnapshot();guard();return value;},
   state(){return{historyOwner:editor?.markdownEditor.surface.historyOwner,historyEntries:editor?.markdownEditor.surface.history.length??0,historyIndex:editor?.markdownEditor.surface.historyIndex??-1,blocked,workers:workers.length,urls:urls.length};},
   dispose:cleanup,
  };
 }catch(error){cleanup();throw error;}
}
