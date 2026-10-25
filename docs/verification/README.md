# Local verification results

Test and review scripts write their reports here. These generated files stay on the computer that ran them and are ignored by Git. A fresh clone starts without old run results. CI can retain its results as downloadable artifacts.

Run the relevant checks to produce current evidence. For example:

```text
npm test
npm run test:e2e
npm run build:desktop
npm run verify:desktop
```

See [the development guide](../DEVELOPMENT.md) for prerequisites and other checks. The packaged checks use the separately built `release/win-unpacked` application. Independent review scripts require a real new review of the candidate; running tests does not create that approval.

Reports identify their source digest, test script and, where applicable, packaged files. A result from an earlier source version does not verify later changes. Missing reports mean that evidence has not been produced in this checkout; do not substitute an old developer's saved receipt.

Git retains only these shared reference files here:

- This README, `REPAIRS.md` and `RELEASE-BOUNDARIES.md`.
- `baseline-findings.json`, `browser-fixes.json`, `execution-fixes.json` and `storage-fixes.json`: the defect descriptions and repair map used by the delivery verifier.
- `future-work-catalog.json` and `machina-feature-census.json`: the roadmap and compatibility reference inputs.
- An empty screenshot-directory marker, so capture scripts have their output folder.

Raw screenshots stay local. Reviewed guide images live in `docs/images`. See [GitHub file rules](../GITHUB-HYGIENE.md).
