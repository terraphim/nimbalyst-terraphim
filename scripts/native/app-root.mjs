/** Keep extracted packaged workers outside the source checkout's module scope. */
import {readFile,realpath,mkdtemp} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
export async function createAppRoot(temporaryDirectory,checkoutDirectory){
 if(!isAbsolute(temporaryDirectory??'')||!isAbsolute(checkoutDirectory??''))throw Error('Explicit absolute task temporary and checkout directories required');
 const temporary=await realpath(temporaryDirectory),checkout=await realpath(checkoutDirectory),from=relative(checkout,temporary);
 if(from===''||(!isAbsolute(from)&&from!=='..'&&!from.startsWith('..'+sep)))throw Error('Native app must be outside the source checkout');
 for(let current=temporary;;current=dirname(current)){
  try{const manifest=JSON.parse(await readFile(join(current,'package.json'),'utf8'));if(manifest.type==='module')throw Error('Native app temporary directory has an enclosing ESM package')}
  catch(error){if(error.code!=='ENOENT')throw error}
  if(dirname(current)===current)break;
 }
 return mkdtemp(join(temporary,'terraphim-nimbalyst-'));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(await createAppRoot(process.argv[2],process.argv[3]));
