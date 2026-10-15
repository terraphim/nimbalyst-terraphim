// New loopback-only server for recovered-component tests. No host adapter.
import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { isDescendant } from './path-boundary.mjs';
import ts from 'typescript';
const root=resolve('.');
const mime={'.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.html':'text/html','.woff2':'font/woff2','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
 try {
  const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
  const mounts=[['/.cache/contracts/','.cache/contracts'],['/vendor/','.cache/released-editor'],['/contracts/','.cache/contracts'],['/src/','src'],['/tests/recovery/','tests/recovery']];
  const mount=mounts.filter(([prefix])=>pathname.startsWith(prefix))[0];
  if(!mount) {res.writeHead(404).end();return;}
  const [prefix,directory]=mount,base=await realpath(resolve(root,directory));
  const lexical=resolve(base,pathname.slice(prefix.length));
  if(!isDescendant(base,lexical)) {res.writeHead(403).end();return;}
  const file=await realpath(lexical);
  if(!isDescendant(base,file)) {res.writeHead(403).end();return;}
  let bytes=await readFile(file), type=mime[extname(file)]||'application/octet-stream';
  if(file.endsWith('.ts')) {bytes=Buffer.from(ts.transpileModule(bytes.toString('utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);type='text/javascript';}
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'}).end(bytes);
 } catch {res.writeHead(404).end();}
});
server.listen(43819,'127.0.0.1');
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>process.exit()));
