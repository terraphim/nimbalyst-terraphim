import { test, expect } from '@playwright/test';

test('loopback server refuses encoded traversal and non-source repository reads', async ({ request }) => {
  const disallowed = [
    '/src/%2e%2e%2fREADME.md',
    '/tests/recovery/%2e%2e%2f%2e%2e%2fREADME.md',
    '/vendor/%2e%2e%2f%2e%2e%2fREADME.md',
    '/contracts/%2e%2e%2f%2e%2e%2fREADME.md',
    '/package.json',
    '/docs/recovery/provenance.json',
  ];
  for (const path of disallowed) {
    const response = await request.get(path);
    expect([403, 404], path).toContain(response.status());
    expect(await response.text(), path).not.toContain('# Nimbalyst Terraphim adapter');
  }
});
