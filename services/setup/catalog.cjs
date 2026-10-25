'use strict';
const fs=require('node:fs'),path=require('node:path');
const CATALOG=[
 {id:'python',name:'Python',engines:['python'],purpose:'Run Python tests.',publisher:'Python Software Foundation',source:'https://docs.python.org/3/using/windows.html#the-nuget-org-packages'},
 {id:'java',name:'Java JDK',engines:['java'],purpose:'Compile and run Java tests.',publisher:'Eclipse Adoptium',source:'https://adoptium.net/installation/'},
 {id:'dotnet',name:'.NET SDK',engines:['csharp'],purpose:'Compile and run C# tests.',publisher:'Microsoft',source:'https://learn.microsoft.com/en-us/dotnet/core/install/windows'},
 {id:'playwright',name:'Website test browser',engines:['playwright'],purpose:'Download the Chromium version used by this app.',publisher:'Microsoft Playwright',source:'https://playwright.dev/docs/browsers'},
 {id:'pytest',name:'pytest',engines:['pytest'],purpose:'Add pytest to an LVX-managed Python installation.',publisher:'pytest developers / Python Software Foundation',source:'https://docs.pytest.org/en/stable/getting-started.html'},
 {id:'robot',name:'Robot Framework',engines:['robot'],purpose:'Add Robot Framework to an LVX-managed Python installation.',publisher:'Robot Framework Foundation / Python Software Foundation',source:'https://robotframework.org/'},
 {id:'junit',name:'JUnit runner',engines:['junit'],purpose:'Download and configure the JUnit console runner.',publisher:'JUnit team',source:'https://junit.org/junit5/docs/5.11.4/user-guide/'},
 {id:'jest',name:'Jest project packages',engines:['jest'],purpose:'Add Jest to the selected project. Requires an existing package.json.',publisher:'Jest contributors / OpenJS Foundation',source:'https://jestjs.io/docs/getting-started',project:true},
 {id:'nunit',name:'NUnit project packages',engines:['nunit'],purpose:'Add the NUnit test packages to one existing C# project.',publisher:'NUnit team / Microsoft',source:'https://docs.nunit.org/articles/nunit/getting-started/installation.html',project:true}
];
const item=id=>{const value=CATALOG.find(x=>x.id===id);if(!value)throw Error('Choose a supported setup item.');return value;};
function allowedURL(value){
 const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)throw Error('Setup only downloads from the fixed official HTTPS sources.');
 const allowed=u.hostname==='api.nuget.org'&&['/v3-flatcontainer/python/','/v3/registration5','/v3/catalog0/'].some(prefix=>u.pathname.startsWith(prefix))||u.hostname==='api.adoptium.net'&&u.pathname.startsWith('/v3/')||u.hostname==='github.com'&&u.pathname.startsWith('/adoptium/temurin21-binaries/releases/download/')||['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname)||u.hostname==='builds.dotnet.microsoft.com'&&u.pathname.startsWith('/dotnet/')||u.hostname==='nodejs.org'&&u.pathname.startsWith('/dist/')||u.hostname==='repo.maven.apache.org'&&u.pathname.startsWith('/maven2/org/junit/platform/junit-platform-console-standalone/');
 if(!allowed)throw Error('Download source is outside the supported catalog.');return u.href;
}
async function officialFetch(url,{fetchImpl=fetch,signal}={}){
 for(let hop=0;hop<6;hop++){url=allowedURL(url);const response=await fetchImpl(url,{redirect:'manual',signal});if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('Download redirect has no destination.');url=new URL(location,url).href;continue;}if(!response.ok)throw Error('Download failed (HTTP '+response.status+'). Check your connection and try again.');return response;}throw Error('Too many download redirects.');
}
async function metadata(url,options={},json=true){const response=await officialFetch(url,options);let size=0,parts=[];for await(const data of response.body){size+=data.length;if(size>4*1024*1024)throw Error('Setup metadata is unexpectedly large.');parts.push(data);}const text=Buffer.concat(parts).toString('utf8');return json?JSON.parse(text):text;}
function artifact(id,version,url,digest,algorithm='sha256',size){allowedURL(url);if(!new RegExp('^[a-f0-9]{'+(algorithm==='sha512'?128:64)+'}$','i').test(digest))throw Error('Publisher checksum is missing or invalid.');return{id,version,url,digest:digest.toLowerCase(),algorithm,size:size||null};}
async function resolveArtifacts(id,{runtimePaths={},capabilities={},fetchImpl=fetch,signal,workspaceRoot}={}){
 item(id);const net={fetchImpl,signal},artifacts=[];let projectFile=null;
 if(['python','pytest','robot'].includes(id)){
  const versions=(await metadata('https://api.nuget.org/v3-flatcontainer/python/index.json',net)).versions.filter(v=>/^3\.13\.\d+$/.test(v)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));const version=versions.at(-1);if(!version)throw Error('No supported Python release was found.');
  const registration=await metadata('https://api.nuget.org/v3/registration5-semver1/python/'+version+'.json',net),entry=typeof registration.catalogEntry==='string'?await metadata(registration.catalogEntry,net):registration.catalogEntry;
  if(entry?.packageHashAlgorithm?.toUpperCase()!=='SHA512')throw Error('Python publisher checksum is unavailable.');const digest=Buffer.from(entry.packageHash||'','base64').toString('hex');artifacts.push(artifact('python',version,'https://api.nuget.org/v3-flatcontainer/python/'+version+'/python.'+version+'.nupkg',digest,'sha512'));
 }
 if(id==='java'||id==='junit'&&!(capabilities.runtimes?.javac?.available&&capabilities.runtimes?.java?.available)){const release=(await metadata('https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse',net))[0],p=release?.binary?.package;if(!p)throw Error('No supported Java JDK release was found.');artifacts.push(artifact('java',release.version.semver,p.link,p.checksum,'sha256',p.size));}
 if(id==='dotnet'){
  const releases=await metadata('https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json',net),release=releases.releases.find(r=>!r.sdk.version.includes('-')),file=release?.sdk?.files?.find(f=>f.rid==='win-x64'&&f.name.endsWith('.zip'));if(!file)throw Error('No supported .NET SDK release was found.');artifacts.push(artifact('dotnet',release.sdk.version,file.url,file.hash,'sha512'));
 }
 if(id==='junit')artifacts.push(artifact('junit','1.11.4','https://repo.maven.apache.org/maven2/org/junit/platform/junit-platform-console-standalone/1.11.4/junit-platform-console-standalone-1.11.4.jar','b016ef6b1c3454d6d7c2c88ce081dabf289699686af6622d6e4e2e1b54b4a2fc'));
 if(id==='jest'){
  projectFile=path.join(workspaceRoot||'','package.json');if(!workspaceRoot||!fs.existsSync(projectFile))throw Error('Choose a project folder containing package.json before setting up Jest.');
  const release=(await metadata('https://nodejs.org/dist/index.json',net)).find(r=>/^v24\./.test(r.version)&&r.lts),name='node-'+release?.version+'-win-x64.zip';if(!release)throw Error('No supported Node.js LTS release was found.');
  const hashes=await metadata('https://nodejs.org/dist/'+release.version+'/SHASUMS256.txt',net,false),digest=hashes.split(/\r?\n/).find(line=>line.endsWith('  '+name))?.split(/\s/)[0];artifacts.push(artifact('node',release.version,'https://nodejs.org/dist/'+release.version+'/'+name,digest||''));
 }
 if(id==='nunit'){
  if(!workspaceRoot)throw Error('Choose your NUnit project folder first.');const files=fs.readdirSync(workspaceRoot).filter(n=>n.endsWith('.csproj'));if(files.length!==1)throw Error('Choose a folder containing exactly one .csproj file.');projectFile=path.join(workspaceRoot,files[0]);if(!capabilities.runtimes?.dotnet?.available)throw Error('Set up the .NET SDK first, then return to NUnit.');
 }
 return{artifacts,projectFile};
}
module.exports={CATALOG,item,allowedURL,officialFetch,metadata,resolveArtifacts};
