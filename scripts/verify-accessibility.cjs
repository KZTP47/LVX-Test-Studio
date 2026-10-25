'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {root,sourceManifest,hash}=require('./source-manifest.cjs');
const source=sourceManifest(),read=file=>JSON.parse(fs.readFileSync(path.join(root,file)));
require('./build-ui.cjs').buildUI({check:true});
function receipt(kind){
 const r=read('docs/verification/accessibility-'+kind+'.json');assert.equal(r.status,'SUCCESS');assert.equal(r.sourceDigest,source.digest);assert.equal(r.packaged,kind==='packaged');
 assert.equal(r.testScriptSha256,hash(fs.readFileSync(path.join(root,'scripts/accessibility-e2e.cjs'))));assert.deepEqual(r.violations,[]);assert.deepEqual(r.gradientFailures,[]);assert.deepEqual(r.errors,[]);
 if(r.packaged)assert.deepEqual(r.packageProof,require('./package-manifest.cjs').verifyPackage());
 for(const theme of ['light','dark'])for(const name of ['home','start','build','graph','readiness','agent-populated','visual-test-populated','visual-test-save','selector-choices','runtime-setup','node/git-repo','node/log-collector'])assert.ok(r.scans.some(s=>s.name===theme+'/'+name),'Missing audited screen '+theme+'/'+name);
 for(const word of ['oracle detects','Escape restores the graph launcher','native save dialog Tab','removed selector modal','test built with keyboard','200% zoom','Reduced motion'])assert.ok(r.checks.some(c=>c.includes(word)),'Missing behavioural verification '+word);
 assert.ok(r.screenshots.length>=8);for(const entry of r.screenshots){assert.equal(entry.sha256,hash(fs.readFileSync(path.join(root,entry.file))));assert.ok(entry.url.endsWith('/index.html'));assert.ok(Number.isInteger(entry.windowId));}
 for(const s of r.scans)assert.ok(s.incomplete.every(i=>i.id==='color-contrast'),'Unresolved noncontrast incomplete on '+s.name);
}
function regression(){const r=read('docs/verification/regression-results.json');assert.equal(r.sourceDigest,source.digest);assert.ok(r.tests>=602);assert.equal(r.pass,r.tests);assert.equal(r.fail,0);assert.equal(r.skipped,0);const expected=fs.readdirSync(path.join(root,'tests')).filter(f=>f.endsWith('.test.cjs')).map(f=>'tests/'+f).concat(fs.readdirSync(root).filter(f=>f.endsWith('.test.js'))).sort();assert.deepEqual(r.files.map(f=>f.file).sort(),expected,'Regression receipt must include every current test file');for(const file of r.files)assert.equal(file.sha256,hash(fs.readFileSync(path.join(root,file.file))));}
const mode=process.argv[2]||'delivery';
if(mode==='source'||mode==='packaged'){receipt(mode);console.log('LVX_ACCESSIBILITY_'+mode.toUpperCase()+'_VERIFIED');}
else if(mode==='regression'){regression();console.log('LVX_ACCESSIBILITY_REGRESSION_VERIFIED');}
else{receipt('source');receipt('packaged');regression();if(mode==='review'){const r=read('docs/verification/accessibility-independent-review.json');assert.equal(r.verdict,'APPROVED');assert.equal(r.independent,true);assert.equal(r.sourceDigest,source.digest);assert.deepEqual(r.packageProof,require('./package-manifest.cjs').verifyPackage());assert.deepEqual(r.unresolved,[]);assert.ok(r.checks.length>=4&&r.checks.every(c=>c.passed===true));for(const file of ['docs/verification/accessibility-source.json','docs/verification/accessibility-packaged.json','docs/verification/regression-results.json','scripts/accessibility-e2e.cjs'])assert.equal(r.evidenceHashes[file],hash(fs.readFileSync(path.join(root,file))));console.log('LVX_ACCESSIBILITY_REVIEW_VERIFIED');}else console.log('LVX_ACCESSIBILITY_DELIVERY_VERIFIED');}
