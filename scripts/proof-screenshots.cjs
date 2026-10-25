'use strict';
const fs=require('node:fs'),path=require('node:path');
const {root,hash}=require('./source-manifest.cjs');
function preserveScreenshots(label,files){
 if(!/^[a-z-]+$/.test(label))throw Error('Invalid screenshot evidence label');
 const directory=path.join(root,'docs/verification/screenshots',label);fs.mkdirSync(directory,{recursive:true});
 return Object.fromEntries(files.map(file=>{if(path.basename(file)!==file)throw Error('Invalid screenshot name');const bytes=fs.readFileSync(path.join(root,'docs/screenshots',file));fs.writeFileSync(path.join(directory,file),bytes);return [file,{path:'docs/verification/screenshots/'+label+'/'+file,sha256:hash(bytes)}];}));
}
module.exports={preserveScreenshots};
