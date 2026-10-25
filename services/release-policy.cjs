'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {windowsPowerShell}=require('./windows-shell.cjs');
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
function verifyManifest(envelope, publicKey, {currentVersion,currentSequence=0,allowRollback=false}={}) {
  if(!envelope||!envelope.manifest||typeof envelope.signature!=='string'||!publicKey)throw Error('A signed update manifest and pinned public key are required.');
  const m=envelope.manifest;
  if(!crypto.verify(null,Buffer.from(canonical(m)),publicKey,Buffer.from(envelope.signature,'base64')))throw Error('Update signature is invalid.');
  if(m.schemaVersion!==1||!/^\d+\.\d+\.\d+$/.test(m.version)||!Number.isSafeInteger(m.sequence)||m.sequence<=currentSequence||!Number.isFinite(Date.parse(m.expiresAt))||Date.parse(m.expiresAt)<=Date.now())throw Error('Update metadata is expired, replayed or invalid.');
  const parts=v=>v.split('.').map(Number);const a=parts(m.version),b=parts(currentVersion||'0.0.0');let older=false;for(let i=0;i<3;i++){if(a[i]!==b[i]){older=a[i]<b[i];break;}}
  if(older&&(!allowRollback||m.rollbackApproved!==true))throw Error('Rollback needs a newly signed approval and explicit user selection.');
  if(!/^https:\/\//.test(m.url)||!/^[a-f0-9]{64}$/.test(m.sha256)||!Number.isSafeInteger(m.bytes)||m.bytes<=0)throw Error('Update artifact metadata is invalid.');
  return {...m,rollback:older};
}
function verifyArtifact(file,manifest,{requireAuthenticode=true,publisher}={}) {
  const data=fs.readFileSync(file);if(data.length!==manifest.bytes||crypto.createHash('sha256').update(data).digest('hex')!==manifest.sha256)throw Error('Installer checksum or size does not match the signed manifest.');
  if(requireAuthenticode){if(process.platform!=='win32'||!publisher)throw Error('A trusted Windows publisher identity is required.');
    // Pass paths as an environment value, never interpolate into PowerShell source.
    const result=JSON.parse(windowsPowerShell('$s=Get-AuthenticodeSignature -LiteralPath $env:LVX_VERIFY_ARTIFACT; @{status=[string]$s.Status; subject=[string]$s.SignerCertificate.Subject} | ConvertTo-Json -Compress',{env:{LVX_VERIFY_ARTIFACT:path.resolve(file)}}));
    if(result.status!=='Valid'||result.subject!==publisher)throw Error('Installer publisher signature is not trusted.');
  }
  return {verified:true,sha256:manifest.sha256};
}
module.exports={canonical,verifyManifest,verifyArtifact};
