'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const {root,sourceManifest}=require('./source-manifest.cjs');
const git=(...args)=>cp.execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
try{
 assert.equal(git('branch','--show-current'),'main');
 for(const args of [['remote','get-url','origin'],['remote','get-url','--push','origin']])assert.equal(git(...args),'https://github.com/KZTP47/LVX-Test-Studio.git');
 const digest=sourceManifest().digest;
 for(const mode of ['source','packaged']){const receipt=JSON.parse(fs.readFileSync(path.join(root,'output/flow-corrections',mode+'.json')));assert.equal(receipt.status,'SUCCESS');assert.equal(receipt.sourceDigest,digest,mode+' flow evidence is stale');}
 cp.execFileSync(process.execPath,['scripts/nine-regression-verify.cjs'],{cwd:root,stdio:'inherit',windowsHide:true});
 const packageProof=require('./nine-package-verify.cjs').verify();assert.equal(packageProof.sourceDigest,digest);
 for(const leaf of ['audit-private','audit-paths','judge'])cp.execFileSync(process.execPath,['.unlazy/flow-corrections-20261026/'+leaf+'/verify.cjs'],{cwd:root,stdio:'inherit',windowsHide:true});
 const head=git('rev-parse','HEAD'),remote=git('ls-remote','origin','refs/heads/main').split(/\s+/)[0];assert.equal(remote,head,'Public main differs from the reviewed delivery');assert.equal(git('status','--porcelain'),'','Public delivery has uncommitted files');
 fs.mkdirSync(path.join(root,'output/flow-corrections'),{recursive:true});fs.writeFileSync(path.join(root,'output/flow-corrections/delivery.json'),JSON.stringify({status:'SUCCESS',commit:head,publicMain:remote,sourceDigest:digest,version:packageProof.version,verifiedAt:new Date().toISOString()},null,2));
 console.log('LVX_FLOW_DELIVERY_VERIFIED');
}catch(error){console.error(error.stack);process.exitCode=1;}
