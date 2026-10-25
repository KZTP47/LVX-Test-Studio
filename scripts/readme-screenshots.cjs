'use strict';
// Documentation fixtures are deliberately authored in an isolated profile.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {root,sourceManifest}=require('./source-manifest.cjs');
async function run(){
 const packageProof=require('./package-manifest.cjs').verifyPackage();
 const source=sourceManifest(),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-readme-')),workspace=path.join(temporary,'Application checks');fs.mkdirSync(workspace);let app;
 try{
  const env={...process.env,LVX_TEST_USER_DATA:path.join(temporary,'profile'),LVX_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  app=await require('playwright')._electron.launch({executablePath:path.join(root,'release/win-unpacked/LVX Test Studio.exe'),cwd:os.tmpdir(),env});
  const page=await app.firstWindow();page.setDefaultTimeout(20000);await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1440,1000);w.webContents.setBackgroundThrottling(false);w.showInactive();});
  await page.waitForFunction(()=>window.LVXStudioInitialized===true);await app.evaluate(({dialog},workspace)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[workspace]});},workspace);
  await page.getByRole('button',{name:'Choose folder',exact:true}).click();await page.getByRole('button',{name:'Trust selected workspace',exact:true}).click();await page.getByRole('button',{name:'Build a check',exact:true}).last().click();
  await page.getByLabel('Test name',{exact:true}).fill('Verify the application name');await page.getByRole('button',{name:'Add step',exact:true}).click();await page.getByLabel('Value to check',{exact:true}).fill('LVX Test Studio');await page.getByLabel('Expected value',{exact:true}).fill('LVX Test Studio');
  await page.getByRole('button',{name:'Save check',exact:true}).click();await page.waitForFunction(()=>!!LVXStudio.state.record);await page.getByRole('button',{name:'Run check',exact:true}).click();await page.waitForFunction(()=>LVXStudio.state.run?.status==='SUCCESS');
  assert.equal(await page.evaluate(()=>LVXStudio.state.run.total),1);await page.screenshot({path:path.join(root,'docs/screenshots/readme-builder.png')});await page.locator('[data-page="runs"]').click();await page.screenshot({path:path.join(root,'docs/screenshots/readme-runs.png')});
  assert.equal(sourceManifest().digest,source.digest);assert.deepEqual(require('./package-manifest.cjs').packageIdentity(),packageProof);const screenshotProof=require('./proof-screenshots.cjs').preserveScreenshots('readme',['readme-builder.png','readme-runs.png']);
  fs.writeFileSync(path.join(root,'docs/verification/readme-results.json'),JSON.stringify({date:new Date().toISOString(),sourceDigest:source.digest,packaged:true,packageProof,screenshotProof,fixture:'Real visually authored check, actual native child assertion and SQLite record, disposable profile. No normal app data was seeded.'},null,2));console.log('LVX_README_SCREENSHOTS_VERIFIED');
 }finally{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}const resolved=path.resolve(temporary);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('lvx-readme-'))throw Error('Unsafe screenshot fixture cleanup');fs.rmSync(resolved,{recursive:true,force:true,maxRetries:8,retryDelay:250});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
