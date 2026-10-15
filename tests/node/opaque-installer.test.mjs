import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';

test('the opaque installer is compiled into inert source text before host module transformation',async()=>{
 const source=await readFile('src/opaque-installer.ts','utf8');
 const expected=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,alwaysStrict:true}}).outputText;
 const generated=await readFile('.cache/contracts/opaque-installer-source.ts','utf8');
 const module=await import('data:text/javascript,'+encodeURIComponent(generated));
 assert.equal(module.opaqueInstallerSource,expected);
 assert.match(expected,/await import\(bootstrapUrl\)/);
 assert.doesNotMatch(expected,/importShim|<\/script|export |from ['"]/);
 assert.match(expected,/opaqueInstaller\(installerNonce\)/);
 const frame=await readFile('src/frame.ts','utf8');
 assert.doesNotMatch(frame,/opaqueInstaller\.toString/);
 assert.match(frame,/const script=opaqueInstallerSource/);
});


test('the standalone preparation creates identical installer bytes from an empty cache',async()=>{
 const temporary=await mkdtemp(join(tmpdir(),'nimbalyst-installer-empty-'));
 try {
  await mkdir(join(temporary,'src'));
  await writeFile(join(temporary,'src/opaque-installer.ts'),await readFile('src/opaque-installer.ts'));
  execFileSync(process.execPath,[resolve('scripts/prepare-opaque-installer.mjs')],{cwd:temporary,stdio:'pipe'});
  assert.deepEqual(await readFile(join(temporary,'.cache/contracts/opaque-installer-source.ts')),await readFile('.cache/contracts/opaque-installer-source.ts'));
 } finally {await rm(temporary,{recursive:true,force:true})}
});
