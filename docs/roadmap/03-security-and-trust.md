# Security and trust

Assessment date: 2026-10-24. The original gap is retained as historical context. Status below distinguishes implementation, measured verification and external release prerequisites.

## FW-13 · OS-backed credential storage and redaction

Priority: **P0**. Status: **VERIFIED**.

Historical source evidence: visual-editor.js: cfg-ai-apikey and node.data.apiKey; script.js: execution_config.

Original gap: API keys/configuration can be persisted with application data or graph objects. There is no central credential reference store or general log/export redactor.

Acceptance criteria: Store secrets with Electron safeStorage/OS facilities, persist opaque references, redact exports/logs and test backups for accidental secret inclusion.

Implementation: OS-encrypted vault, protected legacy configs, opaque references, actual protected HTTP and redacted evidence.

Verification: roadmap-security.json; roadmap-credential-compat.json; roadmap-host.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

## FW-14 · Workspace trust and scoped desktop capabilities

Priority: **P0**. Status: **VERIFIED**.

Historical source evidence: preload.js; main.js: file-ops, sys-ops, git-ops.

Original gap: The renderer can request filesystem and command operations. Running user-authored tests is intentional, but there is no explicit workspace trust/capability model.

Acceptance criteria: Bind each run to a selected workspace, validate IPC payloads and sender, scope read/write/command access and require explicit trust for imported executable workflows.

Implementation: Validated main-frame IPC, canonical workspace scope, imported-code review and stale read/write binding.

Verification: roadmap-security.json; roadmap-host.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

## FW-15 · Actual infrastructure scanner adapters

Priority: **P1**. Status: **VERIFIED**.

Historical source evidence: security-testing.js: scanInfrastructure and Docker/K8s/network scanners.

Original gap: The old green stubs are replaced by explicit unavailable errors. No Docker, Kubernetes or network scanning backend ships in the app.

Acceptance criteria: Implement separately installable, versioned adapters with authorized targets, structured findings, coverage/error state and real positive/negative fixtures.

Implementation: Versioned installable local configuration/network adapters, authorized targets and explicit unsupported modes.

Verification: roadmap-security.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

## FW-16 · Dependency resolution from lockfiles and SBOMs

Priority: **P1**. Status: **VERIFIED**.

Historical source evidence: security-testing.js: DependencyScanner.

Original gap: OSV lookups now fail incomplete coverage for unresolved ranges. Exact direct versions work, but transitive lockfile inventory is absent.

Acceptance criteria: Parse package-lock/pnpm/yarn/Python lockfiles or CycloneDX; deduplicate exact versions, track every lookup and fail incomplete coverage without losing findings.

Implementation: Supported lockfile/SBOM exact-version inventory, deduplication and complete lookup accounting.

Verification: roadmap-security.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

## FW-17 · Scanner evidence, policy scope and suppressions

Priority: **P1**. Status: **VERIFIED**.

Historical source evidence: security-testing.js: SASTScanner, SecretsScanner, checkPolicy.

Original gap: Local checks are pattern based. There is no syntax-aware taint analysis, reviewed suppression workflow or signed coverage record.

Acceptance criteria: Document supported rules/languages, add locations and fingerprints, expiring reviewed suppressions and explicit completeness; never advertise heuristic checks as proof of security.

Implementation: Stated rule coverage, locations/fingerprints, policy scope and expiring reviewed suppressions.

Verification: roadmap-security.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

## FW-18 · Controlled preview isolation and network policy

Priority: **P1**. Status: **VERIFIED**.

Historical source evidence: visual-web-tester.js: iframe execution; main.js: BrowserWindow.

Original gap: Uploaded HTML/JS runs for testing and desktop IPC can execute authored commands. Cross-origin and untrusted-content behavior needs a deliberate trust design.

Acceptance criteria: Separate preview origin/process from privileged renderer, restrict bridge exposure, define CSP/network policy and test that untrusted content cannot access desktop capabilities.

Implementation: Static picker snapshots, isolated browser execution and authenticated allowlisted DOM evidence.

Verification: roadmap-preview.json; roadmap-host.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

