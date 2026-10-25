const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {root,sourceManifest,hash}=require('./source-manifest.cjs');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const json=file=>JSON.parse(read(file));
const reports=()=>['e2e','desktop'].map(name=>json(`docs/verification/${name}-results.json`));
function provenance(){
 require('./repository-identity.cjs').currentRepository(root);
 assert.equal(execFileSync('git',['rev-parse','9f7e70226af0b11dbcb079253f48fe8c7f402b09^{commit}'],{cwd:root,encoding:'utf8'}).trim(),'9f7e70226af0b11dbcb079253f48fe8c7f402b09');
 const base=json('docs/verification/baseline-findings.json');const maps=['execution','storage','browser'].flatMap(name=>json(`docs/verification/${name}-fixes.json`).findings);assert.equal(base.length,52);assert.equal(new Set(maps.map(f=>f.id)).size,52);
 for(const finding of base){const fix=maps.find(f=>f.id===finding.id);assert.ok(fix&&fix.change&&fix.tests.length,`Missing repair ${finding.id}`);assert.ok(fix.files.every(file=>fs.existsSync(path.join(root,file))));}
 assert.equal(hash(fs.readFileSync(path.join(root,'assets/icons/lvx-test-studio.png'))),'2ee9ff581febd0ebe5c56a0be8234ad0ba8b2024e40500348bf36f6200466508');console.log('PROVENANCE_VERIFIED');
}
function evidence(){const digest=sourceManifest().digest;for(const report of reports()){assert.equal(report.source.digest,digest,'Stale runtime evidence');assert.equal(report.rendererErrors.length,0);assert.equal(report.externalRequests.length,0);assert.ok(report.checks.length>=35);}const regression=json('docs/verification/regression-results.json');assert.equal(regression.sourceDigest,digest,'Stale regression evidence');assert.equal(regression.fail,0);assert.equal(regression.skipped,0);for(const entry of regression.files)assert.equal(hash(fs.readFileSync(path.join(root,entry.file))),entry.sha256,'Tests changed after run');assert.ok(read('README.md').includes('docs/DEVELOPMENT.md'));assert.ok(read('docs/DEVELOPMENT.md').includes('verification'));}
function docs(){
 evidence();const md=read('README.md');assert.ok(md.length>1000&&md.length<9000,'README should be a concise user guide');for(const match of md.matchAll(/!?\[[^\]]*\]\(([^)]+)\)|<img[^>]+src="([^"]+)"/g)){const file=match[1]||match[2];if(!/^(https?:|#)/.test(file))assert.ok(fs.existsSync(path.resolve(root,file)),`Broken README link ${file}`);}
 const desktop=json('docs/verification/desktop-results.json');for(const file of desktop.screenshots){const png=fs.readFileSync(path.join(root,'docs/screenshots',file));assert.equal(png.subarray(1,4).toString(),'PNG');assert.ok(png.length>20000);assert.equal(hash(png),desktop.screenshotHashes[file],'Screenshot changed after actual capture');}
 assert.equal((read('docs/verification/REPAIRS.md').match(/^### /gm)||[]).length,52);console.log('README_VERIFIED');
}
function ui(){
 evidence();const html=read('index.html');const scripts=[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>m[1]);assert.equal(scripts.length,new Set(scripts).size);assert.ok(scripts.every(s=>!/^https?:/.test(s)));
 assert.doesNotMatch(read('script.js'),/ensureDemoSuites|demo_producer_v1|demo_consumer_v1|function loadWebsiteTemplate/);assert.doesNotMatch(read('unit-testing.js'),/createSample|seedSample|initializeSample/);
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);assert.ok((html.match(/class="lvx-icon"/g)||[]).length>50);
 const ico=fs.readFileSync(path.join(root,'assets/icons/lvx-test-studio.ico'));assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),7);
 assert.ok(reports().every(r=>r.checks.some(c=>c.includes('SVG icons with no emoji'))&&r.checks.some(c=>c.includes('no seeded suites'))));console.log('UI_ASSETS_VERIFIED');
}
function future(){
 const destination=path.join(root,'docs/roadmap'),catalog=json('docs/verification/future-work-catalog.json');assert.equal(catalog.length,30);assert.equal(new Set(catalog.map(i=>i.id)).size,30);
 const files=fs.readdirSync(destination).filter(f=>f.endsWith('.md'));assert.equal(files.length,6);const contents=files.map(file=>{const md=fs.readFileSync(path.join(destination,file),'utf8');assert.ok(md.length>1000);if(process.env.LVX_FUTURE_WORK_DIR)assert.equal(md,fs.readFileSync(path.join(path.resolve(process.env.LVX_FUTURE_WORK_DIR),file),'utf8'),'Optional roadmap mirror drift');return md;}).join('\n');
 for(const item of catalog)for(const field of ['id','name','evidence','acceptance'])assert.ok(contents.includes(item[field]),'Missing roadmap '+field+' for '+item.id);console.log('FUTURE_WORK_VERIFIED');
}
const commands={provenance,docs,ui,future};try{const requested=process.argv[2]||'all';if(requested==='all')for(const run of Object.values(commands))run();else{assert.ok(commands[requested],'Unknown check');commands[requested]();}}catch(e){console.error(e);process.exitCode=1;}
