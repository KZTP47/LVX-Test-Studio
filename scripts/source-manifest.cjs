const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
function sourceManifest(){
 const files=fs.readdirSync(root).filter(f=>f.endsWith('.js')&&!f.endsWith('.test.js')).concat(['index.html','styles.css','package.json']);
 const walk=dir=>{for(const item of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const name=dir+'/'+item.name;if(item.isDirectory())walk(name);else files.push(name);}};walk('services');walk('assets');
 const entries=files.sort().map(file=>({file,sha256:hash(fs.readFileSync(path.join(root,file)))}));return{digest:hash(JSON.stringify(entries)),files:entries};
}
module.exports={sourceManifest,hash,root};
