import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {nativeFailureStatus} from '../../scripts/native/result.mjs';
// Exact visible text retained by native Windows run 38750710544; no simulated host pass.
const actualOnboarding=await readFile(new URL('../fixtures/native/observed-onboarding.txt',import.meta.url),'utf8');
test('actual late onboarding screen classifies the original click timeout as blocked',()=>{
 assert.equal(nativeFailureStatus(new Error('locator.click: Timeout 20000ms exceeded'),actualOnboarding),'BLOCKED_ONBOARDING');
});
test('explicit onboarding refusal stays blocked without a second readable snapshot',()=>{
 assert.equal(nativeFailureStatus(new Error('BLOCKED_ONBOARDING: human completion required'),null),'BLOCKED_ONBOARDING');
});
test('unrelated failures and incomplete text remain failures',()=>{
 for(const text of [null,'','Standard Mode','Welcome to Nimbalyst','By continuing, you agree to our Terms of Service and Privacy Policy.'])assert.equal(nativeFailureStatus(new Error('File save failed'),text),'FAIL');
});
