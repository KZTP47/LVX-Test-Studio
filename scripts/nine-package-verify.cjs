'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),asar=require('@electron/asar');
const {root,sourceManifest,hash}=require('./source-manifest.cjs');
function verify(){
 const executable=process.env.LVX_NINE_EXECUTABLE||path.join(root,'release/win-unpacked/LVX Test Studio.exe'),resources=path.join(path.dirname(executable),'resources'),archive=path.join(resources,'app.asar'),source=sourceManifest();
 for(const entry of source.files.filter(e=>e.file!=='package.json'))assert.equal(hash(asar.extractFile(archive,entry.file.split('/').join(path.sep))),entry.sha256,'Stale packaged file: '+entry.file);
 const metadata=JSON.parse(asar.extractFile(archive,'package.json'));
 assert.equal(metadata.version,JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version);
 for(const file of ['playwright-browsers/chromium-1208/chrome-win64/chrome.exe','python-packages/pytest/__init__.py','python-packages/robot/__init__.py'])assert.ok(fs.existsSync(path.join(resources,file)),'Missing packaged runtime: '+file);
 const result={status:'SUCCESS',version:metadata.version,sourceDigest:source.digest,verifiedFiles:source.files.length-1,executableSha256:hash(fs.readFileSync(executable)),asarSha256:hash(fs.readFileSync(archive))};
 fs.mkdirSync(path.join(root,'output/nine-fixes'),{recursive:true});fs.writeFileSync(path.join(root,'output/nine-fixes/package-proof.json'),JSON.stringify(result,null,2)+'\n');console.log('LVX_NINE_PACKAGE_BYTES_VERIFIED');return result;
}
module.exports={verify};if(require.main===module)try{verify();}catch(error){console.error(error);process.exitCode=1;}
