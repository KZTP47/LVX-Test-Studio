'use strict';
const crypto=require('node:crypto');
const RULES = [
  {id:'JS-EVAL',language:'javascript',pattern:/\b(?:eval|Function)\s*\(/g,severity:'HIGH',message:'Dynamic code evaluation needs manual review'},
  {id:'JS-HTML',language:'javascript',pattern:/\.innerHTML\s*=/g,severity:'MEDIUM',message:'HTML assignment needs verified sanitization'},
  {id:'PY-SHELL',language:'python',pattern:/shell\s*=\s*True/g,severity:'HIGH',message:'Shell execution needs manual command-input review'},
  {id:'PY-EVAL',language:'python',pattern:/\b(?:exec|eval)\s*\(/g,severity:'HIGH',message:'Dynamic code evaluation needs manual review'},
  {id:'RF-HTTP',language:'robot',pattern:/http:\/\/(?!localhost(?:[:/]|$)|127\.0\.0\.1(?:[:/]|$))[^\s]+/g,severity:'MEDIUM',message:'External HTTP traffic is not encrypted'},
  {id:'SECRET-LITERAL',language:'*',pattern:/(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"\r\n]{8,}['"]/gi,severity:'HIGH',message:'Possible embedded credential; use a protected secret reference'},
  {id:'PRIVATE-KEY',language:'*',pattern:/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,severity:'CRITICAL',message:'Private key material in source'}
];
const fingerprint=finding=>crypto.createHash('sha256').update([finding.ruleId,finding.path.replace(/\\/g,'/'),finding.line,finding.column||1].join('\0')).digest('hex');
function scanSource(files){
  if(!Array.isArray(files)||!files.length)throw new Error('Choose at least one source file');
  const findings=[],errors=[],coverage=[];
  for(const file of files){
    if(typeof file.content!=='string'||file.content.length>2*1024*1024){errors.push(`Source file unavailable or too large: ${file.path}`);continue;}
    const language=file.language||(/\.py$/i.test(file.path)?'python':/\.robot$/i.test(file.path)?'robot':/\.[cm]?[jt]sx?$/i.test(file.path)?'javascript':null);
    if(!['javascript','python','robot'].includes(language)){errors.push(`Unsupported source language: ${file.path}`);continue;}
    const rules=RULES.filter(rule=>rule.language==='*'||rule.language===language);
    coverage.push({path:file.path,language,rules:rules.map(rule=>rule.id),method:'bounded-text-heuristics'});
    for(const rule of rules){rule.pattern.lastIndex=0;for(const match of file.content.matchAll(rule.pattern)){
      const prefix=file.content.slice(0,match.index),line=prefix.split('\n').length,column=match.index-prefix.lastIndexOf('\n');
      const finding={ruleId:rule.id,severity:rule.severity,message:rule.message,path:file.path,line,column,scanner:'source-heuristics-v1'};
      findings.push({...finding,fingerprint:fingerprint(finding)});
    }}
  }
  return {schemaVersion:1,status:errors.length?'ERROR':findings.length?'FAILURE':'SUCCESS',findings,errors,coverage:{complete:errors.length===0,total:files.length,scanned:coverage.length,files:coverage,limitations:['Textual rules are not syntax-aware and may include false positives or miss vulnerabilities. A completed scan is not proof of security.']}};
}
module.exports={scanSource,fingerprint,RULES:RULES.map(({pattern,...rule})=>rule)};
