import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'nimbalyst archive café '));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['scripts/prepare-recovery-assets.mjs', 'scripts/path-boundary.mjs', 'docs/recovery/released-assets-manifest.json']) {
    const target = join(root, name);
    await mkdir(join(target, '..'), { recursive: true });
    await copyFile(new URL('../../' + name, import.meta.url), target);
  }
  return root;
}

test('actual released archive imports from native absolute paths with spaces and Unicode', async t => {
  const root = await fixture(t), archive = join(root, 'editor candidate 漢字.tar.gz');
  await copyFile(new URL('../../.cache/editor-candidate.tar.gz', import.meta.url), archive);
  const result = spawnSync(process.execPath, ['scripts/prepare-recovery-assets.mjs', archive], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(await readFile(join(root, '.artifacts/released-assets.json'), 'utf8'));
  assert.equal(receipt.checked.length, 132);
  for (const row of receipt.checked) {
    const bytes = await readFile(join(root, '.cache/released-editor', row.path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256);
  }
});

test('corrupt archive is refused before any extraction directory is created', async t => {
  const root = await fixture(t), archive = join(root, 'invalid.tar.gz');
  await writeFile(archive, 'not the released archive');
  const result = spawnSync(process.execPath, ['scripts/prepare-recovery-assets.mjs', archive], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Release archive hash mismatch/);
  await assert.rejects(stat(join(root, '.cache/released-editor')), { code: 'ENOENT' });
});
