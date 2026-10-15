/** Classify failed native attempts; never turns missing execution into success. */
export function nativeFailureStatus(error,visibleText){
 if(String(error).includes('BLOCKED_ONBOARDING'))return 'BLOCKED_ONBOARDING';
 if(typeof visibleText==='string'&&visibleText.includes('Welcome to Nimbalyst')&&visibleText.includes('Standard Mode')&&visibleText.includes('By continuing, you agree to our Terms of Service and Privacy Policy.'))return 'BLOCKED_ONBOARDING';
 return 'FAIL';
}
