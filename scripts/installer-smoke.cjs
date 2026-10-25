'use strict';
// An existing LVX installation is never used as a fixture or uninstalled.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {windowsPowerShell}=require('../services/windows-shell.cjs');
async function run(){
 if(process.platform!=='win32')throw Error('Windows installer verification requires Windows.');
 const packageProof=require('./package-manifest.cjs').verifyPackage();
 const root=path.resolve(__dirname,'..'),build=JSON.parse(fs.readFileSync(path.join(root,'docs/verification/build-results.json'),'utf8'));if(build.sourceDigest!==require('./source-manifest.cjs').sourceManifest().digest||JSON.stringify(build.packageProof)!==JSON.stringify(packageProof))throw Error('Seal the current candidate before installer verification.');
 const existing=windowsPowerShell("@(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'LVX Test Studio' }).Count").trim();
 if(existing!=='0')throw Error('An LVX installation already exists. Use a disposable Windows VM for installer lifecycle verification.');
 const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,installer=path.join(root,'release',`LVX Test Studio Setup ${version}.exe`);if(crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex')!==build.installerSha256)throw Error('Installer changed after candidate sealing.');
 const deadline=Date.now()+5000;let running;do{running=windowsPowerShell("@(Get-Process -Name 'LVX Test Studio' -ErrorAction SilentlyContinue).Count").trim();if(running==='0')break;await new Promise(r=>setTimeout(r,250));}while(Date.now()<deadline);if(running!=='0')throw Error('Close running LVX applications before installer verification; no user process will be closed automatically.');
 const authenticode=windowsPowerShell('[string](Get-AuthenticodeSignature -LiteralPath $env:LVX_SIGNED_FILE).Status',{env:{LVX_SIGNED_FILE:installer}}).trim();
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-installer-')),target=path.join(temp,'application'),report={date:new Date().toISOString(),version,sourceDigest:require('./source-manifest.cjs').sourceManifest().digest,checks:[],packageProof,installerSha256:crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex'),authenticode,signed:authenticode==='Valid'};
 const check=(name,ok)=>{if(!ok)throw Error(name);report.checks.push(name);console.log('PASS',name);};
 const execute=(exe,args)=>{const r=cp.spawnSync(exe,args,{cwd:os.tmpdir(),windowsHide:true,timeout:180000,encoding:'utf8'});if(r.error||r.status!==0)throw Error(`Installer process failed (${r.status}): ${r.error?.message||r.stderr}`);};
 try{
  check('Install target is an isolated temporary directory',path.resolve(target).startsWith(fs.realpathSync(os.tmpdir())+path.sep));
  fs.mkdirSync(target);require('./windows-runtime-access.cjs').prepareRuntimeAccess(temp,target);
  const previous=path.join(root,'release','LVX Test Studio Setup 0.1.0.exe');
  if(version!=='0.1.0'&&fs.existsSync(previous)){execute(previous,['/S','/D='+target]);check('Previous 0.1.0 installer creates an upgrade fixture',fs.existsSync(path.join(target,'LVX Test Studio.exe')));report.previousInstallerSha256=crypto.createHash('sha256').update(fs.readFileSync(previous)).digest('hex');}
  execute(installer,['/S','/D='+target]);check('Silent installer creates the actual executable',fs.existsSync(path.join(target,'LVX Test Studio.exe')));
  const installedArchive=path.join(target,'resources','app.asar');
  const archiveHash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  check('Upgrade installs the verified current application archive',archiveHash(installedArchive)===archiveHash(path.join(root,'release','win-unpacked','resources','app.asar')));
  check('Upgrade installs the verified Electron executable',archiveHash(path.join(target,'LVX Test Studio.exe'))===archiveHash(path.join(root,'release','win-unpacked','LVX Test Studio.exe')));
  const {_electron}=require('playwright'),env={...process.env,LVX_TEST_USER_DATA:path.join(temp,'profile'),LVX_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:path.join(target,'LVX Test Studio.exe'),cwd:os.tmpdir(),env});
  try{const page=await app.firstWindow();await page.waitForFunction(()=>window.LVXStudioInitialized===true);check('Installed application launches with the expected version',await app.evaluate(({app})=>app.getVersion())===version);check('Installed application uses the pinned Electron runtime',await app.evaluate(()=>process.versions.electron)===require('../package.json').devDependencies.electron);check('Installed application starts without seeded tests',await page.evaluate(()=>testSuites.length===0));}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
  execute(installer,['/S','/D='+target]);check('Reinstall preserves a usable executable',fs.statSync(path.join(target,'LVX Test Studio.exe')).size>1024*1024);
  const uninstaller=path.join(target,'Uninstall LVX Test Studio.exe');check('Installer provides an uninstaller',fs.existsSync(uninstaller));execute(uninstaller,['/S']);
  for(let i=0;i<120&&fs.existsSync(path.join(target,'LVX Test Studio.exe'));i++)await new Promise(r=>setTimeout(r,250));
  check('Uninstaller removes the fixture executable',!fs.existsSync(path.join(target,'LVX Test Studio.exe')));
  fs.writeFileSync(path.join(root,'docs/verification/installer-results.json'),JSON.stringify(report,null,2));console.log('LVX_INSTALLER_LIFECYCLE_VERIFIED');
 }finally{
  // Keep failed installations for a deliberate recovery; never recursively erase an installed app.
  if(!fs.existsSync(path.join(target,'LVX Test Studio.exe')))fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:250});
 }
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});module.exports={run};
