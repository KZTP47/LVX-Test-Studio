'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..');process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(root,'.external/playwright-browsers');
const {chromium}=require('playwright'),{createServer}=require('../scripts/dev-server.cjs');
const {createService}=require('../services/github-studio/index.cjs');
const {createDemoTransport,DEFAULT_FILES}=require('../services/github-studio/demo-remote.cjs');
async function fixture(t,additionalFiles=[]){
 const sourceFiles=[...DEFAULT_FILES,...additionalFiles,...Array.from({length:600},(_,i)=>({path:`tests/large-${i}.test.ts`,content:`import { it, expect } from 'vitest';\nit('case ${i}', () => { expect(${i}).toBe(${i}); });\n`}))];
 const transport=createDemoTransport({files:sourceFiles}),binding='C:\\fixture';let fail=false,hold=false,release;
 const request=async(url,options)=>{if(fail)throw Error('Offline fixture');if(hold&&url.includes('/git/trees/'))await new Promise(resolve=>{release=resolve;});return transport(url,options);};request.simulated=true;
 const service=createService({getWorkspaceRoot:()=>binding,request}),base={workspaceRoot:binding,repository:transport.state.repository};
 const snapshot=await service.handle('snapshot',{...base,scope:'workflows'}),repo={id:'large-live',fullName:snapshot.fullName,ref:snapshot.ref,commit:snapshot.commit,importedAt:snapshot.importedAt,workflows:snapshot.files.map(f=>({path:f.path,source:f.content,sha:f.sha})),selected:snapshot.files[0].path,example:false};
 let saved={value:{version:1,repositories:[repo]},revision:1};const actions=[];
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
 t.after(async()=>{release?.();await browser.close();await service.close();await new Promise(resolve=>server.close(resolve));});
 const page=await browser.newPage({viewport:{width:1500,height:1000}});page.setDefaultTimeout(8000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('loadingInvoke',async(domain,action,payload)=>{actions.push({domain,action});if(domain==='workspace'){
  if(action==='read')return structuredClone(saved);
  if(action==='transact'){const r=payload.records[0];assert.equal(r.expectedRevision,saved.revision);saved={value:structuredClone(r.value),revision:saved.revision+1};return {changes:[{id:r.id,revision:saved.revision}]};}
  throw Error('Unexpected workspace action '+action);
 }return service.handle(action,payload);});
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.LVXStudioInitialized);
 await page.evaluate(async binding=>{const {mountGitHubWorkflows}=await import('/github-workflows.js');document.body.innerHTML='<main id="loading-fixture"></main>';window.loadingMount=await mountGitHubWorkflows(document.querySelector('main'),{desktop:true,workspaceRoot:binding,invoke:window.loadingInvoke});},binding);
 transport.state.calls.length=0;actions.length=0;
 return {page,errors,actions,state:transport.state,get saved(){return saved;},fail:value=>{fail=value;},hold:()=>{hold=true;},release:()=>{hold=false;release?.();},hasPending:()=>!!release};
}
const settled=page=>page.waitForFunction(()=>document.querySelector('.gs-editor')&&!document.querySelector('.gs-editor').hasAttribute('aria-busy'));

test('matrix viewer reaches variants past 256 and reusable inspection follows 15 files while detecting a genuine cycle',async t=>{
 const nested=Array.from({length:15},(_,i)=>({path:'.github/workflows/nested-'+i+'.yml',content:'on: workflow_call\njobs:\n  nested:\n    uses: ./.github/workflows/nested-'+((i+1)%15)+'.yml\n'}));
 const matrix=Array.from({length:300},(_,i)=>i).join(',');
 const f=await fixture(t,[...nested,{path:'.github/workflows/scale.yml',content:'on: push\njobs:\n  many:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        value: ['+matrix+']\n    steps:\n      - run: echo hi\n  call:\n    uses: ./.github/workflows/nested-0.yml\n'}]),p=f.page;
 await p.getByRole('button',{name:'Edit workflow & tests '+f.state.repository,exact:true}).click();await settled(p);
 await p.locator('[name="workflow-path"]').selectOption('.github/workflows/scale.yml');await settled(p);
 await p.locator('.gs-matrix summary').click();await p.locator('[name="matrix-count"]').fill('257');await p.locator('[data-gs="matrix"]').click();await settled(p);
 assert.equal(JSON.parse(await p.locator('.gs-matrix-result pre').innerText()).length,257);
 await p.locator('[data-gs="matrix-next"]').click();await settled(p);const tail=JSON.parse(await p.locator('.gs-matrix-result pre').innerText());assert.equal(tail.length,43);assert.equal(tail.at(-1).value,299);
 await p.locator('[data-job="call"]').click();await settled(p);await p.locator('[data-gs="reusable"]').click();await settled(p);
 for(let i=1;i<15;i++){await p.locator('[data-gs="nested-reusable"]').click();await settled(p);assert.match(await p.locator('.gs-reusable h4').innerText(),new RegExp('nested-'+i+'\\.yml'));}
 await p.locator('[data-gs="nested-reusable"]').click();await settled(p);assert.match(await p.locator('.gs-notice').innerText(),/cycle detected/);assert.deepEqual(f.errors,[]);
});
test('Edit workflow & tests opens saved sources offline, then loads and caches only selected tests without losing drafts',async t=>{
 const f=await fixture(t),p=f.page;f.fail(true);const start=Date.now();
 await p.getByRole('button',{name:'Edit workflow & tests '+f.state.repository,exact:true}).click();await settled(p);
 assert.equal(await p.locator('.gs-job-nav [data-gs="job"]').count(),2);assert.equal(f.state.calls.length,0);assert.equal(f.actions.some(a=>a.action==='snapshot'),false);
 t.diagnostic('Workflow editor open time (no GitHub reads): '+(Date.now()-start)+' ms');
 await p.locator('[data-gs="source-toggle"]').click();const yaml=p.locator('[name="raw-source"]');await yaml.fill((await yaml.inputValue())+'\n# preserved local draft\n');await p.locator('[data-gs="save-source"]').click();await settled(p);
 await p.locator('[data-tab="tests"]').click();await settled(p);assert.equal(f.state.calls.length,0);
 f.fail(false);await p.locator('[data-gs="browse-tests"]').click();await settled(p);assert.equal(f.state.calls.length,2);assert.equal(await p.locator('[name="test-path"] option').count(),603);
 await p.locator('[name="test-path"]').selectOption('tests/large-599.test.ts');await settled(p);assert.equal(f.state.calls.length,3);assert.equal(await p.locator('[name="case-title"]').inputValue(),'case 599');
 assert.ok(f.saved.value.repositories[0].files.find(f=>f.kind==='workflow').content.includes('preserved local draft'));
 await p.locator('[name="test-path"]').selectOption('tests/large-598.test.ts');await settled(p);assert.equal(f.state.calls.length,4);
 await p.locator('[name="test-path"]').selectOption('tests/large-599.test.ts');await settled(p);assert.equal(f.state.calls.length,4,'Re-selecting cached source must not fetch');
 f.fail(true);await p.locator('[name="test-path"]').selectOption('tests/large-597.test.ts');await settled(p);assert.match(await p.locator('.gs-notice').innerText(),/could not confirm|network/i);assert.equal(await p.locator('[name="test-path"]').inputValue(),'tests/large-599.test.ts');
 await p.locator('[data-gs="back"]').click();await p.locator('.gw-lanes:not([hidden])').waitFor();
 await p.getByRole('button',{name:'Edit workflow & tests '+f.state.repository,exact:true}).click();await settled(p);
 assert.ok(f.saved.value.repositories[0].files.find(f=>f.kind==='workflow').content.includes('preserved local draft'));assert.deepEqual(f.errors,[]);
});
test('slow test inventory can be left safely and late results cannot save into a closed editor',async t=>{
 const f=await fixture(t),p=f.page;
 await p.getByRole('button',{name:'Edit workflow & tests '+f.state.repository,exact:true}).click();await settled(p);
 await p.locator('[data-tab="tests"]').click();await settled(p);f.hold();await p.locator('[data-gs="browse-tests"]').click();
 for(let attempt=0;!f.hasPending()&&attempt<500;attempt++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(f.hasPending(),'Inventory read must reach the delayed transport');
 await p.locator('[data-gs="back"]').click();await p.locator('.gw-lanes:not([hidden])').waitFor();f.release();
 await p.waitForFunction(()=>!document.querySelector('.gs-editor'));await p.locator('[data-action="list"]').click();
 assert.equal(f.saved.revision,1);assert.equal(f.saved.value.repositories[0].files,undefined);assert.deepEqual(f.errors,[]);
});
