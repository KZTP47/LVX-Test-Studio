'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const dir=path.resolve(__dirname,'../release'),requireSigned=process.argv.includes('--require-signed');
const candidate=`LVX Test Studio Setup ${require('../package.json').version}.exe`;
const files=fs.readdirSync(dir).filter(n=>requireSigned?n===candidate:n.endsWith('.exe'));
if(!files.length)throw Error('No installer artifacts found.');
for(const name of files)if(requireSigned){
 const state=require('../services/windows-shell.cjs').windowsPowerShell('[string](Get-AuthenticodeSignature -LiteralPath $env:LVX_SIGNED_FILE).Status',{env:{LVX_SIGNED_FILE:path.join(dir,name)}}).trim();
 if(state!=='Valid')throw Error('Release candidate is not signed by a trusted publisher.');
}
fs.writeFileSync(path.join(dir,'SHA256SUMS.txt'),files.sort().map(n=>crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,n))).digest('hex')+'  '+n).join('\n')+'\n');
console.log('LVX_CHECKSUMS_VERIFIED');
