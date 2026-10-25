const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
async function main() {
  require('./build-ui.cjs').buildUI();
  const copy = (from,to) => { fs.mkdirSync(path.dirname(to),{recursive:true}); fs.cpSync(from,to,{recursive:true}); };
  const vendor = path.join(root,'assets/vendor');
  const licenses=path.join(root,'assets/licenses');fs.mkdirSync(licenses,{recursive:true});
  for(const [pkg,name]of [['chart.js','LICENSE.md'],['html2canvas','LICENSE'],['monaco-editor','LICENSE'],['monaco-editor','ThirdPartyNotices.txt']])copy(path.join(root,'node_modules',pkg,name),path.join(licenses,pkg+'-'+name));
  for(const [name,url]of [['pyodide-MPL-2.0.txt','https://raw.githubusercontent.com/pyodide/pyodide/0.24.1/LICENSE'],['sheetjs-LICENSE.txt','https://cdn.sheetjs.com/xlsx-0.20.3/package/LICENSE']]){const file=path.join(licenses,name);if(!fs.existsSync(file)){const response=await fetch(url);if(!response.ok)throw Error('License download failed: '+url);fs.writeFileSync(file,await response.text());}}
  copy(path.join(root,'node_modules/chart.js/dist/chart.umd.js'),path.join(vendor,'chart.umd.js'));
  copy(path.join(root,'node_modules/html2canvas/dist/html2canvas.min.js'),path.join(vendor,'html2canvas.min.js'));
  copy(path.join(root,'node_modules/monaco-editor/min/vs'),path.join(vendor,'monaco/vs'));
  for(const name of ['pyodide.js','pyodide.asm.js','pyodide.asm.wasm','python_stdlib.zip','pyodide-lock.json']) copy(path.join(root,'node_modules/pyodide',name),path.join(vendor,'pyodide',name));
  const lock=JSON.parse(fs.readFileSync(path.join(vendor,'pyodide/pyodide-lock.json'),'utf8')),loaded=new Set();
  async function wheel(name){if(loaded.has(name))return;loaded.add(name);const pkg=lock.packages[name];if(!pkg)throw Error(`Unknown Pyodide package ${name}`);for(const dependency of pkg.depends||[])await wheel(dependency);const file=path.join(vendor,'pyodide',pkg.file_name);if(!fs.existsSync(file)){const res=await fetch('https://cdn.jsdelivr.net/pyodide/v0.24.1/full/'+pkg.file_name);if(!res.ok)throw Error(`Pyodide package ${name}: ${res.status}`);const data=Buffer.from(await res.arrayBuffer());if(crypto.createHash('sha256').update(data).digest('hex')!==pkg.sha256)throw Error('Package integrity mismatch: '+name);fs.writeFileSync(file,data);}}
  await wheel('micropip');await wheel('pytest');
  const robot=path.join(vendor,'python/robotframework-7.3.2-py3-none-any.whl');
  if(!fs.existsSync(robot)){const metadata=await(await fetch('https://pypi.org/pypi/robotframework/7.3.2/json')).json();const pkg=metadata.urls.find(p=>p.filename.endsWith('py3-none-any.whl'));if(!pkg)throw Error('Robot wheel metadata missing');const data=Buffer.from(await(await fetch(pkg.url)).arrayBuffer());if(crypto.createHash('sha256').update(data).digest('hex')!==pkg.digests.sha256)throw Error('Robot wheel integrity mismatch');fs.mkdirSync(path.dirname(robot),{recursive:true});fs.writeFileSync(robot,data);}
  const pinned=JSON.parse(fs.readFileSync(path.join(root,'vendor-lock.json'),'utf8'));
  for(const entry of [pinned.sheetjs,pinned.sheetjsLicense])await require('./vendor-cache.cjs').ensurePinned(path.join(root,entry.path),entry);
  const sheet=path.join(root,pinned.sheetjs.path);
  fs.writeFileSync(path.join(root,'.external-tailwind.css'),'@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');
  execFileSync(process.execPath,[path.join(root,'node_modules/tailwindcss/lib/cli.js'),'-i','.external-tailwind.css','-o','assets/ui.css','--content','./index.html,./*.js','--minify'],{cwd:root,stdio:'inherit'});
  fs.unlinkSync(path.join(root,'.external-tailwind.css'));
  const sharp = require('sharp');
  const frames=[];
  for(const size of [16,24,32,48,64,128,256]) {
    const png = await sharp(path.join(root,'assets/icons/lvx-test-studio.png')).resize(size,size).png().toBuffer();
    fs.writeFileSync(path.join(root,`assets/icons/lvx-${size}.png`),png);
    frames.push({size,png});
  }
  const header=Buffer.alloc(6+16*frames.length); header.writeUInt16LE(1,2); header.writeUInt16LE(frames.length,4);
  let offset=header.length;
  frames.forEach(({size,png},i)=>{const p=6+16*i;header[p]=size===256?0:size;header[p+1]=header[p];header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(png.length,p+8);header.writeUInt32LE(offset,p+12);offset+=png.length;});
  fs.writeFileSync(path.join(root,'assets/icons/lvx-test-studio.ico'),Buffer.concat([header,...frames.map(f=>f.png)]));
  fs.writeFileSync(path.join(vendor,'PROVENANCE.json'),JSON.stringify({generatedBy:'npm run build:assets',sheetjs:{version:pinned.sheetjs.version,source:pinned.sheetjs.url,sha256:crypto.createHash('sha256').update(fs.readFileSync(sheet)).digest('hex')},packages:['chart.js@4.4.0','html2canvas@1.4.1','monaco-editor@0.44.0','pyodide@0.24.1'],licenses:'See node_modules package LICENSE files and THIRD_PARTY_NOTICES.md'},null,2));
  console.log('LVX_ASSETS_BUILT');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
