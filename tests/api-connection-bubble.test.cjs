const test = require('node:test');
const assert = require('node:assert/strict');
const model = () => import('../api-atlas.js');
const fixture = () => ({ services: [{id:'client',title:'Frontend'},{id:'server',title:'Platform'},{id:'other',title:'Unrelated'}], apiServices:[{id:'orders',repositoryId:'server',type:'api-service',title:'Orders',evidence:{path:'orders.json'}},{id:'catalogue',repositoryId:'server',type:'api-service',title:'Catalogue',evidence:{path:'catalogue.json'}}], externalNodes:[{id:'external',type:'external',title:'Unknown provider'}], endpoints:[{id:'get-orders',serviceId:'server',apiServiceId:'orders',path:'/orders',method:'GET',evidence:[]},{id:'post-orders',serviceId:'server',apiServiceId:'orders',path:'/orders',method:'POST',evidence:[]},{id:'catalogue-path',serviceId:'server',apiServiceId:'catalogue',path:'/catalogue',method:'GET',evidence:[]},{id:'other-path',serviceId:'other',path:'/orders',method:'GET',evidence:[]}], connections:[{id:'literal',source:'client',target:'server',targetApiServiceId:'orders',endpointId:'get-orders',method:'GET',url:'https://orders.test/orders',evidence:{path:'client.js'}},{id:'configured',source:'client',target:'server',method:'CONFIG',url:'http://platform',defaultOnly:true,evidence:{path:'config.js'}},{id:'unknown',source:'client',externalId:'external',target:null,url:'https://outside.test/get',method:'GET',evidence:{path:'external.js'}}] });
test('A literal connection contains precisely its matched operation', async()=>{
 const {apiSection}=await model();const a=fixture();assert.deepEqual(apiSection(a,'connection','literal').endpoints.map(ep=>ep.id),['get-orders']);assert.equal(apiSection(a,'connection','missing'),null);
});
test('An API-description ownership arrow excludes sibling descriptions in the same repo',async()=>{
 const {apiSection}=await model();assert.deepEqual(apiSection(fixture(),'connection','owns-orders').endpoints.map(ep=>ep.id),['get-orders','post-orders']);
});
test('Configured provider scope retains its runtime caveat and grouped evidence',async()=>{
 const {apiSection}=await model();const a=fixture();a.connections.push({...a.connections[1],id:'second',evidence:{path:'other-config.js'}});const scope=apiSection(a,'connection','configured');assert.equal(scope.endpoints.length,3);assert.equal(scope.evidence.length,2);assert.match(scope.description,/overridden at runtime/);assert.ok(!scope.endpoints.some(ep=>ep.serviceId==='other'));
 a.connections[1].targetApiServiceId='orders';assert.deepEqual(apiSection(a,'connection','configured').endpoints.map(ep=>ep.id),['get-orders','post-orders']);
});
test('External connections never borrow all endpoints from their caller or an unrelated provider',async()=>{
 const {apiSection}=await model();const a=fixture();assert.equal(apiSection(a,'connection','unknown').endpoints.length,0);a.endpoints.push({id:'reviewed',connectionId:'unknown',serviceId:'client'});assert.deepEqual(apiSection(a,'connection','unknown').endpoints.map(ep=>ep.id),['reviewed']);
});
test('Graph sections and endpoint entry points use stable identities',async()=>{
 const {apiSection,networkMarkup}=await model();const a=fixture();assert.equal(apiSection(a,'node','server').endpoints.length,3);assert.equal(apiSection(a,'node','orders').endpoints.length,2);assert.equal(apiSection(a,'node','external').endpoints.length,0);assert.equal(apiSection(a,'endpoint','post-orders').endpoints[0].method,'POST');assert.equal(apiSection(a,'node','gone'),null);assert.match(networkMarkup(a),/data-aa="section" data-section="orders" role="button" tabindex="0"/);
});
