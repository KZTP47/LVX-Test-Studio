'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {sourceManifest}=require('./source-manifest.cjs');
const report=JSON.parse(fs.readFileSync('docs/verification/coordination-independent-review.json','utf8'));
assert.equal(report.verdict,'APPROVED');assert.equal(report.sourceDigest,sourceManifest().digest);assert.equal(report.independent,true);assert.deepEqual(report.unresolvedFindings,[]);
assert.ok(report.checks?.length>=4);assert.ok(report.limits?.length>0);
console.log('LVX_COORDINATION_REVIEW_VERIFIED');
