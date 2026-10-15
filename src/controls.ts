/** Accessible parent controls. The sandbox never receives recovery or filesystem access. */
import type {ParentController} from './controller.ts';
import type {FrameTransport} from './frame.ts';
import {ExportError,type ExportCoordinator,type ExportKind} from './exports.ts';
import {DraftRecovery,type DraftSelection} from './recovery.ts';
export interface ParentControlsOptions {
 container:HTMLElement;isCurrent:()=>boolean;recovery:DraftRecovery;scope:{workspace:string;resource?:string};
 copyText:(text:string)=>Promise<void>;
 editing?:{controller:ParentController;frame:FrameTransport;exporter:ExportCoordinator};
}
const errorText=(error:unknown)=>error instanceof Error?error.message:'Operation failed';
const basename=(path:string)=>path.slice(Math.max(path.lastIndexOf('/'),path.lastIndexOf('\\'))+1);
/** Controls remain usable for inspecting/copying/discarding drafts when admission fails. */
export class ParentControls {
 readonly element:HTMLElement;
 private closed=false;private busy=false;private listing=0;private timer:ReturnType<typeof setInterval>;
 private status:HTMLElement;private recoveryPanel:HTMLElement;private draftRows:HTMLElement;
 private copyCurrent:HTMLButtonElement;private actions:HTMLButtonElement[]=[];private dialog:HTMLDialogElement|null=null;private lastState='';
 constructor(private readonly options:ParentControlsOptions){
  if(!(options.container instanceof HTMLElement)||!options.container.isConnected||typeof options.isCurrent!=='function'||typeof options.copyText!=='function')throw Error('Controls unavailable');
  this.element=document.createElement('section');this.element.setAttribute('aria-label','Terraphim document controls');
  const toolbar=document.createElement('div');toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','Document actions');
  const button=(label:string,action:()=>void)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',action);toolbar.append(b);return b;};
  this.actions.push(button('Save',()=>void this.save()),button('Export clean Markdown',()=>this.openExport('clean')),button('Export knowledge graph',()=>this.openExport('knowledgeGraph')));
  this.copyCurrent=button('Copy current draft',()=>void this.copyCurrentDraft());
  button('Recovery drafts',()=>{this.recoveryPanel.hidden=!this.recoveryPanel.hidden;if(!this.recoveryPanel.hidden)void this.refreshDrafts()});
  this.status=document.createElement('p');this.status.setAttribute('role','status');this.status.setAttribute('aria-live','polite');
  this.recoveryPanel=document.createElement('section');this.recoveryPanel.setAttribute('aria-label','Recovery drafts');this.recoveryPanel.hidden=true;
  const title=document.createElement('h2');title.textContent='Recovery drafts';const info=document.createElement('p');info.textContent='Drafts are separate from your saved file. Restore, copy or discard a selected draft; opening this list does not change your document. A restore creates an unsaved buffer and never writes the file automatically.';
  const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Refresh drafts';refresh.addEventListener('click',()=>void this.refreshDrafts());this.draftRows=document.createElement('div');
  this.recoveryPanel.append(title,info,refresh,this.draftRows);this.element.append(toolbar,this.status,this.recoveryPanel);options.container.append(this.element);
  this.timer=setInterval(()=>this.refreshState(),100);this.refreshState();
 }
 private current():boolean {try{return!this.closed&&this.options.isCurrent()&&this.element.isConnected}catch{return false}}
 private say(text:string):void {if(this.current())this.status.textContent=text;}
 private refreshState():void {
  if(!this.current()){this.dispose();return;}
  const state=this.options.editing?.controller.state(),key=JSON.stringify(state?{mode:state.mode,error:state.error,dirty:state.dirty}:null);
  const blocked=!state||['closed','conflict','uncertain','recovery_pending'].includes(state.mode)||state.error==='host_state_failed';
  for(const action of this.actions)action.disabled=this.busy||blocked;
  this.copyCurrent.disabled=this.busy||!this.options.editing||state?.mode==='closed';
  if(key!==this.lastState){this.lastState=key;if(!this.busy)this.say(!state?'Editing unavailable. Recovery drafts remain available.':state.error?`${state.mode.replaceAll('_',' ')}: ${state.error.replaceAll('_',' ')}`:state.mode==='saved'?'Saved':state.mode==='saving'?'Saving':state.dirty?'Editing — unsaved changes':'Editing');}
 }
 private async save():Promise<void> {
  if(!this.current()||this.busy||!this.options.editing)return;this.busy=true;this.refreshState();this.say('Saving');
  let message:string;try{await this.options.editing.frame.requestSave();message='Saved';}catch(error){message=`Save failed: ${errorText(error)}`}finally{this.busy=false;this.refreshState()}this.say(message);
 }
 private openExport(kind:ExportKind):void {
  if(!this.current()||this.busy||this.dialog||!this.options.editing)return;
  let resource:string;try{resource=this.options.editing.controller.snapshot().resource;}catch(error){this.say(`Export unavailable: ${errorText(error)}`);return;}
  const restore=document.activeElement instanceof HTMLElement?document.activeElement:null,dialog=document.createElement('dialog');this.dialog=dialog;
  const title=document.createElement('h2');title.id='export-title-'+crypto.randomUUID();title.textContent=kind==='clean'?'Export clean Markdown':'Export knowledge graph';dialog.setAttribute('aria-labelledby',title.id);
  const form=document.createElement('form'),label=document.createElement('label'),input=document.createElement('input');input.id='export-name-'+crypto.randomUUID();input.required=true;label.htmlFor=input.id;label.textContent='New filename';
  input.value=basename(resource).replace(/\.terraphim\.md$/i,'')+(kind==='clean'?'.clean.md':'.knowledge-graph.json');
  const note=document.createElement('p');note.textContent='Creates a new file beside this document. Existing files are never replaced.';
  const submit=document.createElement('button');submit.type='submit';submit.textContent='Create export';const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';
  const close=()=>{if(this.dialog===dialog)this.dialog=null;dialog.close();dialog.remove();if(this.current()&&restore?.isConnected)restore.focus()};
  cancel.addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close()});
  form.addEventListener('submit',event=>{event.preventDefault();const filename=input.value;close();void this.export(kind,filename)});
  form.append(label,input,note,submit,cancel);dialog.append(title,form);this.element.append(dialog);dialog.showModal();input.focus();input.select();
 }
 private async export(kind:ExportKind,filename:string):Promise<void> {
  if(!this.current()||this.busy||!this.options.editing)return;this.busy=true;this.refreshState();this.say('Saving and creating export');
  let message:string;try{const receipt=await this.options.editing.exporter.export(kind,filename);message=`Created ${basename(receipt.destination)}`}
  catch(error){const inspect=error instanceof ExportError&&error.mayExist&&error.destination?` Inspect ${basename(error.destination)}; a file may have been created.`:'';message=`Export failed: ${errorText(error)}${inspect}`}
  finally{this.busy=false;this.refreshState()}this.say(message);
 }
 private async copyCurrentDraft():Promise<void>{
  if(!this.current()||this.busy||!this.options.editing)return;this.busy=true;this.refreshState();this.say('Reading current draft');
  let message:string;try{const snapshot=await this.options.editing.frame.readDraft();if(!this.current())return;await this.options.copyText(snapshot.source);message='Copied current draft; source file unchanged'}catch(error){message=`Copy failed: ${errorText(error)}`}finally{this.busy=false;this.refreshState()}this.say(message);
 }
 private async restoreDraft(selection:DraftSelection):Promise<void>{
  if(!this.current()||this.busy||!this.options.editing)return;this.busy=true;this.refreshState();this.say('Restoring selected draft');
  let message:string;try{await this.options.editing.frame.restoreDraft(selection,{confirmed:true});message='Restored draft — unsaved changes'}catch(error){message=`Restore failed: ${errorText(error)}. The saved file and previous draft are preserved.`}finally{this.busy=false;this.refreshState()}this.say(message);
 }
 private async refreshDrafts():Promise<void> {
  const generation=++this.listing;if(!this.current())return;this.draftRows.textContent='Loading drafts';
  try{const selections=await this.options.recovery.list(this.options.scope);if(!this.current()||generation!==this.listing)return;this.draftRows.replaceChildren();if(!selections.length){this.draftRows.textContent='No recovery drafts';return;}for(const selection of selections)this.addDraft(selection)}
  catch(error){if(this.current()&&generation===this.listing)this.draftRows.textContent=`Recovery unavailable: ${errorText(error)}`}
 }
 private addDraft(selection:DraftSelection):void {
  const row=document.createElement('article'),title=document.createElement('h3');title.textContent=selection.record?`${basename(selection.record.identity.resource)} — ${selection.record.updatedAt}`:'Corrupt recovery record';
  const notice=document.createElement('p');notice.textContent=selection.status==='candidate'?'Full annotated draft; copying does not save it.':'This record cannot be restored. You can copy its inspection summary or discard this exact record.';
  const copy=document.createElement('button');copy.type='button';copy.textContent=selection.status==='candidate'?'Copy draft':'Copy inspection summary';
  copy.addEventListener('click',()=>{if(!this.current())return;void(async()=>{copy.disabled=true;try{const text=selection.record?(await this.options.recovery.recover(selection,selection.record.baselineHash)).source:selection.raw;if(!this.current())return;await this.options.copyText(text);this.say('Copied recovery draft')}catch(error){this.say(`Copy failed: ${errorText(error)}`)}finally{if(this.current())copy.disabled=false}})()});
  const discard=document.createElement('button');discard.type='button';discard.textContent='Discard draft';discard.addEventListener('click',()=>{if(!this.current())return;discard.disabled=true;const confirm=document.createElement('button');confirm.type='button';confirm.textContent='Confirm discard';const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Keep draft';const remove=()=>{confirm.remove();cancel.remove();discard.disabled=false;discard.focus()};cancel.addEventListener('click',remove);confirm.addEventListener('click',()=>{if(!this.current())return;void(async()=>{confirm.disabled=true;try{const removed=await this.options.recovery.discard(selection);if(!this.current())return;if(removed){row.remove();this.say('Draft discarded')}else{this.say('Draft changed; refresh before discarding');remove()}}catch(error){this.say(`Discard failed: ${errorText(error)}`);remove()}})()});row.append(confirm,cancel);cancel.focus()});
  if(selection.status==='candidate'&&this.options.editing){
   const restore=document.createElement('button');restore.type='button';restore.textContent='Restore draft';
   restore.addEventListener('click',()=>{if(!this.current()||this.busy)return;restore.disabled=true;const note=document.createElement('p');note.textContent='Restore this selected draft as an unsaved buffer? Save or copy any current edits first. The file changes only when you Save.';const confirm=document.createElement('button');confirm.type='button';confirm.textContent='Confirm restore';const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Keep current buffer';const close=()=>{note.remove();confirm.remove();cancel.remove();restore.disabled=false;if(this.current())restore.focus()};cancel.addEventListener('click',close);confirm.addEventListener('click',()=>{if(!this.current()||this.busy)return;close();void this.restoreDraft(selection)});row.append(note,confirm,cancel);cancel.focus()});row.append(restore);
  }
  row.append(title,notice,copy,discard);this.draftRows.append(row);
 }
 dispose():void {if(this.closed)return;this.closed=true;this.listing++;clearInterval(this.timer);if(this.dialog){this.dialog.close();this.dialog.remove();this.dialog=null;}this.element.remove()}
}
