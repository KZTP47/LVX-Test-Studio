'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../services/github-studio/test-source.cjs');
const js = source => m.discover({ path: 'tests/a.spec.ts', source });
const cases = discovery => discovery.cases.filter(c => c.kind === 'case');
function preserved(before, result) {
  let expected = before; for (const e of [...result.edits].sort((a, b) => b.start - a.start)) { assert.equal(before.slice(e.start, e.end), e.oldText); expected = expected.slice(0, e.start) + e.newText + expected.slice(e.end); } assert.equal(result.source, expected); assert.equal(result.unchangedOutsideEdits, true);
}
test('AST recognizes aliased imports, nested suites, tags, assertions, routes and source steps without executing', async () => {
  const source = "import { test as check, expect as verify } from '@playwright/test';\nconst fixture = 'keep';\ncheck.describe('Account', {tag:'@account'}, () => {\n check('login @smoke', {tag: ['@fast']}, async ({page}) => {\n  await page.goto('/login');\n  await page.route('**/api', route => route.fulfill({body:'ok'}));\n  await verify(page).toHaveTitle('Login');\n });\n});\n";
  const d = await js(source), [suite, c] = d.cases;
  assert.equal(d.parser, 'typescript-ast'); assert.equal(d.cases.length, 2); assert.equal(c.parentId, suite.id); assert.deepEqual(c.tags, ['@account', '@fast', '@smoke']); assert.equal(c.assertions.length, 1); assert.equal(c.assertions[0].kind, 'toHaveTitle'); assert.equal(c.routes.length, 2); assert.equal(c.steps.length, 3); assert.equal(c.bodySource.includes("await page.goto('/login');"), true);
  assert.equal(source.slice(c.titleRange.start, c.titleRange.end), "'login @smoke'");
});
test('shadowed helpers, fake calls in strings/comments, hooks and runtime skip are not cases', async () => {
  const source = "import { test } from '@playwright/test';\n// test('fake', ()=>{});\nconst fake = `test('fake', ()=>{})`;\nfunction helper(test){ test('shadow',()=>{}); }\n{ const test = ()=>{}; test('local',()=>{}); }\ntest.beforeEach(async()=>{});\ntest('real',()=>{test.skip(true,'reason');});";
  const d = await js(source); assert.deepEqual(cases(d).map(c => c.title), ['real']);
});
test('JSX/TSX, Jest global hint, parameterized and todo declarations stay source templates', async () => {
  const d = await m.discover({ path: 'tests/a.test.tsx', frameworkHint: 'jest', source: "const view = <div>{'test'}</div>; describe('group',()=>{ test.each([[1],[2]])('value %s', a=>{expect(a).toBeTruthy()}); test.todo('later'); });" });
  assert.equal(cases(d).length, 2); assert.equal(cases(d)[0].parameterized, true); assert.equal(cases(d)[1].capabilities.editBody, false); assert.equal(cases(d)[1].title, 'later');
  assert.equal((await js("const test = () => {}; test('ordinary',()=>{});")).cases.length, 0);
});
test('dynamic title, duplicate title and exact revision identities are honest', async () => {
  const s = "import {test} from 'vitest'; const title='a'; test(title,()=>{}); test('same',()=>{}); test('same',()=>{});";
  const d = await js(s); assert.equal(cases(d)[0].dynamic, true); assert.equal(cases(d)[0].capabilities.rename, false); assert.notEqual(d.cases[1].id, d.cases[2].id);
  await assert.rejects(m.mutate({ path:'a.ts',source:s,caseId:d.cases[0].id,operation:{type:'rename',title:'x'} }), /changed|title/i);
});
test('title edit preserves BOM/CRLF/unrelated comments, imports, Unicode, helpers and sibling source', async () => {
  const path='tests/a.spec.ts', source="\uFEFF// \u{1f603} untouched\r\nimport { test } from '@playwright/test';\r\nconst helper = `braces { }`;\r\n// own comment\r\ntest('one',()=>{}); // trailing\r\ntest('two',()=>{});";
  const d=await m.discover({path,source}), result=await m.mutate({path,source,caseId:d.cases[0].id,expectedFingerprint:d.fingerprint,operation:{type:'rename',title:"new ' title\n\u{1f603}"}});
  preserved(source,result); assert.equal(result.source.includes('// trailing\r\ntest(\'two\''),true); assert.equal(result.discovery.cases[0].title,"new ' title\n\u{1f603}"); assert.equal(result.source[0],'\uFEFF');
});
test('body and single assertion edits preserve callback parameters, annotations and unrelated statements', async () => {
  const path='a.ts',source="import {test,expect} from '@playwright/test';\ntest('one', async ({page}: {page:any}) => {\n await page.goto('/');\n expect(1).toBe(1);\n});\nconst after=7;";
  let d=await m.discover({path,source});const a=await m.mutate({path,source,caseId:d.cases[0].id,operation:{type:'assertion',index:0,source:'expect(2).toBe(2)'}});preserved(source,a);assert.match(a.source,/\{page\}: \{page:any\}/);assert.match(a.source,/goto\('\/'\)/);
  const b=await m.mutate({path,source:a.source,caseId:a.discovery.cases[0].id,operation:{type:'body',bodySource:"await page.goto('/other');\nexpect(3).toBe(3);"}});preserved(a.source,b);assert.match(b.source,/const after=7;/);assert.equal(b.discovery.cases[0].assertions.length,1);
});
test('delete removes complete statement but preserves adjacent comments and all unrelated source', async () => {
  const path='a.js',source="import {test} from 'vitest';\n// Keep this explanation\ntest('first',()=>{}); // Keep trailing note\ntest('second',()=>{});";
  const d=await m.discover({path,source}),out=await m.mutate({path,source,caseId:d.cases[0].id,operation:{type:'delete'}});preserved(source,out);assert.match(out.source,/Keep this explanation/);assert.match(out.source,/Keep trailing note/);assert.equal(cases(out.discovery).length,1);
});
test('add picks real test binding under a suite and namespace import rather than describe', async () => {
  for(const source of ["import {describe,it} from 'vitest'; describe('group',()=>{it('existing',()=>{});});", "import * as pw from '@playwright/test'; pw.test.describe('group',()=>{pw.test('existing',()=>{});});"]){const path='a.ts',d=await m.discover({path,source}),out=await m.mutate({path,source,operation:{type:'add',parentId:d.cases[0].id,title:'new',bodySource:'const x = 1;'}});preserved(source,out);assert.equal(cases(out.discovery).length,2);assert.equal(out.discovery.cases.filter(c=>c.kind==='suite').length,1);}
});
test('Playwright tag changes preserve annotations and reject dynamic tag expressions', async () => {
  const path='a.ts',source="import {test} from '@playwright/test'; test('one', {tag:['@old'], annotation:{type:'issue',description:'keep'}}, ()=>{});";
  const d=await m.discover({path,source}),out=await m.mutate({path,source,caseId:d.cases[0].id,operation:{type:'tags',tags:['new']}});preserved(source,out);assert.match(out.source,/description:'keep'/);assert.deepEqual(out.discovery.cases[0].ownTags,['@new']);
  const dynamic=source.replace("['@old']",'tagsFromEnv');const d2=await m.discover({path,source:dynamic});assert.equal(d2.cases[0].capabilities.editTags,false);
});
test('invalid source, stale hashes/IDs and missing index reject; large valid source remains supported', async () => {
  const path='a.ts',source="import {test} from 'vitest'; test('a',()=>{});",d=await m.discover({path,source});
  await assert.rejects(m.mutate({path,source,caseId:d.cases[0].id,expectedFingerprint:'wrong',operation:{type:'delete'}}),e=>e.code==='STALE_SOURCE');
  await assert.rejects(m.mutate({path,source,caseId:'old-id',operation:{type:'delete'}}),e=>e.code==='STALE_CASE');
  await assert.rejects(m.mutate({path,source,caseId:d.cases[0].id,operation:{type:'body',bodySource:'if ('}}),e=>e.code==='INVALID_SOURCE');
  await assert.rejects(m.mutate({path,source,caseId:d.cases[0].id,operation:{type:'assertion',index:7,source:'x'}}),e=>e.code==='INVALID_OPERATION');
  assert.equal((await m.discover({path,source:'//'+'x'.repeat(600*1024)+'\n'+source})).cases.length,1);
  const broken=await m.discover({path,source:"import {test} from 'vitest'; test('a',()=>{"});assert.equal(broken.capabilities.structured,false);
});
test('path validation and unknown languages fail or disclose unsupported capability', async () => {
  for(const path of ['../a.ts','/a.ts','C:/a.ts','a\\b.ts','a/../b.ts'])await assert.rejects(m.discover({path,source:''}),e=>e.code==='INVALID_PATH');
  const d=await m.discover({path:'readme.md',source:'test("fake")'});assert.equal(d.capabilities.structured,false);assert.equal(d.diagnostics[0].code,'UNSUPPORTED_LANGUAGE');
});
test('all scaffold frameworks produce parseable discoverable test source', async () => {
  for(const [framework,path,title]of [['playwright','a.spec.ts','new title'],['vitest','a.test.ts','new title'],['jest','a.test.js','new title'],['pytest','test_a.py','test_new'],['nunit','A.cs','NewTest'],['xunit','A.cs','NewTest'],['mstest','A.cs','NewTest'],['robot','a.robot','New case']]){const source=m.scaffold({path,framework,title}),d=await m.discover({path,source});assert.equal(cases(d).length,1,framework);assert.equal(d.diagnostics.some(d=>d.severity==='error'),false,framework);}
});
test('real Python AST handles decorators, class nesting, async tests, marks and UTF16 Unicode spans', async () => {
  const path='test_api.py',source='# \u{1f603} keep\nimport pytest\n\n@pytest.mark.smoke\n@pytest.mark.parametrize("x", [1,2])\nasync def test_api(x):\n    assert "\u{1f603}" == "\u{1f603}"\n\nclass TestAccount:\n    def test_login(self):\n        assert True\n';
  const d=await m.discover({path,source});assert.equal(d.parser,'tree-sitter-python');assert.equal(cases(d).length,2);assert.equal(d.cases[0].parameterized,true);assert.deepEqual(d.cases[0].tags,['smoke']);assert.equal(source.slice(d.cases[0].titleRange.start,d.cases[0].titleRange.end),'test_api');assert.equal(d.cases.at(-1).parentId,d.cases[1].id);assert.equal(d.cases[0].assertions.length,1);
  const out=await m.mutate({path,source,caseId:d.cases[0].id,operation:{type:'rename',title:'test_renamed'}});preserved(source,out);assert.match(out.source,/@pytest.mark.parametrize/);assert.equal(out.discovery.cases[0].title,'test_renamed');
});
test('Python body/add/delete preserve imports and sibling members; inline syntax is explicit', async () => {
  const path='test_a.py',source='import pytest\n# Keep helper\nhelper = 3\n\nclass TestMath:\n    def test_one(self):\n        assert 1 == 1\n\n    def test_two(self):\n        assert 2 == 2\n';
  let d=await m.discover({path,source}),out=await m.mutate({path,source,caseId:cases(d)[0].id,operation:{type:'body',bodySource:'assert 3 == 3\nassert True'}});preserved(source,out);assert.equal(cases(out.discovery)[0].assertions.length,2);
  const added=await m.mutate({path,source:out.source,operation:{type:'add',parentId:out.discovery.cases[0].id,title:'test_three',bodySource:'assert True'}});assert.equal(cases(added.discovery).length,3);assert.match(added.source,/helper = 3/);
  const del=await m.mutate({path,source:added.source,caseId:cases(added.discovery)[0].id,operation:{type:'delete'}});assert.equal(cases(del.discovery).length,2);assert.match(del.source,/def test_two/);
  const inline=await m.discover({path,source:'def test_inline(): assert True\n'});assert.equal(inline.cases[0].capabilities.editBody,false);
});
test('Python tags require a real pytest binding and preserve parametrize decorators', async () => {
  const path='test_a.py',source='import pytest\n@pytest.mark.parametrize("x", [1])\ndef test_a(x):\n    assert x\n';const d=await m.discover({path,source});const out=await m.mutate({path,source,caseId:d.cases[0].id,operation:{type:'tags',tags:['smoke']}});preserved(source,out);assert.match(out.source,/@pytest.mark.parametrize/);assert.match(out.source,/@pytest.mark.smoke/);
  const source2='def test_a():\n    assert True\n',d2=await m.discover({path,source:source2});await assert.rejects(m.mutate({path,source:source2,caseId:d2.cases[0].id,operation:{type:'tags',tags:['smoke']}}),e=>e.code==='BINDING_REQUIRED');
});
test('real C# AST parses attributes, async/generics, braces in strings, assertions, Unicode and negative attributes', async () => {
  const path='Tests.cs',source='// \u{1f603} keep\nusing NUnit.Framework;\npublic class Account {\n  [Custom("Test")] void Helper() {}\n  [Test, Category("smoke")]\n  public async Task Login() { var x = "{}"; Assert.That(x, Is.Not.Null); }\n}\n';
  const d=await m.discover({path,source});assert.equal(d.parser,'tree-sitter-csharp');assert.equal(cases(d).length,1);const c=cases(d)[0];assert.equal(c.title,'Login');assert.equal(source.slice(c.titleRange.start,c.titleRange.end),'Login');assert.equal(c.assertions.length,1);assert.equal(c.capabilities.editTags,false);
  const out=await m.mutate({path,source,caseId:c.id,operation:{type:'rename',title:'LoginWorks'}});preserved(source,out);assert.match(out.source,/Custom\("Test"\)/);assert.equal(cases(out.discovery)[0].title,'LoginWorks');
});
test('C# body/add/delete and isolated attribute tag edit preserve class structure and unrelated source', async () => {
  const path='Tests.cs',source='using NUnit.Framework;\npublic class A {\n  // keep note\n  [Test]\n  [Category("old")]\n  public void TestOne() { Assert.That(true); }\n  private int Helper() => 7;\n}\n';
  let d=await m.discover({path,source}),out=await m.mutate({path,source,caseId:cases(d)[0].id,operation:{type:'tags',tags:['smoke']}});assert.match(out.source,/Category\("smoke"\)/);assert.match(out.source,/keep note/);
  const body=await m.mutate({path,source:out.source,caseId:cases(out.discovery)[0].id,operation:{type:'body',bodySource:'Assert.That(2, Is.EqualTo(2));'}});assert.equal(cases(body.discovery)[0].assertions.length,1);
  const add=await m.mutate({path,source:body.source,operation:{type:'add',parentId:body.discovery.cases[0].id,title:'TestTwo',bodySource:'Assert.That(true);'}});assert.equal(cases(add.discovery).length,2);assert.match(add.source,/private int Helper\(\) => 7;/);
  const del=await m.mutate({path,source:add.source,caseId:cases(add.discovery)[0].id,operation:{type:'delete'}});assert.equal(cases(del.discovery).length,1);assert.match(del.source,/private int Helper/);
});
test('C# and Python invalid identifiers and malformed bodies reject rather than damaging files', async () => {
  for(const [framework,path,title]of [['nunit','Tests.cs','Good'],['pytest','test_a.py','test_good']]){const source=m.scaffold({path,framework,title}),d=await m.discover({path,source}),c=cases(d)[0];await assert.rejects(m.mutate({path,source,caseId:c.id,operation:{type:'rename',title:'not an identifier'}}),e=>e.code==='INVALID_TITLE');await assert.rejects(m.mutate({path,source,caseId:c.id,operation:{type:'body',bodySource:'if ('}}),e=>e.code==='INVALID_SOURCE');}
});
test('Robot simple table discovers tags/routes/assertions, mutates and preserves settings/other sections', async () => {
  const path='tests/a.robot',source='*** Settings ***\nLibrary    Browser\n\n*** Test Cases ***\nLogin\n    [Tags]    smoke\n    Go To    https://example.com/login\n    Should Be Equal    1    1\n\nOther\n    Log    Keep\n\n*** Keywords ***\nHelper\n    Log    helper\n';
  const d=await m.discover({path,source});assert.equal(cases(d).length,2);assert.equal(d.parser,'robot-table-blocks');assert.deepEqual(d.cases[0].tags,['smoke']);assert.equal(d.cases[0].assertions.length,1);assert.equal(d.cases[0].routes.length,1);
  const out=await m.mutate({path,source,caseId:d.cases[0].id,operation:{type:'tags',tags:['fast']}});preserved(source,out);assert.match(out.source,/\*\*\* Keywords \*\*\*\nHelper\n    Log    helper/);assert.deepEqual(out.discovery.cases[0].tags,['fast']);
  const body=await m.mutate({path,source:out.source,caseId:out.discovery.cases[0].id,operation:{type:'body',bodySource:'Should Be Equal    2    2'}});assert.equal(body.discovery.cases[0].assertions.length,1);
});
test('Robot advanced pipe/continuation/control blocks disclose unsupported structured body edits', async () => {
  for(const source of ['*** Test Cases ***\n| Pipe case |\n| | Log | hi |\n','*** Test Cases ***\nLoop\n    FOR    ${x}    IN    1\n        Log    ${x}\n    END\n','*** Test Cases ***\nA\n    [Tags]    smoke\n    ...    slow\n']){const d=await m.discover({path:'a.robot',source});assert.equal(d.cases[0].capabilities.editBody,false);assert.equal(d.cases[0].capabilities.editTags,false);}
});
test('Robot add/delete inserts in test section before keywords and prevents separator title injection', async () => {
  const path='a.robot',source='*** Test Cases ***\nOne\n    Log    one\n*** Keywords ***\nHelper\n    Log    keep\n';const d=await m.discover({path,source});const out=await m.mutate({path,source,operation:{type:'add',title:'Two',bodySource:'Should Be Equal    1    1'}});assert.equal(cases(out.discovery).length,2);assert.ok(out.source.indexOf('Two')<out.source.indexOf('*** Keywords ***'));
  const del=await m.mutate({path,source:out.source,caseId:out.discovery.cases[0].id,operation:{type:'delete'}});assert.equal(cases(del.discovery).length,1);assert.match(del.source,/Helper\n    Log    keep/);
  await assert.rejects(m.mutate({path,source,caseId:d.cases[0].id,operation:{type:'rename',title:'bad\nInjected'}}),e=>e.code==='INVALID_TITLE');
});
test('CI links simple explicit file commands, infers broad scripts, isolates monorepo directory and reports real orphan', async () => {
  const files=[{path:'tests/a.spec.ts',source:m.scaffold({path:'a.ts',framework:'playwright',title:'a'})},{path:'client/src/a.test.ts',source:m.scaffold({path:'a.ts',framework:'vitest',title:'a'})},{path:'other/test_a.py',source:'def test_a():\n    assert True\n'}];
  const workflows=[{path:'.github/workflows/ci.yml',source:"jobs:\n  browser:\n    steps:\n      - run: npx playwright test tests/a.spec.ts\n  unit:\n    defaults:\n      run:\n        working-directory: client\n    steps:\n      - run: npm test\n"}],packageSources=[{path:'client/package.json',source:JSON.stringify({scripts:{test:'vitest run'}})}];
  const out=await m.inferLinks({workflows,files,packageSources});assert.equal(out.links.length,2);assert.equal(out.links.find(l=>l.filePath==='tests/a.spec.ts').confidence,'explicit');assert.equal(out.links.find(l=>l.filePath.startsWith('client/')).workingDirectory,'client');assert.deepEqual(out.orphans.map(o=>o.path),['other/test_a.py']);
});
test('CI uncertainty for filters, dynamic shell, missing scripts, cyclic scripts and invalid package/workflow is visible', async () => {
  const files=[{path:'a.spec.ts',source:m.scaffold({path:'a.ts',framework:'playwright',title:'a'})}],workflows=[{path:'.github/workflows/ci.yml',source:'jobs:\n  test:\n    steps:\n      - run: npx playwright test --grep @smoke\n      - run: npm run loop\n      - run: echo $(secret)\n'}],packageSources=[{path:'package.json',source:JSON.stringify({scripts:{loop:'npm run loop'}})},{path:'broken/package.json',source:'{'}];const out=await m.inferLinks({workflows,files,packageSources});assert.equal(out.links[0].confidence,'inferred');assert.ok(out.unresolvedSteps.length>=2);assert.ok(out.diagnostics.some(d=>d.code==='INVALID_PACKAGE'));assert.equal((await m.inferLinks({workflows:[{path:'bad.yml',source:'jobs: ['}],files})).diagnostics[0].code,'INVALID_WORKFLOW');
});
test('named hooks, test steps and hoisted/shadowed bindings are negative controls', async () => {
  const source="import {test} from '@playwright/test'; test.beforeEach('named',()=>{}); test.step('step',()=>{}); function outer(){test('hoisted',()=>{});if(true){var test=()=>{};}} const f=function test(){test('local name',()=>{});}; test('actual',()=>{});";
  assert.deepEqual(cases(await js(source)).map(c=>c.title),['actual']);
});
test('adding to an imported empty file and CJS scaffolds uses its actual binding', async () => {
  const path='empty.ts',source="import {test as check} from 'vitest';\n// keep\n";
  const out=await m.mutate({path,source,operation:{type:'add',title:'new',bodySource:'const x=1;'}});assert.equal(cases(out.discovery).length,1);assert.match(out.source,/check\('new'/);preserved(source,out);
  const cjs=m.scaffold({path:'a.test.cjs',framework:'jest',title:'commonjs'});assert.match(cjs,/require\('@jest\/globals'\)/);assert.equal(cases(await m.discover({path:'a.test.cjs',source:cjs})).length,1);
});
test('Playwright tags handle trailing commas and remove title tags without moving unrelated details', async () => {
  const path='a.ts',source="import {test} from '@playwright/test'; test('login @old', {annotation:{type:'issue'},},()=>{});";
  const d=await m.discover({path,source}),out=await m.mutate({path,source,caseId:d.cases[0].id,operation:{type:'tags',tags:['new']}});preserved(source,out);assert.equal(out.discovery.cases[0].title,'login');assert.deepEqual(out.discovery.cases[0].tags,['@new']);assert.match(out.source,/annotation:\{type:'issue'\}/);
});
test('deleting the final Python method preserves a valid class with pass and comments', async () => {
  const path='test_a.py',source='class TestX:\n    # keep explanation\n    def test_one(self):\n        assert True\n';const d=await m.discover({path,source});const out=await m.mutate({path,source,caseId:cases(d)[0].id,operation:{type:'delete'}});preserved(source,out);assert.match(out.source,/# keep explanation/);assert.match(out.source,/    pass/);assert.equal(out.discovery.diagnostics.some(d=>d.severity==='error'),false);
  assert.equal((await m.discover({path,source:'class TestX:\n\n'})).capabilities.structured,false);
});
test('unittest scaffold, inherited framework, assertions and added methods remain discoverable', async () => {
  const path='test_a.py',source=m.scaffold({path,framework:'unittest',title:'test_one'}),d=await m.discover({path,source});assert.equal(cases(d)[0].framework,'unittest');assert.equal(cases(d)[0].assertions.length,1);assert.equal(cases(d)[0].capabilities.editTags,false);
  const out=await m.mutate({path,source,operation:{type:'add',parentId:d.cases[0].id,framework:'unittest',title:'test_two'}});assert.equal(cases(out.discovery).length,2);assert.match(out.source,/self.assertTrue\(True\)/);
  await assert.rejects(m.mutate({path,source,caseId:cases(d)[0].id,operation:{type:'rename',title:'invisible'}}),e=>e.code==='INVALID_TITLE');
});
test('Python multiple marks and C# multiple tag attributes edit without consuming unrelated comments', async () => {
  for(const [framework,path,title]of [['pytest','test_a.py','test_one'],['nunit','A.cs','One'],['xunit','A.cs','One'],['mstest','A.cs','One']]){const source=m.scaffold({path,framework,title,tags:['old','older']}),d=await m.discover({path,source}),c=cases(d)[0];assert.deepEqual(c.ownTags,['old','older'],framework);assert.equal(c.capabilities.editTags,true,framework);const out=await m.mutate({path,source,caseId:c.id,operation:{type:'tags',tags:['new']}});preserved(source,out);assert.deepEqual(cases(out.discovery)[0].ownTags,['new'],framework);}
  const path='A.cs',source='using NUnit.Framework; class A { [Test] [Category("old")] public void One(){} }',d=await m.discover({path,source});assert.equal(cases(d)[0].capabilities.editTags,false);
});
test('Robot case deletion preserves comments between cases and rejects unsupported body templates', async () => {
  const path='a.robot',source='*** Test Cases ***\nOne\n    Log    one\n\n# Keep next explanation\nTwo\n    Log    two\n';const d=await m.discover({path,source});const out=await m.mutate({path,source,caseId:d.cases[0].id,operation:{type:'delete'}});preserved(source,out);assert.match(out.source,/# Keep next explanation/);
  await assert.rejects(m.mutate({path,source,caseId:d.cases[0].id,operation:{type:'body',bodySource:'IF    True\n    Log    x'}}),e=>e.code==='UNSUPPORTED_CONSTRUCT');
});
test('CI chains resolve literal scripts and cd safely; printed runner words do not create links', async () => {
  const files=[{path:'tests/a.spec.ts',source:m.scaffold({path:'a.ts',framework:'playwright',title:'a'})},{path:'src/a.test.ts',source:m.scaffold({path:'a.ts',framework:'vitest',title:'a'})},{path:'client/a.test.ts',source:m.scaffold({path:'a.ts',framework:'vitest',title:'a'})}],packageSources=[{path:'package.json',source:JSON.stringify({scripts:{all:'vitest run && playwright test'}})},{path:'client/package.json',source:JSON.stringify({scripts:{test:'vitest run'}})}];
  const out=await m.inferLinks({files,packageSources,workflows:[{path:'ci.yml',source:'jobs:\n  checks:\n    steps:\n      - run: npm run all\n      - run: cd client && npm test\n      - run: echo playwright test\n'}]});assert.ok(out.links.some(l=>l.framework==='playwright'));assert.ok(out.links.some(l=>l.filePath==='client/a.test.ts'&&l.workingDirectory==='client'));assert.equal(out.links.some(l=>l.command==='echo playwright test'),false);assert.ok(out.unresolvedSteps.some(s=>s.command==='echo playwright test'));assert.ok(out.links.every(l=>l.confidence==='inferred'));
});
test('route discovery recognizes fixture aliases while map.get and ordinary get helpers are negative controls',async()=>{
  const source="import {test} from '@playwright/test'; test('routes',async({page:browserPage,request:api})=>{ const map=new Map(); map.get('key'); helper.get('no'); await browserPage.goto('/yes'); await api.get('/api'); });";
  const d=await js(source);assert.deepEqual(d.cases[0].routes.map(r=>r.value),['/yes','/api']);
});
test('empty Robot test sections add before keywords, preserving the source helper',async()=>{
  const path='a.robot',source='*** Test Cases ***\n\n*** Keywords ***\nHelper\n    Log    keep\n';const out=await m.mutate({path,source,operation:{type:'add',framework:'robot',title:'Added',bodySource:'Log    hi'}});assert.equal(cases(out.discovery).length,1);assert.match(out.source,/\*\*\* Keywords \*\*\*\nHelper\n    Log    keep/);
});
test('cross-framework additions and aliased pytest tags cannot silently generate invalid bindings',async()=>{
  const path='a.ts',source=m.scaffold({path,framework:'vitest',title:'a'});await assert.rejects(m.mutate({path,source,operation:{type:'add',framework:'playwright',title:'wrong'}}),e=>e.code==='BINDING_REQUIRED');
  const py='import pytest as p\ndef test_a():\n    assert True\n',d=await m.discover({path:'test_a.py',source:py});await assert.rejects(m.mutate({path:'test_a.py',source:py,caseId:d.cases[0].id,operation:{type:'tags',tags:['smoke']}}),e=>e.code==='BINDING_REQUIRED');
});

test('pytest suite rename retains collection prefix and ordinary class methods are not flattened', async () => {
  const path='tests/test_collection.py',source='class TestGroup:\n    def test_one(self):\n        assert True\n';
  const d=await m.discover({path,source}),suite=d.cases.find(c=>c.kind==='suite');
  await assert.rejects(m.mutate({path,source,caseId:suite.id,operation:{type:'rename',title:'Gone'}}),{code:'INVALID_TITLE'});
  const out=await m.mutate({path,source,caseId:suite.id,operation:{type:'rename',title:'TestRenamed'}});assert.equal(out.discovery.cases.length,2);
  assert.equal((await m.discover({path,source:source.replace('TestGroup','Helpers')})).cases.length,0);
  const unit='import unittest\nclass Checks(unittest.TestCase):\n    def test_one(self):\n        self.assertTrue(True)\n';const u=await m.discover({path,source:unit});
  assert.match((await m.mutate({path,source:unit,caseId:u.cases[0].id,operation:{type:'rename',title:'RenamedChecks'}})).source,/class RenamedChecks/);
});
test('Robot title CRUD rejects comments, sections, indentation and continuations without losing neighboring cases', async () => {
  const path='tests/a.robot',source='*** Test Cases ***\nOne\n    Log    one\nTwo\n    Log    two\n',d=await m.discover({path,source});
  for(const title of ['# Hidden','*** Settings ***',' Leading','   ','...','... continued']){
    await assert.rejects(m.mutate({path,source,caseId:d.cases[0].id,operation:{type:'rename',title}}),{code:'INVALID_TITLE'});
    await assert.rejects(m.mutate({path,source,operation:{type:'add',title,framework:'robot'}}),{code:'INVALID_TITLE'});
    assert.throws(()=>m.scaffold({path,framework:'robot',title}),{code:'INVALID_TITLE'});
  }
  const out=await m.mutate({path,source,caseId:d.cases[0].id,operation:{type:'rename',title:'Renamed case'}});assert.deepEqual(out.discovery.cases.map(c=>c.title),['Renamed case','Two']);
});
test('C# suite rename requires symbol tooling and cannot leave a constructor under a different class name',async()=>{
  const path='tests/CheckTests.cs',source='using NUnit.Framework; [TestFixture] public class CheckTests { public CheckTests() {} [Test] public void A(){ Assert.That(true); } }';
  const d=await m.discover({path,source}),suite=d.cases.find(c=>c.kind==='suite');assert.equal(suite.capabilities.rename,false);
  await assert.rejects(m.mutate({path,source,caseId:suite.id,operation:{type:'rename',title:'Other'}}),{code:'UNSUPPORTED_CONSTRUCT'});
});
