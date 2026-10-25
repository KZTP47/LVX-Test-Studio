'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {root,sourceManifest,hash}=require('./source-manifest.cjs');
function packageIdentity(){return {asarSha256:hash(fs.readFileSync(path.join(root,'release/win-unpacked/resources/app.asar'))),executableSha256:hash(fs.readFileSync(path.join(root,'release/win-unpacked/LVX Test Studio.exe')))};}
function verifyPackage(){
 const asar=require('@electron/asar'),archive=path.join(root,'release/win-unpacked/resources/app.asar');
 for(const entry of sourceManifest().files.filter(e=>e.file!=='package.json'))assert.equal(hash(asar.extractFile(archive,entry.file.split('/').join(path.sep))),entry.sha256,'Stale/corrupt packaged source: '+entry.file);
 const metadata=JSON.parse(asar.extractFile(archive,'package.json').toString());assert.equal(metadata.version,require('../package.json').version);assert.equal(metadata.license,'MIT');return packageIdentity();
}
module.exports={packageIdentity,verifyPackage};
