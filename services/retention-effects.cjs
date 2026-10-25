'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
async function applyRetentionEffects(summary,{workspaceRoot,getWorkspaceRoot,execution,restoreBaselines}={}){
 const bound=()=>{if(!workspaceRoot||workspaceRoot!==getWorkspaceRoot())throw Error('Workspace changed during retained-evidence cleanup. Reopen this project to reconcile its evidence.');};bound();
 const result={deletedNativeRuns:[],deletedBaselineFiles:[],absentBaselineFiles:[],warnings:[]};
 if(summary.deletedRunIds?.length){
  const runs=await execution.handle('runs',{});bound();const actual=Array.isArray(runs)?runs:runs.runs||[],byId=new Map(actual.map(r=>[r.id,r]));
  const ids=summary.deletedRunIds.filter(id=>byId.has(id)&&!['RUNNING','PENDING'].includes(byId.get(id).status));
  if(ids.length)result.deletedNativeRuns=(await execution.handle('pruneRuns',{ids,workspaceRoot})).deletedRunIds;
 }
 if(summary.changedBaselineArchives?.length){bound();await restoreBaselines({replace:true});bound();}
 for(const item of summary.deletedScreenshotFiles||[]){
  bound();if(!/^\.lvx[\\/]baselines[\\/][a-f0-9]{64}\.png$/.test(item.path||'')||!/^[a-f0-9]{64}$/.test(item.sha256||''))throw Error('Invalid managed screenshot cleanup identity.');
  const filename=path.resolve(workspaceRoot,item.path),relative=path.relative(workspaceRoot,filename);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Screenshot cleanup escaped its workspace.');
  let cursor=workspaceRoot;for(const part of relative.split(path.sep)){cursor=path.join(cursor,part);if(fs.existsSync(cursor)&&fs.lstatSync(cursor).isSymbolicLink())throw Error('A linked screenshot cleanup path was preserved.');}
  if(!fs.existsSync(filename)){result.absentBaselineFiles.push(item.path);continue;}
  const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.nlink!==1)throw Error('A non-regular or shared screenshot file was preserved.');
  const digest=crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');if(digest!==item.sha256){result.warnings.push('A screenshot changed after cleanup planning and was preserved: '+item.path);continue;}
  fs.unlinkSync(filename);result.deletedBaselineFiles.push(item.path);
 }
 return result;
}
module.exports={applyRetentionEffects};
