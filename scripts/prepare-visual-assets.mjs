/** Package verified local visual dependencies; no network or editor source rewriting. */
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,dirname,posix} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build,version as esbuildVersion} from 'esbuild';
import ts from 'typescript';
import {isDescendant} from './path-boundary.mjs';
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifestPath=join(repository,'docs/recovery/released-assets-manifest.json');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const components=['input','icon','button','button-group','tooltip','split-panel','dialog','divider','badge'];
const icons=['type-bold','type-italic','code','link','type-h1','type-h2','type-h3','type-underline','question-circle'];
const shoelace='vendor/shoelace/2.12.0/cdn';
const unchangedAssets={wrapper:'terraphim-editor.min.js',graphWorker:'js/rolegraph-worker.js',graphGlue:'rolegraph/terraphim_rolegraph_browser.js',graphWasm:'rolegraph/terraphim_rolegraph_browser_bg.wasm',defaultRole:'roles/default.json'};

/** All reads finish and all hashes pass before any bundler executes. */
async function verifiedRelease(sourceRoot){
 const root=await realpath(sourceRoot),expected=JSON.parse(await readFile(manifestPath,'utf8'));
 const files=new Map();
 for(const [name,hash]of Object.entries(expected.assets)){
  const path=resolve(root,name);
  if(!isDescendant(root,path)||!isDescendant(root,await realpath(path)))throw Error('Release asset escapes root: '+name);
  const bytes=await readFile(path);
  if(digest(bytes)!==hash)throw Error('Release asset hash mismatch: '+name);
  files.set(name,bytes);
 }
 return files;
}
/** Build solely from immutable in-memory, hash-checked input bytes. */
export async function buildVisualAssets(sourceRoot){
 const files=await verifiedRelease(sourceRoot),inputs=new Set();
 const get=name=>{const bytes=files.get(name);if(!bytes)throw Error('Unpinned visual dependency: '+name);inputs.add(name);return bytes;};
 const iconData=Object.fromEntries(icons.map(name=>[name,'data:image/svg+xml;base64,'+get(`${shoelace}/assets/icons/${name}.svg`).toString('base64')]));
 const entry=[...components.map(name=>`import './${shoelace}/components/${name}/${name}.js';`),
  `import {registerIconLibrary} from './${shoelace}/utilities/icon-library.js';`,
  `const icons=${JSON.stringify(iconData)}; registerIconLibrary('default',{resolver:name=>Object.hasOwn(icons,name)?icons[name]:''});`].join('\n');
 const bundle=await build({entryPoints:['terraphim-visual-entry'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof',metafile:true,logLevel:'silent',plugins:[{
  name:'verified-release-only',setup(builder){
   builder.onResolve({filter:/^terraphim-visual-entry$/},()=>({path:'entry',namespace:'owned-entry'}));
   builder.onLoad({filter:/.*/,namespace:'owned-entry'},()=>({contents:entry,loader:'js'}));
   const resolvePinned=args=>{
    if(!args.path.startsWith('./')&&!args.path.startsWith('../'))throw Error('Nonlocal visual import refused: '+args.path);
    const base=args.namespace==='pinned-release'?posix.dirname(args.importer):'.';
    const path=posix.normalize(posix.join(base,args.path));
    if(path.startsWith('../')||path.startsWith('/')||!path.endsWith('.js')||!files.has(path))throw Error('Unpinned visual import refused: '+path);
    return{path,namespace:'pinned-release'};
   };
   builder.onResolve({filter:/.*/,namespace:'owned-entry'},resolvePinned);
   builder.onResolve({filter:/.*/,namespace:'pinned-release'},resolvePinned);
   builder.onLoad({filter:/.*/,namespace:'pinned-release'},args=>({contents:get(args.path).toString('utf8'),loader:'js'}));
  },
 }]});
 if(bundle.warnings.length)throw Error('Visual bundle warnings: '+bundle.warnings.map(w=>w.text).join('; '));
 if(bundle.outputFiles.length!==1)throw Error('Unexpected visual bundle outputs');
 const cssNames=[`${shoelace}/themes/light.css`,...['fontawesome','solid','regular','brands'].map(name=>`vendor/fontawesome/6.5.2/css/${name}.min.css`),'terraphim-editor.min.css'];
 const styles=cssNames.map(name=>{
  const css=get(name).toString('utf8');if(/@import\s/i.test(css))throw Error('Visual stylesheet import refused');
  return css.replace(/url\(([^)]*)\)/g,(_,reference)=>{
   if(!/^\.\.\/webfonts\/[a-z0-9-]+\.(?:woff2|ttf)$/.test(reference))throw Error('Unreviewed stylesheet URL');
   const path=posix.normalize(posix.join(posix.dirname(name),reference));
   return`url(data:font/${path.endsWith('.woff2')?'woff2':'ttf'};base64,${get(path).toString('base64')})`;
  });
 }).join('\n');
 const runtimeSource=await readFile(join(repository,'src/visual.ts'),'utf8');
 const runtime=Buffer.from(ts.transpileModule(runtimeSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
 const assets={runtime,components:Buffer.from(bundle.outputFiles[0].contents),styles:Buffer.from(styles)};
 for(const [name,path]of Object.entries(unchangedAssets))assets[name]=get(path);
 const manifest=Object.fromEntries(Object.entries(assets).map(([name,bytes])=>[name,{sha256:digest(bytes),bytes:bytes.length}]));
 const provenance={release:'v0.1.0-rc.2',source:'25ad3b16a1bebab6edd767a7efd1ace7b25c82ad',archiveSha256:'daa104aecdca43df5ca6dcf36b420351be09784a8436ab61bd3fc9acb1504e73',verifiedReleaseFiles:files.size,bundler:{name:'esbuild',version:esbuildVersion},adapterSource:{path:'src/visual.ts',sha256:digest(Buffer.from(runtimeSource))},unchangedAssets,
  bundledModules:Object.keys(bundle.metafile.inputs).filter(name=>name.startsWith('pinned-release:')).map(name=>name.slice('pinned-release:'.length)).sort(),
  inputs:[...inputs].sort().map(path=>({path,sha256:digest(files.get(path)),bytes:files.get(path).length})),
  transformations:{components:'Bundled verified Shoelace modules and local SVG icon resolver; original source is unchanged.',styles:'Combined verified CSS; font URLs replaced with exact pinned font bytes as data URLs.'}};
 return{assets,manifest,provenance};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const result=await buildVisualAssets(join(repository,'.cache/released-editor'));
 const destination=join(repository,'.cache/contracts/visual');await mkdir(destination,{recursive:true});
 const manifest={};for(const[name,bytes]of Object.entries(result.assets)){
  const extension=name==='graphWasm'?'.wasm':name==='styles'?'.css':name==='defaultRole'?'.json':'.js';
  const file=name+extension;await writeFile(join(destination,file),bytes);manifest[name]={...result.manifest[name],url:'/contracts/visual/'+file};
 }
 await writeFile(join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 await mkdir(join(repository,'.artifacts'),{recursive:true});
 await writeFile(join(repository,'.artifacts/visual-assets.json'),JSON.stringify(result.provenance,null,2)+'\n');
 console.log(`Verified ${result.provenance.verifiedReleaseFiles} release assets; bundled ${result.provenance.bundledModules.length} local modules into ${Object.keys(manifest).length} visual assets.`);
}
