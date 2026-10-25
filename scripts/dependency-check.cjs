'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {root,sourceManifest,hash}=require('./source-manifest.cjs');
const cli=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const result=cp.spawnSync(process.execPath,[cli,'audit','--json'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:8*1024*1024});
if(result.error)throw result.error;
let audit;try{audit=JSON.parse(result.stdout);}catch{throw Error('Dependency audit returned no usable JSON; it cannot pass.');}
const counts=audit.metadata?.vulnerabilities;if(!counts||audit.error)throw Error('Dependency audit coverage unavailable; it cannot pass.');
const report={date:new Date().toISOString(),sourceDigest:sourceManifest().digest,lockSha256:hash(fs.readFileSync(path.join(root,'package-lock.json'))),packageSha256:hash(fs.readFileSync(path.join(root,'package.json'))),vulnerabilities:counts,status:result.status===0&&counts.total===0?'SUCCESS':'FINDINGS',versions:JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).devDependencies,boundary:'Current npm advisory database and resolved package-lock graph. A zero count is not a guarantee against undisclosed vulnerabilities.'};
fs.writeFileSync(path.join(root,'docs/verification/dependency-results.json'),JSON.stringify(report,null,2)+'\n');
if(report.status!=='SUCCESS')throw Error('Known dependency advisories remain: '+counts.total);
console.log('LVX_DEPENDENCY_AUDIT_VERIFIED');
