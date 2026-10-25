'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {root,sourceManifest,hash}=require('./source-manifest.cjs');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8').replace(/^\uFEFF/,'')),source=sourceManifest();
function verifyRegression(){const r=read('docs/verification/regression-results.json');assert.equal(r.sourceDigest,source.digest);assert.ok(r.tests>=526);assert.equal(r.pass,r.tests);assert.equal(r.fail,0);assert.equal(r.skipped,0);for(const file of r.files)assert.equal(file.sha256,hash(fs.readFileSync(path.join(root,file.file))));}
if(process.argv[2]==='regression'){verifyRegression();console.log('LVX_IMPORT_REGRESSION_VERIFIED');process.exit(0);}
const pkg=require('./package-manifest.cjs').verifyPackage(),scriptSha=hash(fs.readFileSync(path.join(root,'scripts/showcase-import-e2e.cjs')));
const archive=path.join(root,'exports/LVX-Advanced-Showcase-2026-10-25/LVX-Advanced-Showcase.lvx.json'),archiveSha=hash(fs.readFileSync(archive)),original=read('docs/verification/showcase-import-reproduction.json');assert.equal(original.error,'Invalid JSON format');assert.equal(original.archiveSha256,archiveSha);
for(const mode of ['source','packaged']){const report=read('docs/verification/showcase-import-'+mode+'.json');assert.equal(report.status,'SUCCESS');assert.equal(report.sourceDigest,source.digest);assert.equal(report.scriptSha256,scriptSha);assert.equal(report.archiveSha256,archiveSha);assert.equal(report.archiveBytes,fs.statSync(archive).size);assert.ok(report.checks.length>=26);assert.equal(report.errors.length,0);if(mode==='packaged')assert.deepEqual(report.packageProof,pkg);for(const shot of report.screenshots)assert.equal(shot.sha256,hash(fs.readFileSync(path.join(root,shot.file))));}
verifyRegression();
if(process.argv[2]==='review'){
 const review=read('docs/verification/showcase-import-independent-review.json');assert.equal(review.status,'APPROVED');assert.equal(review.independent,true);assert.equal(review.sourceDigest,source.digest);assert.deepEqual(review.packageProof,pkg);assert.deepEqual(review.unresolvedFindings,[]);assert.ok(review.checks.length>=4&&review.checks.every(c=>c.passed===true));
 for(const file of ['scripts/showcase-import-e2e.cjs','scripts/verify-showcase-import.cjs','tests/import-routing.test.cjs','README.md']){const proof=review.scriptProofs.find(p=>p.file===file);assert.ok(proof,'Missing review binding '+file);assert.equal(proof.sha256,hash(fs.readFileSync(path.join(root,file))));}
 console.log('LVX_SHOWCASE_IMPORT_REVIEW_VERIFIED');process.exit(0);
}
const readme=fs.readFileSync(path.join(root,'README.md'),'utf8');assert.ok(readme.includes('Import JSON')&&readme.includes('Import validated project'));assert.equal(require('../package.json').version,'0.7.1');require('./build-ui.cjs').buildUI({check:true});console.log('LVX_SHOWCASE_IMPORT_DELIVERY_VERIFIED');
