/** Parent-only opt-in role checkpoints. The existing client/Rust path owns graph validation. */
import {assertSnapshotRole,RoleCheckpoints,type RoleCandidate} from './role-storage.ts';
export interface RoleControlsOptions {
 container:HTMLElement;workspace:string;isCurrent:()=>boolean;store:RoleCheckpoints;
 client:{exportSnapshot():Promise<string>;importSnapshot(snapshot:string):Promise<unknown>};
}
const message=(error:unknown)=>error instanceof Error?error.message:'Role operation failed';
/** Listing never activates a role; restore always uses a fresh writer namespace. */
export class RoleControls {
 readonly element:HTMLElement;
 private closed=false;private enabled=false;private busy=false;private generation=0;private writer=crypto.randomUUID();
 private toggle:HTMLInputElement;private saveButton:HTMLButtonElement;private refreshButton:HTMLButtonElement;private status:HTMLElement;private rows:HTMLElement;
 constructor(private readonly options:RoleControlsOptions){
  if(!(options.container instanceof HTMLElement)||!options.container.isConnected||!options.workspace||typeof options.isCurrent!=='function')throw Error('Role controls unavailable');
  options.store.setEnabled(false);this.element=document.createElement('section');this.element.setAttribute('aria-label','Local role checkpoints');
  const label=document.createElement('label');this.toggle=document.createElement('input');this.toggle.type='checkbox';label.append(this.toggle,document.createTextNode('Keep local role checkpoints'));
  const info=document.createElement('p');info.textContent='Opt in to keep this role locally for this workspace. Document alternatives remain separate. Choose a stored checkpoint explicitly to restore it.';
  this.saveButton=document.createElement('button');this.saveButton.type='button';this.saveButton.textContent='Save role checkpoint';this.saveButton.addEventListener('click',()=>void this.save());
  this.refreshButton=document.createElement('button');this.refreshButton.type='button';this.refreshButton.textContent='Refresh role checkpoints';this.refreshButton.addEventListener('click',()=>void this.refresh());
  this.status=document.createElement('p');this.status.setAttribute('role','status');this.status.setAttribute('aria-live','polite');this.rows=document.createElement('div');
  this.toggle.addEventListener('change',()=>{if(!this.current())return;this.enabled=this.toggle.checked;this.generation++;options.store.setEnabled(this.enabled);this.rows.replaceChildren();this.update();this.say(this.enabled?'Role persistence enabled for this session':'Role persistence disabled; existing checkpoints retained');if(this.enabled)void this.refresh()});
  const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Roles and local checkpoints';details.append(summary,label,info,this.saveButton,this.refreshButton,this.status,this.rows);this.element.append(details);options.container.append(this.element);this.update();
 }
 private current():boolean{try{return!this.closed&&this.options.isCurrent()&&this.element.isConnected}catch{return false}}
 private guard(generation:number):void{if(!this.current()||!this.enabled||generation!==this.generation)throw Error('Role checkpoint owner changed')}
 private say(text:string):void{if(this.current())this.status.textContent=text}
 private update():void{this.saveButton.disabled=this.busy||!this.enabled;this.refreshButton.disabled=this.busy||!this.enabled;this.toggle.disabled=this.busy}
 private async save():Promise<void>{
  if(!this.current()||!this.enabled||this.busy)return;this.busy=true;this.update();const generation=this.generation;
  try{const snapshot=await this.options.client.exportSnapshot();this.guard(generation);if(typeof snapshot!=='string'||new TextEncoder().encode(snapshot).byteLength>4*1024*1024)throw Error('Role snapshot exceeds limit');const envelope=JSON.parse(snapshot),graph=JSON.parse(envelope.graphJson),role=graph.role;assertSnapshotRole(snapshot,role);const saved=await this.options.store.checkpoint({workspace:this.options.workspace,role,session:this.writer},snapshot);this.guard(generation);this.say(`Role checkpoint saved: ${saved.identity.role}`)}catch(error){this.say(`Role checkpoint failed: ${message(error)}`)}finally{this.busy=false;this.update()}
 }
 private async refresh():Promise<void>{
  if(!this.current()||!this.enabled||this.busy)return;this.busy=true;this.update();const generation=this.generation;
  try{const entries=await this.options.store.list({workspace:this.options.workspace});this.guard(generation);this.rows.replaceChildren();for(const entry of entries){const row=document.createElement('article'),title=document.createElement('p');title.textContent=entry.identity.role+' — '+(entry.status==='candidate'?entry.updatedAt:'Unavailable checkpoint');row.append(title);if(entry.status==='candidate'){const restore=document.createElement('button');restore.type='button';restore.textContent='Restore role checkpoint';restore.addEventListener('click',()=>this.confirmRestore(row,entry,restore));row.append(restore)}else{const reason=document.createElement('p');reason.textContent=entry.reason.replaceAll('_',' ');row.append(reason)}this.rows.append(row)}if(!entries.length)this.rows.textContent='No stored role checkpoints'}catch(error){this.say(`Role checkpoints unavailable: ${message(error)}`)}finally{this.busy=false;this.update()}
 }
 private confirmRestore(row:HTMLElement,selection:RoleCandidate,button:HTMLButtonElement):void{
  if(!this.current()||!this.enabled||this.busy)return;button.disabled=true;const generation=this.generation,note=document.createElement('p');note.textContent=`Restore the selected ${selection.identity.role} checkpoint into a new local session? This changes the active role, not the document.`;
  const confirm=document.createElement('button');confirm.type='button';confirm.textContent='Confirm role restore';const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Keep current role';const close=()=>{note.remove();confirm.remove();cancel.remove();button.disabled=false;if(this.current()&&button.isConnected)button.focus()};cancel.addEventListener('click',close);confirm.addEventListener('click',()=>{if(!this.current()||!this.enabled||generation!==this.generation||!row.isConnected||this.busy)return;close();void this.restore(selection)});row.append(note,confirm,cancel);cancel.focus();
 }
 private async restore(selection:RoleCandidate):Promise<void>{
  if(!this.current()||!this.enabled||this.busy)return;this.busy=true;this.update();const generation=this.generation,writer=crypto.randomUUID();let importAttempted=false;
  try{await this.options.store.restore(selection,{workspace:this.options.workspace,role:selection.identity.role,session:writer},{importSnapshot:(snapshot:string)=>{this.guard(generation);importAttempted=true;return this.options.client.importSnapshot(snapshot)}},{confirmed:true});this.guard(generation);this.writer=writer;this.say('Role restored and checkpoint verified')}catch(error){this.say(`Role restore failed: ${message(error)}${importAttempted?'. Inspect the active role before retrying; an import may already have completed.':''}`)}finally{this.busy=false;this.update()}
 }
 dispose():void{if(this.closed)return;this.closed=true;this.generation++;this.options.store.close();this.element.remove()}
}
