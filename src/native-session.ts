/** Native host assembly using only the released SDK and verified local Rust/editor assets. */
import type {EditorHost} from '@nimbalyst/extension-sdk/types/editor';
import type {editorHostSupports} from '@nimbalyst/extension-sdk';
import {ParentController,type RustSession} from './controller.ts';
import {FrameTransport,verifyFrameAssets,type FrameAssets,type FrameManifest} from './frame.ts';
import type {VisualAssets,VisualManifest} from './visual.ts';
import {DraftRecovery} from './recovery.ts';
import {ExportCoordinator,RustExportDeriver} from './exports.ts';
import {ParentControls} from './controls.ts';
interface Engine {initSync(input:{module:Uint8Array<ArrayBuffer>}):unknown;TerraphimHostSession:new(resource:string,session:string,revision:number,source:string)=>RustSession;open_document(source:string):unknown;export_document():string;export_knowledge_graph():string}
import {RoleCheckpoints} from './role-storage.ts';
import {RoleControls} from './role-controls.ts';
import {loadRoleStorage} from './role-runtime.ts';
export interface NativeSessionOptions {
 container:HTMLElement;host:EditorHost;isCurrent:()=>boolean;supports:typeof editorHostSupports;
 copyText:(text:string)=>Promise<void>;indexedDB:IDBFactory;databaseName?:string;
 frame:{assets:FrameAssets;manifest:FrameManifest};visual:{assets:VisualAssets;manifest:VisualManifest};
}
/** One host tab owns its controller, private frame, export engine and recovery view. */
export class NativeSession {
 readonly element:HTMLElement;
 private disposed=false;private initializing=false;private generation=0;private controller:ParentController|null=null;
 private roleStore:RoleCheckpoints|null=null;private roleControls:RoleControls|null=null;
 private frame:FrameTransport|null=null;private exporter:ExportCoordinator|null=null;private controls:ParentControls|null=null;
 private readonly recovery:DraftRecovery;private readonly frameContainer:HTMLElement;private readonly controlsContainer:HTMLElement;private readonly notice:HTMLElement;
 private unsubscribers:Array<()=>void>=[];private readonly ownerTimer:ReturnType<typeof setInterval>;private readonly identity:{workspace:string|undefined;resource:string};
 private constructor(private readonly options:NativeSessionOptions){
  this.identity={workspace:options.host.workspaceId,resource:options.host.filePath};
  this.recovery=new DraftRecovery({indexedDB:options.indexedDB,databaseName:options.databaseName});
  this.element=document.createElement('section');this.element.className='terraphim-nimbalyst';
  this.notice=document.createElement('p');this.notice.setAttribute('role','alert');this.notice.textContent='Loading Terraphim editor';
  this.controlsContainer=document.createElement('div');this.frameContainer=document.createElement('div');this.frameContainer.style.cssText='min-height:400px;height:calc(100% - 96px)';this.element.append(this.notice,this.controlsContainer,this.frameContainer);options.container.append(this.element);this.ownerTimer=setInterval(()=>{if(!this.current())this.dispose()},50);
 }
 static async start(options:NativeSessionOptions):Promise<NativeSession>{
  if(!(options.container instanceof HTMLElement)||!options.container.isConnected||!options.isCurrent())throw Error('Native editor owner unavailable');
  const session=new NativeSession(options);await session.admit();return session;
 }
 private current():boolean {try{return!this.disposed&&this.options.isCurrent()&&this.element.isConnected&&this.options.host.workspaceId===this.identity.workspace&&this.options.host.filePath===this.identity.resource}catch{return false}}
 private guard(generation:number):void {if(!this.current()||generation!==this.generation)throw Error('Native editor owner changed');}
 private showRecovery():void {
  const{workspace,resource}=this.identity;
  if(typeof workspace!=='string'||!workspace)return;
  this.controls=new ParentControls({container:this.controlsContainer,isCurrent:()=>this.current(),recovery:this.recovery,scope:{workspace,...(typeof resource==='string'&&resource?{resource}:{})},copyText:this.options.copyText});
 }
 private stopEditing():void {
  this.generation++;for(const unsubscribe of this.unsubscribers){try{unsubscribe()}catch{}}this.unsubscribers=[];
  this.roleControls?.dispose();this.roleControls=null;this.roleStore?.close();this.roleStore=null;
  this.controls?.dispose();this.controls=null;this.exporter?.dispose();this.exporter=null;this.frame?.dispose();this.frame=null;this.controller?.dispose();this.controller=null;
 }
 private async engine(assets:FrameAssets,generation:number):Promise<Engine>{
  this.guard(generation);const url=URL.createObjectURL(new Blob([assets.engineGlue],{type:'text/javascript'}));
  try{const engine=await import(/* @vite-ignore */url)as Engine;this.guard(generation);if(typeof engine.initSync!=='function'||typeof engine.TerraphimHostSession!=='function'||typeof engine.export_document!=='function'||typeof engine.export_knowledge_graph!=='function')throw Error('Released editor exports unavailable');engine.initSync({module:assets.engineWasm});return engine}finally{URL.revokeObjectURL(url)}
 }
 private async admit():Promise<void>{
  if(this.initializing||!this.current())return;this.initializing=true;const generation=this.generation;
  this.showRecovery();
  try{
   const assets=await verifyFrameAssets(this.options.frame.assets,this.options.frame.manifest,()=>this.current()&&generation===this.generation);this.guard(generation);
   const parentEngine=await this.engine(assets,generation),exportEngine=await this.engine(assets,generation);this.guard(generation);
   const controller=await ParentController.admit({host:this.options.host,isCurrent:()=>this.current()&&generation===this.generation,supports:this.options.supports,recovery:this.recovery,createSession:(...args)=>new parentEngine.TerraphimHostSession(...args),requestSave:()=>this.frame?this.frame.requestSave():Promise.reject(Error('Editor has not started'))});try{this.guard(generation)}catch(error){controller.dispose();throw error}this.controller=controller;
   const frame=await FrameTransport.start({container:this.frameContainer,controller:this.controller,isCurrent:()=>this.current()&&generation===this.generation,assets,manifest:this.options.frame.manifest,visual:this.options.visual});try{this.guard(generation)}catch(error){frame.dispose();throw error}this.frame=frame;this.frame.element.style.cssText='width:100%;height:100%;min-height:400px;border:0';
   const deriver=new RustExportDeriver(exportEngine);this.exporter=new ExportCoordinator({controller:this.controller,host:this.options.host,supports:this.options.supports,isCurrent:()=>this.current()&&generation===this.generation,derive:source=>deriver.derive(source),saveBarrier:()=>this.frame?this.frame.requestSave():Promise.reject(Error('Editor unavailable'))});
   this.controls?.dispose();this.controls=new ParentControls({container:this.controlsContainer,isCurrent:()=>this.current()&&generation===this.generation,recovery:this.recovery,scope:{workspace:this.options.host.workspaceId!,resource:this.options.host.filePath},copyText:this.options.copyText,editing:{controller:this.controller,frame:this.frame,exporter:this.exporter}});
   this.unsubscribers.push(this.options.host.onFileChanged(()=>{void(async()=>{try{await this.controller?.observeDisk();if(this.current()&&generation===this.generation)this.frame?.synchronize()}catch{if(this.current()&&generation===this.generation){this.notice.textContent='The file changed or became unavailable. Your recovery drafts are preserved.';try{this.frame?.synchronize()}catch{this.stopEditing();this.showRecovery()}}}})()}));
   if(this.options.host.onReadOnlyChanged)this.unsubscribers.push(this.options.host.onReadOnlyChanged(()=>{if(!this.current())return;this.stopEditing();this.showRecovery();this.notice.textContent='File access changed. Reopen this editor to check access again; recovery drafts are preserved.'}));
   let roleNotice='';
   try{const Storage=await loadRoleStorage(this.options.visual,()=>this.current()&&generation===this.generation);this.guard(generation);this.roleStore=new RoleCheckpoints({Storage,indexedDB:this.options.indexedDB,databaseName:(this.options.databaseName??'terraphim-editor')+':role-checkpoints'});this.roleControls=new RoleControls({container:this.controlsContainer,workspace:this.options.host.workspaceId!,isCurrent:()=>this.current()&&generation===this.generation,store:this.roleStore,client:{exportSnapshot:()=>frame.exportRoleSnapshot(),importSnapshot:snapshot=>frame.importRoleSnapshot(snapshot)}})}
   catch(error){this.guard(generation);this.roleControls?.dispose();this.roleControls=null;this.roleStore?.close();this.roleStore=null;roleNotice=`Local role checkpoints unavailable: ${error instanceof Error?error.message:'Storage unavailable'}`}
   this.notice.textContent=roleNotice;
  }catch(error){
   if(this.current()&&generation===this.generation){this.stopEditing();this.showRecovery();this.notice.textContent=`Editing unavailable: ${error instanceof Error?error.message:'Host admission failed'}. Use the ordinary Markdown editor, or inspect recovery drafts.`;}
  }finally{this.initializing=false;}
 }
 dispose():void {if(this.disposed)return;this.disposed=true;clearInterval(this.ownerTimer);this.stopEditing();this.recovery.close();this.element.remove();}
}
