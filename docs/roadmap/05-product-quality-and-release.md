# Product quality and release

Assessment date: 2026-10-24. The original gap is retained as historical context. Status below distinguishes implementation, measured verification and external release prerequisites.

## FW-25 · Accessible application navigation and dialogs

Priority: **P1**. Status: **EXTERNAL PREREQUISITE**.

Historical source evidence: index.html; styles.css; modal open/close functions.

Original gap: SVG icons, focus-visible styling and reduced motion are added. Full modal focus trapping, return focus, keyboard graph editing and screen-reader coverage remain incomplete.

Acceptance criteria: Audit with a keyboard and screen reader, implement dialog semantics/focus lifecycle and accessible graph alternatives; test common flows at 200% zoom.

Implementation: Named accessibility tree, semantic dialogs, trapped Tab, Escape/focus return, accessible workflow list and 200% zoom.

Verification: roadmap-e2e-results.json; final-delivery-results.json; regression-results.json

Remaining: Automated accessibility-tree, keyboard and 200% zoom controls pass; an actual screen-reader session remains unverified.

## FW-26 · Capability-aware onboarding and diagnostics

Priority: **P1**. Status: **VERIFIED**.

Historical source evidence: index.html: execution/storage settings; script.js: initialization.

Original gap: A fresh profile starts empty. There is no unified capability page explaining which local/remote engines are ready, missing or unsupported.

Acceptance criteria: Show runtime/browser/adapter versions, test connections, actionable recovery and exportable redacted diagnostics; never use a green badge for an unavailable engine.

Implementation: Guided empty start, runtime/adapter diagnostics, truthful unavailable states, recovery and redacted exports.

Verification: roadmap-e2e-results.json; roadmap-authoring.json; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

## FW-27 · Signed releases, installer tests and update strategy

Priority: **P1**. Status: **EXTERNAL PREREQUISITE**.

Historical source evidence: package.json: electron-builder build; main.js.

Original gap: An unpacked Windows build can be verified locally. There is no configured publisher certificate, signed release pipeline or verified auto-update feed.

Acceptance criteria: Add reproducible release CI, signing/secrets management, install/uninstall and upgrade tests, release checksums and a signed rollback-capable update policy.

Implementation: Protected signing workflow, installer lifecycle/upgrade controls, checksums and verified signed update/rollback policy.

Verification: installer-results.json; tests/roadmap-product.test.cjs; final-delivery-results.json; regression-results.json

Remaining: A publisher certificate and a genuinely signed candidate are still required.

## FW-28 · Portable development and CI verification

Priority: **P1**. Status: **EXTERNAL PREREQUISITE**.

Historical source evidence: tests/*.test.cjs; scripts/e2e.cjs.

Original gap: Regression/E2E evidence is local Windows evidence. Python engines and browser payload preparation are explicit requirements; other OS distributions are not validated.

Acceptance criteria: Run clean-clone setup in Windows CI, install pinned test extras and retain screenshots/logs; add macOS/Linux only after real platform jobs pass.

Implementation: Pinned preparation, Windows CI configuration, clean-directory installation and actual source/desktop verification.

Verification: clean-room-results.json; .github/workflows/verify.yml; final-delivery-results.json; regression-results.json

Remaining: The hosted Windows workflow has no remote execution receipt; local clean-directory evidence is separate.

## FW-29 · Modular architecture and stable extension API

Priority: **P2**. Status: **VERIFIED**.

Historical source evidence: script.js; index.html; visual-editor.js.

Original gap: The application still uses large global scripts, inline event handlers and compatibility SVG hydration for legacy dynamic views.

Acceptance criteria: Extract modules with typed contracts, remove global load-order dependencies, publish extension capabilities and migrate remaining legacy renderers to semantic SVG components.

Implementation: Explicit service/compiler contracts, typed extension capabilities and dependency-validated synchronous legacy facade with direct SVG.

Verification: roadmap-ui-modules.json; tests/roadmap-product.test.cjs; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

## FW-30 · Project governance, documentation and release notes

Priority: **P2**. Status: **VERIFIED**.

Historical source evidence: repository root; docs/verification.

Original gap: The original repository had no explicit project license, support policy or release process. A README cannot choose legal licensing on the owner’s behalf.

Acceptance criteria: Owner selects a license; add contribution guidelines, compatibility/support matrix, changelog and issue templates that request reproducible redacted evidence.

Implementation: Owner-selected MIT, contribution/security/support guidance, issue template and versioned release notes.

Verification: LICENSE; CONTRIBUTING.md; SECURITY.md; docs/SUPPORT.md; CHANGELOG.md; final-delivery-results.json; regression-results.json

Remaining: No known acceptance gap in the stated verification scope.

