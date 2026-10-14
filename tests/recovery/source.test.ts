import { test,expect } from '@playwright/test';
test('new SHA-256 helper hashes empty and Unicode UTF-8 bytes',async({page})=>{
 await page.goto('/tests/recovery/index.html');
 const hashes=await page.evaluate(async()=>{
  const url='/src/source.ts';const {sha256Utf8}=await import(url);
  return Promise.all(['','abc','Risk — café 漢字 🦀'].map(sha256Utf8));
 });
 expect(hashes).toEqual(["e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "840d0a2a71f44ef43a5181d0d2aaaed55beec88f5578c2be18e63f7bac16dd4b"]);
});
