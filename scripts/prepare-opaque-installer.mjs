import {readFile,writeFile,mkdir} from 'node:fs/promises';
import ts from 'typescript';
await mkdir('.cache/contracts',{recursive:true});

// Compile the standalone sandbox script before the host module loader can rewrite imports.
const installerInput=await readFile('src/opaque-installer.ts','utf8');
const installerOutput=ts.transpileModule(installerInput,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,alwaysStrict:true},reportDiagnostics:true});
if(installerOutput.diagnostics?.length||/<\/script/i.test(installerOutput.outputText))throw Error('Invalid standalone installer');
await writeFile('.cache/contracts/opaque-installer-source.ts','// Generated from the separately typechecked standalone installer.\nexport const opaqueInstallerSource='+JSON.stringify(installerOutput.outputText)+';\n');
