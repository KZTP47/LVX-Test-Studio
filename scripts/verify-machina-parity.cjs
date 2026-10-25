'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const {root,sourceManifest,hash}=require('./source-manifest.cjs');
const read=name=>fs.readFileSync(path.join(root,name),'utf8'),json=name=>JSON.parse(read(name));
function current(name){const report=json('docs/verification/'+name);assert.equal(report.sourceDigest||report.source?.digest,sourceManifest().digest,'Stale evidence: '+name);const script=name.startsWith('machina-e2e')?'scripts/machina-e2e.cjs':name.startsWith('roadmap-')&&name.includes('results')?'scripts/roadmap-e2e.cjs':['desktop-results.json','e2e-results.json'].includes(name)?'scripts/e2e.cjs':null;if(script)assert.equal(report.testScriptSha256,hash(fs.readFileSync(path.join(root,script))),'Verification script drift: '+name);return report;}
function reportValid(report){assert.equal(report.status,'SUCCESS');assert.ok(report.checks.length>10);assert.equal(report.errors?.length||0,0);}
function regression(){const report=current('regression-results.json');assert.equal(report.fail,0);assert.equal(report.skipped,0);assert.ok(report.tests>0);assert.equal(report.pass,report.tests);for(const file of report.files)assert.equal(hash(fs.readFileSync(path.join(root,file.file))),file.sha256,'Regression test drift: '+file.file);console.log('LVX_CURRENT_REGRESSION_VERIFIED');}
function parity(){
 const original=read('apps/lvx-machina/visual-editor.js'),old=[...new Set([...original.matchAll(/data-type="([a-z-]+)"/g)].map(m=>m[1]))].sort();
 const catalog=require('../services/machina-catalog.cjs').nodes.map(n=>n.id).sort();assert.deepEqual(catalog,old);
 const Graph=require('../graph-engine.js');assert.ok(catalog.every(type=>Graph.nodeTypes().includes(type)));
 const manifest=json('apps/lvx-machina/IMPORT-MANIFEST.json');for(const file of manifest.files)assert.equal(hash(fs.readFileSync(path.join(root,'apps/lvx-machina',file.file))),file.sha256,'Historical import changed: '+file.file);
 const census=json('docs/verification/machina-feature-census.json');assert.equal(new Set(census.features.map(f=>f.id)).size,census.features.length);assert.ok(census.features.length>=40);
 for(const feature of census.features){assert.ok(feature.implementation.length&&feature.evidence.length,feature.id);for(const file of [...feature.implementation,...feature.evidence])assert.ok(fs.existsSync(path.join(root,file)),feature.id+': '+file);}
 const source=current('machina-e2e-results.json');reportValid(source);const regression=current('regression-results.json');assert.equal(regression.fail,0);assert.equal(regression.skipped,0);assert.equal(regression.pass,regression.tests);
 for(const item of regression.files)assert.equal(hash(fs.readFileSync(path.join(root,item.file))),item.sha256,'Test changed: '+item.file);
 for(const name of ['machina-runtime.json','machina-graph.json','machina-data.json','machina-retention.json']){const leaf=json('docs/verification/'+name);const entries=leaf.sourceManifest||leaf.sourceHashes||(typeof leaf.sourceSHA256==='object'?leaf.sourceSHA256:null)||leaf.sourceSha256;assert.ok(entries&&Object.keys(entries).length>0,name+' source bindings');const pairs=Array.isArray(entries)?entries.map(e=>[e.file,e.sha256]):Object.entries(entries);for(const [file,digest]of pairs)assert.equal(hash(fs.readFileSync(path.join(root,file))),typeof digest==='string'?digest:digest.sha256,name+' source changed: '+file);}
 console.log('LVX_MACHINA_PARITY_VERIFIED');
}
function release(){
 const packaged=current('machina-e2e-packaged-results.json');reportValid(packaged);assert.deepEqual(packaged.packageProof,require('./package-manifest.cjs').verifyPackage());
 const build=current('build-results.json'),installer=current('installer-results.json'),clean=current('clean-room-results.json');assert.equal(clean.status,'SUCCESS');assert.ok(clean.commands.every(c=>c.exitCode===0));assert.ok(clean.resultFiles['machina-e2e-results.json']);for(const [name,report]of Object.entries(clean.resultFiles)){assert.equal(report.sourceDigest||report.source?.digest,sourceManifest().digest,'Stale clean-directory result: '+name);assert.equal(report.fail||0,0);assert.equal(report.skipped||0,0);assert.equal((report.errors||report.rendererErrors||[]).length,0);if(name==='regression-results.json'){assert.equal(report.pass,report.tests);for(const file of report.files)assert.equal(hash(fs.readFileSync(path.join(root,file.file))),file.sha256,'Clean regression script drift: '+file.file);}else{const script=name.startsWith('machina')?'scripts/machina-e2e.cjs':name.startsWith('roadmap')?'scripts/roadmap-e2e.cjs':'scripts/e2e.cjs';assert.equal(report.testScriptSha256,hash(fs.readFileSync(path.join(root,script))),'Clean E2E script drift: '+name);}}assert.equal(installer.installerSha256,build.installerSha256);
 const file=path.join(root,'release','LVX Test Studio Setup '+require('../package.json').version+'.exe');assert.equal(hash(fs.readFileSync(file)),build.installerSha256);assert.ok(read('release/SHA256SUMS.txt').includes(build.installerSha256));
 for(const name of ['e2e-results.json','desktop-results.json','roadmap-e2e-results.json','roadmap-desktop-results.json']){const report=current(name);assert.equal((report.errors||report.rendererErrors||[]).length,0);assert.ok(report.checks.length>10);if(report.packaged)assert.deepEqual(report.packageProof,require('./package-manifest.cjs').verifyPackage());}
 for(const image of packaged.screenshots)assert.equal(hash(fs.readFileSync(path.join(root,image.file))),image.sha256);
 assert.ok(read('README.md').includes('docs/MACHINA-MIGRATION.md'));assert.ok(read('docs/MACHINA-MIGRATION.md').includes('unsigned'));
 console.log('LVX_MACHINA_RELEASE_VERIFIED');
}
function remote(){
 const run=(exe,args,encoding='utf8')=>cp.execFileSync(exe,args,{cwd:root,encoding,windowsHide:true,maxBuffer:64*1024*1024});
 const repo=JSON.parse(run('gh',['repo','view',require('./repository-identity.cjs').currentRepository(root),'--json','visibility,defaultBranchRef,url']));assert.equal(repo.visibility,'PRIVATE');
 const branch=repo.defaultBranchRef.name,sha=run('git',['ls-remote','origin','refs/heads/'+branch]).split(/\s/)[0];assert.match(sha,/^[a-f0-9]{40}$/);run('git',['fetch','--quiet','origin',branch]);run('git',['merge-base','--is-ancestor','abb5714e5111bb9ca9d45267ad2cb2b46ac4d17f',sha]);
 for(const entry of sourceManifest().files)assert.equal(hash(run('git',['show',sha+':'+entry.file],null)),entry.sha256,'Remote maintained source differs: '+entry.file);
 const receipt={verifiedAt:new Date().toISOString(),repository:repo.url,visibility:repo.visibility,defaultBranch:branch,commit:sha,importCommit:'abb5714e5111bb9ca9d45267ad2cb2b46ac4d17f',sourceDigest:sourceManifest().digest};const receiptFile=path.join(root,'docs/verification/machina-remote-receipt.json');const previous=fs.existsSync(receiptFile)?JSON.parse(fs.readFileSync(receiptFile,'utf8')):null;if(previous&&Object.keys(receipt).filter(key=>key!=='verifiedAt').every(key=>previous[key]===receipt[key]))receipt.verifiedAt=previous.verifiedAt;fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2)+'\n');console.log('LVX_MACHINA_REMOTE_VERIFIED');
}
function judge(){
 const report=current('machina-independent-review.json');assert.equal(report.verdict,'APPROVED');assert.equal(report.independent,true);assert.equal(report.readOnlyImplementation,true);assert.ok(report.reviewerHandle&&report.reviewerHandle!=='/root');assert.equal((report.unresolvedFindings||[]).length,0);assert.ok(report.checks?.length>0);assert.ok(report.coverage?.length>0);assert.ok(report.externalLimits?.length>0);
 for(const file of report.reviewedFiles||[])assert.equal(hash(fs.readFileSync(path.join(root,file.file))),file.sha256,'Reviewed source drift: '+file.file);
 console.log('LVX_INDEPENDENT_JUDGE_VERIFIED');
}
const actions={parity,regression,release,remote,judge};try{const action=process.argv[2];assert.ok(actions[action],'Choose parity, release, remote or judge');actions[action]();}catch(error){console.error(error);process.exitCode=1;}
