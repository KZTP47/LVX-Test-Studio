'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {ensurePinned}=require('../scripts/vendor-cache.cjs'),{checkVendor}=require('../scripts/check-vendor.cjs');
const root=path.resolve(__dirname,'..'),sha=value=>crypto.createHash('sha256').update(value).digest('hex');
test('Vendor cache replaces an old file only after a complete hash-verified download',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-vendor-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const file=path.join(directory,'library.js'),old=Buffer.from('old vulnerable version'),fresh=Buffer.from('pinned patched version'),entry={url:'https://example.invalid/vendor.js',sha256:sha(fresh)};fs.writeFileSync(file,old);
 await assert.rejects(ensurePinned(file,entry,async()=>new Response('tampered bytes')),/integrity/);assert.deepEqual(fs.readFileSync(file),old);
 assert.equal((await ensurePinned(file,entry,async()=>new Response(fresh))).cached,false);assert.deepEqual(fs.readFileSync(file),fresh);assert.equal((await ensurePinned(file,entry,()=>{throw Error('Valid cache must not fetch');})).cached,true);
});
test('Actual pinned SheetJS parses a workbook without losing zero and boolean values',()=>{
 const receipt=checkVendor(),XLSX=require('../assets/vendor/xlsx.full.min.js');assert.equal(XLSX.version,receipt.version);
 const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['name','count','enabled'],['Ada',0,false]]),'Customers');const bytes=XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),read=XLSX.read(bytes,{type:'buffer'});assert.deepEqual(XLSX.utils.sheet_to_json(read.Sheets.Customers),[{name:'Ada',count:0,enabled:false}]);
});
