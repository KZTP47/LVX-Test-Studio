> Historical 0.3.0 migration record. The 0.4.0 visual agent delivery and current source-bound verdict are documented in [Agent Studio](AGENT-STUDIO.md); the older independent verdict applies only to its recorded 0.3.0 digest.

# Machina migration

LVX Test Studio 0.3.0 integrates the richer local Machina branch into the maintained desktop application. The repository root is the product. `apps/lvx-machina` preserves the historical application source with a file-by-file import manifest; it is not a second application bundled into the installer.

The migration is anchored to the supplied Machina ASAR SHA-256 `924f1b90bd2412ba888c9926d0d9b8f0ae92bfca064908aad05b57efc1eafab5`. Environment files, installed dependencies and personal application data were excluded. The original archive was not edited.

## Connected workflows

Open **Graph workflows** from the workbench. Choose a saved workflow or build a new one. Add tasks from the palette, configure them, connect outputs and save. Saved checks and older suites are available as test nodes. Use **Workflows** for the simpler ordered dependency builder.

| Node | Maintained behavior |
|---|---|
| Security Scan | Native source inspection with selected rule families, explicit coverage and findings; configured notification attempts are separate from the inspection result |
| Security Gate | Evaluates connected native scan evidence against severity limits; missing or forged evidence fails |
| Git Repo | Workspace-scoped repository operations and explicit missing-branch fail/create/base policy |
| Unit Test | Real project execution and test discovery with unavailable/zero-test outcomes reported honestly |
| AI Unit Test | Source selection, generation preview, assisted or automated execution, explicit strategy and fallback configuration |
| AI Log Summary | Configured provider summarizes selected native logs and can save the result |
| Log Collector & Zip | Connected, ancestor or full-run log collection into a workspace-scoped ZIP |
| Start Runner | Selected execution scope, stop boundary, per-node attempts and separate master/node log evidence |
| Wait / Delay | Cancellable, bounded native delay |
| API Performance | HTTP assertions and extraction; configured duration/concurrency produce actual measured requests |
| API Contract | Status and JSON structure validation with violations; unsupported schema keywords are rejected |
| AI Code Review | Interactive or automated review, proposal/history/diff, explicit approval or rejection and persistent decision evidence |
| Website UX Auto Tester | HTML, repository or live website audit with routes, scenarios, bounded exploration, browser errors and reports |
| Push & Deploy | Explicit Git push, webhook or reviewed shell operation, with actual process/request receipts |

Undo/redo, selection/deletion, pan/zoom/reset, connection feedback and selected-node ancestor runs are retained. Running and reviewing sessions can be minimized. Expanded output shows the node evidence behind the result. All dedicated tasks use the native workflow service rather than unrestricted renderer execution.

## Fixtures, imports and sessions

**Mocks & sessions** contains five fixture template kinds, generated variable tokens, ordered setup/cleanup actions, CSV/TSV/Excel/JSON/text data, column mappings and all/per-row/selected/sample execution modes. Save a reusable plan or attach it to the current visual check. The check builder displays the attachment and lets you inspect, edit or remove it. The retained suite editor offers the same builder.

Fixture templates create local values. They do not start a database or mock HTTP server. Setup/cleanup actions have defined native effects; custom code is an explicit reviewed action. Cleanup is attempted after failure and cancellation.

Preview legacy JSON or an in-workspace folder before importing. Migration preserves existing records, remaps colliding IDs and connections, and restores compatible views and version histories. Imported executable code and declarative tasks require review in **Project & backup** before execution. Native Studio archives continue to use the checksummed project import flow.

Saved sessions and managed logs have persistent count, age and size retention policies with a cleanup preview. Retention only manages the application's own evidence directories. It does not recursively delete authored project folders.

Use **Storage & cleanup** for execution, scan, screenshot and version count/age policies, quota usage, pinned/dependency protection, preview and retryable cleanup receipts. Interrupted native file cleanup resumes from a durable receipt. Foreign-workspace receipts are preserved for inspection and never replayed against the current project. Shared versions use one SQLite source; the consolidated legacy IndexedDB database can be previewed and migrated explicitly without deleting the original.

Imported device settings remain inactive drafts in **Mocks & sessions** until reviewed. Applying keeps a protected recovery copy. Restorable Windows-encrypted credentials are converted into opaque references on the original account; unavailable encryption requires re-entry. Classic storage connection preferences do not replace the active SQLite workspace.

Light appearance remains the default. Dark appearance is optional and persisted. Save/run/new/search shortcuts are available, alongside graph undo/redo/delete. The Robot website starter is an explicit editor action; first launch remains empty.

## Verification and limits

The feature census, current-source tests, real desktop flows, package and installer receipts live in `docs/verification`. The historical comparison describes the **pre-migration** 0.2.0 baseline and is preserved as such.

Local fixtures exercise real loopback HTTP, generated AI responses, bare Git remotes, shell processes and Chromium. These tests cannot certify a user's credentials, remote deployment permissions, paid model service or notification destination. AI output still requires appropriate review. The contract validator implements a documented supported schema subset, not every JSON Schema dialect. A bounded browser audit is not a complete accessibility or security audit.

The Windows installer is unsigned unless a genuine publisher certificate is configured. No certificate or external-service receipt is fabricated. The final independent AI verdict is recorded separately from implementation reports and is valid only for its exact source digest.
