// Reconstructed validation harness; not part of the preserved implementation.
// All aliases select actual upstream modules. No setup files, IPC/module mocks,
// or substitutes for the filesystem reader or Jotai/TabsProvider are loaded.
import { defineConfig } from 'vitest/config';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
export default defineConfig({
  root,
  resolve: { alias: [
    { find: /^@nimbalyst\/runtime\/(.+)$/, replacement: path.join(root, 'packages/runtime/src') + '/$1' },
    { find: /^@nimbalyst\/extension-sdk$/, replacement: path.join(root, 'packages/extension-sdk/src/index.ts') },
    { find: /^@nimbalyst\/collab-protocol$/, replacement: path.join(root, 'packages/collab-protocol/src/index.ts') },
  ] },
  test: {
    environment: 'jsdom',
    setupFiles: [],
    include: ['packages/electron/src/renderer/services/__tests__/WorkspaceFileOpen.test.tsx'],
    testTimeout: 10000,
    hookTimeout: 10000,
    reporters: ['default', 'json'],
    outputFile: { json: path.join(root, '.artifacts/focused-open-results.json') },
  },
});
