# Pipelines and CI

Assessment date: 2026-10-24. The original gap is retained as historical context. Status below distinguishes implementation, measured verification and external release prerequisites.

## FW-07 · A real headless CI execution service

Priority: **P0**. Status: **VERIFIED**.

Historical source evidence: cicd-integration.js: generated workflow templates.

Original gap: Generated CI templates now validate terminal JSON summaries. The corresponding hosted/headless execution API is not supplied by this desktop repository.

Acceptance criteria: Ship an authenticated CLI/service returning documented total/passed/failed/errors and nonzero exit for failure, error, pending or zero tests; exercise GitHub/GitLab/Jenkins fixtures against it.

Implementation: Authenticated CLI/loopback service, genuine terminal counts and provider templates invoking the shipped runner.

Verification: roadmap-execution.json; roadmap-credential-compat.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

## FW-08 · Parallel graph scheduling and resource locks

Priority: **P1**. Status: **VERIFIED**.

Historical source evidence: graph-engine.js: execute.

Original gap: The DAG runs sequentially after topological sorting. The comment mentions future parallelism, but no scheduler or concurrency control exists.

Acceptance criteria: Run independent nodes concurrently with configurable limits and per-resource locks; preserve dependency isolation, cancellation and deterministic evidence.

Implementation: Parallel dependency scheduler, bounded concurrency and resource locks.

Verification: roadmap-execution.json; roadmap-authoring.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

## FW-09 · Explicit artifact contracts and provenance

Priority: **P1**. Status: **VERIFIED**.

Historical source evidence: graph-engine.js: _resolveInputs.

Original gap: Ancestor filtering is repaired, but artifacts still merge by string key. Two ancestors can publish the same name without an explicit conflict strategy.

Acceptance criteria: Add typed ports, producer/run provenance and validation; reject ambiguous collisions or require an explicit mapping before execution.

Implementation: Typed input/output editors, explicit mappings, collision checks and producer/run provenance.

Verification: roadmap-execution.json; roadmap-authoring.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

## FW-10 · Run history, retries and failure strategies

Priority: **P1**. Status: **VERIFIED**.

Historical source evidence: pipeline-manager.js: runGraphPipeline, runPipeline.

Original gap: Pipelines store lastRun/lastStatus and an in-memory console. There is no durable per-node run graph, retry policy or resumable execution.

Acceptance criteria: Persist every attempt and node state; implement bounded backoff, stop/continue policies and safe rerun-from-failed-node with linked original evidence.

Implementation: Persisted node attempts, bounded retries, failure policy and linked rerun-from-failed evidence.

Verification: roadmap-execution.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

## FW-11 · Versioned workflow schema and graph validation

Priority: **P1**. Status: **VERIFIED**.

Historical source evidence: visual-editor.js: getGraph/loadGraph; graph-engine.js: _getTopologicalSort.

Original gap: Saved graph objects have no formal schema/version migration layer. Cycle errors are handled at run time.

Acceptance criteria: Validate dangling edges, duplicate IDs, missing configuration and cycles before Save/Run; migrate old underscore types without data loss.

Implementation: Versioned graph schema, migration and pre-save/run structural validation.

Verification: roadmap-execution.json; roadmap-e2e-results.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

## FW-12 · Portable workflow import, templates and scheduling

Priority: **P2**. Status: **VERIFIED**.

Historical source evidence: pipeline-manager.js; collaboration.js exports.

Original gap: Test sharing exists; a complete portable workspace/pipeline package and background scheduler do not. Removed automatic demo suites must not return.

Acceptance criteria: Export versioned dependency bundles; offer explicitly chosen templates without seeding user data; add opt-in schedules with missed-run policy and cancellation.

Implementation: Explicit templates, checksummed fixture bundles and workspace-scoped opt-in schedules; imports disable timers.

Verification: roadmap-execution.json; roadmap-runtime-isolation.json; roadmap-host.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

