/** The shipped SDK validator, imported without its unrelated collaboration peers. */
import {validateExtensionBundle} from '../node_modules/@nimbalyst/extension-sdk/dist/validate.js';
import {writeFile} from 'node:fs/promises';
const result=await validateExtensionBundle('./dist');
await writeFile('.artifacts/native-sdk-validation.json',JSON.stringify({sdk:'0.7.0',scope:'compiled bundle validation; not native app qualification',...result},null,2)+'\n');
if(!result.valid||result.errors.length||result.warnings.length)throw Error(JSON.stringify(result));
console.log('Actual SDK bundle validation passed without warnings.');
