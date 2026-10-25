'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const {root,sourceManifest,hash}=require('./source-manifest.cjs'),{verifyPackage}=require('./package-manifest.cjs');
const packageProof=verifyPackage(),metadata=require('../package.json'),installer=path.join(root,'release',`LVX Test Studio Setup ${metadata.version}.exe`),executable=path.join(root,'release/win-unpacked/LVX Test Studio.exe');
const runtime=cp.execFileSync(executable,['-p','process.versions.electron'],{cwd:os.tmpdir(),env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,encoding:'utf8',timeout:30000}).trim();
if(runtime!==metadata.devDependencies.electron)throw Error('Candidate has a stale Electron runtime');
const stat=fs.statSync(installer),archive=fs.statSync(path.join(root,'release/win-unpacked/resources/app.asar'));if(stat.size<1024*1024||stat.mtimeMs+2000<archive.mtimeMs)throw Error('Installer predates the candidate archive');
fs.writeFileSync(path.join(root,'docs/verification/build-results.json'),JSON.stringify({date:new Date().toISOString(),sourceDigest:sourceManifest().digest,version:metadata.version,runtime,packageProof,installerSha256:hash(fs.readFileSync(installer)),installerBytes:stat.size},null,2));console.log('LVX_CURRENT_CANDIDATE_SEALED');
