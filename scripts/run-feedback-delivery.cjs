'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const {root,sourceManifest,hash}=require('./source-manifest.cjs');
try{
 const source=sourceManifest().digest,script=hash(fs.readFileSync(path.join(root,'scripts/run-feedback-e2e.cjs'))),phases=['errors','browser','success','connections'];
 const packageProof=require('./nine-package-verify.cjs').verify();assert.equal(packageProof.sourceDigest,source);
 cp.execFileSync(process.execPath,['scripts/nine-regression-verify.cjs'],{cwd:root,stdio:'inherit',windowsHide:true});
 for(const phase of phases){cp.execFileSync(process.execPath,['scripts/run-feedback-e2e.cjs',phase],{cwd:root,env:{...process.env,LVX_FEEDBACK_EXECUTABLE:path.join(root,'release/win-unpacked/LVX Test Studio.exe')},stdio:'inherit',windowsHide:true});
  for(const mode of ['source','packaged']){const proof=JSON.parse(fs.readFileSync(path.join(root,'.unlazy/run-feedback-20261026',phase+'-'+mode+'.json')));assert.equal(proof.status,'SUCCESS');assert.equal(proof.sourceDigest,source,'Stale '+phase+' '+mode);assert.equal(proof.scriptSha256,script);assert.deepEqual(proof.errors,[]);assert.ok(proof.checks.length>=8);}
 }
 assert.equal(sourceManifest().digest,source);const regression=JSON.parse(fs.readFileSync(path.join(root,'docs/verification/regression-results.json')));fs.mkdirSync(path.join(root,'output/run-feedback'),{recursive:true});fs.writeFileSync(path.join(root,'output/run-feedback/delivery.json'),JSON.stringify({status:'SUCCESS',version:packageProof.version,sourceDigest:source,packageProof,regressionTests:regression.tests,verifiedAt:new Date().toISOString(),limits:['No live AI provider account exercised.','Browser choice applies to LVX-managed browsers; external project commands control their own browsers.']},null,2));console.log('LVX_RUN_FEEDBACK_DELIVERED');
}catch(error){console.error(error.stack);process.exitCode=1;}
