# Contributing

Use Node 22.18.0 or later. Run `npm ci`, `npm run setup`, then `npm test`. For native adapters install the relevant runtime and test framework. `npm run test:e2e` creates isolated fixtures and profiles; it must never use your personal API keys or repositories. Package with `npm run build:desktop` and verify with `npm run verify:desktop` after source edits stop.

The full adapter regression suite needs Python, JDK 25 and .NET SDK 9. Prepare its pinned native fixtures with `node services/execution/prepare-native-fixtures.cjs`. Install additional developer-only Python packages locally with `python -m pip install --target .external/python-test-packages -r tests/requirements.txt`. Set `LVX_TEST_PYTHON` when the test interpreter differs from the default command. `node scripts/clean-room.cjs` prepares an isolated copy and runs the complete local setup/verification path; it does not push to GitHub or certify hosted CI.

Keep new services modular with explicit contracts in `docs/api/studio.d.ts`. Add a regression that demonstrates the defect, including an expected failure or missing-prerequisite control. Preserve status distinctions, transactional writes, workspace boundaries, secret redaction and keyboard access. A green badge requires complete evidence.

Before submitting a change, inspect logs and screenshots for credentials and private paths. Explain the user-visible behavior, meaningful validation and any remaining platform limits. Do not commit generated installers, temporary profiles, dependency caches or user workspaces.

The lockfile includes a `postcss-selector-parser` 7.1.6 override for the retained Tailwind 3 build. It removes the reported parser advisory without changing the app to Tailwind 4. Recheck the actual asset build, computed contrast and desktop flows when changing it. `node scripts/dependency-check.cjs` requires a complete current npm advisory response and records the measured lockfile hash.

Vendored SheetJS is separately pinned in `vendor-lock.json`. The asset build verifies cached files and downloads against the declared SHA-256 before replacing anything. Run `node scripts/check-vendor.cjs` after preparation; npm's dependency graph does not include this standalone browser script.
