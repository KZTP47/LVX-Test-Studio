const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {sourceManifest,hash,root}=require('./source-manifest.cjs');
const asar=require('@electron/asar');
try{
 const archive=path.join(root,'release/win-unpacked/resources/app.asar');
 for(const entry of sourceManifest().files.filter(e=>e.file!=='package.json'))assert.equal(hash(asar.extractFile(archive,entry.file.split('/').join(path.sep))),entry.sha256,`Stale/corrupt packaged file: ${entry.file}`);
 assert.ok(fs.existsSync(path.join(root,'release/win-unpacked/resources/playwright-browsers/chromium-1208/chrome-win64/chrome.exe')),'Missing packaged Chromium');
 for(const name of ['pytest','robot'])assert.ok(fs.existsSync(path.join(root,'release/win-unpacked/resources/python-packages',name,'__init__.py')),'Missing packaged native Python extras: '+name);
 const pythonRoot=path.join(root,'.external/python-runtime-packages'),packagedPython=path.join(root,'release/win-unpacked/resources/python-packages');
 function verifyPython(directory=''){for(const item of fs.readdirSync(path.join(pythonRoot,directory),{withFileTypes:true})){if(item.name==='__pycache__'||(!directory&&item.name==='bin')||item.name.endsWith('.pyc'))continue;const relative=path.join(directory,item.name);if(item.isDirectory())verifyPython(relative);else assert.equal(hash(fs.readFileSync(path.join(packagedPython,relative))),hash(fs.readFileSync(path.join(pythonRoot,relative))),'Stale packaged Python extra: '+relative);}}verifyPython();
 console.log('PACKAGED_SOURCE_HASHES_VERIFIED');
 require('./e2e.cjs').run({packaged:true}).catch(e=>{console.error(e);process.exitCode=1;});
}catch(e){console.error(e);process.exitCode=1;}
