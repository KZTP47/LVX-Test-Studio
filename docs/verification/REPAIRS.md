# Repair and verification record

Assessment date: 2026-10-24. Baseline: `9f7e70226af0b11dbcb079253f48fe8c7f402b09`.

All **52 original findings** have individual source and regression mappings below. The three repair leaves introduced 66 focused tests; retained historical regressions and integration controls bring the current complete `npm test` suite to 114 tests. Actual browser/Electron execution is recorded separately; VM fixtures are not described as live external integrations.

An unavailable backend now fails visibly rather than returning fabricated clean evidence. This fixes false-success defects without claiming those missing engines are implemented. See [future work](../roadmap/README.md) for the distinction.

## Original findings

### B01 · OSV severity arrays cause vulnerable dependencies to disappear

**Correction:** OSV severity arrays and database fallback are parsed; CVSS v3 base scores are calculated. Unsupported severities remain UNKNOWN findings and block policy.

**Source:** [security-testing.js](../../security-testing.js), [tests/browser.test.cjs](../../tests/browser.test.cjs).

**Regression:** B01: standard OSV arrays, empty fallback and unknown CVSS retain every finding.

### B02 · Unavailable dependency scans become cached policy passes

**Correction:** Network/HTTP/invalid response and unresolved-version errors remain explicit incomplete coverage, preserve successful findings and are never cached as clean scans.

**Source:** [security-testing.js](../../security-testing.js), [tests/browser.test.cjs](../../tests/browser.test.cjs).

**Regression:** B02: rejected/non-OK dependency lookups remain ERROR and retry rather than cache clean.

### B03 · Infrastructure scanner stubs violate the manager result contract

**Correction:** Infrastructure returns normalized arrays or backend evidence; unavailable scanners and malformed results return ERROR with policyPassed=false and visible unavailable UI. Optional backend delegation is used only if supplied.

**Source:** [security-testing.js](../../security-testing.js), [security-ui.js](../../security-ui.js), [tests/browser.test.cjs](../../tests/browser.test.cjs).

**Regression:** B03: unavailable infrastructure is an explicit ERROR; array and backend object normalize.

### B04 · Policy early returns ignore configured vulnerability maxima

**Correction:** Every numeric maximum is checked independently, then cumulative fail-on severity rules apply; unknown findings cannot pass.

**Source:** [security-testing.js](../../security-testing.js), [tests/browser.test.cjs](../../tests/browser.test.cjs).

**Regression:** B04: every numeric maximum applies before fail-on severity, including low fail-on.

### B10 · Asynchronous JavaScript unit tests report PASS before completion

**Correction:** Custom JavaScript awaits test promises and await-based setup/teardown, reports asynchronous failures and provides a cooperative AbortSignal timeout. Early setup returns cannot silently skip tests.

**Source:** [unit-testing.js](../../unit-testing.js), [tests/browser.test.cjs](../../tests/browser.test.cjs).

**Regression:** B09/B10/B11: shared const fixtures, awaited promises and teardown on failure; B10: cooperative async timeout fails and aborts its test signal.

### B12 · Python framework tests are defined but never discovered or run

**Correction:** Python unittest invokes the real loader/runner; pytest invokes real package discovery/main and reads executed counts. Empty tests and unavailable engines fail visibly. Unsupported Jest/Java/.NET modes are not treated as successful browser scripts.

**Source:** [unit-testing.js](../../unit-testing.js), [tests/browser.test.cjs](../../tests/browser.test.cjs).

**Regression:** B11/B12: actual unittest discovery executes failures and always runs teardown; B12: actual pytest discovery never passes a failing or empty suite.

### B13 · Live runner advanced checks inspect the creator preview instead

**Correction:** Every advanced action receives the actual execution window. An awaited isolated visual executor supports pipeline callers and removes its owned iframe.

**Source:** [visual-web-tester.js](../../visual-web-tester.js), [advanced-assertions.js](../../advanced-assertions.js), [tests/browser.test.cjs](../../tests/browser.test.cjs).

**Regression:** B13/B19: every advanced step receives runner window and exact threshold stays zero; B13/B14: awaitable pipeline visual execution inspects its own page and removes its iframe.

### B21 · Visual builders generate Robot code without required cell separators

**Correction:** Both builders and editor snippets emit proper Robot cells, literal escaped arguments and multiline continuation rows. Universal keyword names match Selenium. Advanced checks save as visual steps; external Robot uses an explicit Fail rather than skipping those checks.

**Source:** [nocode-builder.js](../../nocode-builder.js), [visual-web-tester.js](../../visual-web-tester.js), [monaco-config.js](../../monaco-config.js), [tests/browser.test.cjs](../../tests/browser.test.cjs).

**Regression:** B21: generators emit real Robot cells and continuation arguments, and prevent unsupported external checks from passing; B21: actual Robot dry-run accepts both builders; execution preserves multiline literal arguments; B21: Monaco completion snippets retain complete keywords and separate every argument cell.

### DRV-01 · Playwright desktop runner depends on external Node and launch-directory dependencies

**Correction:** process.execPath plus ELECTRON_RUN_AS_NODE; explicit Playwright module root and bundled browser path; os.tmpdir execution directory. Main accepts isolated profile/hidden window for parent Electron E2E.

**Source:** [services/playwright-runner.js](../../services/playwright-runner.js), [main.js](../../main.js), [tests/execution.test.cjs](../../tests/execution.test.cjs).

**Regression:** DRV-01 child runner uses packaged Electron Node and explicit module/browser paths outside launch cwd; DRV-01 real child runtime resolves shipped Playwright without launch-directory modules.

### EXE-01 · Graph pipelines report failing nodes as SUCCESS and continue execution

**Correction:** Canonical SUCCESS/FAILURE/ERROR including legacy aliases; failure/error prevents stop-policy dependents. Unknown outcomes are ERROR.

**Source:** [graph-engine.js](../../graph-engine.js), [tests/execution.test.cjs](../../tests/execution.test.cjs).

**Regression:** EXE-01 graph treats production FAILURE/ERROR and legacy aliases truthfully and stops dependents.

### EXE-02 · Security nodes created by the visual editor never reach the graph security handlers

**Correction:** Canonical hyphen node types with intentional underscore import aliases; actual palette drop reaches scan handler.

**Source:** [pipeline-manager.js](../../pipeline-manager.js), [visual-editor.js](../../visual-editor.js), [graph-engine.js](../../graph-engine.js), [tests/execution.test.cjs](../../tests/execution.test.cjs).

**Regression:** EXE-02 canonical security palette nodes and legacy underscore imports dispatch actual scan handlers; EXE-02 palette drop dispatches the same canonical types through the graph.

### EXE-03 · Security gate cannot receive the preceding scan's results

**Correction:** Scans publish artifacts.securityResults; connected ancestor scan evidence reaches gates, aggregated across branches. Missing, failed, malformed, unrelated or partial evidence cannot pass.

**Source:** [pipeline-manager.js](../../pipeline-manager.js), [graph-engine.js](../../graph-engine.js), [tests/execution.test.cjs](../../tests/execution.test.cjs).

**Regression:** EXE-03 connected scans reach gates; missing/unavailable or unrelated evidence cannot pass; EXE-03 unavailable, incomplete, or unreadable scans stay ERROR instead of passing gates.

### EXE-04 · Website test result contract makes every successful website test fail

**Correction:** Shared core normalizes structured adapter status instead of checking only result.success. Website load event installed before src and timer cleared.

**Source:** [script.js](../../script.js), [tests/execution.test.cjs](../../tests/execution.test.cjs).

**Regression:** EXE-04 actual website adapter status survives shared suite result normalization.

### EXE-06 · Successful test summaries containing '0 failed' are reclassified as failures

**Correction:** Removed stdout keyword heuristics; runner status/exit result is authoritative.

**Source:** [script.js](../../script.js), [tests/execution.test.cjs](../../tests/execution.test.cjs).

**Regression:** EXE-06 stdout diagnostics never override authoritative success or failure.

### EXE-07 · Pipeline execution silently skips configured data-driven rows

**Correction:** Silent affects presentation, not dataset coverage. Every row runs with pipeline inputs, substituted expected output and saved file contents.

**Source:** [script.js](../../script.js), [tests/execution.test.cjs](../../tests/execution.test.cjs).

**Regression:** EXE-07 silent pipeline runs every configured row and passes graph inputs without UI.

### EXE-09 · Concurrent local-storage mutations overwrite each other

**Correction:** Local read-modify-write commits synchronously before any await; concurrent mutations cannot use stale snapshots. View unassignment and tag batches await storage.

**Source:** [script.js](../../script.js), [tests/execution.test.cjs](../../tests/execution.test.cjs).

**Regression:** EXE-09 concurrent creates updates deletes and view unassignment preserve every mutation.

### S01 · Migrating version history disconnects it from the active version-control UI

**Correction:** Active version-control and UI now await one backend, preserve and verify migration originals, serialize saves, keep already committed histories visible if another legacy record fails, invalidate markers on fallback writes.

**Source:** [indexeddb-version-storage.js](../../indexeddb-version-storage.js), [version-control.js](../../version-control.js), [tests/storage.test.cjs](../../tests/storage.test.cjs).

**Regression:** S01 verified migration; S01 integration hunt; S01 fallback writes.

### S04 · Collaboration imports and snapshot restores report success without persisting

**Correction:** File imports, backend imports and restores await configured saveSuite/updateSuite and LVXApp.refreshSuites; failures show error without premature mutation; backend imports receive fresh local IDs.

**Source:** [collaboration.js](../../collaboration.js), [collaboration-ui.js](../../collaboration-ui.js), [collaboration-ui2.js](../../collaboration-ui2.js), [tests/storage.test.cjs](../../tests/storage.test.cjs).

**Regression:** S04/S05 public file export/import; S04 backend import and snapshot restore.

### S13 · Generated CI pipelines can succeed when executed tests fail

**Correction:** All three generated providers embed the same structural JSON gate requiring terminal nonempty integer summary, no failed/error counts or error statuses, valid totals, and no failed detailed outcomes. Missing/pending/invalid evidence fails CI.

**Source:** [cicd-integration.js](../../cicd-integration.js), [tests/storage.test.cjs](../../tests/storage.test.cjs).

**Regression:** S13 all generated CI gates.

### B05 · Saving a zero vulnerability limit silently restores defaults

**Correction:** Zero is preserved, blank fields use defaults, and fractional/negative values show validation errors without saving.

**Source:** [security-ui.js](../../security-ui.js), [tests/browser.test.cjs](../../tests/browser.test.cjs).

**Regression:** B05: policy UI preserves zero and rejects negative/fractional maxima.

### B06 · Security Center suite actions reference an unimplemented storage API

**Correction:** Security suite save, selected-suite scan and refresh use the configured awaited LVXApp storage interface.

**Source:** [security-ui.js](../../security-ui.js), [tests/browser.test.cjs](../../tests/browser.test.cjs).

**Regression:** B06: save and selected-suite scan use awaited configured LVXApp storage.

### B07 · Critical vulnerabilities sort after Low in scan results

**Correction:** Nullish fallback preserves critical severity rank zero when rendering mixed findings.

**Source:** [security-ui.js](../../security-ui.js), [tests/browser.test.cjs](../../tests/browser.test.cjs).

**Regression:** B07: result rendering orders critical before high and low.

### B08 · Saving scan history permanently drops records beyond51

**Correction:** History reads the full retention window before appending and stores detail/error evidence; 120 writes retain exactly the newest 100.

**Source:** [security-testing.js](../../security-testing.js), [tests/browser.test.cjs](../../tests/browser.test.cjs).

**Regression:** B08: history retains 100 scans with details and newest-first identity.

### B09 · JavaScript unit setup variables are out of scope in the test

**Correction:** Setup const/let declarations share lexical bindings with async test and teardown closures; an explicit fixture object is also available.

**Source:** [unit-testing.js](../../unit-testing.js), [tests/browser.test.cjs](../../tests/browser.test.cjs).

**Regression:** B09/B10/B11: shared const fixtures, awaited promises and teardown on failure.

### B11 · Unit test failures skip teardown

**Correction:** Both languages execute cleanup in finally. JavaScript cleanup closures retain initialized setup bindings even if later setup fails; primary and cleanup errors are separate.

**Source:** [unit-testing.js](../../unit-testing.js), [tests/browser.test.cjs](../../tests/browser.test.cjs).

**Regression:** B09/B10/B11: shared const fixtures, awaited promises and teardown on failure; B11/B12: actual unittest discovery executes failures and always runs teardown.

### B14 · Accessibility check passes completely unlabelled controls without IDs

**Correction:** Every input/select/textarea is checked for accessible naming including no-ID, associated/wrapping labels, ARIA and relevant native names; hidden controls are excluded.

**Source:** [advanced-assertions.js](../../advanced-assertions.js), [tests/browser.test.cjs](../../tests/browser.test.cjs).

**Regression:** B14: unlabelled controls without IDs fail; associated, wrapping and ARIA names pass; B13/B14: awaitable pipeline visual execution inspects its own page and removes its iframe.

### B15 · Notification delivery ignores each integration's selected events

**Correction:** Delivery filters each integration by its own all/success/failure preferences and normalized result status.

**Source:** [integrations.js](../../integrations.js), [tests/browser.test.cjs](../../tests/browser.test.cjs).

**Regression:** B15: each integration receives only its configured success/failure event.

### B16 · Duplicate DOM IDs route collaboration actions to unrelated controls

**Correction:** Shared root/storage dependency verified: collaboration input/list have distinct IDs and version rendering cannot overwrite standalone controls.

**Source:** [index.html](../../index.html), [collaboration-ui2.js](../../collaboration-ui2.js), [tests/browser.test.cjs](../../tests/browser.test.cjs).

**Regression:** B16: collaboration IDs are unique and version rendering leaves standalone versions intact.

### B18 · Debugger Resume executes one step then pauses again

**Correction:** Debugger tracks run/step state, pauses exactly at requested boundaries, handles Stop while paused, exposes live controls and preserves error outcomes after cleanup.

**Source:** [debugger.js](../../debugger.js), [visual-web-tester.js](../../visual-web-tester.js), [tests/browser.test.cjs](../../tests/browser.test.cjs).

**Regression:** B18: Resume runs to completion, Step pauses once, and Stop unblocks breakpoints; B18: debugger retains error status and failure details after cleanup.

### B19 · Zero screenshot tolerance silently allows five percent difference

**Correction:** Zero screenshot tolerance remains zero with validated 0..100 input; exact mode detects any changed RGB or alpha channel.

**Source:** [visual-web-tester.js](../../visual-web-tester.js), [advanced-assertions.js](../../advanced-assertions.js), [tests/browser.test.cjs](../../tests/browser.test.cjs).

**Regression:** B13/B19: every advanced step receives runner window and exact threshold stays zero; B19: exact image comparison detects one-channel and alpha-only differences.

### B20 · Element picker emits invalid selectors for literal punctuation in IDs

**Correction:** Identifier components use CSS.escape (with fallback), attribute strings are escaped, and each proposed selector is validated against the picked element.

**Source:** [element-picker.js](../../element-picker.js), [tests/browser.test.cjs](../../tests/browser.test.cjs).

**Regression:** B20: selector proposals escape literal punctuation, digits and attribute quotes.

### EXE-05 · Saved input files are discarded by all language execution adapters

**Correction:** All Python/Java/CSharp adapters read persisted input_files; legacy inputFiles retained as fallback.

**Source:** [script.js](../../script.js), [tests/execution.test.cjs](../../tests/execution.test.cjs).

**Regression:** EXE-05 saved input_files delivered to Python Java CSharp with legacy migration.

### EXE-08 · Each data-driven execution appends a duplicate suite instead of updating it

**Correction:** Data-driven completion updates existing suite metadata by id; no create call.

**Source:** [script.js](../../script.js), [tests/execution.test.cjs](../../tests/execution.test.cjs).

**Regression:** EXE-08 data-driven completion updates one existing suite on repeated runs.

### EXE-10 · Expected Output is stored but never checked when running tests

**Correction:** Shared core asserts exact Expected Output after CRLF normalization and removing one terminal newline, for ordinary and every data-driven row.

**Source:** [script.js](../../script.js), [tests/execution.test.cjs](../../tests/execution.test.cjs).

**Regression:** EXE-10 Expected Output exact assertion applies to core and data-driven rows.

### EXE-11 · The Unit Test node's individual Run button calls a nonexistent suite

**Correction:** Individual Unit Run and graph Unit Run share real test-file injection/command adapter, using upstream clone or configured CWD. Missing directory/API produces ERROR.

**Source:** [pipeline-manager.js](../../pipeline-manager.js), [visual-editor.js](../../visual-editor.js), [tests/execution.test.cjs](../../tests/execution.test.cjs).

**Regression:** EXE-11 individual unit Run uses graph injection/command adapter with upstream clone path.

### EXE-12 · Editing a saved graph mutates its live pipeline before Save

**Correction:** Deep clone into editor working state and deep clone on output. Unsaved nested edits cannot mutate saved pipeline.

**Source:** [visual-editor.js](../../visual-editor.js), [tests/execution.test.cjs](../../tests/execution.test.cjs).

**Regression:** EXE-12 editor working copy and returned graph never mutate saved nested data.

### EXE-13 · Security scan checkbox selections are ignored by pipeline execution

**Correction:** Stored checkbox booleans map to canonical scanTypes; editor stores array too. Zero selected categories is explicit ERROR.

**Source:** [pipeline-manager.js](../../pipeline-manager.js), [visual-editor.js](../../visual-editor.js), [tests/execution.test.cjs](../../tests/execution.test.cjs).

**Regression:** EXE-13 actual code scan receives checkbox categories; none selected is an error.

### EXE-14 · Concurrent Playwright runs share and delete the same temporary script

**Correction:** Unique mkdtemp directory per invocation, own cleanup in finally, safe concurrent runs even identical timestamps.

**Source:** [services/playwright-runner.js](../../services/playwright-runner.js), [tests/execution.test.cjs](../../tests/execution.test.cjs).

**Regression:** EXE-14 concurrent invocations have isolated files and clean up only their own directory.

### EXE-15 · Editing a URL website suite throws before the editor opens

**Correction:** Intentional toggleWebsiteMethod alias routes existing HTML/editor callers to implementation; full URL editor open regression.

**Source:** [script.js](../../script.js), [tests/execution.test.cjs](../../tests/execution.test.cjs).

**Regression:** EXE-15 website edit method alias invokes existing toggle behavior.

### EXE-16 · A graph engine error leaves the previously saved SUCCESS status intact

**Correction:** Engine exception updates lastRun/lastStatus ERROR and persists, replacing previously successful metadata.

**Source:** [pipeline-manager.js](../../pipeline-manager.js), [tests/execution.test.cjs](../../tests/execution.test.cjs).

**Regression:** EXE-16 latest engine cycle errors persist ERROR and timestamp over old SUCCESS.

### S03 · Version writes resolve before the IndexedDB transaction commits

**Correction:** Readwrite promises resolve only on transaction complete and reject transaction abort/error; migration verifies a committed reread before its marker.

**Source:** [indexeddb-version-storage.js](../../indexeddb-version-storage.js), [tests/storage.test.cjs](../../tests/storage.test.cjs).

**Regression:** S03 IndexedDB saves and deletes.

### S05 · Export All Suites produces a file the collaboration importer rejects

**Correction:** Single and bulk export formats validate every suite and round-trip through the public file import into persistent storage with new local identities.

**Source:** [collaboration.js](../../collaboration.js), [collaboration-ui.js](../../collaboration-ui.js), [tests/storage.test.cjs](../../tests/storage.test.cjs).

**Regression:** S04/S05 public file export/import.

### S06 · Email recipient modal serializes away the exported file Blob

**Correction:** Email modal uses an event listener closure carrying the actual Blob and suite name; no serialized binary inline handler.

**Source:** [collaboration-ui2.js](../../collaboration-ui2.js), [tests/storage.test.cjs](../../tests/storage.test.cjs).

**Regression:** S06 email modal listener.

### S07 · CSV parser splits valid multiline fields into multiple test rows

**Correction:** CSV parser tokenizes complete quoted records, including multiline/CRLF and escaped quotes, preserves whitespace and rejects malformed records and duplicate/empty headers.

**Source:** [data-manager.js](../../data-manager.js), [tests/storage.test.cjs](../../tests/storage.test.cjs).

**Regression:** S07 complete CSV quoted records; S07/S08 empty single-column values.

### S08 · Opening and saving a dataset edit silently changes quoted field values

**Correction:** Dataset edit and export share the same serializer for headers, values, quotes, commas, newlines and empty single-column fields.

**Source:** [data-manager.js](../../data-manager.js), [tests/storage.test.cjs](../../tests/storage.test.cjs).

**Regression:** S08/S16 dataset edit/save; S07/S08 empty single-column values.

### S09 · Variable substitution interprets literal data as regular expressions and replacement tokens

**Correction:** Placeholder keys and values use literal token replacement, avoiding regex metacharacter interpretation and replacement-string dollar expansion.

**Source:** [data-manager.js](../../data-manager.js), [environment-manager.js](../../environment-manager.js), [tests/storage.test.cjs](../../tests/storage.test.cjs).

**Regression:** S09 data and environment placeholders.

### S11 · Security dashboard displays zero critical findings and perfect compliance for a failing scan

**Correction:** Security cards, charts and compliance normalize actual severity-count schema; legacy summaries with missing details explicitly say unavailable; scan errors show incomplete compliance instead of 100.

**Source:** [reporting-dashboard.js](../../reporting-dashboard.js), [tests/storage.test.cjs](../../tests/storage.test.cjs).

**Regression:** S11 security dashboard consumes real manager counts; S11 unavailable scan evidence.

### S12 · Dashboard timeframe does not filter rankings and All Time truncates trends

**Correction:** One filtered history feeds all summary, trend, ranking and flaky widgets; null means unbounded trends and preserves old executions.

**Source:** [reporting-dashboard.js](../../reporting-dashboard.js), [tests/storage.test.cjs](../../tests/storage.test.cjs).

**Regression:** S12 all dashboard widgets.

### S15 · A failed replacement upload leaves the previous dataset available to save

**Correction:** Each selection invalidates previous data/preview/save state immediately; generation token ignores stale async completions and parse errors leave Save disabled.

**Source:** [data-manager.js](../../data-manager.js), [tests/storage.test.cjs](../../tests/storage.test.cjs).

**Regression:** S15 replacement upload failure.

### S16 · Datasets generated with the number pattern cannot be exported

**Correction:** Typed CSV serializer explicitly converts nonnull values to strings and preserves numeric zero and generated numeric values.

**Source:** [data-manager.js](../../data-manager.js), [tests/storage.test.cjs](../../tests/storage.test.cjs).

**Regression:** S08/S16 dataset edit/save.

### B17 · Monaco warns on valid multiword Robot keywords

**Correction:** Diagnostics split Robot cells on real separators, preserve complete multiword keywords and handle assignment targets, tabs and continuation rows.

**Source:** [monaco-config.js](../../monaco-config.js), [tests/browser.test.cjs](../../tests/browser.test.cjs).

**Regression:** B17: Monaco parses complete multiword cells, tab cells and assignment targets.

### S14 · Collaboration snapshot version numbers stop advancing after version 21

**Correction:** Snapshot ordinal derives from maximum retained version rather than retention length; continues monotonically beyond21.

**Source:** [collaboration.js](../../collaboration.js), [tests/storage.test.cjs](../../tests/storage.test.cjs).

**Regression:** S14 retained collaboration snapshots.

## Additional integration corrections

- Python runs now use separate namespaces and temporary file directories, restore captured streams, clear artifacts between runs and share a serialized interpreter queue. Actual repeated-run isolation is asserted in E2E.
- Dataset selector and preview IDs match the editor. New/edit forms populate datasets, preserve selection on refresh and execute every selected row.
- Website method controls target the real upload/URL panels; upload inputs call the implemented handler.
- Language changes update the actual Monaco model, including Robot/Playwright aliases. Validation ignores disposed/non-Robot models and clears timers on disposal.
- Native-only no-code actions generate explicit failure rows for browser-only execution rather than disappearing from the test.
- Git clone uses an argument-vector process API and unique directories. Credential-bearing request objects are omitted from clone request logs.
- Core UI/runtime dependencies and Python packages are local assets; startup does not wait on optional Firebase imports. Duplicate classic script loading and duplicate DOM IDs are removed.
- Static markup and icon definitions use authored SVG. Dynamic legacy views are converted through the same SVG vocabulary. Authored test/code content is excluded from that conversion.
- Automatic example suite creation, its startup timer and the unused embedded example-test template are removed. Developer regression fixtures remain explicit test files.
- The graph canvas stays in the visible viewport, legacy test nodes route to the real suite runner, and individual Run dialogs remain above the canvas.
- Application/installer branding uses the generated master image and seven ICO resolutions. Package integrity verification compares every shipped source/asset hash before launching the installed-layout app.
- The older repository tests are retained and migrated to Node’s built-in test runner; obsolete green infrastructure mocks now assert genuine unavailable/delegation behavior.

## Evidence and limits

- Source Electron results (`e2e-results.json`) and packaged Windows results (`desktop-results.json`) are generated locally and include source/asset hashes and named checks. See [verification instructions](README.md) to produce them in a fresh clone. Screenshot fixtures are created only in disposable profiles.
- Tests run actual local Pyodide Python/unittest/pytest/Robot, visual DOM steps, graph execution, IndexedDB, Git and Electron IPC Playwright. The custom AI endpoint is a local response fixture.
- Real paid AI accounts, external storage accounts, remote CI services and live email/webhook deliveries are not exercised.
- Browser checks of transaction errors, OSV responses and notification routing use deterministic fixtures. No disk-corruption experiment or production security certification is claimed.
- Windows x64 is verified. No macOS/Linux build or publisher signature is claimed.
- [30 proposed gaps](../roadmap/README.md) remain future work, including real infrastructure engines, native framework adapters, a CI service, worker isolation, credential vaults and team permissions.
