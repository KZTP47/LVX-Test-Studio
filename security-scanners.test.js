// Infrastructure capability contracts. Actual external engines are not bundled.
const test=require('node:test'),assert=require('node:assert/strict');
global.window={};global.localStorage={getItem:()=>null,setItem(){}};
require('./security-testing.js');
for(const [name,scanner,method,args]of [
 ['Docker container','docker','scanContainer',['fixture']],
 ['Docker image','docker','scanImage',['fixture']],
 ['Kubernetes YAML','kubernetes','scanYaml',['kind: Pod']],
 ['Network port','network','scanPort',['127.0.0.1',8080]],
 ['Network endpoint','network','scanEndpoint',['http://127.0.0.1']]
])test(`${name} rejects unavailable engine and delegates only when a backend actually exists`,async()=>{
 delete window.electronAPI;const manager=new window.SecurityTestManager(),adapter=manager.scanners.get(scanner);
 await assert.rejects(adapter[method](...args),/unavailable/);
 let request;window.electronAPI={scanInfrastructure:async value=>{request=value;return{status:'ERROR',error:'Fixture backend unavailable'};}};
 const result=await adapter[method](...args);assert.equal(result.status,'ERROR');assert.ok(request.target);delete window.electronAPI;
});
