'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const {root,sourceManifest}=require('./source-manifest.cjs');
const git=(...args)=>cp.execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
try{
 assert.equal(git('branch','--show-current'),'main');assert.equal(git('remote','get-url','origin'),'https://github.com/KZTP47/LVX-Test-Studio.git');assert.equal(git('remote','get-url','--push','origin'),'https://github.com/KZTP47/LVX-Test-Studio.git');
 const head=git('rev-parse','HEAD'),remote=git('ls-remote','origin','refs/heads/main').split(/\s+/)[0];assert.equal(remote,head,'Public main does not contain this delivery');assert.equal(git('status','--porcelain'),'','Delivery has uncommitted public files');
 const digest=sourceManifest().digest;for(const mode of ['source','packaged']){const report=JSON.parse(fs.readFileSync(path.join(root,'output/nexus-parity',mode+'.json')));assert.equal(report.status,'SUCCESS');assert.equal(report.sourceDigest,digest,mode+' verification is stale');}
 cp.execFileSync(process.execPath,['scripts/nine-regression-verify.cjs'],{cwd:root,stdio:'inherit',windowsHide:true});const proof=require('./nine-package-verify.cjs').verify();assert.equal(proof.sourceDigest,digest);
 fs.writeFileSync(path.join(root,'output/nexus-parity/delivery.json'),JSON.stringify({status:'SUCCESS',commit:head,publicMain:remote,sourceDigest:digest,version:JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,verifiedAt:new Date().toISOString()},null,2));console.log('LVX_NEXUS_DELIVERY_VERIFIED');
}catch(error){console.error(error.stack);process.exitCode=1;}
