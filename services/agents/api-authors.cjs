'use strict';
const {reference}=require('../protect-configuration.cjs');
const PROVIDERS={openai:'OpenAI',anthropic:'Anthropic / Claude',google:'Google Gemini',custom:'OpenAI-compatible endpoint'};
function descriptor(record){
 const c=record.value;
 return {id:'api:'+record.id,name:`${PROVIDERS[c.provider]} · ${c.model} · API key`,provider:c.provider,model:c.model,apiKeyProfile:true,revision:record.revision,maxTokens:c.maxTokens,customEndpoint:c.customEndpoint||''};
}
function configuration(input,previous){
 const provider=input.provider;if(!Object.hasOwn(PROVIDERS,provider))throw Error('Choose a supported API provider.');
 const model=typeof input.model==='string'?input.model.trim():'';if(!model)throw Error('Enter the model ID from your API provider.');
 const maxTokens=Number(input.maxTokens);if(!Number.isSafeInteger(maxTokens)||maxTokens<1)throw Error('Output token limit must be a positive whole number.');
 const apiKey=typeof input.apiKey==='string'?input.apiKey.trim():'';
 if(reference(apiKey))throw Error('Enter a new API key, or leave the field empty to keep the saved key.');
 const key=apiKey||(previous?.provider===provider&&previous.apiKey);if(!key)throw Error('Enter an API key before saving this provider.');
 let customEndpoint='';
 if(provider==='custom'){
  try{const url=new URL(input.customEndpoint);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error();customEndpoint=url.href;}catch{throw Error('Enter the full HTTP(S) chat completions endpoint without credentials, query parameters or a fragment.');}
 }
 return {provider,model,apiKey:key,maxTokens,...(customEndpoint?{customEndpoint}:{}),timeoutMs:0};
}
module.exports={PROVIDERS,descriptor,configuration};
