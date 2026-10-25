# LVX Test Studio — Advanced Showcase

A separate, exported Sensor Shop quality lab for LVX Test Studio 0.5.0. It contains real saved graphs, native execution history, a live Codex council, full conversations, a reviewed graph patch, and owned tasks linked to graph checks. The shop calculates synthetic quotes; it does not take orders or payments.

## Open it

1. Keep this folder in the repository’s `exports` folder. The app remains at `release/win-unpacked/LVX Test Studio.exe`.
2. Right-click **Start Showcase.ps1** → **Run with PowerShell**. Alternatively, open PowerShell here and run `& '.\Start Showcase.ps1'`.
3. A separate Studio profile opens, containing the exported project. Your usual workspace is not replaced. The launcher preserves your edits on later launches.
4. Open **Graph workflows**, **AI agent board**, or **Agent projects** in the left navigation. Choose a saved item, then **Open**.

The native savefile is **LVX-Advanced-Showcase.lvx.json**. You may also import it manually through **Project & backup → Import archive → Validate and preview → Import**, after selecting this folder’s **workspace** directory. Review imported executable content before trusting it. The launcher performs that review/import for this explicit lab and starts new native provider conversations while preserving the exported chats.

The workspace files and local server are required when replaying the examples. Importing the JSON alone supplies the saved project and evidence, but cannot supply a running HTTP service, a JDK, .NET SDK or an authenticated AI account. This bundle uses the runtimes already verified on this computer. Jest/JUnit/NUnit fixtures are linked/configured by the launcher; another computer needs the pinned native fixtures prepared with `node services/execution/prepare-native-fixtures.cjs` in the repository.

The local service listens only on **http://127.0.0.1:47653**. **Stop Showcase Service.ps1** stops it. AI graph nodes use its visible gateway to the real installed Codex CLI. New AI runs consume your account allowance. No credentials are included, and launch alone sends no model prompt. No example deploys remotely or sends messages to other people.

## Start with these graphs

Choose **Graph workflows**, select a name, then **Open selected workflow**. Use **Zoom out** and **Pan** to inspect the whole graph. Open a node’s settings to see the actual inputs, scripts, constraints and output paths. **Run** executes the graph; **Checks & runs** keeps the actual results and prior attempts.

| Graph | What to inspect | Expected result |
|---|---|---|
| **01 · Service quality council** | Parallel API contract, bounded concurrent HTTP requests, source security scan/gate, checkout browser assertions, log ZIP and live AI explanation. Inspect the council’s retained wiring finding below. | Success; 20 HTTP requests produce 40 assertions. The changed wait is 5 ms. This delay is a graph-edit demonstration, not a production readiness guarantee. |
| **02 · Git → native unit tests → live AI-generated tests** | A local Git clone, new branch, existing Node tests, real Codex-generated boundary tests and a ZIP of the results. | Success. The generated test count may change on replay. The explicit TAP reporter makes the output machine-readable. Only the lab’s generated clone is reset. |
| **03 · Live AI review → responsive UX audit → local deployment** | Proposed complete HTML, the review decision, desktop/mobile UX evidence and the local deployment receipt. | Pauses for your decision. Review the HTML and use **Approve and deploy** to permit the final local webhook. Then open **http://127.0.0.1:47653/deployed**. Rejection must not deploy. |
| **04 · Recovery, typed artifacts, resource locks and retries** | A real endpoint returns two 503 responses, then succeeds. Two independent nodes share an exclusive warehouse lock; explicit typed ports merge their values with provenance. | Success after three API attempts; merged stock = 7. |
| **05 · Multi-language and data-driven acceptance** | JavaScript, Python validation, every CSV row, native Jest, JUnit and NUnit. | Success with real runner counts. An unavailable runtime is an error, never a pass. |
| **06 · Intentional failure…** | An assertion deliberately fails, its continuation records evidence, and a separate long wait lets you practise Stop. | **Failure is correct.** Change `2+2===5` to `2+2===4` in a copy to make it pass. |
| **07 · Explicit cancellation…** | A 30-second wait followed by a downstream assertion. | Start, then Stop. Status becomes **Cancelled** and downstream code must not run. |
| **08 · Native languages…** | A versioned reusable fixture, setup/cleanup, typed quantity/coupon parameters, native Robot, Java, C# and pytest. | Success. Try quantity 0 to see validation reject it before execution. The saved hourly schedule is intentionally **disabled**. |
| **09 · Visual website steps…** | No-code website actions, accessibility/performance checks, screenshot baseline/comparison, and four native dataset iterations. | Success; four rows are independently checked. Accessibility rules cover a bounded set of checks, not a full WCAG certification. |

All 16 graph node types have successful native execution evidence. Across graphs 05/08/09, all ten execution engines are exercised. The archive also retains earlier failed preparation attempts: inspect their timestamps and the later successful runs rather than interpreting every historical row as a current defect.

## Watch agents collaborate

1. Open **AI agent board → 01 · Live Codex engineering council → Open board**.
2. Click **Fit agents**. The architecture lead sends to the test specialist and reviewer; the test specialist also sends findings to the reviewer.
3. Select each agent to read its complete chat. Earlier user, peer and assistant messages are preserved. Scroll the history rather than relying on the abbreviated node preview.
4. Inspect the completed goal run and its linked acceptance results. A completed conversation and passing native checks are separate facts. The council identified real limitations in the sample, including narrow mobile assertions and differing coupon whitespace rules. Those findings remain visible; an agent’s confident statement is not a test receipt.
5. For a new run, choose **Architecture lead** as the starter and click **Run goal**. Its four-turn budget permits the directed fan-out/fan-in conversation. **Pause queue**, **Resume queue**, **Stop runs** and **New conversation** are explicit controls.

The three supplied agents use authenticated **Codex** with read-only permissions and your native default model/effort. Claude and Gemini are supported by the app, but are not presented as working accounts in this export: Claude was not logged in, and Gemini required a Google Cloud project. Configure those accounts yourself before changing a node’s provider. Model quality and wording can vary between runs.

### Retained improvement exercise: act on a real finding

The saved council found a real configuration defect in graph 01: `evidence` and `summary` explicitly bind `loadTest` to `catalog-contract`, although **catalog-load** produces it. The final summary still receives real load evidence through its separate full-runner logs, so the measured run passes; that does **not** make this particular declared binding correct. This finding is deliberately retained for you to try the agent → proposal → review → checks flow on something substantive. Ask an agent to set `inputs.loadTest.producer` to `catalog-load` on both nodes, inspect the patch, apply it, and re-run. **Graph 04** supplies the already-correct typed/provenance example.

Other retained review findings are the browser/calculator difference for surrounding coupon whitespace and narrow mobile assertions. Use the dependent browser-review task to improve those in a copy. The initial graph is a bounded working test lab with concrete improvement exercises, not a claim that the synthetic shop or every configuration is production-ready.

## Work on the existing graph with agents

1. Open **Agent projects → Sensor Shop release ownership → Open project**.
2. Inspect **Review the current product contract**. It contains an actual completed provider conversation, a native graph check that includes required ancestors, and an explicit recorded review. The dependent **Your turn: review the browser journey** remains ready for you to start and judge.
3. In the graph section, select the saved service-quality workflow. Inspect its node context, settings, dependencies, artifact ports and revision.
4. Inspect the applied proposal: the architecture lead renamed `settle` and reduced its delay from 25 to 5 ms. It was parsed as a structured graph patch, previewed against the exact saved revision and applied transactionally. The updated complete graph was then run again.
5. Try your own bounded request: “Improve only the browser node’s assertions; preserve its node ID and every edge. Return an lvx-graph-patch block against the supplied revision.” Review the before/after proposal before applying it. **Run graph checks** provides native evidence; **Open graph** takes you to the same graph in the visual editor.

Changing a graph or task can invalidate old evidence. Re-run and review current checks instead of treating imported historical approval as proof of a new revision. The live chat is intentionally preserved independently of the user’s final review decision.

The local exported showcase includes its generated graph, agent-council and task screenshots under `evidence`. Those run captures are not included in this source repository.

## Explore the rest of Studio

- **Build a check:** open the visual value/repeat/HTTP example or debugger playground. Visual steps remain editable and their generated code is inspectable. For interactive debugging, start the JavaScript playground with debugging enabled, pause, set an executable breakpoint, inspect variables, step and resume. Other engines show their actual capabilities and support native output/cancellation.
- **Test data:** compare 40 reproducible synthetic customers with the separately masked contacts. The CSV matrix is local; it contains no real personal records. Masking preserves equality and is not a guarantee of anonymisation.
- **Workflows:** inspect typed contracts, resources, retries and versioned shared fixtures. `Pricing-fixture-workflow.lvx-workflow.json` is a separate native dependency bundle. Its opt-in schedule is saved disabled; no timer starts from import.
- **Checks & runs / Storage & cleanup:** inspect node attempts, original runs, artifacts and negative controls. The first quality run is pinned. Preview cleanup before applying it; the recorded dry run shows pin protection. Nothing is removed by the supplied retention demonstration.
- **Mocks & sessions:** use the four-row dataset suite, then inspect the individual iterations and their variables. Create a session using these saved suites; compare its raw evidence before changing fixture versions.
- **Security:** graph 01 demonstrates the source scanner and policy gate. See **FEATURE-COVERAGE.md** for the distinction between that example, separately installed infrastructure adapters, dependency advisory lookups and your own authorised targets. No live production infrastructure is scanned.
- **Team access:** start a local service explicitly, create viewer/editor identities, and test their permissions in another client. Verification exercised unauthenticated denial and credential revocation. Tokens are intentionally omitted from the archive; another machine needs its own new identities.
- **Project & backup:** the supplied JSON is the app’s genuine checksummed export, including native evidence and baselines. Fresh-profile import was tested. Imports do not replay work or enable schedules. Keep the workspace files with the JSON when moving this lab.
- **Setup & diagnostics:** inspect installed runtimes and the bounded isolated preview. The supplied preview baseline is real. OS credential protection, provider login, signing certificates, remote CI and screen-reader testing require the relevant machine/account setup.

## Verification and replay limits

See **evidence/build-results.json**, **evidence/extra-checks.json**, **evidence/fresh-import-results.json**, **evidence/replay-results.json** and **FEATURE-COVERAGE.md**. **CHECKSUMS.sha256** binds the delivered files. The ZIP excludes disposable app profiles, native provider credentials and dependency caches; the savefile contains the portable app records and evidence.

Repeated AI runs are nondeterministic and can hit quota/authentication limits. The local API/browser/math/fixture checks have deterministic assertions. The recorded green runs establish this lab’s measured behavior; they do not establish production security, general accessibility, payment handling or remote deployment readiness. Signed Windows releases and hosted CI remain external prerequisites documented by the application.
