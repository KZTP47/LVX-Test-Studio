'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {root,sourceManifest,hash}=require('./source-manifest.cjs');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const review=read('docs/verification/unified-independent-review.json'),source=sourceManifest();
assert.equal(review.status,'APPROVED');assert.equal(review.independent,true);assert.equal(review.sourceDigest,source.digest,'Review is stale');assert.deepEqual(review.unresolvedFindings,[]);assert.ok(review.checks.length>=4);assert.ok(review.checks.every(c=>c.passed===true));
assert.deepEqual(review.packageProof,require('./package-manifest.cjs').verifyPackage());require('./verify-pe-icon.cjs').verifyEmbeddedIcon();
const expectedScripts=['scripts/unified-ui-e2e.cjs','scripts/agent-board-nexus-e2e.cjs','scripts/verify-mascot.cjs','scripts/verify-pe-icon.cjs','README.md','docs/DEVELOPMENT.md'];
for(const file of expectedScripts){const proof=review.scriptProofs.find(p=>p.file===file);assert.ok(proof,'Review omitted '+file);assert.equal(proof.sha256,hash(fs.readFileSync(path.join(root,file))),'Reviewed artifact changed: '+file);}
for(const [file,script,minimum]of [['unified-ui-source.json','unified-ui-e2e.cjs',31],['unified-ui-packaged.json','unified-ui-e2e.cjs',31],['nexus-board-results.json','agent-board-nexus-e2e.cjs',30],['nexus-board-packaged-results.json','agent-board-nexus-e2e.cjs',30]]){const report=read('docs/verification/'+file);assert.equal(report.status,'SUCCESS');assert.equal(report.sourceDigest,source.digest);assert.equal(report.scriptSha256,hash(fs.readFileSync(path.join(root,'scripts',script))));assert.ok(report.checks.length>=minimum);assert.equal(report.errors.length,0);if(report.packaged)assert.deepEqual(report.packageProof,review.packageProof);for(const shot of report.screenshots)assert.equal(shot.sha256,hash(fs.readFileSync(path.join(root,shot.file))));}
const regression=read('docs/verification/regression-results.json');assert.equal(regression.sourceDigest,source.digest);assert.equal(regression.fail,0);assert.equal(regression.skipped,0);assert.ok(regression.pass>0);for(const file of regression.files)assert.equal(file.sha256,hash(fs.readFileSync(path.join(root,file.file))));
assert.ok(review.limits.some(x=>/live|fixture/i.test(x)));console.log('LVX_UNIFIED_REVIEW_VERIFIED');
