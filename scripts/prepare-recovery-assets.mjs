// Newly reconstructed recovery harness; never a release packager.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { isDescendant } from './path-boundary.mjs';
const archive = process.argv[2];
if (!archive) throw Error('Pass the preserved released editor-candidate.tar.gz path.');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const archiveBytes = await readFile(archive);
const archiveHash = sha256(archiveBytes);
if (archiveHash !== 'daa104aecdca43df5ca6dcf36b420351be09784a8436ab61bd3fc9acb1504e73') throw Error('Release archive hash mismatch');
const manifest = JSON.parse(await readFile('docs/recovery/released-assets-manifest.json','utf8'));
const destination = resolve('.cache/released-editor');
await mkdir(destination,{recursive:true});
// Standard input avoids GNU tar treating Windows drive letters as remote hosts.
execFileSync('tar',['-xzf','-'],{cwd:destination,input:archiveBytes});
const checked = [];
for (const [name,expected] of Object.entries(manifest.assets)) {
 const path = resolve(destination,name);
 if (!isDescendant(destination,path)) throw Error('Unsafe manifest path');
 const bytes = await readFile(path), actual = sha256(bytes);
 if (actual !== expected) throw Error('Release asset hash mismatch: '+name);
 checked.push({path:name,sha256:actual,bytes:bytes.length});
}
await mkdir('.artifacts',{recursive:true});
await writeFile('.artifacts/released-assets.json',JSON.stringify({release:'v0.1.0-rc.2',source:'25ad3b16a1bebab6edd767a7efd1ace7b25c82ad',archiveSha256:archiveHash,checked},null,2)+'\n');
console.log(`Verified archive and ${checked.length} released assets.`);
