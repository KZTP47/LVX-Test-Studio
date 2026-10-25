'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const {root,sourceManifest,hash}=require('./source-manifest.cjs');
try{
 const report=JSON.parse(fs.readFileSync(path.join(root,'docs/verification/regression-results.json')));
 assert.equal(report.sourceDigest,sourceManifest().digest,'Regression evidence is stale. Run npm test.');assert.ok(report.tests>600);assert.equal(report.tests,report.pass);assert.equal(report.fail,0);assert.equal(report.skipped,0);
 const files=fs.readdirSync(path.join(root,'tests')).filter(f=>f.endsWith('.test.cjs')).map(f=>'tests/'+f).concat(fs.readdirSync(root).filter(f=>f.endsWith('.test.js')));
 assert.deepEqual(report.files.map(e=>e.file).sort(),files.sort(),'Regression file coverage changed');
 for(const entry of report.files)assert.equal(hash(fs.readFileSync(path.join(root,entry.file))),entry.sha256,'Changed test: '+entry.file);
 const publication=cp.spawnSync(process.execPath,['scripts/verify-repository-contents.cjs','publication'],{cwd:root,encoding:'utf8',windowsHide:true});process.stdout.write(publication.stdout||'');process.stderr.write(publication.stderr||'');assert.equal(publication.status,0,'Publication guard failed');
 const remote=cp.execFileSync('git',['remote','get-url','origin'],{cwd:root,encoding:'utf8'}).trim();assert.equal(remote,'https://github.com/KZTP47/LVX-Test-Studio.git');
 console.log('LVX_NINE_REGRESSION_VERIFIED');
}catch(error){console.error(error);process.exitCode=1;}
