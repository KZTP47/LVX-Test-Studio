'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {root,sourceManifest,hash}=require('./source-manifest.cjs'),source=sourceManifest();
function verifyReceipt(mode){
 const receipt=JSON.parse(fs.readFileSync(path.join(root,'docs/verification/board-save-'+mode+'.json'),'utf8'));
 assert.equal(receipt.status,'SUCCESS');assert.equal(receipt.sourceDigest,source.digest);assert.equal(receipt.scriptSha256,hash(fs.readFileSync(path.join(root,'scripts/board-save-e2e.cjs'))));
 assert.ok(receipt.checks.length>=16);assert.deepEqual(receipt.errors,[]);assert.equal(receipt.screenshot.sha256,hash(fs.readFileSync(path.join(root,receipt.screenshot.file))));
 if(mode==='packaged')assert.deepEqual(receipt.packageProof,require('./package-manifest.cjs').verifyPackage());
}
function regression(){
 const receipt=JSON.parse(fs.readFileSync(path.join(root,'docs/verification/regression-results.json'),'utf8'));assert.equal(receipt.sourceDigest,source.digest);assert.equal(receipt.tests,receipt.pass);assert.ok(receipt.tests>=546);assert.equal(receipt.fail,0);assert.equal(receipt.skipped,0);
 for(const entry of receipt.files)assert.equal(entry.sha256,hash(fs.readFileSync(path.join(root,entry.file))),'Stale test evidence '+entry.file);
}
const mode=process.argv[2]||'delivery';
if(mode==='source'){verifyReceipt('source');console.log('LVX_BOARD_SAVE_SOURCE_EVIDENCE_VERIFIED');}
else if(mode==='regression'){regression();console.log('LVX_BOARD_SAVE_REGRESSION_EVIDENCE_VERIFIED');}
else{verifyReceipt('source');verifyReceipt('packaged');regression();console.log('LVX_BOARD_SAVE_DELIVERY_VERIFIED');}
