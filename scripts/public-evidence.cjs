'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function sanitizeText(value){
 let text=value;
 for(const prefix of [pathToFileURL(root).href,root,root.replaceAll('\\','/'),encodeURI(root.replaceAll('\\','/'))].sort((a,b)=>b.length-a.length))text=text.replace(new RegExp(escape(prefix),'gi'),'<repository>');
 text=text.replace(/(?:file:\/\/\/)?[A-Z]:[\\/]+Users[\\/]+(?!Public(?:[\\/]|$)|Default(?:[\\/]|$))[^\\/\s"'<>]+/gi,'<user-home>');
 text=text.replace(/\/(?:home|Users)\/(?!shared(?:\/|$))[^/\s"'<>]+/g,'<user-home>');
 text=text.replace(/[A-Z]:[\\/]+0_Webapp[^\\/\r\n"'<>]*[\\/]+[^\\/\r\n"'<>]*ALSTOM/gi,'<workspace-root>');
 return text;
}
function sanitizeData(value){if(typeof value==='string')return sanitizeText(value);if(Array.isArray(value))return value.map(sanitizeData);if(value&&typeof value==='object'){const pairs=Object.entries(value).map(([key,item])=>[sanitizeText(key),sanitizeData(item)]);if(new Set(pairs.map(p=>p[0])).size!==pairs.length)throw Error('Path redaction would collapse distinct object keys; review manually');return Object.fromEntries(pairs);}return value;}
function candidates(){return [...new Set(cp.execFileSync('git',['ls-files','-c','-o','--exclude-standard','-z'],{cwd:root}).toString().split('\0').filter(Boolean))].sort();}
function prepare(){
 const files=candidates(),changed=[];
 for(const file of files.filter(f=>f.startsWith('docs/')&&/\.(?:json|md)$/.test(f))){
  if(fs.lstatSync(path.join(root,file)).isSymbolicLink())throw Error('Review a documentation symlink without reading its target: '+file);
  const original=fs.readFileSync(path.join(root,file)),text=original.toString('utf8');let next;
  if(file.endsWith('.json')){
   const value=JSON.parse(text),clean=sanitizeData(value);if(JSON.stringify(value)===JSON.stringify(clean))continue;
   if(!Array.isArray(clean)&&clean&&typeof clean==='object')clean.publicationNote={kind:'redacted-copy',originalSha256:hash(original),notice:'Local path labels were replaced by portable placeholders for GitHub. Original verification hashes and results bind the raw artifact, retained locally; this public copy is not byte-identical to that artifact.'};
   next=JSON.stringify(clean,null,2)+'\n';
  }else{
   next=text.replace(/\[([^\]]+)\]\(<([^>]+)>\)/g,(all,label,target)=>{
    const portable=sanitizeText(target);if(portable===target)return all;
    const line=/(?:\:)(\d+)$/.exec(portable),withoutLine=line?portable.slice(0,line.index):portable;
    let mapped=withoutLine.replace(/^<repository>\//,'').replace(/^output\/machina-comparison\/machina\//,'apps/lvx-machina/');
    if(files.includes(mapped))return '['+label+']('+path.posix.relative(path.posix.dirname(file),mapped)+(line?'#L'+line[1]:'')+')';
    return label+' (`'+portable+'`; local historical evidence)';
   });next=sanitizeText(next);if(next===text)continue;
   next+='\nPublication note: local machine path labels have been replaced by portable references. The original historical artifact is retained locally.\n';
  }
  const digest=hash(original),backup=path.join(root,'output/publication-originals',digest,file);fs.mkdirSync(path.dirname(backup),{recursive:true});if(!fs.existsSync(backup))fs.writeFileSync(backup,original);else if(hash(fs.readFileSync(backup))!==digest)throw Error('Original evidence backup mismatch');
  fs.writeFileSync(path.join(root,file),next);changed.push({file,originalSha256:digest,publicSha256:hash(Buffer.from(next))});
 }
 fs.mkdirSync(path.join(root,'output'),{recursive:true});fs.writeFileSync(path.join(root,'output/publication-redactions.json'),JSON.stringify(changed,null,2));console.log('PUBLIC_EVIDENCE_PREPARED '+changed.length+' files');return changed;
}
module.exports={root,hash,candidates,sanitizeText,sanitizeData,prepare};
if(require.main===module)prepare();
