'use strict';
const fs=require('node:fs'),path=require('node:path'),{root,hash,candidates}=require('./public-evidence.cjs');
function textOf(bytes){try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);return text.includes('\0')?null:text;}catch{return null;}}
function normalized(value){let text=value.replace(/\\u([a-f0-9]{4})/gi,(_,h)=>String.fromCharCode(parseInt(h,16)));for(let i=0;i<3;i++)text=text.replace(/\\\\/g,'\\').replace(/(?:%[a-f0-9]{2})+/gi,s=>{try{return decodeURIComponent(s);}catch{return s;}});return text;}
function findings(file,text){
 const source=normalized(text),result=[];
 const patterns={
  'personal-home-path':/(?:[A-Z]:[\\/]+Users[\\/]+(?!Public(?:[\\/]|$)|Default(?:[\\/]|$)|(?:user|username|example|test)(?:[\\/]|$))[^\\/\s"'<>]+|\/(?:home|Users)\/(?!shared(?:\/|$)|(?:user|username|example|test)(?:\/|$))[^/\s"'<>]+)/gi,
  'personal-workspace-path':/[A-Z]:[\\/]+0_Webapp[^\\/\r\n"'<>]*[\\/]+[^\\/\r\n"'<>]*ALSTOM/gi,
  'provider-token':/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g,
  'private-key':/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
  'credential-in-url':/\b(?:https?|mongodb(?:\+srv)?|postgres(?:ql)?|mysql):\/\/[^\s/@:]+:[^\s/@]+@/gi,
  'literal-credential':/\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret)["']?\s*[:=]\s*(["'])([^"'\r\n]{6,})\1/gi
 };
 for(const [rule,re] of Object.entries(patterns)){let m;while(m=re.exec(source)){result.push({file,rule,line:source.slice(0,m.index).split('\n').length,matchSha256:hash(Buffer.from(m[0]))});}}
 // The current checkout can live anywhere; do not bake its owner's root into policy.
 for(const prefix of [root,root.replaceAll('\\','/')]){const at=source.toLowerCase().indexOf(prefix.toLowerCase());if(at>=0)result.push({file,rule:'checkout-absolute-path',line:source.slice(0,at).split('\n').length,matchSha256:hash(Buffer.from(prefix))});}
 return [...new Map(result.map(f=>[f.file+':'+f.rule+':'+f.line+':'+f.matchSha256,f])).values()];
}
function inventory(){return candidates().map(file=>{if(fs.lstatSync(path.join(root,file)).isSymbolicLink())throw Error('Review a Git symlink without reading its target: '+file);const bytes=fs.readFileSync(path.join(root,file)),text=textOf(bytes);return {file,sha256:hash(bytes),policySha256:text===null?hash(bytes):hash(Buffer.from(text.replace(/\r\n/g,'\n'))),bytes:bytes.length,binary:text===null,findings:text===null?[]:findings(file,text)};});}
function positiveControls(){
 const slash=String.fromCharCode(92),home=['C:','Users','private-owner','project'].join(slash),workspace=['F:','0_Webapp REPO','0000__ALSTOM','private-project'].join(slash),key=['ghp','aB7cD9eF1gH3iJ5kL7mN9pQ1rS3tU5vW7xY9'].join('_');
 for(const value of [home,JSON.stringify(home),encodeURIComponent(home),JSON.stringify(JSON.stringify(home)),workspace,JSON.stringify(workspace),key,['password','=',JSON.stringify('unique-fixture-password')].join(' '),['-----BEGIN','PRIVATE KEY-----'].join(' '),'https:'+'//example:fixture-password@example.invalid'])if(!findings('<positive-control>',value).length)throw Error('Public-file scanner missed a known-positive control');
 if(findings('<negative-control>','Use logs/ relative to the workspace.').length)throw Error('Public-file scanner rejected portable text');return 10;
}
function inspect(policy){
 const files=inventory(),issues=[];for(const item of files){
  if(item.binary){const review=policy.reviewedBinaries.find(r=>r.file===item.file&&r.sha256===item.sha256);if(!review)issues.push({file:item.file,rule:'unreviewed-binary'});}
  for(const finding of item.findings){const known=policy.syntheticMatches.some(r=>r.file===finding.file&&r.rule===finding.rule&&r.matchSha256===finding.matchSha256&&r.fileSha256===item.policySha256);if(!known)issues.push(finding);}
 }
 for(const item of files)if(/^(?:docs\/screenshots|docs\/verification\/screenshots)\//.test(item.file)&&!['docs/screenshots/.gitkeep','docs/verification/screenshots/.gitkeep'].includes(item.file))issues.push({file:item.file,rule:'raw-capture-published'});
 for(const item of files)if(['docs/screenshots/.gitkeep','docs/verification/screenshots/.gitkeep'].includes(item.file)&&item.bytes!==0)issues.push({file:item.file,rule:'nonempty-capture-marker'});
 return {files,issues};
}
module.exports={root,hash,textOf,normalized,findings,inventory,positiveControls,inspect};
if(require.main===module){const items=inventory();fs.mkdirSync(path.join(root,'output'),{recursive:true});fs.writeFileSync(path.join(root,'output/public-file-findings.json'),JSON.stringify(items.flatMap(i=>i.findings),null,2));console.log(JSON.stringify({files:items.length,binary:items.filter(i=>i.binary).length,findings:items.flatMap(i=>i.findings)},null,2));}
