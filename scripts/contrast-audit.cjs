'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {root,sourceManifest}=require('./source-manifest.cjs'),{createServer}=require('./dev-server.cjs');
process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(root,'.external/playwright-browsers');
async function run(){
 const source=sourceManifest(),server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await require('playwright').chromium.launch({headless:true});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.LVXStudioInitialized===true);
  const checks=[];
  for(const theme of ['primary','success','info','warning','danger','purple','gray']){
   await page.evaluate(theme=>{document.getElementById('contrast-fixture')?.remove();const button=document.createElement('button');button.id='contrast-fixture';button.className='aero-button-'+theme;button.textContent='Measured button';button.style.cssText='position:fixed;top:5px;left:5px;padding:12px;z-index:99999';document.body.append(button);},theme);
   for(const state of ['normal','hover']){
    if(state==='hover')await page.locator('#contrast-fixture').hover();else await page.mouse.move(500,500);
    await page.waitForTimeout(250);
    const result=await page.locator('#contrast-fixture').evaluate(el=>{
     const css=getComputedStyle(el),parse=s=>(s.match(/[\d.]+/g)||[]).map(Number),fg=parse(css.color),colors=css.backgroundImage.match(/rgba?\([^)]+\)/g)||[css.backgroundColor];
     const blend=v=>v.slice(0,3).map(c=>(v[3]??1)*c+(1-(v[3]??1))*255);
     const lum=v=>{const a=blend(v).map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});return .2126*a[0]+.7152*a[1]+.0722*a[2];};
     const ratios=colors.map(c=>{const a=lum(fg),b=lum(parse(c));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);});
     return {foreground:css.color,background:css.backgroundImage==='none'?css.backgroundColor:css.backgroundImage,minimumRatio:Math.min(...ratios)};
    });checks.push({theme,state,...result});assert.ok(result.minimumRatio>=4.5,theme+' '+state+' contrast '+result.minimumRatio);
   }
  }
  const consoleContrast=await page.locator('#pipeline-run-modal .bg-gray-800 .text-gray-400').evaluate(el=>({foreground:getComputedStyle(el).color,background:getComputedStyle(el.parentElement).backgroundColor}));assert.equal(consoleContrast.foreground,'rgb(209, 213, 219)');
  assert.equal(sourceManifest().digest,source.digest);fs.writeFileSync(path.join(root,'docs/verification/contrast-results.json'),JSON.stringify({date:new Date().toISOString(),sourceDigest:source.digest,checks,consoleContrast,boundary:'Computed Chromium CSS, normal and hover states; gradients measured at every declared stop. This targeted theme audit is not a whole-product accessibility certification.'},null,2));console.log('LVX_BUTTON_CONTRAST_VERIFIED',checks.length);
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
