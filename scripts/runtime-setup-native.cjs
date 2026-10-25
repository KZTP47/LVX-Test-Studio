'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('playwright'),{sourceManifest,hash,root}=require('./source-manifest.cjs');
async function run(mode='packaged'){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-setup-native-')),workspace=path.join(temp,'project'),source=sourceManifest(),scriptSha256=hash(fs.readFileSync(__filename)),packaged=mode==='packaged',packageProof=packaged?require('./package-manifest.cjs').verifyPackage():null,checks=[],installs=[];let app,page,managedDotnet;
 fs.mkdirSync(workspace);fs.writeFileSync(path.join(workspace,'package.json'),JSON.stringify({name:'lvx-disposable-proof',version:'1.0.0',private:true,jest:{testMatch:['**/managed.test.js']}}));
 fs.writeFileSync(path.join(workspace,'managed.test.js'),"test('managed Jest actually runs',()=>expect(6*7).toBe(42));");
 fs.writeFileSync(path.join(workspace,'test_managed.py'),'def test_managed():\n    assert 6 * 7 == 42\n');
 fs.writeFileSync(path.join(workspace,'Managed.csproj'),'<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework><IsTestProject>true</IsTestProject><IsPackable>false</IsPackable></PropertyGroup></Project>');
 fs.writeFileSync(path.join(workspace,'Managed.cs'),'using NUnit.Framework; public class Managed { [Test] public void RealAssertion() { Assert.That(6 * 7, Is.EqualTo(42)); } }');
 const junit=path.join(workspace,'junit');fs.mkdirSync(junit);fs.writeFileSync(path.join(junit,'ManagedTest.java'),'import org.junit.jupiter.api.Test; import static org.junit.jupiter.api.Assertions.*; public class ManagedTest { @Test void realAssertion() { assertEquals(42, 6*7); } }');
 const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name);};
 const ops=(domain,action,payload={})=>page.evaluate(({domain,action,payload})=>electronAPI.studioOps.invoke(domain,action,payload),{domain,action,payload});
 const terminal=async(domain,id)=>{for(let i=0;i<4800;i++){const r=await ops(domain,domain==='setup'?'get':'getRun',{id});if(['SUCCESS','ERROR','FAILURE','CANCELLED','NEEDS_ATTENTION'].includes(r.status))return r;await new Promise(r=>setTimeout(r,250));}throw Error('Timeout '+domain);};
 try{
  const env={...process.env,LVX_TEST_USER_DATA:path.join(temp,'profile'),LVX_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({...(packaged?{executablePath:path.join(root,'release/win-unpacked/LVX Test Studio.exe')}:{args:[root]}),cwd:os.tmpdir(),env});page=await app.firstWindow();await page.waitForFunction(()=>window.LVXStudioInitialized===true);
  await app.evaluate(({dialog},folder)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]}),workspace);await page.evaluate(async()=>{await electronAPI.studioOps.chooseWorkspace();await electronAPI.studioOps.invoke('security','trust',{trusted:true});});
  for(const itemId of ['python','pytest','robot','java','dotnet','junit','jest','nunit','playwright']){
   const before=await ops('execution','runtimeConfiguration'),plan=await ops('setup','preview',{itemId});
   check(itemId+' preview identifies the publisher, destination and package changes',!!plan.publisher&&!!plan.location&&plan.artifacts.every(a=>a.url.startsWith('https://')&&a.digest.length>=64));
   const started=await ops('setup','start',{planId:plan.id,consent:true}),job=await terminal('setup',started.id);console.log(itemId,job.status,job.message);if(job.status!=='SUCCESS')console.error(job.log);
   check(itemId+' installs from actual official sources and passes native readiness',job.status==='SUCCESS');installs.push({itemId,status:job.status,artifacts:plan.artifacts.map(a=>({id:a.id,version:a.version,algorithm:a.algorithm,digest:a.digest})),packages:plan.packages});
   if(itemId==='dotnet')managedDotnet=(await ops('execution','runtimeConfiguration')).dotnet;
   if(itemId==='jest')check('Jest bootstrap preserves Electron as the internal child runner',(await ops('execution','runtimeConfiguration')).node===before.node);
  }
  const cases=[
   {engine:'javascript',code:'assert(6 * 7 === 42);'},
   {engine:'python',code:'assert 6 * 7 == 42'},
   {engine:'robot',code:'*** Test Cases ***\nManaged assertion\n    Should Be Equal As Integers    42    42'},
   {engine:'java',code:'public class LvxTest { public static void main(String[] args) { if (6 * 7 != 42) throw new RuntimeException("wrong"); System.out.println("Java managed proof"); } }'},
   {engine:'csharp',code:'if (6 * 7 != 42) throw new System.Exception("wrong"); System.Console.WriteLine("C# managed proof");'},
   {engine:'jest'}, {engine:'pytest'}, {engine:'nunit',projectPath:path.join(workspace,'Managed.csproj')}, {engine:'junit',projectPath:junit},
   {engine:'playwright',code:'await page.setContent("<h1>Managed browser</h1>"); assert(await page.locator("h1").textContent() === "Managed browser");'}
  ];
  for(const payload of cases){const started=await ops('execution','start',{...payload,name:'Managed '+payload.engine+' verification',timeoutMs:180000}),result=await terminal('execution',started.id);if(result.status!=='SUCCESS')console.error(JSON.stringify(result));check('Real '+payload.engine+' test runs successfully with the downloaded tools',result.status==='SUCCESS'&&result.passed>0);}
  const paths=await ops('execution','runtimeConfiguration');check('All newly configured runtimes remain inside the disposable app profile',['python','java','javac','dotnet','junitJar','browserRoot'].every(key=>paths[key]?.startsWith(path.join(temp,'profile'))));
  assert.equal(hash(fs.readFileSync(__filename)),scriptSha256,'Verifier script changed during execution');assert.equal(sourceManifest().digest,source.digest,'Source changed during native setup proof');
  fs.writeFileSync(path.join(root,'docs/verification/runtime-setup-native.json'),JSON.stringify({status:'SUCCESS',sourceDigest:source.digest,scriptSha256,at:new Date().toISOString(),packaged,packageProof,checks,installs,scope:'All nine actual official-source setup flows and real tests in all ten execution engines, using disposable app-local storage and project files. No live AI account calls or system installations.'},null,2)+'\n');console.log('LVX_RUNTIME_SETUP_NATIVE_VERIFIED');
 }finally{if(managedDotnet&&managedDotnet.startsWith(path.join(temp,'profile'))){await new Promise(resolve=>require('node:child_process').execFile(managedDotnet,['build-server','shutdown'],{windowsHide:true,timeout:20000,env:{...process.env,DOTNET_ROOT:path.dirname(managedDotnet)}},()=>resolve()));}if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}assert.equal(path.dirname(temp),os.tmpdir());fs.rmSync(temp,{recursive:true,force:true,maxRetries:8,retryDelay:200});}
}
module.exports={run};if(require.main===module)run(process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
