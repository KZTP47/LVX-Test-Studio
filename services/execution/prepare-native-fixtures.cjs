'use strict';
// Optional native verification dependencies. Nothing here is seeded into a
// user's workspace. Versions are explicit; npm/NuGet verify their packages.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const root=process.env.LVX_NATIVE_FIXTURES||path.join(os.tmpdir(),'lvx-native-fixtures-v1');
function command(cmd,args,cwd){const r=spawnSync(cmd,args,{cwd,encoding:'utf8',timeout:240000,windowsHide:true,shell:process.platform==='win32'&&cmd==='npm'});if(r.status!==0)throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stdout}\n${r.stderr}\n${r.error?.message||''}`);return r.stdout;}
async function prepare(){
    fs.mkdirSync(root,{recursive:true});const jest=path.join(root,'jest');fs.mkdirSync(jest,{recursive:true});fs.writeFileSync(path.join(jest,'package.json'),JSON.stringify({name:'lvx-native-jest-proof',private:true,devDependencies:{jest:'29.7.0'}}));
    if(!fs.existsSync(path.join(jest,'node_modules/jest/bin/jest.js')))command('npm',['install','--ignore-scripts','--no-audit','--no-fund'],jest);
    fs.writeFileSync(path.join(jest,'proof.test.js'),"test('real Jest assertion',()=>expect(2+2).toBe(4));\n");
    const junit=path.join(root,'junit');fs.mkdirSync(junit,{recursive:true});const jar=path.join(root,'junit-platform-console-standalone-1.11.4.jar');
    if(!fs.existsSync(jar)){const response=await fetch('https://repo.maven.apache.org/maven2/org/junit/platform/junit-platform-console-standalone/1.11.4/junit-platform-console-standalone-1.11.4.jar');if(!response.ok)throw new Error(`JUnit download HTTP ${response.status}`);fs.writeFileSync(jar,Buffer.from(await response.arrayBuffer()));}
    if(crypto.createHash('sha256').update(fs.readFileSync(jar)).digest('hex')!=='b016ef6b1c3454d6d7c2c88ce081dabf289699686af6622d6e4e2e1b54b4a2fc')throw new Error('Pinned JUnit fixture JAR checksum mismatch.');
    fs.writeFileSync(path.join(junit,'ProofTest.java'),'import org.junit.jupiter.api.Test; import static org.junit.jupiter.api.Assertions.assertEquals; public class ProofTest { @Test void proof() { assertEquals(4,2+2); } }');
    command('javac',['-cp',jar,path.join(junit,'ProofTest.java')],junit);
    const nunit=path.join(root,'nunit');fs.mkdirSync(nunit,{recursive:true});
    fs.writeFileSync(path.join(nunit,'Proof.csproj'),'<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net9.0</TargetFramework><IsTestProject>true</IsTestProject><IsPackable>false</IsPackable></PropertyGroup><ItemGroup><PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.13.0"/><PackageReference Include="NUnit" Version="4.3.2"/><PackageReference Include="NUnit3TestAdapter" Version="5.0.0"/></ItemGroup></Project>');
    fs.writeFileSync(path.join(nunit,'Proof.cs'),'using NUnit.Framework; public class Proof { [Test] public void Adds() { Assert.That(2+2, Is.EqualTo(4)); } }');
    command('dotnet',['restore',path.join(nunit,'Proof.csproj'),'--nologo'],nunit);
    const manifest={root,jest,junit,junitJar:jar,nunit,versions:{jest:'29.7.0',junit:'1.11.4',nunit:'4.3.2',nunitAdapter:'5.0.0',testSdk:'17.13.0'},junitSha256:crypto.createHash('sha256').update(fs.readFileSync(jar)).digest('hex'),preparedAt:new Date().toISOString()};fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2));return manifest;
}
if(require.main===module)prepare().then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={prepare,root};
