import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative,isAbsolute} from 'node:path';
import {Worker} from 'node:worker_threads';
import {createAppRoot} from '../../scripts/native/app-root.mjs';
const worker=path=>new Promise((resolve,reject)=>{const child=new Worker(path);child.once('message',resolve);child.once('error',reject)});
const body='const {parentPort}=require("node:worker_threads");const fs=require("node:fs");parentPort.postMessage(fs.readFileSync(__dirname+"/actual.txt","utf8"));';
test('real packaged-style CommonJS worker fails beneath enclosing ESM package',async()=>{
 const base=await mkdtemp(join(tmpdir(),'nim-native-esm-'));
 try{await writeFile(join(base,'package.json'),JSON.stringify({type:'module'}));const app=join(base,'app','resources');await mkdir(app,{recursive:true});await writeFile(join(app,'sqlite-worker.bundle.js'),body);await writeFile(join(app,'actual.txt'),'Actual worker output');await assert.rejects(worker(join(app,'sqlite-worker.bundle.js')),/require is not defined/)}finally{await rm(base,{recursive:true,force:true})}
});
test('actual task app root is fresh, outside checkout and runs the unchanged worker',async()=>{
 const base=await mkdtemp(join(tmpdir(),'nim-native-isolation-'));
 try{const checkout=join(base,'checkout'),temporary=join(base,'runner-temp');await mkdir(checkout);await mkdir(temporary);await writeFile(join(checkout,'package.json'),JSON.stringify({type:'module'}));const root=await createAppRoot(temporary,checkout);assert.ok(relative(await realpath(temporary),root).startsWith('terraphim-nimbalyst-'));const from=relative(await realpath(checkout),root);assert.ok(from==='..'||from.startsWith('..'+(process.platform==='win32'?'\\':'/'))||isAbsolute(from));await writeFile(join(root,'sqlite-worker.bundle.js'),body);await writeFile(join(root,'actual.txt'),'Actual worker output');assert.equal(await worker(join(root,'sqlite-worker.bundle.js')),'Actual worker output');assert.equal(await readFile(join(checkout,'package.json'),'utf8'),'{'+'"type":"module"'+'}');assert.notEqual(await createAppRoot(temporary,checkout),root)}finally{await rm(base,{recursive:true,force:true})}
});
test('checkout descendants and an ESM temporary ancestor are refused',async()=>{
 const base=await mkdtemp(join(tmpdir(),'nim-native-refusal-'));
 try{const checkout=join(base,'checkout'),inside=join(checkout,'cache'),esm=join(base,'esm'),temporary=join(esm,'temp');await mkdir(inside,{recursive:true});await mkdir(temporary,{recursive:true});await writeFile(join(esm,'package.json'),JSON.stringify({type:'module'}));await assert.rejects(createAppRoot(inside,checkout),/outside the source checkout/);await assert.rejects(createAppRoot(temporary,checkout),/enclosing ESM package/)}finally{await rm(base,{recursive:true,force:true})}
});
