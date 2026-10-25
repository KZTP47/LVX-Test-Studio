'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {root,hash,sourceManifest}=require('./source-manifest.cjs');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,'docs/verification',file),'utf8'));
const current=sourceManifest(),proof=require('./package-manifest.cjs').verifyPackage();const receipts=[];
for(const type of ['source','packaged']){
 const file='coordination-'+type+'-results.json',report=read(file);assert.equal(report.status,'SUCCESS');assert.equal(report.sourceDigest,current.digest);assert.equal(report.testScriptSha256,hash(fs.readFileSync(path.join(root,'scripts/coordination-e2e.cjs'))));assert.equal(report.packaged,type==='packaged');assert.deepEqual(report.errors,[]);assert.ok(report.checks.length>=15);
 for(const shot of report.screenshots)assert.equal(hash(fs.readFileSync(path.join(root,shot.file))),shot.sha256);
 if(type==='packaged')assert.deepEqual(report.packageProof,proof);receipts.push({file,checks:report.checks.length,sha256:hash(fs.readFileSync(path.join(root,'docs/verification',file)))});
}
const regression=read('regression-results.json');assert.equal(regression.sourceDigest,current.digest);assert.equal(regression.tests,regression.pass);assert.equal(regression.fail,0);assert.equal(regression.skipped,0);for(const entry of regression.files)assert.equal(hash(fs.readFileSync(path.join(root,entry.file))),entry.sha256);
const live=read('coordination-live-results.json');assert.equal(live.sourceDigest,current.digest);assert.equal(live.testScriptSha256,hash(fs.readFileSync(path.join(root,'scripts/coordination-live.cjs'))));assert.ok(['SUCCESS','BLOCKED'].includes(live.status));assert.ok(live.attempts.length||live.providerDetection.every(p=>!p.installed||p.id==='api'));if(live.status==='SUCCESS')assert.ok(live.attempts.some(a=>a.status==='SUCCESS'&&a.proposalId&&a.checkRunId));
const agent=read('agent-studio-e2e-results.json');assert.equal(agent.sourceDigest,current.digest);assert.equal(agent.status,'SUCCESS');
const style=read('node-config-style-packaged-results.json');assert.equal(style.sourceDigest,current.digest);assert.equal(style.status,'SUCCESS');assert.deepEqual(style.packageProof,proof);
require('./verify-coordination-review.cjs');
const result={status:'VERIFIED',recordedAt:new Date().toISOString(),version:require('../package.json').version,sourceDigest:current.digest,packageProof:proof,executable:'release/win-unpacked/LVX Test Studio.exe',receipts,regression:{tests:regression.tests,pass:regression.pass,fail:0,skipped:0},liveProviderStatus:live.status,liveProviders:live.attempts.map(({provider,status})=>({provider,status})),styleChecks:style.checks.length,independentReview:'coordination-independent-review.json',limits:['One bounded real-provider graph task is not a comparative model-quality benchmark. Claude/Gemini authentication remains account-specific.','Unpacked unsigned evaluation build; earlier installers and reviews retain their original version/digest.']};
fs.writeFileSync(path.join(root,'docs/verification/coordination-delivery-results.json'),JSON.stringify(result,null,2)+'\n');console.log('LVX_COORDINATION_DELIVERY_VERIFIED');
