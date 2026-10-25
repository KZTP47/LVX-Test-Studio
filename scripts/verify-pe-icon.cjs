'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {root,hash}=require('./source-manifest.cjs');
function verifyEmbeddedIcon(executable=path.join(root,'release/win-unpacked/LVX Test Studio.exe')){
 const pe=fs.readFileSync(executable),ico=fs.readFileSync(path.join(root,'assets/icons/lvx-test-studio.ico'));
 assert.equal(pe.subarray(0,2).toString(),'MZ');const nt=pe.readUInt32LE(0x3c);assert.equal(pe.subarray(nt,nt+4).toString(),'PE\0\0');
 const optional=nt+24,magic=pe.readUInt16LE(optional),directories=optional+(magic===0x20b?112:96),resourceRva=pe.readUInt32LE(directories+16),sections=nt+24+pe.readUInt16LE(nt+20);
 const rvaOffset=rva=>{for(let i=0;i<pe.readUInt16LE(nt+6);i++){const s=sections+i*40,start=pe.readUInt32LE(s+12),size=Math.max(pe.readUInt32LE(s+8),pe.readUInt32LE(s+16));if(rva>=start&&rva<start+size)return pe.readUInt32LE(s+20)+rva-start;}throw Error('PE resource address is outside its sections');};
 const base=rvaOffset(resourceRva),entries=offset=>{const p=base+offset,n=pe.readUInt16LE(p+12)+pe.readUInt16LE(p+14);return Array.from({length:n},(_,i)=>({id:pe.readUInt32LE(p+16+i*8),target:pe.readUInt32LE(p+20+i*8)}));};
 const resource=type=>{const parent=entries(0).find(e=>e.id===type);assert.ok(parent,'Missing Windows resource type '+type);return entries(parent.target&0x7fffffff).map(item=>{const language=entries(item.target&0x7fffffff)[0],p=base+(language.target&0x7fffffff),off=rvaOffset(pe.readUInt32LE(p)),size=pe.readUInt32LE(p+4);return{id:item.id,bytes:pe.subarray(off,off+size)};});};
 const icons=resource(3),groups=resource(14),expected=Array.from({length:ico.readUInt16LE(4)},(_,i)=>{const p=6+i*16,len=ico.readUInt32LE(p+8),off=ico.readUInt32LE(p+12);return{size:ico[p]||256,sha256:hash(ico.subarray(off,off+len))};});
 const match=groups.find(group=>{const b=group.bytes;if(b.readUInt16LE(4)!==expected.length)return false;return expected.every((frame,i)=>{const p=6+i*14,id=b.readUInt16LE(p+12),actual=icons.find(icon=>icon.id===id);return (b[p]||256)===frame.size&&actual&&hash(actual.bytes)===frame.sha256;});});
 assert.ok(match,'Windows executable still has an old or different embedded icon');return{group:match.id,frames:expected,executableSha256:hash(pe)};
}
module.exports={verifyEmbeddedIcon};if(require.main===module){const proof=verifyEmbeddedIcon(process.argv[2]);console.log(JSON.stringify(proof));console.log('LVX_EMBEDDED_MASCOT_VERIFIED');}
