'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const rows=[
 ['Terminable native processes, shared run IDs and process-tree cancellation.','roadmap-execution.json; roadmap-runtime-isolation.json'],
 ['Actual Jest/JUnit/NUnit project discovery, native reports and zero/failure/error controls.','roadmap-execution.json'],
 ['Native runtime registry, version probes, explicit project prerequisites and editable runtime locations.','roadmap-execution.json; roadmap-e2e-results.json'],
 ['Durable execution records, streamed output, interrupted-run recovery and SQLite terminal evidence.','roadmap-execution.json; roadmap-host.json'],
 ['Shared capability protocol; real V8 authored breakpoints, variables and stepping. Other engines explicitly report unavailable interactive debugging.','roadmap-execution.json; roadmap-runtime-isolation.json; roadmap-authoring.json'],
 ['Versioned setup/cleanup fixtures, typed parameters and memory-only secret references.','roadmap-execution.json; roadmap-runtime-isolation.json'],
 ['Authenticated CLI/loopback service, genuine terminal counts and provider templates invoking the shipped runner.','roadmap-execution.json; roadmap-credential-compat.json'],
 ['Parallel dependency scheduler, bounded concurrency and resource locks.','roadmap-execution.json; roadmap-authoring.json'],
 ['Typed input/output editors, explicit mappings, collision checks and producer/run provenance.','roadmap-execution.json; roadmap-authoring.json'],
 ['Persisted node attempts, bounded retries, failure policy and linked rerun-from-failed evidence.','roadmap-execution.json'],
 ['Versioned graph schema, migration and pre-save/run structural validation.','roadmap-execution.json; roadmap-e2e-results.json'],
 ['Explicit templates, checksummed fixture bundles and workspace-scoped opt-in schedules; imports disable timers.','roadmap-execution.json; roadmap-runtime-isolation.json; roadmap-host.json'],
 ['OS-encrypted vault, protected legacy configs, opaque references, actual protected HTTP and redacted evidence.','roadmap-security.json; roadmap-credential-compat.json; roadmap-host.json'],
 ['Validated main-frame IPC, canonical workspace scope, imported-code review and stale read/write binding.','roadmap-security.json; roadmap-host.json'],
 ['Versioned installable local configuration/network adapters, authorized targets and explicit unsupported modes.','roadmap-security.json'],
 ['Supported lockfile/SBOM exact-version inventory, deduplication and complete lookup accounting.','roadmap-security.json'],
 ['Stated rule coverage, locations/fingerprints, policy scope and expiring reviewed suppressions.','roadmap-security.json'],
 ['Static picker snapshots, isolated browser execution and authenticated allowlisted DOM evidence.','roadmap-preview.json; roadmap-host.json'],
 ['SQLite/WAL transactions, durable migrations, quota/recovery controls and visual corrupt-database archive recovery.','roadmap-workspace.json; roadmap-storage-bridge.json; roadmap-recovery.json'],
 ['Actual two-window CAS, field-selection merges, reload, draft export and deleted-record copy.','roadmap-storage-bridge.json; roadmap-authoring.json; roadmap-host.json'],
 ['Checksummed selected record dependencies, binary evidence, native baselines/configuration and precommit validation.','roadmap-workspace.json; roadmap-host.json'],
 ['Authenticated loopback team service, server roles, identity revocation and concurrent revisions.','roadmap-workspace.json; roadmap-e2e-results.json'],
 ['Binary/log/result artifacts by run, disk usage, pinning and previewable retention.','roadmap-workspace.json; roadmap-host.json'],
 ['Typed/ranged/required streaming CSV validation, saved datasets, deterministic generation, masking and explicit row batches.','roadmap-workspace.json; roadmap-authoring.json'],
 ['Named accessibility tree, semantic dialogs, trapped Tab, Escape/focus return, accessible workflow list and 200% zoom.','roadmap-e2e-results.json'],
 ['Guided empty start, runtime/adapter diagnostics, truthful unavailable states, recovery and redacted exports.','roadmap-e2e-results.json; roadmap-authoring.json'],
 ['Protected signing workflow, installer lifecycle/upgrade controls, checksums and verified signed update/rollback policy.','installer-results.json; tests/roadmap-product.test.cjs'],
 ['Pinned preparation, Windows CI configuration, clean-directory installation and actual source/desktop verification.','clean-room-results.json; .github/workflows/verify.yml'],
 ['Explicit service/compiler contracts, typed extension capabilities and dependency-validated synchronous legacy facade with direct SVG.','roadmap-ui-modules.json; tests/roadmap-product.test.cjs'],
 ['Owner-selected MIT, contribution/security/support guidance, issue template and versioned release notes.','LICENSE; CONTRIBUTING.md; SECURITY.md; docs/SUPPORT.md; CHANGELOG.md']
];
const final=process.argv.includes('--final'),digest=require('./source-manifest.cjs').sourceManifest().digest;
if(final){
 const expected=[['regression-results.json','sourceDigest'],['e2e-results.json','source'],['desktop-results.json','source'],['roadmap-e2e-results.json','sourceDigest'],['roadmap-desktop-results.json','sourceDigest'],['clean-room-results.json','sourceDigest']];
 for(const [file,key]of expected){const report=JSON.parse(fs.readFileSync(path.join(root,'docs/verification',file),'utf8')),actual=key==='source'?report.source.digest:report[key];if(actual!==digest)throw Error('Stale/missing final verification: '+file);}
}
const status=Object.fromEntries(rows.map(([implementation,proof],index)=>{
 const id='FW-'+String(index+1).padStart(2,'0');
 const remaining=id==='FW-27'?'A publisher certificate and a genuinely signed candidate are still required.':id==='FW-28'?'The hosted Windows workflow has no remote execution receipt; local clean-directory evidence is separate.':id==='FW-25'?'Automated accessibility-tree, keyboard and 200% zoom controls pass; an actual screen-reader session remains unverified.':final?'':'Current implementation awaits the final frozen-source/package aggregate.';
 return [id,{status:!final?'IMPLEMENTED — VERIFICATION PENDING':['FW-25','FW-27','FW-28'].includes(id)?'EXTERNAL PREREQUISITE':'VERIFIED',implementation,verification:proof.split('; ').concat(final?['final-delivery-results.json','regression-results.json']:[]),remaining,sourceDigest:final?digest:null}];
}));
fs.writeFileSync(path.join(root,'docs/verification/roadmap-status.json'),JSON.stringify(status,null,2));
require('./write-roadmap.cjs');
