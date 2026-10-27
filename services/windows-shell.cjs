'use strict';
const path=require('node:path'),{execFileSync}=require('node:child_process');
function windowsEnvironment(extra={}){
 const environment={...process.env,...extra};
 // PowerShell 7's inherited module path can select incompatible assemblies in
 // Windows PowerShell 5.1, or shadow built-in security cmdlets with user modules.
 for(const key of Object.keys(environment))if(key.toLowerCase()==='psmodulepath')delete environment[key];
 return environment;
}
function windowsPowerShell(script,{env={},...options}={}){
 if(process.platform!=='win32')throw Error('Windows PowerShell requires Windows.');
 const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const prelude="$ErrorActionPreference='Stop'; Import-Module -Name (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1') -Force; ";
 return execFileSync(executable,['-NoProfile','-NonInteractive','-Command',prelude+script],{windowsHide:true,encoding:'utf8',timeout:0,...options,env:windowsEnvironment(env)});
}
module.exports={windowsEnvironment,windowsPowerShell};
