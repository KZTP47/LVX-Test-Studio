# Data and collaboration

Assessment date: 2026-10-24. The original gap is retained as historical context. Status below distinguishes implementation, measured verification and external release prerequisites.

## FW-19 · Transactional workspace persistence and backup

Priority: **P0**. Status: **VERIFIED**.

Historical source evidence: script.js: LocalStorageBackend; indexeddb-version-storage.js.

Original gap: Concurrent in-process suite mutations are repaired. Suites/settings/history remain split across localStorage and IndexedDB rather than one transactional workspace store.

Acceptance criteria: Introduce schema-versioned SQLite/IndexedDB storage, transactional multi-record changes, export/import backup and recovery tests for quota, abort, corruption and interrupted migration.

Implementation: SQLite/WAL transactions, durable migrations, quota/recovery controls and visual corrupt-database archive recovery.

Verification: roadmap-workspace.json; roadmap-storage-bridge.json; roadmap-recovery.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

## FW-20 · Cross-window conflict detection

Priority: **P1**. Status: **VERIFIED**.

Historical source evidence: script.js: LocalStorageBackend pending queue; collaboration.js.

Original gap: The mutation queue protects one renderer. Multiple windows/processes or cloud writers do not share that queue or revision compare-and-swap.

Acceptance criteria: Use record revisions and atomic writes; surface conflict UI, merge/reload choices and tests with two actual app windows.

Implementation: Actual two-window CAS, field-selection merges, reload, draft export and deleted-record copy.

Verification: roadmap-storage-bridge.json; roadmap-authoring.json; roadmap-host.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

## FW-21 · A complete portable project archive

Priority: **P1**. Status: **VERIFIED**.

Historical source evidence: collaboration.js: exportForTeam; data-manager.js; environment-manager.js.

Original gap: Sharing covers suites/snapshots. Referenced datasets, environment secrets, baselines, pipelines and artifact history are not one validated portable archive.

Acceptance criteria: Define an archive manifest with checksums/schema, include selected dependencies, exclude secrets by default and validate/preview imports before atomic commit.

Implementation: Checksummed selected record dependencies, binary evidence, native baselines/configuration and precommit validation.

Verification: roadmap-workspace.json; roadmap-host.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

## FW-22 · Authenticated team workspaces and permissions

Priority: **P1**. Status: **VERIFIED**.

Historical source evidence: collaboration.js; script.js: FirebaseBackend, PostgRESTBackend.

Original gap: Share/export helpers and configurable storage are not a full team service with roles, audit log, conflict resolution and tenant isolation.

Acceptance criteria: Provide authenticated identities, owner/editor/viewer policies, revocable shares, server-enforced authorization and concurrent edit tests.

Implementation: Authenticated loopback team service, server roles, identity revocation and concurrent revisions.

Verification: roadmap-workspace.json; roadmap-e2e-results.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

## FW-23 · Artifact storage and retention controls

Priority: **P1**. Status: **VERIFIED**.

Historical source evidence: advanced-assertions.js: baseline_screenshots; reporting-dashboard.js: test_execution_history.

Original gap: Screenshots/history use browser storage with fixed caps. There is no configurable filesystem artifact repository, quota management or retention UI.

Acceptance criteria: Store binary artifacts by run ID, show disk usage, configure retention and pin evidence; deletions must preserve pinned runs and report recoverable errors.

Implementation: Binary/log/result artifacts by run, disk usage, pinning and previewable retention.

Verification: roadmap-workspace.json; roadmap-host.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

## FW-24 · Dataset types, large files and privacy controls

Priority: **P2**. Status: **VERIFIED**.

Historical source evidence: data-manager.js: parseCSV, saveDataSet, replaceVariables.

Original gap: CSV escaping and literal replacement are repaired. There is no typed schema, streaming import or masking/generation policy for sensitive columns.

Acceptance criteria: Validate required/type/range constraints with row-level errors, stream large inputs and offer deterministic synthetic data plus opt-in masking.

Implementation: Typed/ranged/required streaming CSV validation, saved datasets, deterministic generation, masking and explicit row batches.

Verification: roadmap-workspace.json; roadmap-authoring.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

