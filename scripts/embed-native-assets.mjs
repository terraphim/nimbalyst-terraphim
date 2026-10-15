/** Bundle only the verified source-component assets; emitted bytes are checked again at runtime. */
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const names={frame:['bootstrap','source','engineGlue','engineWasm','hostBridge'],visual:['runtime','components','styles','wrapper','graphWorker','graphGlue','graphWasm','defaultRole']};
/** Refuse altered assets, aliases and unexpected entries before emitting executable source. */
export async function embedNativeAssets(root){
 const packed={},readbacks=[];let total=0;
 for(const[group,expected]of Object.entries(names)){
  const directory=join(root,'.cache/contracts',group),manifestPath=join(directory,'manifest.json');if(!(await lstat(manifestPath)).isFile())throw Error('Asset manifest is not a regular file');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));if(Object.keys(manifest).sort().join()!==[...expected].sort().join())throw Error('Unexpected asset names');const verified={},assets={};
  for(const name of expected){const item=manifest[name];if(!item||Object.keys(item).sort().join()!=='bytes,sha256,url'||!Number.isSafeInteger(item.bytes)||item.bytes<=0||!/^[a-f0-9]{64}$/.test(item.sha256)||typeof item.url!=='string'||!new RegExp('^/contracts/'+group+'/[A-Za-z]+\\.(?:js|css|json|wasm)$').test(item.url))throw Error('Invalid asset manifest');const file=join(directory,item.url.split('/').at(-1));if(!(await lstat(file)).isFile())throw Error('Asset is not a regular file');const bytes=await readFile(file);if(bytes.length!==item.bytes||digest(bytes)!==item.sha256||(total+=bytes.length)>16*1024*1024)throw Error('Asset integrity failure');verified[name]={bytes:bytes.length,sha256:item.sha256};assets[name]=bytes.toString('base64');readbacks.push({group,name,...verified[name]});}
  packed[group]={manifest:verified,assets};
 }
 return{source:'// Generated only from verified local assets.\nexport const packedAssets='+JSON.stringify(packed)+' as const;\n',readbacks};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const result=await embedNativeAssets(process.cwd());await mkdir('.cache/native',{recursive:true});await writeFile('.cache/native/assets.ts',result.source);await mkdir('.artifacts',{recursive:true});await writeFile('.artifacts/native-embedded-assets.json',JSON.stringify({scope:'candidate build assets; not native qualification',files:result.readbacks},null,2)+'\n');console.log(`Embedded ${result.readbacks.length} verified local assets.`);}
