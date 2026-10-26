# What belongs on GitHub

The repository contains what another developer needs to run, build, test and change LVX Test Studio:

- Application source, runtime assets and the original mascot.
- `package.json`, the npm lockfile, pinned vendor information and setup scripts.
- Tests, development tools, CI workflows and example source projects.
- Licences, user guides, reviewed guide screenshots, design notes and reference catalogues.
- The archived Machina source, used to compare features and understand compatibility.

Downloaded `node_modules`, installers and unpacked releases stay local. So do workspace data, exports, generated test reports, raw screenshots, logs, caches, private environment settings, signing certificates and personal editor settings. `.gitignore` lists these explicitly. Shared editor configuration and `.env.example` can still be committed; they must not contain credentials.

Private project memory under `0_PERSISTENT_memory`, Obsidian settings, local SQLite/database files and sidecars, pasted `codex-clipboard` captures, raw `screenshots` folders, private key files and local cloud/SSH profiles are also excluded. Keep reviewed guide images in `docs/images`, and use synthetic text fixtures for database or credential tests. Ignoring private files preserves them locally.

The `assets/vendor` files are runtime resources used by the app, including its offline Python/editor tools. They remain tracked. Setup can prepare the required desktop dependencies on another computer; see [the development guide](DEVELOPMENT.md).

## Check before committing

```text
node scripts/verify-repository-contents.cjs check
node scripts/verify-public-files.cjs check
git status --short
```

The first check verifies the candidate file set and tests the ignore rules against local-output and shared-source examples. It fails if an already-tracked file matches an ignore rule. The second checks every tracked or nonignored new file for personal paths and common secret formats. Known test values and reviewed binaries have exact fingerprints in `public-files-policy.json`; tests and vendor folders are not broadly exempt.

Ignoring a file does not untrack it. To keep a tracked local file on disk but remove it from the next commit, use `git rm --cached -- path/to/file` and commit that removal. Review the file first: a broad ignore rule must not hide needed source, tests or examples. Add new local-output rules when introducing a tool that writes elsewhere. Files placed in an arbitrary new folder are eligible for Git until explicitly ignored.

Only reviewed documentation images belong in `docs/images`. Native test captures stay under ignored `docs/screenshots` and `docs/verification/screenshots`. Generated verification reports stay local under `docs/verification`; its README, repair references, release boundaries and input catalogues remain tracked. Their filenames are listed in `.gitignore` and the repository-contents check.

## Test a candidate-only checkout

```text
node scripts/verify-repository-contents.cjs fresh
```

On Windows with Node, Python, Java and .NET installed, this copies only Git candidate files to an isolated directory under ignored `output/`. It installs dependencies, runs setup and the full regression suite, launches the source app, builds a separate Windows app and tests that packaged app. It does not replace your normal `release/win-unpacked`. Logs and results remain under ignored `output/`. Downloads require networking and the check uses disk space for the separate checkout and build.

CI performs the file-set and secret-format checks directly on its checkout. Test reports can be retained as CI artifacts; they are not committed source files.

## Main branch and contributions

External contributors can fork this repository and open pull requests. `.github/CODEOWNERS` assigns all files to the repository owner for review.

The active GitHub ruleset for `main` restricts updates, deletion and force pushes to repository administrators. Other contributors must use pull requests with an approving code-owner review and resolved review conversations; new commits dismiss stale approvals. The repository owner is the only administrator. Administrator bypass lets the owner maintain the project directly. Do not grant administrator access to outside collaborators: that role can bypass these rules and change repository settings.

Rules are configured in GitHub, separately from this file. Verify the live ruleset and collaborator permissions when changing access; this documentation and CODEOWNERS alone do not enforce branch protection.

## Local audits and Git history

The extended `audit`, `clean` and `review` modes in `verify-public-files.cjs` work with local evidence. An audit is bound to its exact file set and history; regenerate it after changes. A previous review is historical, not approval of a new commit. `public-evidence.cjs` can prepare deliberately selected publication copies of documentation while keeping raw originals locally; ordinary generated test reports remain ignored.

This public repository receives a cleaned source snapshot on its own initial history. The separate private Machina repository history is not imported. Ignore rules protect future commits; they do not erase a file if it is later committed by mistake.

Secret detection has limits. Never commit actual account credentials or workspace exports. The public maintainer handle, required third-party licence attribution and public repository links are intentional project identity. Historical commits may retain earlier public author credits; ignore rules and current-tree cleanup do not rewrite Git history.
