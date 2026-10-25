const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),files=fs.readdirSync(root).filter(f=>/\.(js|html)$/.test(f)&&!f.endsWith('.test.js'));
const source=files.map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n');
const ids=new Set([...source.matchAll(/\bid\s*=\s*['"]([^'"]+)['"]/g)].map(m=>m[1]));
for(const f of files.filter(f=>f.endsWith('.js'))){const missing=[...new Set([...fs.readFileSync(path.join(root,f),'utf8').matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map(m=>m[1]))].filter(id=>!ids.has(id));if(missing.length)console.log(f+': '+missing.join(', '));}
