'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const {root,sourceManifest}=require('./source-manifest.cjs');
const mode=process.argv[2]||'source';assert.ok(['source','packaged'].includes(mode));
const env={...process.env};if(mode==='packaged')env.LVX_NEXUS_EXECUTABLE=path.join(root,'release/win-unpacked/LVX Test Studio.exe');else delete env.LVX_NEXUS_EXECUTABLE;
const before=sourceManifest().digest;
for(const file of ['nexus-graph-e2e.cjs','nexus-board-e2e.cjs','nexus-import-e2e.cjs','nexus-recovery-e2e.cjs']){const result=cp.spawnSync(process.execPath,[path.join('scripts',file)],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:240000});process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');assert.equal(result.status,0,file+' failed');}
if(mode==='packaged'){process.env.LVX_NINE_EXECUTABLE=env.LVX_NEXUS_EXECUTABLE;require('./nine-package-verify.cjs').verify();}
assert.equal(sourceManifest().digest,before,'Source changed during verification');const report={status:'SUCCESS',mode,sourceDigest:before,verifiedAt:new Date().toISOString(),providerVerification:'Local HTTP provider fixtures; live accounts not exercised'};fs.mkdirSync(path.join(root,'output/nexus-parity'),{recursive:true});fs.writeFileSync(path.join(root,'output/nexus-parity',mode+'.json'),JSON.stringify(report,null,2));console.log(mode==='source'?'LVX_NEXUS_SOURCE_VERIFIED':'LVX_NEXUS_PACKAGED_VERIFIED');
