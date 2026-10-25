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
 await assert.rejects(requestAI({provider:'anthropic',prompt:'exact'},fixture({content:[{type:'text',text:'partial'}],stop_reason:'model_context_window_exceeded'})),error=>error.code==='AI_INCOMPLETE');
 const result=await requestAI({provider:'anthropic',prompt:'exact'},fixture({content:[{type:'text',text:'complete'}],stop_reason:'end_turn',usage:{input_tokens:0,output_tokens:3,other:'not usage'}}));assert.deepEqual(result.usage,{input_tokens:0,output_tokens:3});
});
test('Invalid conversation roles are rejected before any request',async()=>{
 let called=false;await assert.rejects(requestAI({...base,messages:[{role:'tool',content:'unsupported'}]},{fetch:async()=>{called=true;throw Error('not reached');}}),/user\/assistant/);assert.equal(called,false);
});
