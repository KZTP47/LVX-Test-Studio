const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const env={...process.env,PLAYWRIGHT_BROWSERS_PATH:path.join(root,'.external/playwright-browsers')};
// Install pure-Python runtime extras locally, never into the user's Python.
const candidates=[process.env.LVX_PYTHON,'python','python3'].filter(Boolean);
let python;
for(const candidate of candidates){const result=spawnSync(candidate,['-c','import sys; assert sys.version_info >= (3,10); print(sys.executable)'],{encoding:'utf8',windowsHide:true});if(result.status===0){python=result.stdout.trim();break;}}
if(!python)throw Error('Install Python 3.10 or later, or set LVX_PYTHON to its executable, then run npm run setup again.');
// Recent Electron packages download their verified runtime lazily on require.
const electronExecutable=require('electron');
require('./windows-runtime-access.cjs').prepareRuntimeAccess(root,path.dirname(electronExecutable));
const extras=spawnSync(python,['-m','pip','install','--disable-pip-version-check','--only-binary=:all:','--upgrade','--target',path.join(root,'.external/python-runtime-packages'),'-r',path.join(__dirname,'python-runtime-requirements.txt')],{cwd:root,stdio:'inherit',windowsHide:true});
if(extras.status!==0)process.exit(extras.status||1);
const playwrightCLI=path.join(path.dirname(require.resolve('playwright/package.json')),'cli.js');
for(const args of [[playwrightCLI,'install','chromium'],[path.join(__dirname,'build-assets.cjs')]]){const r=spawnSync(process.execPath,args,{cwd:root,env,stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);}
console.log('LVX setup complete. npm start launches the desktop application.');
