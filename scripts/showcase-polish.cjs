'use strict';
const fs=require('node:fs'),path=require('node:path');const {folder,launch}=require('./build-showcase.cjs');const {hash}=require('./source-manifest.cjs');
async function run(){const report=JSON.parse(fs.readFileSync(path.join(folder,'evidence/build-results.json'))),{app,page}=await launch(report.profile);try{
 await page.locator('[data-page="graph"]').click();await page.locator('#machina-workflow-select').selectOption(report.workflowIds[0]);await page.locator('#machina-workflow-open').click();await page.locator('.ve-node').first().waitFor();
 await page.evaluate(()=>{const e=LVXStudio.graphEditor,m=e._getGraphMetrics();e.scale=Math.max(.35,Math.min(.65,(e.canvas.clientWidth-440)/(m.maxX-m.minX)));e.panning={x:300-(m.minX+e.graphOrigin.x)*e.scale,y:120-(m.minY+e.graphOrigin.y)*e.scale};e._applyViewportTransform();});await page.waitForTimeout(250);await page.screenshot({path:path.join(folder,'evidence/advanced-graph.png')});
 await page.locator('[data-page="agentBoard"]').click();await page.locator('[name="saved-board"]').selectOption(report.boardId);await page.locator('[data-ab-action="load"]').click();await page.locator('[data-ab-action="fit"]').click();await page.locator('[data-agent-id="reviewer"]').first().click();await page.locator('[data-ab-action="save"]').click();await page.waitForTimeout(300);await page.screenshot({path:path.join(folder,'evidence/live-agent-council.png')});
 report.screenshots=report.screenshots.map(s=>({...s,sha256:hash(fs.readFileSync(path.join(folder,s.file)))}));fs.writeFileSync(path.join(folder,'evidence/build-results.json'),JSON.stringify(report,null,2)+'\n');console.log('LVX_SHOWCASE_SCREENSHOTS_CAPTURED');
 }finally{await app.close();}}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
