/** Load the unchanged released storage constructor from already verified wrapper bytes. */
import {verifyVisualAssets,type VisualAssets,type VisualManifest} from './visual.ts';
import type{StorageConstructor}from'./role-storage.ts';
export async function loadRoleStorage(input:{assets:VisualAssets;manifest:VisualManifest},isCurrent:()=>boolean):Promise<StorageConstructor>{
 const checked=await verifyVisualAssets(input.assets,input.manifest,isCurrent);if(!isCurrent())throw Error('Role storage owner changed');
 const url=URL.createObjectURL(new Blob([checked.assets.wrapper],{type:'text/javascript'}));
 try{await import(/* @vite-ignore */url);if(!isCurrent())throw Error('Role storage owner changed');const Storage=(globalThis as unknown as{TeRoleGraphStorage:StorageConstructor}).TeRoleGraphStorage;if(typeof Storage!=='function')throw Error('Released role storage unavailable');return Storage}finally{URL.revokeObjectURL(url)}
}
