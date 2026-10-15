/** Thin React host entry. React remains external and is supplied by Nimbalyst. */
import {createElement,useEffect,useRef} from 'react';
import {editorHostSupports,copyToClipboard,type EditorHostProps} from '@nimbalyst/extension-sdk';
import {NativeSession} from './native-session.ts';
import type {FrameAssets,FrameManifest} from './frame.ts';
import type {VisualAssets,VisualManifest} from './visual.ts';
import {packedAssets} from '../.cache/native/assets.ts';
import './native.css';
function decode(values:Record<string,string>):Record<string,Uint8Array<ArrayBuffer>>{return Object.fromEntries(Object.entries(values).map(([name,text])=>[name,Uint8Array.from(atob(text),character=>character.charCodeAt(0))]));}
function TerraphimEditor({host}:EditorHostProps){
 const container=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const element=container.current;if(!element)return;let current=true,session:NativeSession|null=null;
  void NativeSession.start({container:element,host,isCurrent:()=>current,supports:editorHostSupports,copyText:copyToClipboard,indexedDB,
   frame:{assets:decode(packedAssets.frame.assets)as FrameAssets,manifest:packedAssets.frame.manifest as FrameManifest},
   visual:{assets:decode(packedAssets.visual.assets)as VisualAssets,manifest:packedAssets.visual.manifest as VisualManifest}})
   .then(value=>{if(current)session=value;else value.dispose()})
   .catch(error=>{if(current){const notice=document.createElement('p');notice.setAttribute('role','alert');notice.textContent=`Terraphim could not open this file: ${error instanceof Error?error.message:'Host unavailable'}`;element.replaceChildren(notice)}});
  return()=>{current=false;session?.dispose()};
 },[host,host.filePath,host.workspaceId]);
 return createElement('div',{ref:container,className:'terraphim-native-parent'});
}
export const components={TerraphimEditor};
