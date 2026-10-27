# GitHub workflows and repository tests

Open **GitHub Actions** from **Your tools**. Enter a GitHub repository URL or `owner/repository`, then choose **Import repository**. Leave the branch field empty to use the default branch, or enter a branch, tag or commit.

Each repository gets its own lane and **Workflow YAML** selector. Changing one lane leaves other selections in place. Importing the same repository and ref updates its existing lane; different refs can have separate lanes. Arrows show job `needs` dependencies. Select a job to read its runner, conditions, matrix and steps. **Job list** provides jobs without navigating a graph. **View exact YAML source** retains comments and original text; **Open on GitHub** points to the imported commit.

**Refresh** retrieves a new snapshot. A failed refresh keeps the previous snapshot and displays the error. Refreshing a repository with local drafts asks before replacing them. **Remove repository** removes its lane and local drafts after the applicable confirmation; it does not delete anything on GitHub. A repository without workflow YAML stays an empty lane.

## Desktop and browser preview

Select a project folder in desktop before importing or editing repositories. Snapshots, drafts, selections, publication receipts and the offline demo belong to that project. Storage revision checks prevent one window from silently replacing another window's saved work. Imported source is pinned to an immutable commit; changing a branch later does not rewrite the snapshot you are reviewing.

Browser preview supports public repository graphs and stores its lanes in the browser. Source editing, private sign-in and publishing use the desktop app. Browser graph examples remain explicitly labeled illustrations. Leaving a view stops its UI updates; an already-sent remote write must be checked through its publication receipt rather than assumed cancelled.

## Workflow editor

**Edit workflow & tests** opens the saved workflow directly, including offline snapshots and repositories with more than 250 test files. It does not download the repository before opening. Under **Repository tests**, choose **Browse repository tests** to fetch the file list, then select a test file to load its source. Loaded sources and local edits are cached in the project. Only loaded test files are analyzed for CI links. You can return to repository lanes while a read is pending; a late response cannot save into a closed editor.

Choose **Edit workflow & tests** in a repository lane, then **Workflow editor**. You can create or delete workflow files, add or delete jobs, edit job names, dependencies, conditions and runner values, change triggers, and add, edit or delete step mappings. The exact YAML editor is available for changes outside the forms. Invalid imported YAML can be opened for source repair.

Changes are saved as local drafts. Structured edits retain unrelated source and comments; review the resulting diff, especially when changing shared YAML anchors or raw source. Missing dependencies, cycles, invalid jobs and invalid steps produce diagnostics. A workflow must pass supported validation before publishing.

**Show matrix combinations** enumerates supported literal axes with `include` and `exclude`, up to the display limit. Expressions remain unresolved. The lane graph still shows the source matrix job as one node. **Inspect reusable workflow** displays called source and its revision without executing it; nested references use their caller's repository and commit. Private or inaccessible reusable sources can remain unavailable even when Actions itself can call them. Repeated or excessively deep inspection chains are bounded.

## Repository tests

**Repository tests** lists recognized test files, suites, cases, tags, assertions and supported routes. JavaScript and TypeScript discovery uses the TypeScript compiler API; Python and C# use bundled Tree-sitter grammars; Robot Framework uses its supported text-block parser. These parsers inspect text locally. They do not import project modules, execute tests, install dependencies or invoke a project's Python or .NET runtime.

Supported forms cover Playwright, Vitest, Jest, pytest, unittest, NUnit, xUnit, MSTest and Robot Framework. Capabilities depend on the declaration and language: unsupported edits are disabled or rejected. Dynamic declarations and parameterized cases are source templates rather than an enumeration of every runtime test. Syntax newer than a pinned grammar can require a source change or remain unsupported.

pytest class names retain their collection prefix. Robot titles cannot become comments or section headers. C# class renaming uses the project's symbol tools so constructors and references can be updated together; individual test methods remain editable here.

Select a declaration to rename it, edit supported tags, change its actions and assertions, or delete it. **Add test case** adds a case at the top level or inside a supported suite. **Create test file** provides a framework scaffold. File deletion is a draft until published. Exact source editing is available for recognized test files. Edits preserve neighboring source instead of regenerating the whole test file.

**CI links for this file** reports static evidence from workflow commands and package scripts. A match is an inference, not proof that CI executes a particular runtime case. Creating a file can optionally add an execution step to a selected workflow job. Review dependencies, runner setup, working directory and the new command in the diff; automatic wiring does not install or configure the framework. Run tests through the project's normal tools or LVX's existing test features before publishing.

## Review, stage and publish

Open **Changes & publish** and select complete files to stage. A draft can remain unstaged while other files are published. New files, updates and deletions enter the same commit. **Discard file changes** restores the imported file or removes an uncommitted new file. Further edits invalidate the previous preview.

Choose a destination branch and one of these modes:

| Mode | Result |
| --- | --- |
| New branch and pull request | Creates one commit on a new review branch, then opens a PR against the target. |
| New branch, pull request, then merge | Creates the review branch and PR, then attempts the selected merge method with an expected head SHA. |
| Commit directly to target branch | Appends one commit only if the target still has the reviewed head commit. |

Enter the commit message and PR details, then choose **Prepare publish preview**. Review the repository, base commit, target, mode, selected paths and unified diff. Confirm that review before choosing **Publish reviewed changes**. The host keeps the exact reviewed plan; changing a form cannot silently replace its contents after approval.

All selected file changes become visible through one commit. Creating Git objects, moving a branch, opening a PR and merging a PR are separate operations; they are not one GitHub transaction. If PR creation or merging fails after the commit succeeds, the branch or PR remains available and the result identifies the phase. Required checks, reviews, rules, conflicts and unsupported merge-queue requirements can leave the PR unmerged. LVX does not force-push or bypass those controls. A queued or blocked merge is not a successful merge.

Direct commits use GitHub's expected-head check. They reject changed executable files because that API cannot explicitly specify file modes; use the PR route to preserve executable modes. A snapshot imported from a tag or commit still needs a real destination branch with a matching base. If the branch has moved, refresh and review against the new baseline rather than overwrite it.

Publication receipts record the operation ID before the request. **Check publication outcome** reconciles an interrupted, failed or partial operation with GitHub. Use it after a timeout: a missing response does not prove a request failed. Recovery checks existing branches, commits and PRs before continuing, and verifies the expected PR head before merging. Local unpublished drafts are retained when the published baseline is refreshed; conflicting remote changes need review before staging again.

## Sign-in and permissions

Public reads can work without a token. Private source reads need repository **Contents: read**, and private run results need **Actions: read**. Publishing requires **Contents: write**; workflow changes additionally need **Workflows: write**. Opening a PR needs **Pull requests: write**. Repository access, organisation policies and branch rules can impose further restrictions. See GitHub's [fine-grained token permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens).

Desktop imports read supported files through the GitHub API. Large public imports can exhaust the unauthenticated request allowance. Wait for its reset or provide a protected token with repository read access. A failed import retains the previous saved snapshot.

Tokens are encrypted through the desktop credential service. The renderer holds an opaque reference; the host resolves it only for GitHub requests. Tokens are excluded from repository records and publication receipts. The sign-in is reused during the app session. **Remove saved sign-in** deletes that encrypted credential and stops using it; replacing a token deletes its previous credential. A read-only token can still import and inspect source when publishing is denied.

## Runs and offline examples

**GitHub runs** fetches runs matching the selected workflow and imported commit. Select a listed run to inspect that attempt's runtime jobs and steps. **Watch runs while this view is open** enables bounded polling. Status errors or an empty run list are not passing results. Runtime names, custom job names and matrix variants can differ from YAML job IDs, so results are listed separately instead of assigned to graph nodes by guesswork. GitHub rate limits can delay updates.

**Load example repositories**, followed by **Edit workflow & tests**, opens an offline desktop repository with workflow YAML, Playwright and Vitest sources and package scripts. Edit files, stage a diff and try all publication modes. The same publisher runs against a GitHub fixture backed by project storage. Demo branches, commits, PRs and merges are synthetic, remain labeled as simulated, and persist across reopening the view or app. Demo publishing accepts no GitHub credentials and makes no GitHub writes.

## Coverage and limits

Discovery recognises common test paths and suffixes plus supported runner/package configuration files. It does not import every file, custom test convention or generated test in a repository. Binary sources, symlinks, submodules, unsupported encodings and oversized files are excluded from editable imports. A truncated GitHub tree fails rather than becoming a misleading complete inventory. Unsupported declarations and unresolved expressions remain diagnostics or source text.

Repository imports, selected-file refreshes and staging have no file-count ceiling. Blob downloads use at most four concurrent requests. If GitHub truncates a recursive tree or its response exceeds the response budget, LVX traverses immutable directory trees to obtain a complete inventory. An incomplete directory response fails explicitly; it never imports a misleading partial inventory. Whole-repository Git cloning also has no file-count ceiling.

Repository lanes, workflow counts, job counts, source bytes, snapshot bytes and saved-board bytes have no application capacity ceiling. Imports use bounded batches, immutable source hashes and complete tree traversal. GitHub runs, jobs and publication recovery follow all available pages/history with cycle detection. Matrix inspection calculates exact totals without allocating the Cartesian product: select a starting offset and page size, then use Next combinations to reach every variant. Zero page size requests all remaining variants; very large matrices should use pages. Source diff creation uses a linear-space unified patch so a valid large edit is not rejected by an edit-distance deadline. Network operations remain cancellable when the workspace closes or changes; GitHub itself and the available memory/disk can still impose practical limits.

Live GitHub behavior depends on the user's token, repository rules and server responses. Automated write-path coverage uses deterministic offline/local transports, including failures and unknown outcomes. It does not certify publishing against every private repository or branch-protection configuration. This view does not evaluate Actions expressions, run imported tests, expand every dynamic matrix, fetch secret values, provide a general Git working tree, or implement a merge queue.

## Development and checks

Run `npm ci` and `npm run build:assets`, then `npm run dev` for browser graph preview or `npm start` for Electron. `npm run build:desktop` rebuilds the Windows executable directory. Keep the complete `release/win-unpacked` folder together.

Focused suites live in `tests/github-workflows*.test.cjs` and `tests/github-studio*.test.cjs`. They exercise source preservation, supported edits, publication transports, storage and UI behavior. Playwright UI checks use Chromium under `.external/playwright-browsers`; desktop checks exercise Electron. `npm test` runs the repository regression suite. Read final test totals from current verification receipts rather than historical counts.

The existing vanilla JavaScript/Electron application, test editors and LVX execution graphs remain in place. GitHub source editing and publishing use a separate host service. Pinned parser/diff dependencies and grammar notices are listed in [third-party notices](../THIRD_PARTY_NOTICES.md), with license texts and grammar provenance under `assets/licenses`.
