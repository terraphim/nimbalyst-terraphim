// Newly reconstructed controller tests: real released WASM + upstream filesystem reads + real temp files.
import { type Page } from '@playwright/test';
import { mkdtemp,readFile,writeFile,rm,mkdir,chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const serviceModule=pathToFileURL(join(process.cwd(),'.cache/contracts/ProjectFileService.mjs')).href;
export async function controllerFixture(page:Page,source='Risk — café 🦀\r\n',timeoutMs=2000){
 const workspace=await mkdtemp(join(tmpdir(),'nimbalyst-controller-')),filePath=join(workspace,'brief.terraphim.md');await writeFile(filePath,source);
 const {ProjectFileService}=await import(serviceModule);const service=new ProjectFileService({createSnapshot(){throw Error('unused upstream write');}},()=>{throw Error('unused upstream write');});
 const writes:string[]=[];let writeGate:Promise<void>|null=null,release:()=>void=()=>{},externalAfterSave:string|null=null,deleteAfterSave=false,rawGate:Promise<void>|null=null,releaseRaw:()=>void=()=>{},rawCalls=0;
 await page.exposeBinding('fileOperation',async(_,{kind,value}:{kind:string;value?:string})=>{
  if(kind==='text')return service.read(workspace,[filePath]);
  if(kind==='raw'){rawCalls++;if(rawGate)await rawGate;return [...await readFile(filePath)];}
  if(kind==='save'){writes.push(value!);if(writeGate)await writeGate;await writeFile(filePath,value!);if(externalAfterSave!==null)await writeFile(filePath,externalAfterSave);if(deleteAfterSave)await rm(filePath);return;}
  throw Error('Unknown test bridge operation');
 });
 await page.goto('/tests/recovery/index.html');
 await page.evaluate(async({workspace,filePath,timeoutMs})=>{
  const controller='/src/controller.ts',recovery='/src/recovery.ts',sdk='/contracts/editorHostCapabilities.js',engine='/vendor/terraphim_editor.js';
  const [{ParentController},{DraftRecovery},{editorHostSupports},wasm]=await Promise.all([import(controller),import(recovery),import(sdk),import(engine)]);await wasm.default('/vendor/terraphim_editor_bg.wasm');
  const w=window as any;const changes=new Set<any>(),saves=new Set<any>();w.dirty=[];
  w.host={workspaceId:workspace,filePath,fs:{read:()=>w.fileOperation({kind:'text'})},loadBinaryContent:async()=>new Uint8Array(await w.fileOperation({kind:'raw'})).buffer,saveContent:(value:string)=>w.fileOperation({kind:'save',value}),onFileChanged:(fn:any)=>{changes.add(fn);return()=>changes.delete(fn)},onSaveRequested:(fn:any)=>{saves.add(fn);return()=>saves.delete(fn)},setDirty:(value:boolean)=>{w.dirty.push(value);w.reenter?.(value)},isDiffModeActive:()=>false};
  w.recovery=new DraftRecovery({indexedDB,databaseName:'controller:'+crypto.randomUUID()});
  w.active=true;w.ParentController=ParentController;w.controllerOptions={host:w.host,isCurrent:()=>w.active,supports:editorHostSupports,recovery:w.recovery,createSession:(...args:any[])=>new wasm.TerraphimHostSession(...args),timeoutMs};w.controller=await ParentController.admit(w.controllerOptions);
  w.wasm=wasm;w.events={changes,saves};
  w.propose=(source:string,id:number)=>{const snapshot=w.controller.snapshot(),frame=new wasm.TerraphimHostSession(snapshot.resource,snapshot.session,snapshot.revision,snapshot.source);try{return JSON.parse(frame.propose(JSON.stringify({protocol:1,resource:snapshot.resource,session:snapshot.session,revision:snapshot.revision,sourceHash:snapshot.sourceHash,id,command:'replace_source',args:{source}})))}finally{frame.free()}};
 },{workspace,filePath,timeoutMs});
 return{workspace,filePath,writes,read:()=>readFile(filePath,'utf8'),write:(text:string)=>writeFile(filePath,text),blockSave:()=>{writeGate=new Promise<void>(r=>release=r);},release:()=>{release();writeGate=null;},rawCalls:()=>rawCalls,blockRaw:()=>{rawGate=new Promise<void>(r=>releaseRaw=r);},releaseRaw:()=>{releaseRaw();rawGate=null;},externalAfterSave:(text:string)=>{externalAfterSave=text;},deleteAfterSave:()=>{deleteAfterSave=true;},cleanup:async()=>{release();releaseRaw();await page.evaluate(()=>{(window as any).controller?.dispose();(window as any).recovery?.close();}).catch(()=>{});await rm(workspace,{recursive:true,force:true});}};
}
