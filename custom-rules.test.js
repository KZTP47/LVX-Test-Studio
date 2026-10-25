const test=require('node:test'),assert=require('node:assert/strict');
global.window={};global.localStorage={getItem:()=>null,setItem(){}};
require('./security-testing.js');
test('Custom security rules add real patterns without requiring unused infrastructure SDKs',()=>{
 const manager=new window.SecurityTestManager();
 manager.loadCustomRules({javascript:[{id:'CUSTOM001',name:'Forbidden variable',severity:'CRITICAL',pattern:'forbidden_var',description:'Fixture rule',recommendation:'Remove it'}]});
 const scanner=manager.scanners.get('sast');const findings=scanner.scan('const x = forbidden_var;','javascript');
 assert.equal(findings.length,1);assert.equal(findings[0].ruleId,'CUSTOM001');assert.equal(scanner.scan('const x = 42;','javascript').length,0);
});
