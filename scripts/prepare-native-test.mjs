/** Test the exact compiled entry with the real external React runtime. */
import {build} from 'esbuild';
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out='.cache/contracts/native';await mkdir(out,{recursive:true});
for(const name of ['index.js','index.css'])await copyFile('dist/'+name,out+'/'+name);
await build({stdin:{contents:'export {default,createElement,useRef,useEffect,useSyncExternalStore} from "react"; export {createRoot} from "react-dom/client";',resolveDir:process.cwd(),sourcefile:'react-host.js'},outfile:out+'/react.js',bundle:true,format:'esm',platform:'browser',define:{'process.env.NODE_ENV':'"production"'},logLevel:'warning'});
const files=[];for(const name of ['index.js','index.css','react.js']){const bytes=await readFile(out+'/'+name);files.push({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})}await writeFile('.artifacts/native-test-inputs.json',JSON.stringify({scope:'built package browser fixture, not native app',files},null,2)+'\n');
