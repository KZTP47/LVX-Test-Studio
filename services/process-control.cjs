'use strict';
const {execFile}=require('node:child_process');
const path=require('node:path');
async function stopProcessTree(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode) return;
  if (process.platform !== 'win32') {try {process.kill(-child.pid,'SIGKILL');} catch {child.kill('SIGKILL');} return;}
  const windowsRoot=path.resolve(process.env.SystemRoot || '');
  if (!/^[A-Za-z]:\\Windows$/i.test(windowsRoot) || windowsRoot.toLowerCase() !== path.resolve(process.env.WINDIR || '').toLowerCase()) throw Error('Windows process cleanup path could not be verified.');
  await new Promise((resolve,reject)=>execFile(path.join(windowsRoot,'System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:5000},error=>{
    if (!error || child.exitCode !== null || child.signalCode) resolve(); else reject(Error('The adapter process could not be stopped.'));
  }));
}
module.exports={stopProcessTree};
