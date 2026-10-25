'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {_electron}=require('playwright'),{root,sourceManifest,hash}=require('./source-manifest.cjs');
async function run(mode='source'){
 const packaged=mode==='packaged',temporary=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-setup-alignment-')),source=sourceManifest(),checks=[],screenshots=[],errors=[];
 let app;
 try{
  const env={...process.env,LVX_TEST_USER_DATA:path.join(temporary,'profile'),LVX_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({...(packaged?{executablePath:path.join(root,'release/win-unpacked/LVX Test Studio.exe')}:{args:[root]}),cwd:temporary,env});
  const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.waitForFunction(()=>window.LVXStudioInitialized===true);await page.evaluate(()=>LVXStudio.open('start'));await page.locator('.studio-journey > li').first().waitFor();
  const measure=()=>page.locator('.studio-journey > li').evaluateAll(items=>items.map(item=>{const s=getComputedStyle(item,'::before'),r=item.getBoundingClientRect(),heading=item.querySelector(':scope > strong'),h=heading.getBoundingClientRect(),line=parseFloat(getComputedStyle(heading).lineHeight),left=r.left+parseFloat(s.left),top=r.top+parseFloat(s.top),width=parseFloat(s.width),height=parseFloat(s.height);return {number:s.content,gap:h.left-left-width,verticalError:Math.abs(h.top+line/2-top-height/2),aligned:[...item.children].every(child=>Math.abs(child.getBoundingClientRect().left-h.left)<1),fits:item.scrollWidth<=item.clientWidth+1};}));
  // Prove the geometry check detects the original overlap before accepting it.
  const broken=await page.addStyleTag({content:'#studio-task-surface .studio-journey>li {padding:16px!important} #studio-task-surface .studio-journey>li::before {left:0!important;top:24px!important}'});
  assert.ok((await measure()).some(row=>row.gap<0));await broken.evaluate(element=>element.remove());checks.push('Original overlapping layout fails the geometric positive control');
  for(const [label,width,height,zoom,dark]of [['wide',1920,1080,1,false],['laptop',1366,900,1,false],['zoom',1600,1050,2,false],['dark',1600,1050,1,true]]){
   await app.evaluate(({BrowserWindow},{width,height,zoom})=>{const window=BrowserWindow.getAllWindows()[0];window.setContentSize(width,height);window.webContents.setZoomFactor(zoom);window.webContents.setBackgroundThrottling(false);window.showInactive();},{width,height,zoom});
   await page.evaluate(dark=>document.body.classList.toggle('theme-dark',dark),dark);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));if(zoom>1)await page.locator('.studio-journey > li').first().scrollIntoViewIfNeeded();
   const rows=await measure();assert.equal(rows.length,3);for(const row of rows){assert.ok(row.gap>=12,JSON.stringify(row));assert.ok(row.verticalError<=1,JSON.stringify(row));assert.ok(row.aligned&&row.fits,JSON.stringify(row));}checks.push(label+': all three numbers align beside headings; instructions/buttons align and cards do not overflow');
   const file='docs/screenshots/setup-alignment-'+mode+'-'+label+'.png';await (zoom>1?page.locator('.studio-journey'):page).screenshot({path:path.join(root,file)});screenshots.push({file,sha256:hash(fs.readFileSync(path.join(root,file)))});
  }
  assert.deepEqual(errors,[]);assert.equal(sourceManifest().digest,source.digest);
  const report={status:'SUCCESS',version:require('../package.json').version,sourceDigest:source.digest,checks,screenshots,errors,...(packaged?{packageProof:require('./package-manifest.cjs').verifyPackage()}:{})};fs.writeFileSync(path.join(root,'docs/verification/setup-alignment-'+mode+'.json'),JSON.stringify(report,null,2)+'\n');console.log('LVX_SETUP_ALIGNMENT_'+mode.toUpperCase()+'_VERIFIED');
 }finally{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}assert.equal(path.dirname(temporary),os.tmpdir());fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
}
run(process.argv[2]||'source').catch(error=>{console.error(error);process.exitCode=1;});
