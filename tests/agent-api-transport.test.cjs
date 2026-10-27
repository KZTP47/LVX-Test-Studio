'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {requestAI}=require('../services/ai-provider.cjs');
const base={provider:'custom',customEndpoint:'http://127.0.0.1/fixture',model:'fixture',prompt:'exact current input'};
const fixture=value=>({fetch:async()=>new Response(JSON.stringify(value))});
test('API conversation preserves full user and assistant text without adding an empty system prompt',async()=>{
 let body;const messages=[{role:'user',content:'first\nline'},{role:'assistant',content:'full prior answer'},{role:'user',content:base.prompt}];
 const result=await requestAI({...base,messages},{fetch:async(url,options)=>{body=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'complete'}}]}));}});
 assert.deepEqual(body.messages,messages);assert.equal(result.completionStatus,'COMPLETE');
});
test('Token-limited responses fail visibly and retain redacted partial output',async()=>{
 await assert.rejects(requestAI(base,fixture({choices:[{finish_reason:'length',message:{content:'unfinished result'}}]})),error=>error.code==='AI_INCOMPLETE'&&error.finishReason==='length'&&error.partialText==='unfinished result');
});
test('Provider refusals remain blocked failures even with HTTP200',async()=>{
 await assert.rejects(requestAI(base,fixture({choices:[{finish_reason:'stop',message:{refusal:'Provider declined',content:null}}]})),error=>error.code==='AI_BLOCKED');
});
test('Gemini receives native conversation roles and content-filtered output cannot succeed',async()=>{
 let body;await assert.rejects(requestAI({provider:'google',prompt:'next',messages:[{role:'assistant',content:'prior'},{role:'user',content:'next'}]},{fetch:async(url,options)=>{body=JSON.parse(options.body);return new Response(JSON.stringify({promptFeedback:{blockReason:'SAFETY'}}));}}),error=>error.code==='AI_BLOCKED');
 assert.equal(body.contents[0].role,'model');assert.equal(body.contents[1].parts[0].text,'next');
});
test('Anthropic context limits are incomplete failures and numeric usage remains inspectable',async()=>{
 await assert.rejects(requestAI({provider:'anthropic',prompt:'exact',maxTokens:100000},fixture({content:[{type:'text',text:'partial'}],stop_reason:'model_context_window_exceeded'})),error=>error.code==='AI_INCOMPLETE');
 const result=await requestAI({provider:'anthropic',prompt:'exact',maxTokens:100000},fixture({content:[{type:'text',text:'complete'}],stop_reason:'end_turn',usage:{input_tokens:0,output_tokens:3,other:'not usage'}}));assert.deepEqual(result.usage,{input_tokens:0,output_tokens:3});
});
test('Invalid conversation roles are rejected before any request',async()=>{
 let called=false;await assert.rejects(requestAI({...base,messages:[{role:'tool',content:'unsupported'}]},{fetch:async()=>{called=true;throw Error('not reached');}}),/user\/assistant/);assert.equal(called,false);
});

test('Common API providers send the explicit model, protected key and provider-specific output budget',async()=>{
 for(const provider of ['openai','anthropic','google','custom']){
  let sent;const result=await requestAI({...base,provider,model:'user-chosen-model',apiKey:'secret:11111111-1111-4111-8111-111111111111',maxTokens:8192},{resolveSecret:()=> 'fixture-private-key',fetch:async(url,options)=>{sent={url,headers:options.headers,body:JSON.parse(options.body)};return new Response(JSON.stringify(provider==='google'?{candidates:[{finishReason:'STOP',content:{parts:[{text:'generated'}]}}]}:provider==='anthropic'?{stop_reason:'end_turn',content:[{type:'text',text:'generated'}]}:{choices:[{finish_reason:'stop',message:{content:'generated'}}]}));}});
  assert.equal(result.generatedText,'generated');assert.ok(!sent.url.includes('fixture-private-key'));
  if(provider==='google'){assert.ok(sent.url.includes('user-chosen-model'));assert.equal(sent.headers['x-goog-api-key'],'fixture-private-key');assert.equal(sent.body.generationConfig.maxOutputTokens,8192);assert.ok(!('temperature' in sent.body.generationConfig));}
  else{assert.equal(sent.body.model,'user-chosen-model');assert.equal(sent.headers[provider==='anthropic'?'x-api-key':'Authorization'],provider==='anthropic'?'fixture-private-key':'Bearer fixture-private-key');assert.equal(sent.body[provider==='openai'?'max_completion_tokens':'max_tokens'],8192);if(provider==='openai'){assert.ok(!('temperature' in sent.body));assert.ok(!('max_tokens' in sent.body));}}
 }
});
