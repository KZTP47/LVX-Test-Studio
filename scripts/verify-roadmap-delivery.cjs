'use strict';
// Validate current receipts rather than promoting historical green test counts.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {root,sourceManifest,hash}=require('./source-manifest.cjs');
const digest=sourceManifest().digest;
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const report=name=>read('docs/verification/'+name+'.json');
function regression(){
 const r=report('regression-results');assert.equal(r.sourceDigest,digest,'Stale regression receipt');
 assert.ok(r.tests>0);assert.equal(r.pass,r.tests);assert.equal(r.fail,0);assert.equal(r.skipped,0);
 const actual=fs.readdirSync(path.join(root,'tests')).filter(n=>n.endsWith('.test.cjs')).map(n=>'tests/'+n).concat(fs.readdirSync(root).filter(n=>n.endsWith('.test.js'))).sort();
 assert.deepEqual(r.files.map(e=>e.file).sort(),actual,'New regression file omitted');
 for(const f of r.files)assert.equal(hash(fs.readFileSync(path.join(root,f.file))),f.sha256,'Stale test: '+f.file);
 console.log('LVX_CURRENT_REGRESSION_VERIFIED',r.pass);
 return r.pass;
}
function runtime(){
 const counts={};
 for(const name of ['e2e-results','desktop-results','roadmap-e2e-results','roadmap-desktop-results']){
  const r=report(name);assert.equal(r.sourceDigest||r.source?.digest,digest,'Stale '+name);
  assert.ok(r.checks.length>0);assert.deepEqual(r.errors||r.rendererErrors,[]);
  if(r.externalRequests)assert.deepEqual(r.externalRequests,[]);
  if(r.packaged)assert.deepEqual(r.packageProof,require('./package-manifest.cjs').packageIdentity(),'Runtime receipt belongs to another binary');
  assert.ok(r.screenshotProof&&Object.keys(r.screenshotProof).length>=3,'Missing preserved screenshot evidence');
  for(const proof of Object.values(r.screenshotProof))assert.equal(hash(fs.readFileSync(path.join(root,proof.path))),proof.sha256,'Changed screenshot evidence');
  counts[name]=r.checks.length;
 }
 console.log('LVX_CURRENT_RUNTIME_VERIFIED',JSON.stringify(counts));return counts;
}
function distribution(){
 const version=read('package.json').version,r=report('installer-results');
 assert.equal(r.version,version);assert.equal(r.sourceDigest,digest);
 assert.ok(r.checks.some(c=>c.includes('Uninstaller removes')));assert.ok(r.checks.some(c=>c.includes('Upgrade installs')));
 const installer=path.join(root,'release',`LVX Test Studio Setup ${version}.exe`);
 assert.equal(hash(fs.readFileSync(installer)),r.installerSha256,'Installer changed after lifecycle test');
 const build=report('build-results');assert.equal(build.sourceDigest,digest);assert.equal(build.installerSha256,r.installerSha256);assert.deepEqual(r.packageProof,build.packageProof);assert.deepEqual(build.packageProof,require('./package-manifest.cjs').packageIdentity());
 const icon=report('icon-results');assert.equal(icon.sourceDigest,digest);assert.equal(icon.executableSha256,build.packageProof.executableSha256);assert.equal(hash(fs.readFileSync(path.join(root,icon.path))),icon.sha256);
 assert.ok(fs.readFileSync(path.join(root,'release/SHA256SUMS.txt'),'utf8').includes(r.installerSha256+'  '+path.basename(installer)));
 const asar=require('@electron/asar'),archive=path.join(root,'release/win-unpacked/resources/app.asar');
 for(const entry of sourceManifest().files.filter(e=>e.file!=='package.json'))assert.equal(hash(asar.extractFile(archive,entry.file.split('/').join(path.sep))),entry.sha256,'Stale package '+entry.file);
 assert.ok(asar.extractFile(archive,'LICENSE').toString().startsWith('MIT License'));
 console.log('LVX_CURRENT_DISTRIBUTION_VERIFIED',version,r.authenticode);return {version,sha256:r.installerSha256,authenticode:r.authenticode,packageProof:build.packageProof,icon};
}
function clean(){
 const r=report('clean-room-results');assert.equal(r.sourceDigest,digest);assert.equal(r.status,'SUCCESS');
 assert.ok(r.commands.length>=7);for(const c of r.commands)assert.equal(c.exitCode,0,c.command);
 for(const [name,p]of Object.entries(r.resultFiles)){assert.equal(p.sourceDigest||p.source?.digest,digest,'Clean-room source mismatch: '+name);}
 console.log('LVX_LOCAL_CLEAN_ROOM_RECEIPT_VERIFIED');return r.date;
}
function catalog(){
 const statuses=report('roadmap-status'),items=report('future-work-catalog');assert.equal(items.length,30);assert.equal(Object.keys(statuses).length,30);
 const counts={verified:0,external:0};for(let n=1;n<=30;n++){
  const id='FW-'+String(n).padStart(2,'0'),s=statuses[id];assert.ok(s,id);assert.equal(s.sourceDigest,digest);
  assert.ok(['VERIFIED','EXTERNAL PREREQUISITE'].includes(s.status),'Unsettled '+id);
  if(s.status==='VERIFIED')counts.verified++;else{assert.ok(s.remaining.trim());counts.external++;}
 }
 const mirror=path.resolve(root,'..','LVX Test Studio, future work','2026-10-24');
 for(const name of fs.readdirSync(path.join(root,'docs/roadmap')).filter(n=>n.endsWith('.md')))assert.equal(fs.readFileSync(path.join(root,'docs/roadmap',name),'utf8'),fs.readFileSync(path.join(mirror,name),'utf8'),'Roadmap mirror drift');
 for(const name of ['LICENSE','README.md','CONTRIBUTING.md','SECURITY.md','CHANGELOG.md','docs/SUPPORT.md','docs/api/studio.d.ts','.github/ISSUE_TEMPLATE/bug.yml','.github/workflows/verify.yml','.github/workflows/release.yml'])assert.ok(fs.statSync(path.join(root,name)).size>100,name);
 require('./build-ui.cjs').buildUI({check:true});
 console.log('LVX_ROADMAP_RECONCILIATION_VERIFIED',JSON.stringify(counts));return counts;
}
function documentation(){
 const r=report('readme-results');assert.equal(r.sourceDigest,digest);assert.equal(r.packaged,true);assert.deepEqual(r.packageProof,require('./package-manifest.cjs').packageIdentity());const md=fs.readFileSync(path.join(root,'README.md'),'utf8');
 for(const [file,proof]of Object.entries(r.screenshotProof)){assert.ok(md.includes('docs/screenshots/'+file),'README omits measured screenshot');assert.equal(hash(fs.readFileSync(path.join(root,proof.path))),proof.sha256);assert.equal(hash(fs.readFileSync(path.join(root,'docs/screenshots',file))),proof.sha256);}
 const contrast=report('contrast-results');assert.equal(contrast.sourceDigest,digest);assert.ok(contrast.checks.length>=14);assert.ok(contrast.checks.every(c=>c.minimumRatio>=4.5));
 console.log('LVX_CURRENT_DOCUMENTATION_VERIFIED');return {screenshots:r.screenshotProof,minimumButtonContrast:Math.min(...contrast.checks.map(c=>c.minimumRatio))};
}
function dependencies(){const r=report('dependency-results');assert.equal(r.sourceDigest,digest);assert.equal(r.status,'SUCCESS');assert.equal(r.vulnerabilities.total,0);assert.equal(r.lockSha256,hash(fs.readFileSync(path.join(root,'package-lock.json'))));assert.equal(r.packageSha256,hash(fs.readFileSync(path.join(root,'package.json'))));console.log('LVX_CURRENT_DEPENDENCIES_VERIFIED');return r.vulnerabilities;}
function vendor(){const actual=require('./check-vendor.cjs').checkVendor(),receipt=report('vendor-results');assert.equal(receipt.sourceDigest,digest);assert.equal(receipt.lockSha256,actual.lockSha256);assert.equal(receipt.sha256,actual.sha256);console.log('LVX_CURRENT_VENDOR_VERIFIED');return actual;}
function recoveryEvidence(){
 const r=report('roadmap-recovery');assert.equal(r.counts.fail,0);assert.equal(r.counts.pass,r.counts.tests);assert.deepEqual(r.sourceDrift,[]);
 const capture=r.scenarios.find(s=>s.screenshot);assert.ok(capture);const filename=path.resolve(capture.screenshot),temporary=require('node:os').tmpdir();assert.equal(path.dirname(filename),path.resolve(temporary));assert.match(path.basename(filename),/^lvx-recovery-validated-\d+\.png$/);
 const destination='docs/verification/screenshots/recovery/validated.png',absolute=path.join(root,destination);const bytes=fs.readFileSync(fs.existsSync(filename)?filename:absolute);assert.equal(hash(bytes),capture.screenshotSha256);fs.mkdirSync(path.dirname(absolute),{recursive:true});fs.writeFileSync(absolute,bytes);
 return {path:destination,sha256:capture.screenshotSha256,tests:r.counts.tests,keyboard:capture.keyboard,zoom200:capture.zoom200};
}
function all(){const r={date:new Date().toISOString(),sourceDigest:digest,regression:regression(),runtime:runtime(),distribution:distribution(),cleanRoom:clean(),roadmap:catalog(),documentation:documentation(),dependencies:dependencies(),vendor:vendor(),recoveryEvidence:recoveryEvidence(),external:Object.entries(report('roadmap-status')).filter(([,s])=>s.status==='EXTERNAL PREREQUISITE').map(([id,s])=>({id,reason:s.remaining}))};fs.writeFileSync(path.join(root,'docs/verification/final-delivery-results.json'),JSON.stringify(r,null,2)+'\n');console.log('LVX_LOCAL_DELIVERY_VERIFIED');}
const actions={regression,runtime,distribution,clean,catalog,documentation,all};
try{const action=process.argv[2]||'all';assert.ok(actions[action],'Unknown verification action');actions[action]();}catch(error){console.error(error);process.exitCode=1;}
