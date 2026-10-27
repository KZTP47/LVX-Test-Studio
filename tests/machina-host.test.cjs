'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {requestAI}=require('../services/ai-provider.cjs');
const {protectConfiguration}=require('../services/protect-configuration.cjs');
test('AI provider resolves references in main, preserves an explicit token budget and keeps keys out of errors/results',async()=>{
  const key='private fixture/key?',reference='secret:12345678-1234-4234-8234-123456789abc';let seen;
  const response=await requestAI({provider:'custom',customEndpoint:'http://127.0.0.1:34567/chat',apiKey:reference,prompt:'Check the source',maxTokens:321},{resolveSecret:r=>{assert.equal(r,reference);return key;},fetch:async(url,options)=>{seen={url,options};return new Response(JSON.stringify({choices:[{message:{content:'assert(true); // '+key}}]}));}});
  assert.equal(seen.options.headers.Authorization,'Bearer '+key);assert.equal(JSON.parse(seen.options.body).max_tokens,321);assert.match(response.generatedText,/REDACTED/);assert.ok(!response.generatedText.includes(key));
  await assert.rejects(requestAI({provider:'custom',customEndpoint:'http://localhost/chat',apiKey:key},{fetch:async()=>new Response(encodeURIComponent(key),{status:401})}),error=>!error.message.includes(key)&&!error.message.includes(encodeURIComponent(key)));
});
test('AI transport accepts uncapped defaults and large complete responses while rejecting invalid budgets, provider protocols, JSON and empty content',async()=>{
  const base={provider:'custom',customEndpoint:'http://localhost/chat',prompt:'x'};
  await assert.rejects(requestAI({...base,provider:'unknown'}),/Unknown AI/);
  for(const maxTokens of [-1,1.5,Infinity,true])await assert.rejects(requestAI({...base,maxTokens}),/Token budget/);
  await assert.rejects(requestAI({...base,provider:'anthropic',maxTokens:0}),/Anthropic requires an explicit positive/);
  let body;const noBudget=await requestAI({...base,maxTokens:0},{fetch:async(url,options)=>{body=JSON.parse(options.body);return Response.json({choices:[{message:{content:'complete'}}]});}});assert.equal(noBudget.generatedText,'complete');assert.equal(Object.hasOwn(body,'max_tokens'),false);
  await assert.rejects(requestAI({...base,customEndpoint:'file:///tmp/input'}),/HTTP/);
  await assert.rejects(requestAI(base,{fetch:async()=>new Response('broken')}),/invalid JSON/);
  await assert.rejects(requestAI(base,{fetch:async()=>new Response(JSON.stringify({choices:[]}))}),/no generated text/);
  const large='x'.repeat(8*1024*1024+1),accepted=await requestAI(base,{fetch:async()=>Response.json({choices:[{message:{content:large}}]})});assert.equal(accepted.generatedText,large);
});
test('AI transport forwards abort signal and combines multipart provider text',async()=>{
  const controller=new AbortController();let observed;
  const result=await requestAI({provider:'google',apiKey:'fixture',signal:controller.signal},{fetch:async(url,{signal})=>{observed=signal;return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'first'},{text:' second'}]}}]}));}});
  assert.equal(result.generatedText,'first second');assert.equal(observed.aborted,false);
  const pendingController=new AbortController();let fetched;const started=new Promise(resolve=>{fetched=resolve;});
  const pending=requestAI({provider:'google',apiKey:'fixture',signal:pendingController.signal},{fetch:async(url,{signal})=>{fetched();return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new DOMException('Fixture request cancelled','AbortError')),{once:true});});}});
  await started;pendingController.abort();await assert.rejects(pending,{name:'AbortError',message:'Fixture request cancelled'});
});
test('Legacy import protection handles auth tokens, JSON headers, typed secret parameters and password fields',async()=>{
  const stored=[];const protect=value=>protectConfiguration(value,{storeSecret:async payload=>{stored.push(payload);return {reference:'secret:'+require('node:crypto').randomUUID()};}});
  const result=await protect({authToken:'git fixture token',headers:JSON.stringify({Authorization:'Bearer fixture token'}),parameters:{password:'fixture password'},steps:[{type:'fill',selector:'#password',expected:'typed password'}]});
  assert.equal(stored.length,4);assert.ok(result.authToken.startsWith('secret:'));assert.ok(JSON.parse(result.headers).Authorization.startsWith('secret:'));assert.ok(result.parameters.password.secretRef.startsWith('secret:'));assert.equal(result.parameterSchema.password.secret,true);assert.ok(result.steps[0].expected.startsWith('secret:'));
  const again=await protect(result);assert.deepEqual(again,result);assert.equal(stored.length,4);
});

test('Imported declarative task trust covers code-free effects and survives a configuration edit',async()=>{
 const {executableHashes}=require('../services/imported-executables.cjs');
 const node={id:'deploy-import',type:'push-deploy',data:{target:'webhook',url:'http://localhost/deploy'}};
 const hashes=await executableHashes({workflow:{nodes:[node],edges:[]}});
 assert.equal(hashes.length,2);
 const edited=await executableHashes({...node,data:{...node.data,url:'http://localhost/changed'}});
 assert.equal(edited.filter(h=>hashes.includes(h)).length,1,'The stable node identity still requires review');
 assert.equal((await executableHashes({type:'unrecognized',id:'plain',data:{text:'documentation'}})).length,0);
 const code='assert.equal(1,1)';assert.ok((await executableHashes({code})).includes(require('node:crypto').createHash('sha256').update(code).digest('hex')));
});

test('Review redaction retains only typed decision metadata when secrets collide with control strings',()=>{
 const {redactReview,redactRun}=require('../services/protocol-redaction.cjs');
 const id=require('node:crypto').randomUUID(),decisionId=require('node:crypto').randomUUID();
 const review={id,decisionId,nodeId:'review-1',kind:'code-review',state:'pending',proposalHash:'a'.repeat(64),proposal:{code:'private fixture'},history:['private fixture']};
 const redact=value=>JSON.parse(JSON.stringify(value).replaceAll(id,'[REDACTED]').replaceAll(decisionId,'[REDACTED]').replaceAll('code-review','[REDACTED]').replaceAll('private fixture','[REDACTED]'));
 const safe=redactReview(review,redact);assert.equal(safe.id,id);assert.equal(safe.decisionId,decisionId);assert.equal(safe.kind,'code-review');assert.equal(safe.proposal.code,'[REDACTED]');assert.equal(safe.history[0],'[REDACTED]');
 assert.equal(redactRun({id,engine:'workflow',status:'RUNNING',pendingReviews:[review]},redact).pendingReviews[0].decisionId,decisionId);
});

test('Native dependency scan accepts a real AbortSignal and cancels an in-flight provider call',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-scan-cancel-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 let observed;
 const service=require('../services/security').createService({dataDir:folder,workspaceRoot:folder,fetch:async(_url,{signal})=>new Promise((resolve,reject)=>{observed=signal;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});})});
 const controller=new AbortController();
 const work=service.handle('scan',{kind:'dependencies',format:'requirements',content:'requests==2.32.3',signal:controller.signal});
 const rejected=assert.rejects(work,/cancelled test/);
 await new Promise(r=>setTimeout(r,25));assert.ok(observed);controller.abort(new Error('cancelled test'));await rejected;assert.equal(observed.aborted,true);
 await assert.rejects(service.handle('scan',{kind:'source',files:[],signal:{aborted:false}}),/Invalid native cancellation/);
});

test('Legacy OS-encrypted configuration migrates to references and rejects unavailable or malformed ciphertext',async()=>{
 const stored=[],blob={__lvxEncrypted:true,version:1,value:'fixture-ciphertext'};
 const value=await protectConfiguration({apiKey:blob,parameters:{ordinary:blob},githubToken:'git token',slackWebhookUrl:'http://localhost/private',customPassword:'password value',firebaseConfig:{apiKey:'public key'}},{decryptLegacy:async ciphertext=>{assert.equal(ciphertext,'fixture-ciphertext');return 'old encrypted fixture';},storeSecret:async payload=>{stored.push(payload);return {reference:'secret:'+require('node:crypto').randomUUID()};}});
 assert.equal(stored.length,5);assert.match(value.apiKey,/^secret:/);assert.match(value.parameters.ordinary.secretRef,/^secret:/);assert.equal(value.parameterSchema.ordinary.secret,true);assert.equal(value.firebaseConfig.apiKey,'public key');assert.doesNotMatch(JSON.stringify(value),/old encrypted fixture|git token|password value|fixture-ciphertext/);
 const options={storeSecret:async()=>{throw Error('Must not store malformed input');}};
 await assert.rejects(protectConfiguration({authHeader:blob},options),/original OS account|Re-enter/);
 await assert.rejects(protectConfiguration({authHeader:{...blob,version:2}},options),/Unsupported legacy encrypted/);
 await assert.rejects(protectConfiguration({authHeader:blob},{...options,decryptLegacy:()=>{throw Error('private cryptographic detail');}}),error=>/Re-enter/.test(error.message)&&!error.message.includes('private cryptographic detail'));
});

test('Native retention cleanup removes only exact managed files and terminal runs; interrupted retries are idempotent',async t=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
 const {applyRetentionEffects}=require('../services/retention-effects.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-retention-effects-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const directory=path.join(root,'.lvx','baselines');fs.mkdirSync(directory,{recursive:true});
 const name='a'.repeat(64)+'.png',relative='.lvx/baselines/'+name,body=Buffer.from('fixture png'),digest=crypto.createHash('sha256').update(body).digest('hex');fs.writeFileSync(path.join(directory,name),body);
 let runs=[{id:'finished',status:'SUCCESS'},{id:'active',status:'RUNNING'}],pruned=[],restored=0;
 const context={workspaceRoot:root,getWorkspaceRoot:()=>root,execution:{handle:async(action,payload)=>{if(action==='runs')return runs;assert.equal(action,'pruneRuns');pruned.push(...payload.ids);runs=runs.filter(r=>!payload.ids.includes(r.id));return {deletedRunIds:payload.ids};}},restoreBaselines:async()=>{restored++;}};
 const receipt={deletedRunIds:['finished','active','absent'],changedBaselineArchives:[{id:'archive'}],deletedScreenshotFiles:[{path:relative,sha256:digest}]};
 const first=await applyRetentionEffects(receipt,context);assert.deepEqual(first.deletedNativeRuns,['finished']);assert.deepEqual(pruned,['finished']);assert.equal(restored,1);assert.equal(fs.existsSync(path.join(directory,name)),false);
 const retry=await applyRetentionEffects(receipt,context);assert.deepEqual(retry.deletedNativeRuns,[]);assert.deepEqual(retry.absentBaselineFiles,[relative]);
 fs.writeFileSync(path.join(directory,name),'changed');const changed=await applyRetentionEffects(receipt,context);assert.equal(changed.warnings.length,1);assert.equal(fs.readFileSync(path.join(directory,name),'utf8'),'changed');
 await assert.rejects(applyRetentionEffects({deletedScreenshotFiles:[{path:'../outside.png',sha256:digest}]},context),/Invalid managed/);
 await assert.rejects(applyRetentionEffects(receipt,{...context,getWorkspaceRoot:()=>root+'-other'}),/Workspace changed/);
 const linkedName='b'.repeat(64)+'.png';fs.linkSync(path.join(directory,name),path.join(directory,linkedName));await assert.rejects(applyRetentionEffects({deletedScreenshotFiles:[{path:'.lvx/baselines/'+linkedName,sha256:digest}]},context),/shared screenshot/);
});
