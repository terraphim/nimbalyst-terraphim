/** Actual released desktop-app UI only. Refuse unattended onboarding agreements. */
import {chromium} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const [endpoint,workspaceArg,evidenceArg]=process.argv.slice(2);
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint??'')||!workspaceArg||!evidenceArg)throw Error('Explicit loopback endpoint and isolated directories required');
const workspace=resolve(workspaceArg),evidence=resolve(evidenceArg);await mkdir(evidence,{recursive:true});
const sha=value=>createHash('sha256').update(value).digest('hex');
const result={startedAt:new Date().toISOString(),scope:'Actual released desktop app; isolated development-folder candidate; bounded lifecycle only',steps:[],files:{}};
let page,browser;
async function safeOnboarding(){
 if(await page.getByText('Standard Mode',{exact:true}).isVisible())throw Error('BLOCKED_ONBOARDING: human completion required; no Terms were accepted');
 const dismiss=page.getByRole('button',{name:'Not now',exact:true});let visible=false;
 try{await dismiss.waitFor({state:'visible',timeout:7000});visible=true}catch(error){if(error.name!=='TimeoutError')throw error}
 if(visible)await dismiss.click();
 if(await page.getByText('Standard Mode',{exact:true}).isVisible())throw Error('BLOCKED_ONBOARDING: human completion required; no Terms were accepted');
}
try {
 browser=await chromium.connectOverCDP(endpoint);page=browser.contexts()[0].pages().filter(value=>value.url().includes('/renderer/'))[0];if(!page)throw Error('Actual app renderer unavailable');page.setDefaultTimeout(20000);
 result.browserVersion=browser.version();result.rendererUrl=page.url();
 await page.reload({waitUntil:'domcontentloaded'});await safeOnboarding();
 await page.getByText('brief.terraphim.md',{exact:true}).first().dblclick();
 const frame=page.frameLocator('iframe[title="Terraphim editor"]'),surface=frame.locator('.markdown-input');await surface.waitFor({state:'visible'});assert.match(await surface.innerText(),/Risk requires a Decision/);
 assert.equal(await page.locator('iframe[title="Terraphim editor"]').getAttribute('sandbox'),'allow-scripts');
 const sourcePath=join(workspace,'brief.terraphim.md'),before=await readFile(sourcePath);assert.equal(before.toString(),'Risk requires a Decision.\n');result.input={bytes:before.length,sha256:sha(before)};result.steps.push('Actual editor loaded with unchanged fixture');await page.screenshot({path:join(evidence,'01-loaded.png')});
 await surface.click();await surface.press('Control+Home');await surface.press('ArrowRight');await surface.press('Control+Shift+a');
 const alternative=frame.getByRole('textbox',{name:'New alternative: type it and press Enter'});await alternative.fill('Concern');await alternative.press('Enter');await alternative.press('Escape');assert.match(await surface.innerText(),/Concern requires a Decision/);result.steps.push('Created Concern through actual visible alternatives');
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('status').filter({hasText:/^Saved$/}).waitFor({state:'visible'});
 const saved=await readFile(sourcePath);assert.notDeepEqual(saved,before);assert.match(saved.toString(),/Concern requires a Decision/);assert.match(saved.toString(),/```terraphim-alternatives/);await writeFile(join(evidence,'saved-annotated.md'),saved);result.steps.push('Actual annotated file saved and read back');
 for(const [kind,name] of [['clean Markdown','native-clean.md'],['knowledge graph','native-graph.json']]){
  await page.getByRole('button',{name:'Export '+kind,exact:true}).click();await page.getByRole('textbox',{name:'New filename'}).fill(name);await page.getByRole('button',{name:'Create export',exact:true}).click();await page.getByRole('status').filter({hasText:'Created '+name}).waitFor({state:'visible'});
  const bytes=await readFile(join(workspace,name));await writeFile(join(evidence,name),bytes);result.files[name]={bytes:bytes.length,sha256:sha(bytes)};result.steps.push('Actual native dialog exported '+name);
 }
 const clean=await readFile(join(evidence,'native-clean.md'),'utf8'),graph=JSON.parse(await readFile(join(evidence,'native-graph.json'),'utf8'));assert.equal(clean,'Concern requires a Decision.\n');assert.equal(graph.data.risk.id,graph.data.concern.id);result.graph={risk:graph.data.risk,concern:graph.data.concern};await page.screenshot({path:join(evidence,'02-exported.png')});
 await page.reload({waitUntil:'domcontentloaded'});await safeOnboarding();await page.getByText('brief.terraphim.md',{exact:true}).first().dblclick();await surface.waitFor({state:'visible'});assert.match(await surface.innerText(),/Concern requires a Decision/);assert.deepEqual(await readFile(sourcePath),saved);result.steps.push('Actual renderer reload and reopen retain exact saved source');await page.screenshot({path:join(evidence,'03-reopened.png')});
 result.status='PASS_BOUNDED_ACTUAL_NATIVE_LIFECYCLE';
} catch(error) {
 result.status=String(error).includes('BLOCKED_ONBOARDING')?'BLOCKED_ONBOARDING':'FAIL';result.error=String(error);process.exitCode=1;
 if(page){result.visibleText=await page.locator('body').innerText().catch(()=>null);await page.screenshot({path:join(evidence,'failure.png')}).catch(()=>{})}
} finally {
 result.completedAt=new Date().toISOString();await writeFile(join(evidence,'native-receipt.json'),JSON.stringify(result,null,2)+'\n');
 // The dedicated launcher owns process cleanup; closing this CDP connection must not fabricate a save.
 if(browser)await browser.close();
}
