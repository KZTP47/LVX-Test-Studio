'use strict';
// Stored ZIP entries, with ZIP64 records when ZIP32 fields cannot represent the
// archive. File/count/total-byte capacity is not restricted by application policy.
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function zip(files){
 if(!Array.isArray(files)||!files.length)throw Error('ZIP needs entries.');
 const local=[],central=[],names=new Set();let offset=0,needs64=false;
 for(const file of files){
  const name=String(file.filename).replace(/\\/g,'/');if(!name||name.startsWith('/')||name.includes('\0')||name.split('/').some(s=>s==='..')||names.has(name))throw Error('ZIP entry names must be unique relative paths.');names.add(name);
  const nb=Buffer.from(name),content=Buffer.isBuffer(file.content)?file.content:Buffer.from(file.content),crc=crc32(content),largeSize=content.length>=0xffffffff,largeOffset=offset>=0xffffffff;
  if(nb.length>65535)throw Error('ZIP format cannot represent this filename length.');
  let extra=Buffer.alloc(0);if(largeSize){extra=Buffer.alloc(20);extra.writeUInt16LE(1);extra.writeUInt16LE(16,2);extra.writeBigUInt64LE(BigInt(content.length),4);extra.writeBigUInt64LE(BigInt(content.length),12);}
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(largeSize?45:20,4);header.writeUInt16LE(0x800,6);header.writeUInt32LE(crc,14);header.writeUInt32LE(largeSize?0xffffffff:content.length,18);header.writeUInt32LE(largeSize?0xffffffff:content.length,22);header.writeUInt16LE(nb.length,26);header.writeUInt16LE(extra.length,28);local.push(header,nb,extra,content);
  let centralExtra=Buffer.alloc(0);if(largeSize||largeOffset){const values=[...(largeSize?[content.length,content.length]:[]),...(largeOffset?[offset]:[])];centralExtra=Buffer.alloc(4+values.length*8);centralExtra.writeUInt16LE(1);centralExtra.writeUInt16LE(values.length*8,2);values.forEach((v,i)=>centralExtra.writeBigUInt64LE(BigInt(v),4+i*8));needs64=true;}
  const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(largeSize||largeOffset?45:20,4);record.writeUInt16LE(largeSize||largeOffset?45:20,6);record.writeUInt16LE(0x800,8);record.writeUInt32LE(crc,16);record.writeUInt32LE(largeSize?0xffffffff:content.length,20);record.writeUInt32LE(largeSize?0xffffffff:content.length,24);record.writeUInt16LE(nb.length,28);record.writeUInt16LE(centralExtra.length,30);record.writeUInt32LE(largeOffset?0xffffffff:offset,42);central.push(record,nb,centralExtra);offset+=header.length+nb.length+extra.length+content.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22),trailer=[];needs64=needs64||files.length>=65535||directory.length>=0xffffffff||offset>=0xffffffff;
 if(needs64){const record=Buffer.alloc(56),locator=Buffer.alloc(20);record.writeUInt32LE(0x06064b50);record.writeBigUInt64LE(44n,4);record.writeUInt16LE(45,12);record.writeUInt16LE(45,14);record.writeBigUInt64LE(BigInt(files.length),24);record.writeBigUInt64LE(BigInt(files.length),32);record.writeBigUInt64LE(BigInt(directory.length),40);record.writeBigUInt64LE(BigInt(offset),48);locator.writeUInt32LE(0x07064b50);locator.writeBigUInt64LE(BigInt(offset+directory.length),8);locator.writeUInt32LE(1,16);trailer.push(record,locator);}
 end.writeUInt32LE(0x06054b50);end.writeUInt16LE(needs64?65535:files.length,8);end.writeUInt16LE(needs64?65535:files.length,10);end.writeUInt32LE(needs64?0xffffffff:directory.length,12);end.writeUInt32LE(needs64?0xffffffff:offset,16);return Buffer.concat([...local,directory,...trailer,end]);
}
module.exports={zip,crc32};
