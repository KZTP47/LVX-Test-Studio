# Changelog

## 0.11.0

- Repaired old graph runners and made Select/Pan selection visible.
- Added named, archived and deletable AI conversations, colored bubbles, multiple project folders and direct recipients.
- Made board full screen focus on the canvas and settings.
- Added reusable agent-test imports as one graph with one Start node.
- Added persistent save/discard/stop dialogs and per-connection repair for older sign-ins.


## 0.10.0 — Visible AI work and runnable imported tests

- Show elapsed AI activity and provider-visible native output; make directed collaboration explicit and readable in chat.
- Maximize a chat across the application view while preserving other chats and drafts.
- Review and import generated tests from agent replies or exported JSON files.
- List saved workspace graphs in the original pipeline sidebar, with Open and Run actions.
- Run JavaScript and generated async Playwright suites through native engines; review imported executable content before running.
- Save Visual Runner results back to test cards so an earlier error does not hide a later passing run.
- Expose staging/live website URLs, sign-in and refresh in the visual website tester.
- Explain visual tests versus code suites, and guide optional task and graph review setup.
- Add three self-contained, runnable graph examples.

## 0.9.2 — Mascot preview

- Hover over the mascot beside the title to see the full illustration in a larger floating window. Keyboard focus or a click opens it too; Escape closes it.
- Keep the preview inside the window and readable in both appearances.

## 0.9.1 — Readable themes and keyboard controls

- Fix dark-mode text, translucent panels, status colors and placeholders across the app while retaining the original Machina colors.
- Give filters, generated configuration fields, agent canvases and conversations meaningful accessible names.
- Keep keyboard focus inside the current dialog, return it when closed, and let nested Save/Path dialogs handle their own navigation.
- Add keyboard controls for visual test steps, ordering, breakpoints, graph connections and selector choices.
- Preserve breakpoints when reordering steps; support zoom, visible focus and reduced motion.
- Keep the saved appearance when startup builds the navigation before reading preferences.


## 0.9.0 — Complete website targets in the Visual Web Tester

- Add, update, remove and reload multiple files while preserving paths, module imports, styles, images and pages.
- Load a project folder, a Git repository/ref or a staging/live website URL.
- Detect built sites and source projects; explicitly install/start/stop npm project servers with readable status and output.
- Keep saved targets working across visual runs, debugger, live runners and native workflow suite nodes.
- Use normal save/path dialogs in Electron and protect source edits during switching, refresh and cancellation.

## 0.8.1 — Project setup step alignment

- Keep numbered circles beside their headings and align the instructions and buttons beneath the heading text.

## 0.8.0 — Agents and project folders on one board

- Add project folders to the AI board, assign agents and see where each agent works.
- Run native agents in the selected folder while keeping boards and chats in the LVX workspace.
- Keep folder choices private to this machine and protect native conversations when changing folders.
- Open Tasks & graph review on the same board, with plain-English steps and optional advanced proposal details.

## 0.7.4 — Name and choose where to save boards

- Ask for a board name before the first save, including before a first message or goal needs to save it.
- Save a separate copy or explicitly choose and confirm a board to overwrite. Keep original chat history with its board.
- Preserve drafts on cancellation, validation errors and concurrent save conflicts.

## 0.7.3 — Connected chats and native agent repair

- Show dotted ownership links between each floating chat and its agent, including while moving, resizing, panning and zooming.
- Maximize and restore individual chats while keeping other chats, drafts and saved window geometry.
- Repair provider connections from nodes and chats: recheck, choose an installed CLI, open native sign-in or publisher installation instructions.
- Detect installed user-local and desktop Codex tools when the app inherited an older PATH. Keep native sign-in and conversation identity intact.

## 0.7.2 — Responsive test editor

- Open the test editor before scanning installed runtimes; keep editing and saving available during slow or failed detection.
- Reuse pending checks and show tool readiness, retry and setup controls without replacing the form or moving focus.
- Discard late tool results after workspace changes and preserve native runtime validation before execution.

## 0.7.1 — Project import from the home screen

- Recognise full project archives from Import JSON, including the Advanced Showcase, and open the validated project preview.
- Keep the selected file while choosing a folder, explain folder trust, and show record/evidence counts before importing.
- Invalidate previews when the file or workspace changes; retain revision checks and imported-content review.
- Preserve legacy suite imports and reject unsupported files before changing views or pipelines.

## 0.7.0 — Guided tool setup

- Download and configure test tools from Runtimes & diagnostics, the AI board, or agent chats.
- Review each setup plan, follow progress, cancel downloads, and recheck readiness.
- Ask an existing saved agent for help. Optional shared diagnostics are visible before sending; suggested setup buttons still require your review.
- Keep downloaded runtimes in app-local storage. Jest and NUnit explicitly update the selected trusted project.
- Protect newer runtime choices, reject corrupt archives, and clean up unsuccessful downloads.


## 0.6.0 — One app layout and a Nexus-style agent board

Newer tools now open inside the original Machina home layout. Saved visual tests appear beside original test suites, with shared search, language filters and sorting. New test starts a separate test; Test editor returns to the current draft.

The AI board has a dark teal canvas, full-screen controls, independent movable and resizable chats, a minimized-chat dock, and saved agent pictures, colors and icons. Chats stay within the canvas when the window gets smaller. The supplied pink octopus is the app and Windows icon. The README is a short user guide; technical setup moved to docs/DEVELOPMENT.md.

UI and messaging checks use disposable projects and labelled local provider fixtures. These checks do not establish live account availability or model quality.

## 0.5.0 — Owned agent projects and graph collaboration

Adds project goals, assigned tasks, dependency ordering and explicit evidence-based review. Agents can inspect a credential-redacted snapshot of every existing workflow node type, propose revision-bound graph edits and show visual before/after previews. Reviewed edits update the real graph transactionally; native checks retain current graph fingerprints and can be stopped. Existing graph workflows link directly to Agent projects, and conversations open the correct saved board. Original Machina configuration styling and newer controls are retained.

Separate Electron user-flow tests cover task ownership, dependencies, native execution and proposal application. A bounded live-provider experiment is recorded separately from local response fixtures. Account setup and general model quality remain provider-specific.

## 0.4.1

Restore the original Machina visual themes and layouts across all fourteen node configuration dialogs. Preserve newer controls, SVG headings and current save/validation behavior; keep footer actions together and forms reachable at200-percent zoom. The unpacked Windows app is rebuilt for user evaluation.

## 0.4.0 — Visual agents and Machina colours, 2026-10-25

Restores all fourteen original palette and node-header gradients and glossy graph actions. Canvas tool labels fit inside their buttons at desktop and 200-percent zoom. Adds workspace-scoped visual agent boards, directed connections, native Codex/Claude/Gemini session adapters, configured APIs, complete chat/event history, bounded collaboration and explicit linked workflow checks. A fresh linked recipient receives the original goal and criteria even when the predecessor omits them. Context is captured per run and the actual current-turn input stays inspectable beside unchanged peer text. No hidden role prompts or automatic fresh-session fallback.

Independent review drove fixes for stale imports/queued delivery, workspace binding, cancellation evidence, incomplete provider results and conversation recovery. Current 0.4.0 receipts supersede the historical 0.3.0 independent verdict; limits and provider setup are documented in `docs/AGENT-STUDIO.md`. The installer remains unsigned.

## 0.3.0 — Machina integration, 2026-10-25

Preserves the byte-identified Machina source and restores its fourteen graph task types through native execution. Adds reusable mock plans, legacy file and consolidated IndexedDB migration, shared version history, reviewed settings recovery, saved sessions, category retention with retryable cleanup receipts, optional dark appearance and safe keyboard/modal behaviour. Windows-encrypted legacy credentials migrate to opaque references when the original account can decrypt them.

Current-source regression, source/packaged desktop flows, isolated setup and installer lifecycle receipts live in `docs/verification`; the final independent review binds its verdict to an exact source digest. The Windows installer remains unsigned. Development requires the tested Node.js 22.18 or newer.

## 0.2.0 — local candidate, 2026-10-24

Added a visual workbench, native process execution and cancellation, genuine framework adapters, typed workflow scheduling, OS credential references, isolated uploaded previews, SQLite revisions and project archives, local team permissions, typed datasets and approachable recovery. Retained renderer icons now use semantic SVG; a validated module manifest replaces implicit script ordering. MIT was selected by the owner.

Each of the thirty acceptance outcomes has a separate evidence record. Final local package/install verification and external signing/hosted-CI prerequisites are tracked in the roadmap; this candidate is not a public signed release.

## 0.1.0 — local verification baseline, 2026-10-24

Repaired 52 audited defects, integrated the LVX identity, replaced rendered emoji icons with SVG and removed automatic example tests. The previous delivery snapshot recorded 114 regression tests and 41 source plus 41 packaged desktop checks. Those are historical counts; subsequent source edits require a fresh verification run.
