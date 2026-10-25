'use strict';
// Versioned, independently installable adapter. Protocol: one JSON request on stdin, one JSON result on stdout.
const fs = require('node:fs');
const {execFile} = require('node:child_process');
const util = require('node:util');
const run = util.promisify(execFile);
const VERSION = '1.0.0';
async function scan(request) {
  const findings = [], checks = [], errors = [];
  const finding = (ruleId,severity,message,line=1) => findings.push({ruleId,severity,message,line,path:request.target,scanner:'local-config-v1'});
  const check = (id,condition,severity,message,line=1) => {checks.push(id);if(condition)finding(id,severity,message,line);};
  if(request.mode === 'dockerfile') {
    const source=fs.readFileSync(request.target,'utf8');
    if(source.length>4*1024*1024)throw new Error('Configuration file exceeds 4 MiB');
    const lines=source.split(/\r?\n/), active=lines.map((text,index)=>({text:text.replace(/\s+#.*$/,''),line:index+1})).filter(v=>!/^\s*#/.test(v.text));
    if(!active.some(v=>/^\s*FROM\s+/i.test(v.text)))throw new Error('Not a Dockerfile: missing FROM');
    const users=active.filter(v=>/^\s*USER\s+/i.test(v.text));
    check('DOCKER-NONROOT',!users.length||/^\s*USER\s+(?:root|0)(?:\s|:|$)/i.test(users.at(-1).text),'HIGH','The final container stage runs as root',users.at(-1)?.line||1);
    for(const line of active.filter(v=>/^\s*FROM\s+/i.test(v.text)))check('DOCKER-PIN',!/\bFROM\s+[^\s]+@sha256:[a-f0-9]{64}\b/i.test(line.text),'MEDIUM','Pin base images by a verified digest',line.line);
    for(const line of active)check('DOCKER-SECRET',/^\s*(?:ENV|ARG)\s+\S*(?:PASSWORD|TOKEN|SECRET|API_KEY)\S*\s*(?:=|\s)\s*\S+/i.test(line.text),'HIGH','A build argument or environment variable may contain a credential',line.line);
    if(!checks.length)throw new Error('No supported Dockerfile checks executed');
  } else if(request.mode === 'kubernetes') {
    const source=fs.readFileSync(request.target,'utf8');
    if(source.length>4*1024*1024)throw new Error('Configuration file exceeds 4 MiB');
    // Deliberately bounded textual rules, reported as heuristic, never full Kubernetes schema validation.
    if(!/^\s*apiVersion\s*:/m.test(source)||!/^\s*kind\s*:/m.test(source))throw new Error('Not a Kubernetes manifest: apiVersion/kind missing');
    const lines=source.split(/\r?\n/);
    for(const [i,line] of lines.entries()) {
      check('K8S-PRIVILEGED',/^\s*privileged\s*:\s*true\s*(?:#.*)?$/i.test(line),'CRITICAL','Privileged containers bypass important host isolation',i+1);
      check('K8S-HOSTNETWORK',/^\s*hostNetwork\s*:\s*true\s*(?:#.*)?$/i.test(line),'HIGH','Host networking is enabled',i+1);
      check('K8S-ROOT',/^\s*runAsUser\s*:\s*0\s*(?:#.*)?$/i.test(line),'HIGH','Container user is root',i+1);
      check('K8S-LATEST',/^\s*image\s*:\s*[^#\s]+:latest\s*(?:#.*)?$/i.test(line),'MEDIUM','Image uses a mutable latest tag',i+1);
    }
  } else if(request.mode === 'docker-container') {
    if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(request.target))throw new Error('Invalid container identifier');
    const {stdout}=await run('docker',['inspect','--',request.target],{timeout:10000,windowsHide:true,maxBuffer:4*1024*1024});
    const value=JSON.parse(stdout);if(!Array.isArray(value)||!value.length)throw new Error('Docker returned no container');
    for(const container of value) { check('DOCKER-PRIVILEGED',container.HostConfig?.Privileged===true,'CRITICAL','Container is privileged');check('DOCKER-HOSTNETWORK',container.HostConfig?.NetworkMode==='host','HIGH','Container shares host networking');check('DOCKER-NONROOT',!container.Config?.User||/^(?:0|root)(?::|$)/.test(container.Config.User),'HIGH','Container runs as root'); }
  } else if(request.mode === 'endpoint') {
    const url=new URL(request.target);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Expected credential-free HTTP(S) URL');
    const response=await fetch(url,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(5000)});
    if(response.status>=300&&response.status<400)throw new Error('Redirect requires separate target authorization');
    if(!response.ok)throw new Error(`Endpoint returned HTTP ${response.status}`);
    for(const [header,severity] of [['content-security-policy','MEDIUM'],['x-content-type-options','LOW'],['referrer-policy','LOW']])check('HTTP-'+header.toUpperCase(),!response.headers.get(header),severity,`Missing ${header} response header`);
  } else throw new Error('Adapter supports dockerfile, kubernetes, docker-container and endpoint');
  return {schemaVersion:1,adapter:{id:'local-config-v1',version:VERSION},status:errors.length?'ERROR':findings.length?'FAILURE':'SUCCESS',findings,errors,coverage:{complete:!errors.length,checks:checks.length,rules:[...new Set(checks)],method:request.mode==='docker-container'?'docker-inspect':request.mode==='endpoint'?'http-head':'bounded-text-heuristics',limitations:['These checks cover only the listed rules; they do not prove a target secure.']}};
}
if(require.main===module){let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',data=>{input+=data;if(input.length>5*1024*1024)process.exit(2);});process.stdin.on('end',async()=>{try{process.stdout.write(JSON.stringify(await scan(JSON.parse(input))));}catch(error){process.stdout.write(JSON.stringify({schemaVersion:1,status:'ERROR',findings:[],errors:[error.message],coverage:{complete:false,checks:0}}));process.exitCode=1;}});}
module.exports={scan,VERSION};
