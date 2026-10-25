'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),cp=require('node:child_process');
const {windowsEnvironment,windowsPowerShell}=require('../services/windows-shell.cjs');
test('Windows signature shell drops inherited module paths without mutating the parent environment',()=>{
 const before={...process.env},environment=windowsEnvironment({PSModulePath:'incompatible-core-modules',psmodulepath:'another-shadow',LVX_FIXTURE:'literal value'});
 const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
 assert.equal(Object.keys(environment).some(key=>key.toLowerCase()==='psmodulepath'),false);assert.equal(environment.LVX_FIXTURE,'literal value');assert.equal(digest({...process.env}),digest(before),'Parent environment changed');
});
test('Actual Windows security cmdlet rejects an unsigned fixture despite inherited module-path shadowing',()=>{
 assert.equal(process.platform,'win32','Windows release verification requires Windows');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-signature-proof-')),file=path.join(directory,'unsigned fixture.ps1');fs.writeFileSync(file,'Write-Output "unsigned test fixture"\n');
 try{
  const state=windowsPowerShell('[string](Get-AuthenticodeSignature -LiteralPath $env:LVX_FIXTURE).Status',{env:{PSModulePath:path.join(directory,'not-a-module-path'),LVX_FIXTURE:file}}).trim();assert.equal(state,'NotSigned');
  const bytes=fs.readFileSync(file),manifest={bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
  const {verifyArtifact}=require('../services/release-policy.cjs');assert.throws(()=>verifyArtifact(file,manifest,{publisher:'CN=Unsigned fixture'}),/publisher signature is not trusted/);assert.equal(verifyArtifact(file,manifest,{requireAuthenticode:false}).verified,true);
 }finally{assert.equal(path.dirname(directory),os.tmpdir());fs.rmSync(directory,{recursive:true,force:true});}
});
test('Pinned Playwright setup uses the actual CLI file rather than an unexported package subpath',()=>{
 const manifest=require('playwright/package.json'),cli=path.join(path.dirname(require.resolve('playwright/package.json')),'cli.js'),result=cp.spawnSync(process.execPath,[cli,'--version'],{encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr);assert.ok(result.stdout.includes(manifest.version));
 const setup=fs.readFileSync(path.join(__dirname,'../scripts/setup.cjs'),'utf8');assert.equal(setup.includes("require.resolve('playwright/cli')"),false);assert.ok(setup.includes("require.resolve('playwright/package.json')"));
});
