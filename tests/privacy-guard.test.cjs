'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto');
const {guard,denied,hash}=require('../scripts/privacy-guard.cjs');
const project=path.resolve(__dirname,'..'),scanSource=path.join(project,'scripts/privacy-scan.py');
function fixture(t){
 const base=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(base,'lvx-privacy-guard-test-'));
 t.after(()=>{const resolved=path.resolve(root);assert.equal(path.dirname(resolved),base);assert.ok(path.basename(resolved).startsWith('lvx-privacy-guard-test-'));fs.rmSync(resolved,{recursive:true,force:true,maxRetries:4,retryDelay:100});});
 const git=(...args)=>{const r=cp.spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 const put=(name,value)=>{const p=path.join(root,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,value);return p;};
 git('init','--quiet','--initial-branch=main');git('config','user.name','Maintainer');git('config','user.email',['fixture','users.noreply.github.com'].join('@'));git('remote','add','origin','https://github.com/example/project.git');
 put('.gitignore','AGENTS.md\n.my_save_files/\n*.local\n/scripts/privacy-scan.py\n');
 put('package.json',JSON.stringify({name:'guard-fixture',author:'Maintainer'}));put('README.md','Fixture\n');
 put('public-files-policy.json',JSON.stringify({reviewedBinaries:[],syntheticMatches:[],gitleaksExamples:[],historyExamples:[],scanner:{executableSha256:hash('fixture scanner')}}));
 put('privacy-findings-policy.json',JSON.stringify({reviewed:[],reviewedHistory:[]}));
 put('scripts/privacy-scan.py',fs.readFileSync(scanSource));git('add','.');git('commit','--quiet','-m','Public fixture');
 const g=guard(root);fs.mkdirSync(g.state,{recursive:true});const config={repoRoot:root,scanRoot:root,python:'python'};put('.git/privacy-guard/config.json',JSON.stringify(config));
 function inventory(snapshot=true){const out=path.join(g.state,crypto.randomUUID()+'.json');const r=cp.spawnSync('python',[scanSource,'--root',root,'--repo',root,'--report',out,...(snapshot?['--snapshot']:[])],{encoding:'utf8',windowsHide:true});return {exit:r.status,data:fs.existsSync(out)?JSON.parse(fs.readFileSync(out)):null,stdout:r.stdout,stderr:r.stderr};}
 function report(){put('.git/privacy-guard/tools/gitleaks.exe','fixture scanner');const snapshot=inventory();assert.equal(snapshot.exit,0,snapshot.stderr);const id=crypto.randomUUID(),value={id,status:'AWAITING_USER_DECISION',issues:[],head:git('rev-parse','HEAD'),branch:git('symbolic-ref','HEAD'),treeDigest:snapshot.data.treeDigest,refsDigest:hash(cp.execFileSync('git',['for-each-ref','--format=%(refname) %(objectname)'],{cwd:root})),configDigest:hash(JSON.stringify(config))};put('.git/privacy-guard/reports/'+id+'/report.json',JSON.stringify(value));put('.git/privacy-guard/latest.json',JSON.stringify({id}));return value;}
 const pushInput=()=>`refs/heads/main ${git('rev-parse','HEAD')} refs/heads/main ${'0'.repeat(40)}\n`;
 return {root,git,put,g,inventory,report,pushInput};
}
test('all identified local-only paths and private save variants are denied',()=>{
 for(const file of ['AGENTS.md','nested/AGENTS.md','GATES.md','GATES.api-atlas.md','docs/CAPACITY-CHANGES.md','scripts/import-connected-apis.cjs','scripts/inspect-connected-apis.cjs','.my_save_files/project.json','nested/.my_save_files/project.json','pipeline_suites_export_private.json','project.lvx.json','docs/screenshots/raw.png'])assert.equal(denied(file),true,file);
 for(const file of ['api-atlas.js','services/api-atlas/index.cjs','assets/agents/octopus-companion.png','docs/screenshots/.gitkeep','tests/fixtures/input.json'])assert.equal(denied(file),false,file);
});
test('force-added private files are rejected without deleting their bytes',t=>{
 const f=fixture(t),file=f.put('AGENTS.md','Local-only instruction fixture');f.git('add','-f','AGENTS.md');assert.throws(()=>f.g.preCommit(),/private-file-in-git/);assert.equal(fs.readFileSync(file,'utf8'),'Local-only instruction fixture');
});
test('index inspection rejects a staged secret even after the worktree is cleaned',t=>{
 const f=fixture(t),value=['sk-',crypto.randomBytes(24).toString('hex')].join('');f.put('settings.js','const apiKey = '+JSON.stringify(value)+';\n');f.git('add','settings.js');f.put('settings.js','module.exports = {};\n');
 let failure;try{f.g.preCommit();}catch(error){failure=error;}assert.ok(failure);assert.match(failure.message,/provider-token|literal-credential/);assert.equal(failure.message.includes(value),false);
});
test('a private file in an intermediate outgoing commit remains blocked after deletion',t=>{
 const f=fixture(t),base=f.git('rev-parse','HEAD');f.put('AGENTS.md','Private intermediate fixture');f.git('add','-f','AGENTS.md');f.git('commit','--quiet','-m','Intermediate fixture');f.git('rm','--quiet','AGENTS.md');f.git('commit','--quiet','-m','Remove intermediate fixture');
 const issues=f.g.outgoing(f.git('rev-parse','HEAD'),base);assert.ok(issues.some(x=>x.rule==='private-file-in-git'&&x.file==='AGENTS.md'));
});
test('full-tree inventory reads ignored content and ZIP members without disclosing values',t=>{
 const f=fixture(t),value=['ghp_',crypto.randomBytes(18).toString('hex')].join('');f.put('hidden.local',value);
 const zip=path.join(f.root,'archive.zip'),r=cp.spawnSync('python',['-c','import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],"w"); z.writestr("nested.txt",sys.argv[2]); z.close()',zip,value],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);
 const result=f.inventory(false);assert.equal(result.exit,0,result.stderr);assert.ok(result.data.files.some(x=>x.file==='hidden.local'));assert.ok(result.data.findings.some(x=>x.file==='hidden.local'&&x.rule==='provider-token'&&x.line===1));assert.ok(result.data.findings.some(x=>x.file==='archive.zip!nested.txt'&&x.rule==='provider-token'&&x.line===1));assert.equal(JSON.stringify(result.data).includes(value),false);
});
test('full-tree inventory fails closed on a junction or symlink without reading its target',t=>{
 const f=fixture(t),other=fixture(t);other.put('outside-proof.txt','Outside fixture');fs.symlinkSync(other.root,path.join(f.root,'external-link'),process.platform==='win32'?'junction':'dir');
 const result=f.inventory(false);assert.equal(result.exit,1);assert.ok(result.data.errors.some(x=>x.reason==='external-link-not-followed'));assert.ok(!result.data.files.some(x=>x.file.includes('outside-proof')));
 // Remove only the link before the two separately owned fixture cleanups.
 fs.unlinkSync(path.join(f.root,'external-link'));
});
test('audit fails closed when the pinned scanner is unavailable',t=>{const f=fixture(t);assert.throws(()=>f.g.audit(),/scanner missing or changed/);assert.equal(fs.existsSync(path.join(f.g.state,'approval.json')),false);});
test('a clean report never approves itself and approval is required for a push',t=>{
 const f=fixture(t),report=f.report();assert.throws(()=>f.g.approve(report.id,'origin',false),/Explicit user approval/);assert.throws(()=>f.g.prePush('origin','https://github.com/example/project.git',f.pushInput()),/Push blocked/);assert.equal(fs.existsSync(path.join(f.g.state,'approval.json')),false);
});
test('explicit approval permits exactly the reviewed snapshot and destination',t=>{
 const f=fixture(t),report=f.report();f.g.approve(report.id,'origin',true);assert.doesNotThrow(()=>f.g.prePush('origin','https://github.com/example/project.git',f.pushInput()));assert.throws(()=>f.g.prePush('origin','https://github.com/example/other.git',f.pushInput()),/Approval does not match/);
 f.put('changed.local','New local evidence');assert.throws(()=>f.g.prePush('origin','https://github.com/example/project.git',f.pushInput()),/changed; a new audit/);
});
test('approval refuses unresolved reports and uncommitted candidates',t=>{
 const f=fixture(t),report=f.report(),file=path.join(f.g.state,'reports',report.id,'report.json');const blocked={...report,status:'NEEDS_WORK',issues:[{rule:'fixture-unresolved'}]};fs.writeFileSync(file,JSON.stringify(blocked));assert.throws(()=>f.g.approve(report.id,'origin',true),/Resolve findings/);
 f.put('new-source.js','module.exports = 42;');const dirty=f.report();assert.throws(()=>f.g.approve(dirty.id,'origin',true),/Commit the intended candidate locally/);
});
test('hook installation preserves an existing hooksPath',t=>{const f=fixture(t);f.git('config','core.hooksPath','existing-hooks');assert.throws(()=>f.g.install({scannerPath:'missing'}),/Existing hooksPath preserved/);assert.equal(f.git('config','core.hooksPath'),'existing-hooks');});
test('a staged binary requires an exact prior content review',t=>{const f=fixture(t);f.put('capture.png',Buffer.from([0,1,2,3,4]));f.git('add','capture.png');assert.throws(()=>f.g.preCommit(),/unreviewed-binary/);});
test('an intermediate secret in ordinary source is caught even after the final file is removed',t=>{
 const f=fixture(t),base=f.git('rev-parse','HEAD'),value=['sk-',crypto.randomBytes(24).toString('hex')].join('');f.put('settings.js','const apiKey = '+JSON.stringify(value)+';');f.git('add','settings.js');f.git('commit','--quiet','-m','Intermediate source fixture');f.git('rm','--quiet','settings.js');f.git('commit','--quiet','-m','Remove source fixture');
 const issues=f.g.outgoing(f.git('rev-parse','HEAD'),base);assert.ok(issues.some(x=>x.file==='settings.js'&&/provider-token|literal-credential/.test(x.rule)));assert.equal(JSON.stringify(issues).includes(value),false);
});
test('private commit identity is blocked in new outgoing metadata',t=>{
 const f=fixture(t),base=f.git('rev-parse','HEAD');f.git('config','user.email',['fixture','private-company.example.org'].join('@'));f.put('new.js','module.exports = 1;');f.git('add','new.js');f.git('commit','--quiet','-m','Identity fixture');assert.ok(f.g.outgoing(f.git('rev-parse','HEAD'),base).some(x=>x.rule==='private-commit-identity'));
});
test('an approved report cannot be reused for a later commit',t=>{
 const f=fixture(t),report=f.report();f.g.approve(report.id,'origin',true);f.put('new.js','module.exports = 1;');f.git('add','new.js');f.git('commit','--quiet','-m','New public fixture');assert.throws(()=>f.g.prePush('origin','https://github.com/example/project.git',f.pushInput()),/Approval does not match/);
});
test('changing an approved report invalidates its receipt',t=>{
 const f=fixture(t),report=f.report();f.g.approve(report.id,'origin',true);fs.appendFileSync(path.join(f.g.state,'reports',report.id,'report.json'),' ');assert.throws(()=>f.g.prePush('origin','https://github.com/example/project.git',f.pushInput()),/Approval does not match/);
});
test('tags, deletion and multi-ref pushes are not covered by branch approval',t=>{
 const f=fixture(t),oid=f.git('rev-parse','HEAD'),nil='0'.repeat(40);for(const input of [`refs/tags/v1 ${oid} refs/tags/v1 ${nil}\n`,`(delete) ${nil} refs/heads/main ${oid}\n`,f.pushInput()+f.pushInput()])assert.throws(()=>f.g.prePush('origin','https://github.com/example/project.git',input),/explicitly reviewed|one branch update/);
});
test('hook installation does not overwrite an existing default hook',t=>{
 const f=fixture(t),file=f.put('.git/hooks/pre-push','existing hook fixture');assert.throws(()=>f.g.install({scannerPath:'missing'}),/Existing default hook preserved/);assert.equal(fs.readFileSync(file,'utf8'),'existing hook fixture');
});
test('renaming a portable project archive does not make it eligible for Git',t=>{
 const f=fixture(t);f.put('innocent-name.json',JSON.stringify({format:'lvx-workspace',schemaVersion:1,payload:{records:[],artifacts:[]}}));f.git('add','innocent-name.json');assert.throws(()=>f.g.preCommit(),/portable-project-save/);
});
test('a changed scanner invalidates a previously approved report',t=>{
 const f=fixture(t),report=f.report();f.g.approve(report.id,'origin',true);f.put('.git/privacy-guard/tools/gitleaks.exe','changed scanner');assert.throws(()=>f.g.prePush('origin','https://github.com/example/project.git',f.pushInput()),/scanner missing or changed/);
});
test('an older approval cannot override a newer incomplete report',t=>{
 const f=fixture(t),report=f.report();f.g.approve(report.id,'origin',true);f.put('.git/privacy-guard/latest.json',JSON.stringify({id:crypto.randomUUID()}));assert.throws(()=>f.g.prePush('origin','https://github.com/example/project.git',f.pushInput()),/latest complete report/);
});
test('reviewed JWT fixtures require the same full file hash and source line in both scanners',t=>{
 const f=fixture(t),encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url'),token=[encode({alg:'HS256',typ:'JWT'}),encode({sub:'synthetic-fixture'}),crypto.randomBytes(24).toString('base64url')].join('.');
 const source='const note = 1;\nconst token = '+JSON.stringify(token)+';\n';f.put('jwt-fixture.js',source);const policy=JSON.parse(fs.readFileSync(path.join(f.root,'public-files-policy.json')));policy.gitleaksExamples=[{file:'jwt-fixture.js',rule:'jwt',line:2,outerSha256:hash(source)}];f.put('public-files-policy.json',JSON.stringify(policy));f.git('add','jwt-fixture.js','public-files-policy.json');
 const result=f.inventory(false);assert.equal(result.exit,0,result.stderr);assert.ok(result.data.findings.some(x=>x.file==='jwt-fixture.js'&&x.rule==='jwt'&&x.line===2));assert.doesNotThrow(()=>f.g.preCommit());policy.gitleaksExamples[0].line=3;f.put('public-files-policy.json',JSON.stringify(policy));assert.throws(()=>guard(f.root).preCommit(),/jwt/);
});
