'use strict';
const REFERENCE=/^secret:[a-f0-9-]{36}$/;
async function protectedRequest(payload,{resolveSecret,redact=value=>value,fetch:fetchImpl=fetch,signal}={}){
 if(typeof resolveSecret!=='function')throw Error('Protected credentials are unavailable.');
 const resolve=value=>{if(Array.isArray(value))return value.map(resolve);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolve(v)]));if(typeof value==='string'&&REFERENCE.test(value))return resolveSecret(value);return value;};
 const suffix=/^(secret:[a-f0-9-]{36})([/?#].*)$/.exec(String(payload.url));
 const target=new URL(suffix?String(resolveSecret(suffix[1])).replace(/\/$/,'')+suffix[2]:resolve(payload.url));if(!['http:','https:'].includes(target.protocol))throw Error('Protected requests require HTTP or HTTPS.');
 const method=String(payload.method||'GET').toUpperCase();if(!['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(method))throw Error('Unsupported request method.');
 const headers=Object.fromEntries(Object.entries(payload.headers||{}).map(([key,value])=>{const prefix=/^([A-Za-z][\w-]*\s+)(secret:[a-f0-9-]{36})$/.exec(String(value));return [key,prefix?prefix[1]+resolveSecret(prefix[2]):resolve(value)];}));
 for(const [key,value]of target.searchParams)if(REFERENCE.test(value))target.searchParams.set(key,resolveSecret(value));
 if(target.username||target.password){if(!headers.Authorization&&!headers.authorization)headers.Authorization='Basic '+Buffer.from(decodeURIComponent(target.username)+':'+decodeURIComponent(target.password)).toString('base64');target.username='';target.password='';}
 let body=payload.body;
 const contentType=Object.entries(headers).find(([k])=>k.toLowerCase()==='content-type')?.[1]||'';
 if(body!==undefined){if(typeof body!=='string')throw Error('Request body must be text.');if(/application\/json/i.test(contentType))body=JSON.stringify(resolve(JSON.parse(body)));else body=resolve(body);}
 const timeoutMs=Number(payload.timeoutMs??0);require('./capacity.cjs').nonnegative(timeoutMs,'Request timeout');
 const budget=require('./capacity.cjs').deadline(timeoutMs,signal);try{const requestSignal=budget.signal;
 const response=await fetchImpl(target.href,{method,headers,...(!['GET','HEAD'].includes(method)&&body!==undefined?{body}:{}),redirect:'error',signal:requestSignal});
 const chunks=[];let bytes=0;if(response.body)for await(const chunk of response.body){bytes+=chunk.length;chunks.push(chunk);}
 const text=Buffer.concat(chunks).toString('utf8'),responseType=response.headers.get('content-type')||'text/plain';
 let safeBody;if(/application\/json/i.test(responseType)){try{safeBody=JSON.stringify(redact(JSON.parse(text)));}catch{safeBody=redact(text);}}else safeBody=redact(text);
 return {status:response.status,statusText:response.statusText,headers:payload.includeResponseHeaders?redact(Object.fromEntries(response.headers.entries())):{'content-type':responseType},body:safeBody};}finally{budget.dispose();}
}
module.exports={protectedRequest};
