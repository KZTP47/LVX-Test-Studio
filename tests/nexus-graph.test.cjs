'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),GraphEngine=require('../graph-engine.js');
const graph=(targets=[])=>({nodes:[{id:'start',type:'start-runner',data:{retryTargets:targets}},{id:'test',type:'test-suite',data:{suiteId:'saved'}},{id:'other',type:'wait-delay',data:{}}],edges:[{source:'start',target:'test'}]});
test('legacy deleted/disconnected/disabled retry and stop references migrate without mutating saved input',()=>{
 const input=graph([{nodeId:'deleted',attempts:1},{nodeId:'other',attempts:2},{nodeId:'test',attempts:3}]);input.nodes[0].data.disabledRetryNodeIds=['test','deleted'];input.nodes[0].data.stopNodeId='deleted';const original=structuredClone(input),result=GraphEngine.validate(input);assert.equal(result.valid,true);assert.deepEqual(result.workflow.nodes[0].data.retryTargets,[]);assert.equal(result.workflow.nodes[0].data.stopNodeId,'');assert.ok(result.warnings.length>=3);assert.deepEqual(input,original);assert.equal(GraphEngine.executionPlan(input,{runnerId:'start'}).workflow.nodes.length,2);
});
test('missing retry count means no extra tries; zero survives numeric string migration',()=>{
 for(const attempts of [undefined,0,'0']){const result=GraphEngine.validate(graph([{nodeId:'test',attempts}]));assert.equal(result.valid,true);const plan=GraphEngine.executionPlan(result.workflow,{runnerId:'start'});assert.equal(plan.workflow.nodes[1].retry.maxAttempts,1);}
});
test('retry bounds agree across validation, plan and execution and never retry successful nodes',async()=>{
 for(const retryCount of [0,1,10,20]){const input=graph([{nodeId:'test',attempts:retryCount}]);assert.equal(GraphEngine.validate(input).valid,true);const plan=GraphEngine.executionPlan(input,{runnerId:'start'});let tries=0;const run=await new GraphEngine().execute(plan.workflow,async node=>node.type==='start-runner'?{status:'SUCCESS'}:(tries++,{status:'FAILURE'}));assert.equal(run.status,'FAILURE');assert.equal(tries,retryCount+1);}
 const plan=GraphEngine.executionPlan(graph([{nodeId:'test',attempts:20}]),{runnerId:'start'});let calls=0;await new GraphEngine().execute(plan.workflow,async()=>{calls++;return {status:'SUCCESS'};});assert.equal(calls,2);
});
test('malformed live retry policies fail visibly instead of silently rounding or widening execution',()=>{
 for(const attempts of [-1,21,1.5,'',true,'many'])assert.equal(GraphEngine.validate(graph([{nodeId:'test',attempts}])).valid,false,'invalid '+JSON.stringify(attempts));
 for(const backoffMs of [-1,60001,'many'])assert.equal(GraphEngine.validate(graph([{nodeId:'test',attempts:1,backoffMs}])).valid,false);
 const dup=graph([{nodeId:'test',attempts:1},{nodeId:'test',attempts:2}]);assert.equal(GraphEngine.validate(dup).valid,false);assert.equal(GraphEngine.validate(graph([{nodeId:'test',attempts:1},{nodeId:'test',attempts:1}])).valid,true);
 for(const retryTargets of [null,{},[null],[{attempts:2}]]){const input=graph();input.nodes[0].data.retryTargets=retryTargets;if(retryTargets!==null)assert.equal(GraphEngine.validate(input).valid,false);}
});
test('explicit node retry policies override parent runner retries including legacy executionPolicy',()=>{
 const input=graph([{nodeId:'test',attempts:20}]);input.nodes[1].executionPolicy={retryAttempts:2};const plan=GraphEngine.executionPlan(input);assert.equal(plan.workflow.nodes[1].retry,undefined);assert.equal(GraphEngine.validate(input).valid,true);input.nodes[1].executionPolicy.retryAttempts=30;assert.equal(GraphEngine.validate(input).valid,false);
});
test('cancellation stops retries and distinct graph branches retain independent starts',async()=>{
 const input=graph([{nodeId:'test',attempts:20}]);const controller=new AbortController();let tries=0;const plan=GraphEngine.executionPlan(input,{runnerId:'start'});const result=await new GraphEngine().execute(plan.workflow,async node=>{if(node.id==='test'){tries++;controller.abort();return {status:'FAILURE'};}return {status:'SUCCESS'};},{signal:controller.signal});assert.equal(tries,1);assert.equal(result.status,'CANCELLED');
 const independent=graph();independent.nodes.push({id:'start2',type:'start-runner',data:{}},{id:'test2',type:'test-suite',data:{suiteId:'other'}});independent.edges.push({source:'start2',target:'test2'});assert.deepEqual(GraphEngine.executionPlan(independent,{runnerId:'start'}).workflow.nodes.map(n=>n.id),['start','test']);
});
test('malformed workflow input returns actionable validation errors instead of crashing',()=>{for(const value of [null,undefined,'wrong',12,[]])assert.equal(GraphEngine.validate(value).valid,false);assert.equal(GraphEngine.validate({nodes:[null],edges:[null]}).valid,false);});

test('old machine log destinations become portable once while newly configured paths remain explicit',()=>{
 const input=graph();input.nodes[0].data.downloadLogs=true;input.nodes[0].data.logPath='Z:/missing-machine/old-logs';const result=GraphEngine.validate(input);assert.equal(result.valid,true);assert.equal(result.workflow.nodes[0].data.logPath,'logs/start');assert.equal(result.workflow.nodes[0].data.logDestinationMigration.originalPath,input.nodes[0].data.logPath);assert.ok(result.warnings.some(w=>w.includes('logs/start')));
 const modern=structuredClone(input);modern.nodes[0].data.runnerSettingsVersion=1;assert.equal(GraphEngine.validate(modern).workflow.nodes[0].data.logPath,'Z:/missing-machine/old-logs');const next=GraphEngine.validate(result.workflow);assert.equal(next.workflow.nodes[0].data.logPath,'logs/start');assert.equal(next.workflow.nodes[0].data.logDestinationMigration.originalPath,input.nodes[0].data.logPath);
});
