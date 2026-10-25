'use strict';
const fs=require('node:fs'),path=require('node:path');const {folder}=require('./build-showcase.cjs');
const outcomes=[
['FW-01','Cancellation','Graph 07; recorded CANCELLED run, downstream remains pending','Recorded'],
['FW-02','Jest / JUnit / NUnit','Graph 05: actual project discovery and native reports','Recorded'],
['FW-03','Runtime registry and languages','Graphs 05/08/09 exercise all ten engines; Setup & diagnostics lists local capabilities','Recorded; runtimes are machine prerequisites'],
['FW-04','Durable runs','Checks & runs contains real terminal runs, node attempts and cancellation','Recorded'],
['FW-05','Debug protocol','Saved JavaScript debugger playground; evidence/debugger.json records real pause/variables/resume','Recorded; interactive stepping only supported for JavaScript'],
['FW-06','Fixtures / typed parameters','Graph 08 and Pricing-fixture-workflow.lvx-workflow.json; quantity range, shared setup and cleanup','Recorded'],
['FW-07','Headless CI','Headless-pricing-workflow.json; authenticated local CLI evidence/headless-run.json','Recorded locally; remote CI credentials not exported'],
['FW-08','Parallel scheduling / locks','Graphs 01/04: fan-out/fan-in, bounded concurrency, exclusive warehouse resource','Recorded'],
['FW-09','Artifact contracts / provenance','Graph 04 correct explicit object ports and producer assertions; Graph 01 retained loadTest misbinding is an agent improvement exercise documented in START HERE','Recorded correct case in graph 04; graph 01 binding is a disclosed defect, not correct load provenance'],
['FW-10','History / retries / failure policy','Graph 04 retries two real 503s; Graph 06 expected red with continued branch; retained native run history','Recorded; rerun-from-failed is a guided action on the red graph'],
['FW-11','Schema and validation','All saved graphs are schemaVersion 1 and passed actual native validation; try creating a cycle in a copy','Recorded valid inputs; invalid-input exercise is guided'],
['FW-12','Portable bundles / schedules','Native project export plus fixture workflow bundle; Graph 08 hourly schedule saved disabled','Recorded; enable scheduling explicitly'],
['FW-13','Protected credentials','Disposable native-vault probe executed and redacted; value was deleted; archive excludes credentials','Recorded; real provider/account keys must be supplied locally'],
['FW-14','Workspace trust','Fresh profile imports through native preview/import and explicitly admits only this lab; no auto execution','Recorded'],
['FW-15','Infrastructure adapter','security/Dockerfile.intentional-risk and actual local-config-v1 findings; install adapter in Security to replay','Recorded textual configuration rules; Docker runtime/production targets require separate setup/authorization'],
['FW-16','Dependency inventory / advisories','security/package-lock.json and evidence/dependency-inventory.json resolve an exact synthetic dependency','Offline inventory recorded; live OSV advisory lookup requires network and a real dependency inventory'],
['FW-17','Scanner evidence / suppressions','Graph 01 policy gate and infrastructure finding fingerprints in Security history','Evidence recorded; expiring reviewed suppressions are a guided local action, not pre-approved risk acceptance'],
['FW-18','Isolated previews / network policy','Real isolated preview screenshot baseline comparison plus saved native baseline; graph 09 visual regression','Recorded; allow external origins explicitly for other websites'],
['FW-19','Transactional persistence','Genuine native checksummed export, fresh-profile import and current record revisions','Recorded'],
['FW-20','Window conflicts','Actual second-window stale save was rejected; see supplemental-checks.json','Recorded'],
['FW-21','Complete portable archive','LVX-Advanced-Showcase.lvx.json + matching workspace bundle; includes native baselines and configuration','Recorded; workspace services/runtimes remain separate prerequisites'],
['FW-22','Team permissions','Local team service rejects anonymous requests and revoked viewer token; see extra-checks.json','Recorded locally; new user identities/tokens required after import'],
['FW-23','Evidence storage / retention','First successful quality run pinned; real artifacts and non-destructive retention preview','Recorded; applying cleanup is an explicit user action'],
['FW-24','Datasets / privacy','CSV four-row streaming validation, reproducible 40-row synthetic dataset and separately masked contacts','Recorded; equality-preserving pseudonymisation is not anonymisation'],
['FW-25','Accessibility','Graph 09 website rules; accessible app controls and readable screenshots','Bounded rules recorded; actual screen-reader session remains external/unverified'],
['FW-26','Onboarding / diagnostics','Setup & diagnostics shows this computer’s runtime/provider capabilities; launcher explains dependencies','Guided local view; no account state is manufactured'],
['FW-27','Signed releases / updates','Existing release/win-unpacked 0.5.0 identity is verified unchanged','External prerequisite: trusted publisher certificate; current build is unsigned'],
['FW-28','Portable development / CI','Real local authenticated headless example and source/package manifest checks','External prerequisite: hosted Windows workflow execution/account billing; no remote CI receipt claimed'],
['FW-29','Extension API / modular architecture','Lab gateway calls native Codex through the shipped transport; project runs via canonical APIs','Recorded use of current APIs; adding an adapter is development work, not a saved UI setting'],
['FW-30','Governance / docs / release','START HERE.md, this coverage, checksums, genuine receipts and existing MIT repository documentation','Delivered']
];
function build(){const archive=JSON.parse(fs.readFileSync(path.join(folder,'LVX-Advanced-Showcase.lvx.json'))),graphs=archive.payload.records.filter(r=>r.collection==='workflows').map(r=>r.value),types=[...new Set(graphs.flatMap(g=>g.nodes.map(n=>n.type)))].sort(),engines=[...new Set(graphs.flatMap(g=>g.nodes.map(n=>n.data.engine||n.data.suite?.language).filter(Boolean)).map(e=>e==='website'?'playwright':e))].sort();const data={date:new Date().toISOString(),nodeTypes:types,engines,outcomes:outcomes.map(([id,feature,example,boundary])=>({id,feature,example,boundary})),coverageDefinition:'Every graph node type and execution engine is runnable; original roadmap outcomes map to recorded cases, explicit guided actions or machine/account prerequisites. No claim that an archive can contain credentials, OS signing or hosted account receipts.'};fs.writeFileSync(path.join(folder,'feature-coverage.json'),JSON.stringify(data,null,2)+'\n');fs.writeFileSync(path.join(folder,'FEATURE-COVERAGE.md'),'# Feature coverage and boundaries\n\n'+data.coverageDefinition+'\n\n'+types.length+' graph node types; '+engines.length+' engines; '+outcomes.length+' original roadmap outcomes.\n\n| ID | Feature | Concrete example | Boundary |\n|---|---|---|---|\n'+outcomes.map(row=>'| '+row.join(' | ')+' |').join('\n')+'\n');return data;}
module.exports={build};if(require.main===module)console.log(build());
