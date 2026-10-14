/** New direct-engine test harness, NOT the missing Nimbalyst opaque iframe adapter.
 * Uses the released editor's real coordinator, main Rust model and graph Worker.
 * No native save/open, parent protocol, sandbox or host-lifecycle coverage.
 */
interface ReleasedEditor {
 rolegraph:{ready:Promise<unknown>;exportSnapshot():Promise<string>;importSnapshot(snapshot:string):Promise<unknown>};
 markdownEditor:{graphRoleSync:Promise<unknown>;loadThesaurus(text:string):unknown;documentApi():{kg_role_snapshot_json():string}};
 saveDocument():string;
 destroy():unknown;
}
interface ReleasedFactory {create(target:HTMLElement,options:Record<string,unknown>):Promise<ReleasedEditor>}
export async function createEditorFrame(parent:HTMLElement,input:{resource:string;source:string}) {
 const factory=(window as unknown as {TeraphimEditor:ReleasedFactory}).TeraphimEditor;
 const target=document.createElement('div');parent.append(target);
 const editor=await factory.create(target,{value:input.source,assetBase:'/vendor/',rolegraphAssetBase:new URL('/vendor/',location.href).href,standalone:false});
 const role=await fetch('/vendor/roles/default.json');
 if(!role.ok) throw Error('Released default role unavailable');
 editor.markdownEditor.loadThesaurus(await role.text());
 const graph=editor.rolegraph;await graph.ready;await editor.markdownEditor.graphRoleSync;
 return {
  async request(operation:string,payload?:{snapshot:string}):Promise<unknown> {
   if(operation==='role-snapshot') return graph.exportSnapshot();
   if(operation==='role-import' && payload) return graph.importSnapshot(payload.snapshot);
   if(operation==='snapshot') {
    const actualRole=JSON.parse(editor.markdownEditor.documentApi().kg_role_snapshot_json());
    return {source:editor.saveDocument(),roleName:actualRole.name};
   }
   throw Error('Unsupported recovery-test operation: '+operation);
  },
  dispose(){editor.destroy();target.remove();},
 };
}
