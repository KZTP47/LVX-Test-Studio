'use strict';
// Local publication guard. Audits never grant publication approval.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const publicFiles=require('./public-files.cjs');
const DEFAULT_ROOT=path.resolve(__dirname,'..');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const zero=oid=>/^0+$/.test(oid);
const canonical=value=>JSON.stringify(value);
function exec(root,args,input){
 const result=cp.spawnSync('git',args,{cwd:root,input,encoding:'buffer',windowsHide:true,maxBuffer:128*1024*1024});
 if(result.error||result.status!==0)throw Error('Git operation failed: '+args[0]);
 return result.stdout;
}
function inside(parent,child){const rel=path.relative(parent,child);return rel===''||!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);}
function safeDirectory(dir){
 const resolved=path.resolve(dir);let current=path.parse(resolved).root;
 for(const part of resolved.slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);if(fs.existsSync(current)){if(fs.lstatSync(current).isSymbolicLink())throw Error('Linked private state directory refused');}else fs.mkdirSync(current);}
 return resolved;
}
function writeJSON(file,value){
 safeDirectory(path.dirname(file));if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw Error('Linked state file refused');
 const temp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temp,file);
}
function readJSON(file){if(fs.lstatSync(file).isSymbolicLink())throw Error('Linked state file refused');return JSON.parse(fs.readFileSync(file,'utf8'));}
function denied(file){
 const name=file.replaceAll('\\','/');
 return /(^|\/)(?:AGENTS\.md|GATES[^/]*\.md|\.my_save_files|0_PERSISTENT_memory|\.obsidian|\.lvx)(?:\/|$)/i.test(name)||
 /(?:^|\/)pipeline_suites_export_[^/]*\.json$|\.lvx\.json$/i.test(name)||
 ['docs/capacity-changes.md','scripts/import-connected-apis.cjs','scripts/inspect-connected-apis.cjs'].includes(name.toLowerCase())||
 /^(?:docs\/screenshots|docs\/verification\/screenshots)\/(?!\.gitkeep$)/.test(name);
}
function extraFindings(text){
 const source=publicFiles.normalized(text),result=[];
 const rules={
  'absolute-path':/(?<![\w])(?:[A-Z]:[\\/]+(?![bnrstwd]\b)[^\s"'<>|?*\x00]{2,180}|\/(?:home|Users)\/[^\s"'<>]{2,180})/gi,
  'email-address':/(?<![\w.+-])[A-Z0-9_.+-]{1,64}@[A-Z0-9.-]+\.[A-Z]{2,20}\b/gi,
  'jwt':/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
 };
 for(const [rule,re]of Object.entries(rules))for(const m of source.matchAll(re)){
  if(rule==='email-address'){const domain=m[0].split('@').pop().toLowerCase();if(['example.com','example.org','example.net','test.com'].includes(domain)||/\.(?:example|test|invalid)$/.test(domain))continue;}
  result.push({rule,line:source.slice(0,m.index).split('\n').length,matchSha256:hash(m[0])});
 }
 return result;
}
function guard(root=DEFAULT_ROOT){
 root=fs.realpathSync(root);if(fs.realpathSync(exec(root,['rev-parse','--show-toplevel']).toString().trim())!==root)throw Error('Run at the owning Git root');
 const gitDir=exec(root,['rev-parse','--absolute-git-dir']).toString().trim(),state=path.join(gitDir,'privacy-guard');
 const configFile=path.join(state,'config.json'),latestFile=path.join(state,'latest.json'),approvalFile=path.join(state,'approval.json');
 const blobs=new Map();
 const blob=oid=>{if(!blobs.has(oid))blobs.set(oid,exec(root,['cat-file','blob',oid]));return blobs.get(oid);};
 function preload(entries){
  const needed=[...new Set(entries.filter(x=>!x.data&&x.oid&&['100644','100755'].includes(x.mode)&&!blobs.has(x.oid)).map(x=>x.oid))];if(!needed.length)return;
  const output=exec(root,['cat-file','--batch'],Buffer.from(needed.join('\n')+'\n'));let at=0;
  for(const oid of needed){const end=output.indexOf(10,at);if(end<0)throw Error('Incomplete Git blob batch');const [actual,type,sizeText]=output.subarray(at,end).toString().split(' '),size=Number(sizeText),start=end+1;if(actual!==oid||type!=='blob'||!Number.isSafeInteger(size)||size<0||start+size>=output.length||output[start+size]!==10)throw Error('Invalid Git blob batch');blobs.set(oid,output.subarray(start,start+size));at=start+size+1;}
 }
 let policyMemo,reviewMemo,baselineBlobs;
 const policy=()=>policyMemo??=readJSON(path.join(root,'public-files-policy.json'));
 const reviews=()=>reviewMemo??=(fs.existsSync(path.join(root,'privacy-findings-policy.json'))?readJSON(path.join(root,'privacy-findings-policy.json')):{reviewed:[],reviewedHistory:[]});
 function config(){const value=readJSON(configFile),scanRoot=fs.realpathSync(value.scanRoot);if(value.repoRoot!==root||![root,path.dirname(root)].includes(scanRoot)||scanRoot===path.parse(scanRoot).root)throw Error('Scan-root binding mismatch');return {...value,scanRoot};}
 function ignored(files){if(!files.length)return new Set();const r=cp.spawnSync('git',['check-ignore','--no-index','-z','--stdin'],{cwd:root,input:Buffer.from(files.join('\0')+'\0'),windowsHide:true});if(![0,1].includes(r.status))throw Error('Ignore check failed');return new Set(r.stdout.toString().split('\0').filter(Boolean));}
 function entriesFromIndex(){return exec(root,['ls-files','--stage','-z']).toString().split('\0').filter(Boolean).map(row=>{const at=row.indexOf('\t'),meta=row.slice(0,at),file=row.slice(at+1);const [mode,oid,stage]=meta.split(' ');if(stage!=='0')throw Error('Resolve index conflicts before publication');return {file,mode,oid};});}
 function entriesFromCommit(oid){return exec(root,['ls-tree','-r','-z',oid]).toString().split('\0').filter(Boolean).map(row=>{const at=row.indexOf('\t'),meta=row.slice(0,at),file=row.slice(at+1);const [mode,type,object]=meta.split(' ');return {file,mode,oid:object,type};});}
 function knownBlob(entry){
  if(!entry.oid)return false;
  if(!baselineBlobs){baselineBlobs=new Set();for(const record of reviews().reviewedHistory)for(const item of entriesFromCommit(record.commit))baselineBlobs.add(item.file+'\0'+item.oid);}
  return baselineBlobs.has(entry.file+'\0'+entry.oid);
 }
 function allowed(file,sha256,policySha256,finding){
  const p=policy(),r=reviews();
  if(p.syntheticMatches.some(x=>x.file===file&&x.fileSha256===policySha256&&x.rule===finding.rule&&x.matchSha256===finding.matchSha256))return true;
  if(finding.rule==='jwt'&&p.gitleaksExamples.some(x=>x.file===file&&x.rule==='jwt'&&x.outerSha256===policySha256&&x.line===finding.line))return true;
  return r.reviewed.some(x=>x.file===file&&x.sha256===sha256&&x.rule===finding.rule&&x.matchSha256===finding.matchSha256&&typeof x.reason==='string'&&x.reason.length>15);
 }
 function assess(entries,{legacy=false}={}){
  const hidden=ignored(entries.map(x=>x.file)),issues=[],p=policy();
  preload(entries);
  for(const entry of entries){
   if(/[\x00-\x1f\x7f]/.test(entry.file)){issues.push({file:JSON.stringify(entry.file),rule:'control-character-in-filename'});continue;}
   if(denied(entry.file)||hidden.has(entry.file)){issues.push({file:entry.file,rule:'private-file-in-git'});continue;}
   if(!['100644','100755'].includes(entry.mode)){issues.push({file:entry.file,rule:'link-or-submodule-requires-review'});continue;}
   const bytes=entry.data||blob(entry.oid),sha256=hash(bytes),text=publicFiles.textOf(bytes);
   if(text===null){if(!p.reviewedBinaries.some(x=>x.file===entry.file&&x.sha256===sha256))issues.push({file:entry.file,rule:'unreviewed-binary',sha256});continue;}
   const policySha256=hash(text.replace(/\r\n/g,'\n'));
   let value;try{value=JSON.parse(text);}catch{}
   if(value&&typeof value==='object'&&(value.format==='lvx-workspace'||typeof value.exported_at==='string'&&['test_suites','pipelines'].some(k=>Array.isArray(value[k])))){
    const finding={rule:'portable-project-save',matchSha256:sha256};if(!allowed(entry.file,sha256,policySha256,finding))issues.push({...finding,file:entry.file,sha256});
   }
   for(const f of [...publicFiles.findings(entry.file,text),...extraFindings(text)]){
    // Historical baselines were independently audited. Private filenames and
    // first-party home paths remain prohibited even in baseline commits.
    if((legacy||knownBlob(entry))&&!(f.rule==='personal-home-path'&&!entry.file.startsWith('assets/vendor/')))continue;
    if(!allowed(entry.file,sha256,policySha256,f))issues.push({...f,file:entry.file,sha256});
   }
  }
  return issues;
 }
 function identity(){
  const expected=readJSON(path.join(root,'package.json')).author;
  for(const kind of ['GIT_AUTHOR_IDENT','GIT_COMMITTER_IDENT']){
   const ident=exec(root,['var',kind]).toString(),match=/^(.+) <([^>]+)> /.exec(ident);
   if(!match||match[1]!==expected||!/@users\.noreply\.github\.com$/i.test(match[2]))throw Error('Use the public maintainer handle and GitHub noreply email for new commits');
  }
 }
 function preCommit(){const issues=assess(entriesFromIndex());if(issues.length)throw Error('Commit blocked; unreviewed staged content: '+canonical(issues.slice(0,12)));identity();console.log('LVX_PRIVATE_INDEX_VERIFIED');}
 function outgoing(localOid,remoteOid){
  if(!/^[a-f0-9]{40,64}$/.test(localOid)||!/^([a-f0-9]{40,64})$/.test(remoteOid))throw Error('Invalid push object');
  const args=['rev-list',localOid];if(!zero(remoteOid)){exec(root,['cat-file','-e',remoteOid+'^{commit}']);args.push('^'+remoteOid);}
  const commits=exec(root,args).toString().trim().split(/\s+/).filter(Boolean),known=new Set(reviews().reviewedHistory.map(x=>x.commit)),issues=[];
  for(const commit of new Set([localOid,...commits])){
   issues.push(...assess(entriesFromCommit(commit),{legacy:known.has(commit)}).map(x=>({...x,commit})));
   if(!known.has(commit)){
    const metadata=exec(root,['show','-s','--format=%an%n%ae%n%cn%n%ce%n%B',commit]).toString(),[an,ae,cn,ce,...message]=metadata.split('\n'),expected=readJSON(path.join(root,'package.json')).author;
    if(an!==expected||cn!==expected||![ae,ce].every(x=>/@users\.noreply\.github\.com$/i.test(x)))issues.push({commit,rule:'private-commit-identity'});
    for(const f of [...publicFiles.findings('<commit-message>',message.join('\n')),...extraFindings(message.join('\n'))])issues.push({...f,commit,file:'<commit-message>'});
   }
  }
  return issues;
 }
 function scanner(){const file=path.join(state,'tools','gitleaks.exe');if(!fs.existsSync(file)||hash(fs.readFileSync(file))!==policy().scanner.executableSha256)throw Error('Pinned Gitleaks scanner missing or changed; reinstall it before audit');return file;}
 function python(report,snapshot){const c=config(),args=[path.join(root,'scripts','privacy-scan.py'),'--root',c.scanRoot,'--repo',root,'--report',report];if(snapshot)args.push('--snapshot');const r=cp.spawnSync(c.python||'python',args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});if(r.error||r.status!==0)throw Error('Full-tree inventory incomplete; inspect the local inventory errors');return readJSON(report);}
 function gitleaks(dir,mode){
  const report=path.join(dir,'gitleaks-'+mode+'.json'),log=path.join(dir,'gitleaks-'+mode+'.log'),c=config(),env={...process.env};delete env.GITLEAKS_CONFIG;delete env.GITLEAKS_CONFIG_TOML;
  const configPath=path.join(dir,'default.toml'),ignore=path.join(dir,'empty.ignore');fs.writeFileSync(configPath,'[extend]\nuseDefault = true\n');fs.writeFileSync(ignore,'');
  const r=cp.spawnSync(scanner(),[mode==='history'?'git':'dir','.',...(mode==='history'?['--log-opts=--all']:[]),'--config',configPath,'--gitleaks-ignore-path',ignore,'--ignore-gitleaks-allow','--max-archive-depth=0','--redact=100','--no-banner','--report-format','json','--report-path',report],{cwd:mode==='history'?root:c.scanRoot,env,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
  fs.writeFileSync(log,(r.stdout||'')+(r.stderr||''));if(r.error||![0,1].includes(r.status)||/\bERR\b/.test(r.stderr||'')||!fs.existsSync(report))throw Error('Gitleaks did not complete; publication remains blocked');return readJSON(report);
 }
 function workCandidates(){return [...new Set(exec(root,['ls-files','-c','-o','--exclude-standard','-z']).toString().split('\0').filter(Boolean))].sort();}
 function currentHead(){return exec(root,['rev-parse','HEAD']).toString().trim();}
 function currentBranch(){return exec(root,['symbolic-ref','--quiet','HEAD']).toString().trim();}
 function reportAt(id){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid report id');return path.join(state,'reports',id,'report.json');}
 function remoteFingerprint(remote){const url=exec(root,['remote','get-url','--push',remote]).toString().trim();if(!/^(?:https:\/\/github\.com\/[^\s?#:@]+\/[^\s?#:@]+|git@github\.com:[^\s?#:@]+\/[^\s?#:@]+|ssh:\/\/git@github\.com\/[^\s?#:@]+\/[^\s?#:@]+)$/.test(url))throw Error('Review the GitHub push destination; credential URLs are prohibited');return hash(url);}
 function audit(){
  scanner();config();safeDirectory(state);const lock=path.join(state,'audit.lock'),fd=fs.openSync(lock,'wx');
  let attemptedId,attemptedDir;
  try{
   const id=attemptedId=crypto.randomUUID(),dir=attemptedDir=safeDirectory(path.join(state,'reports',id)),inventory=python(path.join(dir,'inventory.json'),false),p=policy(),r=reviews(),c=config(),candidates=workCandidates(),set=new Set(candidates),fileMap=new Map(inventory.files.filter(f=>f.repoFile).map(f=>[f.repoFile,f])),outerMap=new Map(inventory.files.map(f=>[f.file,f])),textHashes=new Map();
   const issues=assess(candidates.map(file=>({file,mode:fs.lstatSync(path.join(root,file)).isSymbolicLink()?'120000':'100644',data:fs.lstatSync(path.join(root,file)).isSymbolicLink()?Buffer.alloc(0):fs.readFileSync(path.join(root,file))})));
   for(const f of inventory.findings){const outer=f.file.split('!')[0],entry=outerMap.get(outer);if(!entry?.repoFile||!set.has(entry.repoFile))continue;
    if(f.file.includes('!')&&p.reviewedBinaries.some(x=>x.file===entry.repoFile&&x.sha256===entry.sha256))continue;
    if(!textHashes.has(entry.repoFile)){const text=publicFiles.textOf(fs.readFileSync(path.join(root,entry.repoFile)));textHashes.set(entry.repoFile,text===null?entry.sha256:hash(text.replace(/\r\n/g,'\n')));}const policySha256=textHashes.get(entry.repoFile);
    if(!allowed(entry.repoFile,entry.sha256,policySha256,f))issues.push({...f,file:entry.repoFile,sha256:entry.sha256});
   }
   const localLeaks=gitleaks(dir,'local'),historyLeaks=gitleaks(dir,'history');
   for(const finding of localLeaks){const absolute=path.resolve(c.scanRoot,finding.File.split('!')[0]);if(!inside(root,absolute))continue;const file=path.relative(root,absolute).split(path.sep).join('/');if(!set.has(file))continue;const entry=fileMap.get(file),text=publicFiles.textOf(fs.readFileSync(absolute)),policySha256=text===null?entry.sha256:hash(text.replace(/\r\n/g,'\n'));
    if(!p.gitleaksExamples.some(x=>x.file===file&&x.rule===finding.RuleID&&x.line===finding.StartLine&&x.outerSha256===policySha256))issues.push({file,rule:'gitleaks:'+finding.RuleID,line:finding.StartLine});
   }
   for(const finding of historyLeaks){
    let known=p.historyExamples.some(x=>x.fingerprint===finding.Fingerprint);
    if(!known&&/^[a-f0-9]{40,64}$/.test(finding.Commit||'')){
     const file=finding.File.split('!')[0],bytes=exec(root,['show',finding.Commit+':'+file]),text=publicFiles.textOf(bytes),digest=text===null?hash(bytes):hash(text.replace(/\r\n/g,'\n'));
     known=p.gitleaksExamples.some(x=>x.file===finding.File&&x.rule===finding.RuleID&&x.line===finding.StartLine&&x.outerSha256===digest);
    }
    if(!known)issues.push({file:finding.File,rule:'history:'+finding.RuleID,line:finding.StartLine});
   }
   const refs=exec(root,['for-each-ref','--format=%(refname) %(objectname)']).toString();
   const history=exec(root,['rev-list','--all']).toString().trim().split(/\s+/).filter(Boolean);for(const commit of history)issues.push(...outgoing(commit,commit));
   const ignoredCandidates=ignored(candidates);if(ignoredCandidates.size)issues.push(...[...ignoredCandidates].map(file=>({file,rule:'ignored-file-already-tracked'})));
   const unique=[...new Map(issues.map(x=>[canonical([x.file,x.commit,x.rule,x.line,x.matchSha256]),x])).values()];
   const readme=fs.readFileSync(path.join(root,'README.md'),'utf8'),readmeImages=[...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)|<img[^>]+src="([^"]+)"/g)].map(x=>x[1]||x[2]);
   const summary={id,created:new Date().toISOString(),status:unique.length?'NEEDS_WORK':'AWAITING_USER_DECISION',candidateCommitted:exec(root,['status','--porcelain=v1','-z']).length===0,head:currentHead(),branch:currentBranch(),treeDigest:inventory.treeDigest,refsDigest:hash(refs),configDigest:hash(canonical(c)),counts:{localFiles:inventory.files.length,bytes:inventory.files.reduce((n,f)=>n+f.bytes,0),candidates:candidates.length,localFindings:inventory.findings.length,archives:inventory.archives.length},issues:unique,readmeImages,withheldFindings:inventory.findings.filter(f=>{const e=outerMap.get(f.file.split('!')[0]);return !e?.repoFile||!set.has(e.repoFile);}),images:inventory.files.filter(f=>f.image).map(f=>({file:f.file,sha256:f.sha256,eligible:!!f.repoFile&&set.has(f.repoFile),readmeLinked:readmeImages.includes(f.repoFile)})),limitations:['No scanner proves complete anonymity or detects every personal name or image pixel.','Review new images, arbitrary personal/business data, encoded/encrypted content and Git metadata manually.','Existing GitHub objects and earlier public author credits are not erased by ignore rules.','Local Git hooks can be bypassed; direct API uploads must follow the same user-approval workflow.'],historyNotes:r.historyNotes||[]};
   // A second complete hash pass prevents approval of an inconsistent audit.
   const finalSnapshot=python(path.join(dir,'final-snapshot.json'),true);if(finalSnapshot.treeDigest!==inventory.treeDigest||refs!==exec(root,['for-each-ref','--format=%(refname) %(objectname)']).toString())throw Error('Local tree or Git history changed during audit; rerun it');
   writeJSON(reportAt(id),summary);writeJSON(latestFile,{id});
   const withheldRules={};for(const finding of summary.withheldFindings)withheldRules[finding.rule]=(withheldRules[finding.rule]||0)+1;
   const protectedFiles=inventory.files.filter(f=>denied(f.repoFile||f.file)).map(f=>f.file),imageCounts={eligible:summary.images.filter(x=>x.eligible).length,local:summary.images.filter(x=>!x.eligible).length};
   const lines=['LVX publication privacy report',summary.status,'Report: '+id,'',`Local files: ${summary.counts.localFiles}; bytes: ${summary.counts.bytes}; candidates: ${summary.counts.candidates}; archives: ${summary.counts.archives}.`,`Unresolved publication findings: ${unique.length}. Withheld/local findings: ${summary.withheldFindings.length}.`,`Candidate committed: ${summary.candidateCommitted}. Images: ${imageCounts.eligible} eligible, ${imageCounts.local} withheld/local.`,...(summary.candidateCommitted?[]:['This is a working-tree review. Prepare the authorized local candidate commit and rerun the final audit before asking the user to approve an upload.']),'',...unique.map(x=>`${JSON.stringify(x.file||'<commit>')}${x.line?':'+x.line:''} — ${x.rule}`),'','Private deny-listed local files preserved on disk:',...protectedFiles.map(x=>JSON.stringify(x)),'','Withheld/local findings by rule (values are never included):',canonical(withheldRules),'Full per-file hashes, findings, archives and image inventory are in the adjacent JSON reports. Findings in dependencies or compiled browsers are not automatically attributed to personal accounts.','',`Reviewed exact bindings: ${p.syntheticMatches.length} source fixtures, ${r.reviewed.length} additional generic/system/upstream references, ${p.reviewedBinaries.length} binary assets. Unknown or changed bytes are not covered.`,'','Agent decisions required:','For each finding, inspect imports, build inputs and runtime use. Ignore only proven nonessential local files; preserve their bytes. Sanitize required code/configuration, then test the affected behavior. Never replace an operational secret with another hardcoded secret. Rerun this full audit after remediation.','',...summary.historyNotes,'',...summary.limitations,'','No upload is authorized by this report. Return it to the user and wait for their decision. Approval requires a clean committed candidate and the exact report id.'];
   fs.writeFileSync(path.join(dir,'report.txt'),lines.join('\n')+'\n');console.log('Report: '+path.join(dir,'report.txt'));console.log(summary.status+' ('+unique.length+' unresolved)');return summary;
  }catch(error){
   if(attemptedDir){writeJSON(reportAt(attemptedId),{id:attemptedId,status:'INCOMPLETE',issues:[{rule:'audit-incomplete'}],reason:error.message});writeJSON(latestFile,{id:attemptedId});fs.writeFileSync(path.join(attemptedDir,'report.txt'),'INCOMPLETE — publication blocked\n'+error.message+'\nNo upload is authorized. Inspect the local scanner/inventory errors and rerun the audit.\n');console.error('Incomplete report: '+path.join(attemptedDir,'report.txt'));}
   throw error;
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
 }
 function verifyReport(report){
  const c=config();scanner();if(report.status!=='AWAITING_USER_DECISION'||report.issues.length)throw Error('Resolve findings and rerun the audit before approval');
  if(readJSON(latestFile).id!==report.id)throw Error('Only the latest complete report can be approved or published');
  const check=path.join(state,'snapshot-'+crypto.randomUUID()+'.json');try{const current=python(check,true);if(current.treeDigest!==report.treeDigest||currentHead()!==report.head||currentBranch()!==report.branch||hash(exec(root,['for-each-ref','--format=%(refname) %(objectname)']).toString())!==report.refsDigest||hash(canonical(c))!==report.configDigest)throw Error('Reviewed files, history or configuration changed; a new audit and user decision are required');}finally{if(fs.existsSync(check))fs.unlinkSync(check);}
  if(exec(root,['status','--porcelain=v1','-z']).length)throw Error('Commit the intended candidate locally, rerun audit, and return the exact report to the user before approving');
 }
 function approve(id,remote='origin',userApproved=false){
  if(!userApproved)throw Error('Explicit user approval of this report is required');const report=readJSON(reportAt(id));verifyReport(report);
  const receipt={reportId:id,reportSha256:hash(fs.readFileSync(reportAt(id))),head:report.head,branch:report.branch,remote,remoteFingerprint:remoteFingerprint(remote),approvedAt:new Date().toISOString()};writeJSON(approvalFile,receipt);console.log('Approval recorded for exactly this report, commit and destination. No upload performed.');return receipt;
 }
 function prePush(remote,url,input){
  const rows=input.trim().split('\n').filter(Boolean).map(x=>x.trim().split(/\s+/));if(rows.length!==1||rows[0].length!==4)throw Error('Approve one branch update at a time; deletions and tags require separate review');
  const [localRef,localOid,remoteRef,remoteOid]=rows[0];if(zero(localOid)||!localRef.startsWith('refs/heads/')||remoteRef!==localRef)throw Error('Only the explicitly reviewed branch update is supported');
  const issues=outgoing(localOid,remoteOid);if(issues.length)throw Error('Push blocked by outgoing commit content: '+canonical(issues.slice(0,12)));
  if(!fs.existsSync(approvalFile)){
   if(!fs.existsSync(latestFile))audit();throw Error('Push blocked: return the local audit report to the user and obtain their explicit decision');
  }
  const receipt=readJSON(approvalFile),report=readJSON(reportAt(receipt.reportId));
  if(receipt.head!==localOid||receipt.branch!==localRef||receipt.remote!==remote||receipt.remoteFingerprint!==hash(url)||receipt.remoteFingerprint!==remoteFingerprint(remote)||receipt.reportSha256!==hash(fs.readFileSync(reportAt(receipt.reportId))))throw Error('Approval does not match this push');
  verifyReport(report);identity();console.log('LVX_REVIEWED_PUSH_VERIFIED');
 }
 function install({scanRoot=root,scannerPath,identityFromHead=false}={}){
  scanRoot=fs.realpathSync(scanRoot);if(![root,path.dirname(root)].includes(scanRoot))throw Error('Scan root must be this repository or its immediate workspace parent');
  const existing=cp.spawnSync('git',['config','--local','--get','core.hooksPath'],{cwd:root,encoding:'utf8'});if(existing.status===0&&existing.stdout.trim()!=='.githooks')throw Error('Existing hooksPath preserved; integrate these hooks explicitly before proceeding');
  const defaultHooks=path.join(gitDir,'hooks');for(const name of ['pre-commit','pre-push'])if(fs.existsSync(path.join(defaultHooks,name)))throw Error('Existing default hook preserved; integrate it before installing');
  if(!scannerPath||hash(fs.readFileSync(scannerPath))!==policy().scanner.executableSha256)throw Error('Supply the verified pinned Gitleaks executable with --scanner');
  let publicIdentity;if(identityFromHead){const [name,email]=exec(root,['log','-1','--format=%an%n%ae']).toString().trim().split('\n');if(name!==readJSON(path.join(root,'package.json')).author||!/@users\.noreply\.github\.com$/i.test(email))throw Error('HEAD does not supply an approved public identity');publicIdentity={name,email};}
  safeDirectory(path.join(state,'tools'));const target=path.join(state,'tools','gitleaks.exe');if(path.resolve(scannerPath)!==path.resolve(target))fs.copyFileSync(scannerPath,target);writeJSON(configFile,{repoRoot:root,scanRoot,python:'python'});
  for(const hook of ['pre-commit','pre-push'])fs.chmodSync(path.join(root,'.githooks',hook),0o755);
  exec(root,['config','--local','core.hooksPath','.githooks']);
  if(publicIdentity){exec(root,['config','--local','user.name',publicIdentity.name]);exec(root,['config','--local','user.email',publicIdentity.email]);}
  console.log('Local privacy hooks installed. Audits and explicit user approval remain required.');
 }
 return {root,state,denied,assess,outgoing,preCommit,prePush,install,audit,approve,verifyReport,entriesFromIndex};
}
module.exports={guard,denied,extraFindings,hash};
if(require.main===module){
 const [mode,...args]=process.argv.slice(2),value=flag=>{const at=args.indexOf(flag);return at>=0?args[at+1]:undefined;};
 try{const g=guard();if(mode==='install')g.install({scanRoot:path.resolve(g.root,value('--scan-root')||'.'),scannerPath:value('--scanner'),identityFromHead:args.includes('--identity-from-head')});else if(mode==='audit')g.audit();else if(mode==='pre-commit')g.preCommit();else if(mode==='pre-push')g.prePush(args[0],args[1],fs.readFileSync(0,'utf8'));else if(mode==='approve')g.approve(args[0],value('--remote')||'origin',args.includes('--user-approved'));else throw Error('Choose install, audit, pre-commit, pre-push or approve');}catch(error){console.error('LVX PRIVACY BLOCK: '+error.message);process.exitCode=1;}
}
