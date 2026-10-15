import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
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
