'use strict';
const crypto = require('node:crypto');

function inventory(content, format) {
  if (typeof content !== 'string' || content.length > 32 * 1024 * 1024) throw new Error('Inventory input must be text below 32 MiB');
  const packages = new Map(), unresolved = [];
  const add = (ecosystem, name, version, location) => {
    const exact = ecosystem === 'npm'
      ? /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(String(version))
      : /^(?:\d+!)?\d+(?:\.\d+)*(?:(?:a|b|rc|post|dev)\d+|\.(?:post|dev)\d+)*(?:\+[a-zA-Z0-9.]+)?$/.test(String(version));
    if (!name || !version || !exact) { unresolved.push({name: name || 'unknown', location, reason: 'Exact resolved version unavailable'}); return; }
    const key = `${ecosystem}:${name.toLowerCase()}@${version}`;
    if (!packages.has(key)) packages.set(key, {id:key, ecosystem, name, version:String(version), locations:[]});
    packages.get(key).locations.push(location);
  };
  const json = () => { try { return JSON.parse(content); } catch { throw new Error('Invalid inventory JSON'); } };
  if (format === 'package-lock') {
    const value = json();
    if(value.packages) {
      for(const [location, pkg] of Object.entries(value.packages)) {
        if (!location) continue;
        if (pkg.link) { unresolved.push({name:pkg.name || location,location,reason:'Linked dependency requires its own resolved inventory'}); continue; }
        add('npm', pkg.name || location.split('node_modules/').pop(), pkg.version, location);
      }
    } else {
      const walk = (deps, prefix='dependencies') => { for(const [name,pkg] of Object.entries(deps || {})) { add('npm',name,pkg.version,`${prefix}/${name}`); walk(pkg.dependencies,`${prefix}/${name}/dependencies`); } }; walk(value.dependencies);
    }
  } else if (format === 'cyclonedx') {
    const value=json(); if(value.bomFormat !== 'CycloneDX') throw new Error('Not a CycloneDX SBOM');
    const walk=items=>{for(const item of items||[]){
      if(item.type !== 'file') {
        const purl = /pkg:(npm|pypi)\/([^@?#]+)@([^?#]+)/.exec(item.purl || '');
        if(purl) add(purl[1]==='pypi'?'PyPI':'npm',decodeURIComponent(purl[2]),decodeURIComponent(purl[3]),item['bom-ref'] || item.name);
        else if(item.name) unresolved.push({name:item.name,reason:'Supported npm/PyPI package URL is required',location:item['bom-ref']||item.name});
      } walk(item.components);
    }}; walk(value.components);
  } else if (format === 'requirements') {
    content.split(/\r?\n/).forEach((line,i)=>{line=line.trim().replace(/\s+#.*$/,'');if(!line||line.startsWith('#')||line.startsWith('--hash='))return; const match=/^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?==([^\s;\\]+)(?:\s*;.*|\s*\\)?$/.exec(line); if(match)add('PyPI',match[1].replace(/[-_.]+/g,'-').toLowerCase(),match[2],`line ${i+1}`);else unresolved.push({name:line.split(/[ <>=;]/)[0],location:`line ${i+1}`,reason:'Only exact == versions can be queried'});});
  } else if (format === 'poetry' || format === 'uv') {
    const sections=content.split(/^\[\[package\]\]\s*$/m).slice(1);
    for(const [i,section] of sections.entries()) { const name=/^name\s*=\s*["']([^"']+)["']/m.exec(section)?.[1],version=/^version\s*=\s*["']([^"']+)["']/m.exec(section)?.[1]; add('PyPI',name?.replace(/[-_.]+/g,'-').toLowerCase(),version,`package ${i+1}`); }
  } else if(format === 'pnpm') {
    // pnpm v6-v9: package snapshots identify exact installed versions. Reject ranges/aliases we cannot resolve.
    let section=false;
    for(const [i,line] of content.split(/\r?\n/).entries()) {
      if(/^(packages|snapshots):\s*$/.test(line)){section=true;continue;}
      if(section && /^\S/.test(line))section=false;
      if(!section)continue;
      const match=/^ {2}['"]?\/?((?:@[^/\s]+\/)?[^\s:'"]+?)(?:@|\/)([0-9][^:'"\s()]*)[^:]*:\s*(?:\{\})?\s*$/.exec(line);
      if(match)add('npm',match[1],match[2],`line ${i+1}`);
      else if(/^ {2}\S.*:\s*$/.test(line))unresolved.push({name:line.trim(),location:`line ${i+1}`,reason:'Unsupported pnpm package locator'});
    }
  } else if(format === 'yarn') {
    let names=[],version=null,location='';
    const flush=()=>{if(names.length)for(const name of names)add('npm',name,version,location);};
    for(const [i,line] of content.split(/\r?\n/).entries()) {
      if(/^[^\s#].*:\s*$/.test(line)) { flush(); version=null;location=`line ${i+1}`; names=[];
        if(line.startsWith('__metadata:'))continue;
        const selectors=line.replace(/:\s*$/,'').replace(/^"|"$/g,'').split(/,\s*/);
        for(const selector of selectors){const match=/^['"]?((?:@[^/]+\/)?[^@\s]+)@/.exec(selector.replace(/^"|"$/g,''));if(match)names.push(match[1]);else unresolved.push({name:selector,location,reason:'Unsupported Yarn selector'});}
      } else { const match=/^\s+version(?::|\s)\s*["']?([^\s"']+)/.exec(line); if(match)version=match[1]; }
    } flush();
  } else throw new Error('Supported inventories: package-lock, pnpm, yarn, requirements, poetry, uv, cyclonedx');
  if(!packages.size && !unresolved.length) unresolved.push({name:'inventory',reason:'No resolved packages found'});
  const result={schemaVersion:1,format,sourceSha256:crypto.createHash('sha256').update(content).digest('hex'),packages:[...packages.values()].sort((a,b)=>a.id.localeCompare(b.id)),unresolved};
  return {...result,status:unresolved.length?'ERROR':'SUCCESS',coverage:{total:packages.size+unresolved.length,resolved:packages.size,unresolved:unresolved.length,complete:unresolved.length===0}};
}
module.exports={inventory};
