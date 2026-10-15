/** Pure privacy/response boundaries for an optional, separately qualified host provider. */
export const ALTERNATIVE_CONTEXT_LIMIT=2000;
export const ALTERNATIVE_RESPONSE_BYTES=32*1024;
export interface AlternativeContext {context:string;selectionStart:number;selectionEnd:number}
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
function whole(value:unknown):value is string{return typeof value==='string'&&decoder.decode(encoder.encode(value))===value}
function boundary(value:string,offset:number):boolean{return offset===0||offset===value.length||!(value.charCodeAt(offset-1)>=0xd800&&value.charCodeAt(offset-1)<=0xdbff&&value.charCodeAt(offset)>=0xdc00&&value.charCodeAt(offset)<=0xdfff)}
/** Pass only the engine's plain body, never annotated source, Overflow or recovery records. */
export function boundedAlternativeContext(body:string,start:number,end:number):AlternativeContext{
 if(!whole(body)||encoder.encode(body).byteLength>1024*1024||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end>body.length||start>=end||!boundary(body,start)||!boundary(body,end))throw Error('Select a nonempty, complete text range in the current document');
 const selected=body.slice(start,end),selectedPoints=Array.from(selected);
 if(selectedPoints.length>ALTERNATIVE_CONTEXT_LIMIT)throw Error('Shorten the selection to 2,000 Unicode characters before requesting external alternatives');
 let paragraphStart=0,paragraphEnd=body.length;
 const breaks=/(?:\r\n|\n|\r(?!\n))[ \t]*(?:\r\n|\n|\r(?!\n))/g;
 for(const match of body.matchAll(breaks)){
  const from=match.index,to=from+match[0].length;
  if(to<=start)paragraphStart=to;
  else if(from>=end){paragraphEnd=from;break}
  else return{context:selected,selectionStart:0,selectionEnd:selected.length};
 }
 const before=Array.from(body.slice(paragraphStart,start)),after=Array.from(body.slice(end,paragraphEnd)),remaining=ALTERNATIVE_CONTEXT_LIMIT-selectedPoints.length;
 let left=Math.min(before.length,Math.floor(remaining/2));const right=Math.min(after.length,remaining-left);left=Math.min(before.length,remaining-right);
 const prefix=before.slice(before.length-left).join(''),suffix=after.slice(0,right).join('');
 return{context:prefix+selected+suffix,selectionStart:prefix.length,selectionEnd:prefix.length+selected.length};
}
/** Validate before handing candidates to the existing engine's normalization and provenance path. */
export function validateAlternativeResponse(payload:string):string[]{
 if(!whole(payload)||encoder.encode(payload).byteLength>ALTERNATIVE_RESPONSE_BYTES)throw Error('Alternative response exceeds the 32 KiB UTF-8 limit or contains invalid Unicode');
 let value:unknown;try{value=JSON.parse(payload)}catch{throw Error('Alternative response must be a JSON array of strings')}
 if(!Array.isArray(value)||value.length>10||value.some(item=>!whole(item)||Array.from(item).length>1024))throw Error('Alternative response must contain at most 10 strings of 1,024 Unicode characters each');
 return value.slice();
}
