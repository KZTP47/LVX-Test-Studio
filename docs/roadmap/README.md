# LVX Test Studio · implementation roadmap

Assessment date: **2026-10-24**. Thirty outcomes across five areas. 27 currently marked VERIFIED; every other status needs the stated verification or external prerequisite.

This is the tracked implementation of the original future-work assessment. Historical gaps remain visible so a configured feature cannot silently be confused with a measured result. The original 52 defect repairs are documented separately in docs/verification/REPAIRS.md.

- [Execution and debugging](01-execution-and-debugging.md)
- [Pipelines and CI](02-pipelines-and-ci.md)
- [Security and trust](03-security-and-trust.md)
- [Data and collaboration](04-data-and-collaboration.md)
- [Product quality and release](05-product-quality-and-release.md)

## Current item status

| Outcome | Status | Remaining |
|---|---|---|
| FW-01 · Preemptible execution and cancellation | VERIFIED | None in stated scope |
| FW-02 · Real Jest, JUnit and NUnit adapters | VERIFIED | None in stated scope |
| FW-03 · A native language runtime registry | VERIFIED | None in stated scope |
| FW-04 · Durable run sessions and process-tree cancellation | VERIFIED | None in stated scope |
| FW-05 · A debugger protocol shared by every engine | VERIFIED | None in stated scope |
| FW-06 · Reusable fixtures and parameter schemas | VERIFIED | None in stated scope |
| FW-07 · A real headless CI execution service | VERIFIED | None in stated scope |
| FW-08 · Parallel graph scheduling and resource locks | VERIFIED | None in stated scope |
| FW-09 · Explicit artifact contracts and provenance | VERIFIED | None in stated scope |
| FW-10 · Run history, retries and failure strategies | VERIFIED | None in stated scope |
| FW-11 · Versioned workflow schema and graph validation | VERIFIED | None in stated scope |
| FW-12 · Portable workflow import, templates and scheduling | VERIFIED | None in stated scope |
| FW-13 · OS-backed credential storage and redaction | VERIFIED | None in stated scope |
| FW-14 · Workspace trust and scoped desktop capabilities | VERIFIED | None in stated scope |
| FW-15 · Actual infrastructure scanner adapters | VERIFIED | None in stated scope |
| FW-16 · Dependency resolution from lockfiles and SBOMs | VERIFIED | None in stated scope |
| FW-17 · Scanner evidence, policy scope and suppressions | VERIFIED | None in stated scope |
| FW-18 · Controlled preview isolation and network policy | VERIFIED | None in stated scope |
| FW-19 · Transactional workspace persistence and backup | VERIFIED | None in stated scope |
| FW-20 · Cross-window conflict detection | VERIFIED | None in stated scope |
| FW-21 · A complete portable project archive | VERIFIED | None in stated scope |
| FW-22 · Authenticated team workspaces and permissions | VERIFIED | None in stated scope |
| FW-23 · Artifact storage and retention controls | VERIFIED | None in stated scope |
| FW-24 · Dataset types, large files and privacy controls | VERIFIED | None in stated scope |
| FW-25 · Accessible application navigation and dialogs | EXTERNAL PREREQUISITE | Automated accessibility-tree, keyboard and 200% zoom controls pass; an actual screen-reader session remains unverified. |
| FW-26 · Capability-aware onboarding and diagnostics | VERIFIED | None in stated scope |
| FW-27 · Signed releases, installer tests and update strategy | EXTERNAL PREREQUISITE | A publisher certificate and a genuinely signed candidate are still required. |
| FW-28 · Portable development and CI verification | EXTERNAL PREREQUISITE | The hosted Windows workflow has no remote execution receipt; local clean-directory evidence is separate. |
| FW-29 · Modular architecture and stable extension API | VERIFIED | None in stated scope |
| FW-30 · Project governance, documentation and release notes | VERIFIED | None in stated scope |

## Evidence boundaries

Source, regression, actual Electron UI, packaged desktop and installer reports carry dates and hashes. Treat old reports as historical after a source change. Hosted CI and a trusted publisher signature require genuine receipts; workflow configuration alone does not satisfy those outcomes. macOS/Linux, paid AI, live external notifications and remote production infrastructure are not certified by local Windows fixtures.
