# Execution and debugging

Assessment date: 2026-10-24. The original gap is retained as historical context. Status below distinguishes implementation, measured verification and external release prerequisites.

## FW-01 · Preemptible execution and cancellation

Priority: **P0**. Status: **VERIFIED**.

Historical source evidence: unit-testing.js: executeJavaScriptUnitTest; script.js: executePythonCode.

Original gap: Custom scripts execute on the renderer thread. AbortSignal handles cooperative async code, but a synchronous loop cannot be interrupted.

Acceptance criteria: Run scripts in terminable workers/processes; Cancel must stop a deliberate loop within two seconds and leave the editor responsive.

Implementation: Terminable native processes, shared run IDs and process-tree cancellation.

Verification: roadmap-execution.json; roadmap-runtime-isolation.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

## FW-02 · Real Jest, JUnit and NUnit adapters

Priority: **P1**. Status: **VERIFIED**.

Historical source evidence: unit-testing.js: runUnitTest; index.html framework selectors.

Original gap: Unsupported framework modes now fail visibly. There is no installed backend for these engines.

Acceptance criteria: Discover actual project tests, execute their native runners, parse machine-readable results and distinguish zero-tests, failures and runtime errors.

Implementation: Actual Jest/JUnit/NUnit project discovery, native reports and zero/failure/error controls.

Verification: roadmap-execution.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

## FW-03 · A native language runtime registry

Priority: **P1**. Status: **VERIFIED**.

Historical source evidence: script.js: executeJavaCode, executeCSharpCode, loadExecutionConfig.

Original gap: Java/C# execution depends on configured remote services or limited compatibility modes, rather than a managed local JDK/.NET runtime.

Acceptance criteria: Probe installed runtimes, show versions/capabilities, execute native fixtures locally and report missing dependencies before Run.

Implementation: Native runtime registry, version probes, explicit project prerequisites and editable runtime locations.

Verification: roadmap-execution.json; roadmap-e2e-results.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

## FW-04 · Durable run sessions and process-tree cancellation

Priority: **P1**. Status: **VERIFIED**.

Historical source evidence: services/playwright-runner.js; pipeline-manager.js: execution paths.

Original gap: Playwright has a bounded child timeout, but there is no shared run-session API, cancellation token or resumable process registry across engines.

Acceptance criteria: Assign run IDs; stream stdout/stderr; cancel child trees and persist terminal status after renderer reload or crash.

Implementation: Durable execution records, streamed output, interrupted-run recovery and SQLite terminal evidence.

Verification: roadmap-execution.json; roadmap-host.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

## FW-05 · A debugger protocol shared by every engine

Priority: **P1**. Status: **VERIFIED**.

Historical source evidence: debugger.js: TestDebugger; visual-web-tester.js: runTestInDebugMode.

Original gap: Breakpoint/step fixes apply to visual steps. Python, shell and generated repository tests do not expose a unified debugger session.

Acceptance criteria: Provide engine capabilities, breakpoint validation, variable inspection and reliable stop/resume with protocol-level integration tests.

Implementation: Shared capability protocol; real V8 authored breakpoints, variables and stepping. Other engines explicitly report unavailable interactive debugging.

Verification: roadmap-execution.json; roadmap-runtime-isolation.json; roadmap-authoring.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

## FW-06 · Reusable fixtures and parameter schemas

Priority: **P2**. Status: **VERIFIED**.

Historical source evidence: unit-testing.js; script.js: parameters and input_files.

Original gap: Suite parameters and unit setup code are independent, loosely typed inputs. Shared fixtures are copied rather than versioned dependencies.

Acceptance criteria: Add typed parameter validation, reusable setup/cleanup fixtures and explicit secret parameters; cleanup runs even when setup or assertions fail.

Implementation: Versioned setup/cleanup fixtures, typed parameters and memory-only secret references.

Verification: roadmap-execution.json; roadmap-runtime-isolation.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

