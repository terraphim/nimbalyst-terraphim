import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir:'tests/recovery', testMatch:'*.test.ts', fullyParallel:false, workers:1,
 timeout:30000, retries:0, outputDir:'.artifacts/browser',
 reporter:[['list'],['json',{outputFile:'.artifacts/browser-results.json'}]],
 use:{baseURL:'http://127.0.0.1:43819',headless:true,trace:'retain-on-failure'},
 webServer:{command:'node scripts/recovery-server.mjs',url:'http://127.0.0.1:43819/tests/recovery/index.html',reuseExistingServer:false},
});
