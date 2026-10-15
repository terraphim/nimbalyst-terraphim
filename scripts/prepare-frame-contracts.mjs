import './prepare-opaque-installer.mjs';
// Source-component fixture builder; future release packaging must bind these app bytes in its CI manifest.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import ts from 'typescript';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const editor=JSON.parse(await readFile('docs/recovery/released-assets-manifest.json','utf8'));
const dependencies={engineGlue:['.cache/released-editor/terraphim_editor.js',editor.assets['terraphim_editor.js']],engineWasm:['.cache/released-editor/terraphim_editor_bg.wasm',editor.assets['terraphim_editor_bg.wasm']],hostBridge:['vendor/terraphim-host-bridge/host-session.js','9e5efc4c3f1f2003cd86f05b266b6666e546c68a065eaca67c897c2328a09388']};
await mkdir('.cache/contracts/frame',{recursive:true});const manifest={};
for(const [name,[file,expected]] of Object.entries(dependencies)){const bytes=await readFile(file);if(sha(bytes)!==expected)throw Error('Pinned frame dependency mismatch');const suffix=name==='engineWasm'?'.wasm':'.js';await writeFile(`.cache/contracts/frame/${name}${suffix}`,bytes);manifest[name]={sha256:expected,bytes:bytes.length,url:`/contracts/frame/${name}${suffix}`};}
for(const [name,path] of [['bootstrap','src/frame-bootstrap.ts'],['source','src/source.ts']]){const content=await readFile(path,'utf8'),bytes=Buffer.from(ts.transpileModule(content,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);await writeFile(`.cache/contracts/frame/${name}.js`,bytes);manifest[name]={sha256:sha(bytes),bytes:bytes.length,url:`/contracts/frame/${name}.js`};}
await writeFile('.cache/contracts/frame/manifest.json',JSON.stringify(manifest,null,2)+'\n');
