'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const modulePromise=import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../import-review-recovery.js')).toString('base64'));
const a='a'.repeat(64),b='b'.repeat(64);
const denied=(hashes=[a])=>Object.assign(Error('Review imported content'),{code:'IMPORT_REVIEW_REQUIRED',details:{hashes}});
test('inline acceptance is explicit, uses only named hashes and retains the original workspace',async()=>{
 const {attachImportReviewRecovery}=await modulePromise,calls=[],workspaceRoot='C:\\fixture';const hashes=[a,a,b];
 const error=attachImportReviewRecovery(denied(hashes),async(...args)=>{calls.push(args);return {trusted:true,hash:args[2].hash};},workspaceRoot);
 assert.deepEqual(calls,[],'Creating the action must never approve content');hashes.push('c'.repeat(64));await error.acceptImportReview();
 assert.deepEqual(calls,[['host','trustImport',{hash:a,workspaceRoot}],['host','trustImport',{hash:b,workspaceRoot}]]);
});
test('ordinary errors, malformed review details and missing workspaces cannot be bypassed',async()=>{
 const {attachImportReviewRecovery}=await modulePromise;
 for(const error of [Error('Provider failed'),Object.assign(denied(),{code:'REVISION_CONFLICT'}),denied([]),denied(['bad']),denied([a,null]),denied('all')])assert.equal(attachImportReviewRecovery(error,()=>{throw Error('Must not invoke');},'C:\\fixture').acceptImportReview,undefined);
 assert.equal(attachImportReviewRecovery(denied(),()=>{},'').acceptImportReview,undefined);
});
test('failed or unconfirmed acceptance stops before later hashes are accepted',async()=>{
 const {attachImportReviewRecovery}=await modulePromise;
 for(const result of [{trusted:false,hash:a},{trusted:true,hash:b},{__lvxError:{code:'WORKSPACE_CHANGED',message:'Workspace changed'}}]){
  let calls=0;const error=attachImportReviewRecovery(denied([a,b]),async()=>{calls++;return result;},'C:\\fixture');await assert.rejects(error.acceptImportReview());assert.equal(calls,1);
 }
});
