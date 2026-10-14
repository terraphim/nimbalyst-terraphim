// Execute the exact pinned upstream filesystem service in Node tests; do not replace its reads.
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const source=await readFile('docs/recovery/pinned-contracts/ProjectFileService.ts');
if(createHash('sha256').update(source).digest('hex')!=='952f9b03dad008f315d0851036c936e845bb59d7fa45cccbfe2d01df6807baed')throw Error('Pinned host contract changed');
await mkdir('.cache/contracts',{recursive:true});
await writeFile('.cache/contracts/ProjectFileService.mjs',ts.transpileModule(source.toString(),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);

await writeFile('.cache/contracts/editorHostCapabilities.js',await readFile('node_modules/@nimbalyst/extension-sdk/dist/editorHostCapabilities.js'));
