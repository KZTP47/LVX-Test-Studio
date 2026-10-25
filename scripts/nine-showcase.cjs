'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const root=path.resolve(__dirname,'..');
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>LVX checkout practice</title><style>body{font:18px system-ui;background:#f4f9ff;color:#183b50;margin:30px}label,input,button{display:block;margin:12px 0;padding:8px}</style></head><body><h1>Checkout practice</h1><label for="quantity">Quantity</label><input id="quantity" type="number" value="1"><label for="coupon">Coupon</label><input id="coupon"><button type="button" id="calculate">Calculate quote</button><p id="result" role="status">Choose a quantity</p><script>document.querySelector('#calculate').onclick=()=>{const q=Number(document.querySelector('#quantity').value),discount=document.querySelector('#coupon').value==='LAB10'?.9:1;document.querySelector('#result').textContent=(249*q*discount+(q<3?49:0)).toFixed(2)+' SEK';};</script></body></html>`;
const steps=[{name:'Input Text',params:{selector:'#quantity',text:'2'}},{name:'Input Text',params:{selector:'#coupon',text:'LAB10'}},{name:'Click Element',params:{selector:'#calculate'}},{name:'Element Should Contain',params:{selector:'#result',text:'497.20 SEK'}},{name:'Check Accessibility',params:{}}];
const quoteCode=`const quote=(q,coupon='')=>{assert(Number.isInteger(q)&&q>0,'Positive whole quantity');return 249*q*(coupon==='LAB10'?.9:1)+(q<3?49:0);};assert(quote(2,'LAB10')===497.2);assert(quote(3)===747);artifacts.quoteVerified=true;`;
const matrixCode=`const rows=[[1,'',298],[2,'LAB10',497.2],[3,'',747],[4,'LAB10',896.4]];for(const [quantity,coupon,expected]of rows){const total=249*quantity*(coupon==='LAB10'?.9:1)+(quantity<3?49:0);assert(total===expected,'Quote row '+quantity);}artifacts.rowsChecked=rows.length;`;
const node=(id,type,name,data,x,y,extra={})=>({id,type,position:{x,y},data:{name,...data},...extra});
const edge=(source,target,extra={})=>({id:source+'-'+target,source,target,...extra});
function graphs(){return [
 {id:'ready-typed-branches',name:'Start here 1 — parallel checks and typed results',schemaVersion:1,description:'Works immediately. No server, account or extra files. Open a node to change its values, then run the whole graph.',concurrency:2,nodes:[
 node('quote','script','Calculate and publish a quote',{engine:'javascript',code:"assert(249*2===498);artifacts.quote={subtotal:498,discount:49.8,shipping:49};"},50,180,{outputs:{quote:{type:'object',required:true}}}),
 node('total','script','Verify the discounted total',{engine:'javascript',code:"assert(inputs.quote.subtotal-inputs.quote.discount+inputs.quote.shipping===497.2);artifacts.total=497.2;"},390,70,{inputs:{quote:{type:'object',producer:'quote',required:true}}}),
 node('shipping','script','Verify the shipping rule',{engine:'javascript',code:"assert(inputs.quote.shipping===49);artifacts.shippingVerified=true;"},390,290,{inputs:{quote:{type:'object',producer:'quote',required:true}}}),
 node('finish','script','Both branches must pass',{engine:'javascript',code:"assert(true,'All upstream checks completed');artifacts.summary='Quote and shipping passed';"},740,180)
 ],edges:[edge('quote','total',{output:'quote',input:'quote',type:'object'}),edge('quote','shipping',{output:'quote',input:'quote',type:'object'}),edge('total','finish'),edge('shipping','finish')]},
 {id:'ready-browser-security',name:'Start here 2 — browser journey and security gate',schemaVersion:1,description:'Tests the included checkout page and scans safe example source. Browser is included in the Windows build; no website server is needed.',concurrency:2,nodes:[
 node('browser','test-suite','Fill fields and verify checkout',{suite:{name:'Included checkout browser test',language:'website',website_method:'upload',website_html_content:html,vwt_steps_json:JSON.stringify(steps)}},40,60),
 node('scan','security-scan','Check safe rendering source',{config:{code:'function renderText(element,value){element.textContent=String(value);}',language:'javascript',sast:true,secrets:true,xss:true,failOn:'high'}},40,290),
 node('gate','security-gate','Require no high or critical findings',{maxCritical:0,maxHigh:0},370,290),
 node('finish','script','Confirm browser and security passed',{engine:'javascript',code:"assert(true,'Browser and security dependencies passed');artifacts.ready=true;"},710,150)
 ],edges:[edge('scan','gate'),edge('browser','finish'),edge('gate','finish')]},
 {id:'ready-suite-matrix',name:'Start here 3 — reusable suites and four-row matrix',schemaVersion:1,description:'Run saved JavaScript suites together, wait briefly and publish a combined result. No external files or accounts.',nodes:[
 node('reuse','test-suite','Reusable acceptance suite',{suite:{name:'Reusable checkout acceptance suite',language:'javascript',code:quoteCode}},40,100),
 node('matrix','test-suite','Check four quantities and coupons',{suite:{name:'Four-row checkout matrix',language:'javascript',code:matrixCode}},390,100),
 node('settle','wait-delay','Short editable delay',{delayMs:20},740,100,{inputs:{suiteId:{producer:'matrix'},iterations:{producer:'matrix'}}}),
 node('report','script','Publish release decision',{engine:'javascript',code:"assert(true,'Every checkout case passed');artifacts.decision={ready:true,scope:'Included practice checkout only'};"},1070,100,{inputs:{suiteId:{producer:'matrix'},iterations:{producer:'matrix'}}})
 ],edges:[edge('reuse','matrix'),edge('matrix','settle'),edge('settle','report')]}
];}
function build(input){const archive=input?structuredClone(input):{format:'lvx-workspace',schemaVersion:2,secretsExcluded:true,payload:{records:[],artifacts:[]}};
 const records=archive.payload.records;
 for(const record of records.filter(r=>r.collection==='suites')){
  if(record.value.name==='Reusable checkout acceptance suite')record.value={...record.value,code:quoteCode};
  if(record.value.name==='Four-row checkout matrix through native dataset binding'){record.value={...record.value,code:matrixCode};delete record.value.dataSetId;delete record.value.datasetId;}
  if(record.value.name==='Visual website journey, accessibility and screenshot regression')record.value={...record.value,website_method:'upload',website_html_content:html,website_url:'',vwt_steps_json:JSON.stringify(steps)};
 }
 const additions=graphs().map(value=>({collection:'workflows',id:value.id,value}));
 if(!records.some(r=>r.collection==='suites'))additions.push(...[
 {id:'ready-acceptance',name:'Reusable checkout acceptance suite',language:'javascript',code:quoteCode},
 {id:'ready-matrix',name:'Four-row checkout matrix',language:'javascript',code:matrixCode},
 {id:'ready-browser',name:'Included checkout website',language:'website',website_method:'upload',website_html_content:html,vwt_steps_json:JSON.stringify(steps)}].map(value=>({collection:'suites',id:value.id,value})));
 for(const record of additions){const index=records.findIndex(r=>r.collection===record.collection&&r.id===record.id);if(index<0)records.push(record);else records[index]=record;}
 archive.exportedAt=new Date().toISOString();archive.manifest={records:records.length,artifacts:archive.payload.artifacts.length,checksumAlgorithm:'sha256',payloadChecksum:hash(JSON.stringify(archive.payload))};return archive;
}
function write(destination,inputFile){fs.mkdirSync(destination,{recursive:true});const source=inputFile?JSON.parse(fs.readFileSync(inputFile,'utf8')):null,archive=build(source),file=path.join(destination,'LVX-Ready-to-Run.lvx.json');fs.writeFileSync(file,JSON.stringify(archive,null,2)+'\n');fs.writeFileSync(path.join(destination,'START HERE.md'),'# Try the working examples\n\n1. In LVX, choose a project folder, then Import JSON and select LVX-Ready-to-Run.lvx.json. Preview and import it.\n2. The pipeline sidebar shows three graphs named Start here. Choose Open graph to inspect one, or Run graph to run it. Review the imported code when asked.\n3. Tests use the included checkout page and values. They need no server or AI account. The Windows build includes its browser.\n\nIf this file also contains the older advanced lab examples, those keep their original setup requirements. Use the three Start here graphs first. AI examples require your own connected provider; local-lab graphs require the original showcase service and project files. Historical runs are evidence from their original run, not a new result on this computer.\n');return {file,graphs:graphs().map(g=>g.id),records:archive.manifest.records,sha256:hash(fs.readFileSync(file))};}
module.exports={build,write,graphs,html,steps,quoteCode,matrixCode};
if(require.main===module)console.log(JSON.stringify(write(process.argv[2]||path.join(root,'exports/Ready-to-Run'),process.argv[3]),null,2));
