import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { isDescendant } from '../../scripts/path-boundary.mjs';

for (const [name, api, base] of [
  ['POSIX', path.posix, '/workspace/cache'],
  ['Windows drive', path.win32, 'C:\\workspace\\cache'],
  ['Windows UNC', path.win32, '\\\\server\\share\\cache'],
]) {
  test(`${name}: permits actual descendants and Unicode paths`, () => {
    assert.equal(isDescendant(base, api.join(base, 'nested', 'café 漢字.js'), api), true);
    assert.equal(isDescendant(base, api.join(base, '..safe', 'file.js'), api), true);
  });
  test(`${name}: rejects self, parent, siblings and normalized traversal`, () => {
    for (const candidate of [base, api.dirname(base), base + '-sibling/file.js', api.resolve(base, '../outside.js')]) {
      assert.equal(isDescendant(base, candidate, api), false, candidate);
    }
  });
  test(`${name}: requires absolute inputs`, () => {
    assert.equal(isDescendant('cache', 'cache/file.js', api), false);
    assert.equal(isDescendant(base, 'file.js', api), false);
  });
}

test('Windows rejects other drives and shares, accepts case-insensitive matching and mixed separators', () => {
  const base = 'C:\\workspace\\cache';
  assert.equal(isDescendant(base, 'D:\\workspace\\cache\\file.js', path.win32), false);
  assert.equal(isDescendant('\\\\server\\share\\cache', '\\\\other\\share\\cache\\file.js', path.win32), false);
  assert.equal(isDescendant(base, 'c:/WORKSPACE/cache/nested/file.js', path.win32), true);
});

test('filesystem roots accept child files but never the root itself', () => {
  for (const [api, root] of [[path.posix, '/'], [path.win32, 'C:\\']]) {
    assert.equal(isDescendant(root, api.join(root, 'file.js'), api), true);
    assert.equal(isDescendant(root, root, api), false);
  }
});
