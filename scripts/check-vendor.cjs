'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {root,sourceManifest,hash}=require('./source-manifest.cjs');
function checkVendor(directory=root){
 const lock=JSON.parse(fs.readFileSync(path.join(directory,'vendor-lock.json'),'utf8'));assert.equal(lock.schemaVersion,1);
 assert.match(lock.sheetjs.version,/^\d+\.\d+\.\d+$/);const v=lock.sheetjs.version.split('.').map(Number);assert.ok(v.length===3&&v.every(Number.isSafeInteger)&&(v[0]>0||v[1]>20||v[1]===20&&v[2]>=2),'SheetJS predates the CVE-2024-22363 fix');
 for(const entry of [lock.sheetjs,lock.sheetjsLicense]){const file=path.resolve(directory,entry.path),relative=path.relative(directory,file);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));assert.equal(hash(fs.readFileSync(file)),entry.sha256,'Stale/corrupt vendored file: '+entry.path);}
 return {version:lock.sheetjs.version,sha256:lock.sheetjs.sha256,lockSha256:hash(fs.readFileSync(path.join(directory,'vendor-lock.json')))};
}
if(require.main===module){try{const result={date:new Date().toISOString(),sourceDigest:sourceManifest().digest,...checkVendor(),boundary:'Exact upstream-version/hash check for the vendored SheetJS script and license; npm audit covers a separate dependency graph.'};fs.writeFileSync(path.join(root,'docs/verification/vendor-results.json'),JSON.stringify(result,null,2)+'\n');console.log('LVX_VENDOR_INTEGRITY_VERIFIED');}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={checkVendor};
