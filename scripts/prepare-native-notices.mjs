/** Retain unchanged dependency licenses beside the compiled native candidate. */
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(await readFile('docs/recovery/released-assets-manifest.json','utf8'));
const notices=[['LICENSE','terraphim.txt'],['vendor/terraphim-host-bridge/LICENSE','terraphim-host-bridge.txt'],['node_modules/@nimbalyst/extension-sdk/LICENSE','nimbalyst-sdk.txt']];
const sdk=JSON.parse(await readFile('node_modules/@nimbalyst/extension-sdk/package.json','utf8'));if(sdk.version!=='0.7.0')throw Error('Unreviewed SDK version');
for(const [name,hash]of Object.entries(manifest.assets)){
 const path=join('.cache/released-editor',name);if(!(await lstat(path)).isFile())throw Error('Released asset is not a regular file');const bytes=await readFile(path);if(sha(bytes)!==hash)throw Error('Released asset integrity failure');
 if(/(?:^|\/)(?:LICENSE|COPYING|NOTICE)(?:\.|$)/i.test(name))notices.push([path,'released/'+name]);
}
const files=[];
for(const [source,name]of notices){if(!(await lstat(source)).isFile())throw Error('License is not a regular file');const bytes=await readFile(source),path=join('dist/licenses',name);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);files.push({path:path.replaceAll('\\','/'),bytes:bytes.length,sha256:sha(bytes)});}
const embedded=JSON.parse(await readFile('.artifacts/native-embedded-assets.json','utf8'));
await writeFile('dist/assets.json',JSON.stringify({scope:'development candidate; native qualification pending',editorRelease:'v0.1.0-rc.2',editorSource:'25ad3b16a1bebab6edd767a7efd1ace7b25c82ad',editorArchiveSha256:'daa104aecdca43df5ca6dcf36b420351be09784a8436ab61bd3fc9acb1504e73',sdk:'0.7.0',embeddedAssets:embedded.files,licenses:files},null,2)+'\n');
console.log(`Preserved ${files.length} unchanged dependency notices.`);
