// Exercise the actual production disabled-service path. No provider response is fabricated.
import{test,expect}from'@playwright/test';
import type{HostAlternatives}from'../../src/ai-host.ts';
test('SDK AI lifecycle with no service keeps the compiled qualification gate disabled',async({page})=>{await page.goto('/tests/recovery/index.html');const actual=await page.evaluate(async()=>{const path='/src/ai-host.ts',module=await import(path);module.deactivateAI();return{connection:module.currentAI(),qualifications:module.QUALIFIED_HOST_AI,available:module.hostAIAvailable(null)}});expect(actual).toEqual({connection:null,qualifications:[],available:false})});
