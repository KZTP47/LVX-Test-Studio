# Review before uploading

An audit produces evidence for the user. It never authorizes an upload. After the agent returns the report, the user decides whether to publish or request more work.

## One-time local installation

Install the pinned Windows x64 Gitleaks version identified in `public-files-policy.json`. Obtain it from the official Gitleaks release, verify its archive and executable hashes against that policy, then run:

```text
node scripts/privacy-guard.cjs install --scanner <verified-gitleaks.exe>
```

For this workspace, which has an outer folder containing the `app` Git checkout, also pass `--scan-root ..`. This binding is stored privately inside `.git/privacy-guard/`; public source files contain no personal installation paths. Other clones default to their own repository root. Node, Git and Python 3.10 or later are required. Missing tools or scan errors block publication.

The installer preserves an unrelated `core.hooksPath` or existing default commit/push hook by refusing to replace it. Integrate those hooks explicitly if necessary. It installs `.githooks/pre-commit` and `.githooks/pre-push` through local Git configuration. Hooks are not installed automatically by cloning a repository.

New commits must use the public maintainer handle from `package.json` and the maintainer's GitHub noreply email. The optional `--identity-from-head` installation flag copies those values from the existing HEAD only when they already satisfy that policy. It changes repository-local configuration, never global Git settings.

## Agent workflow

1. Inventory the entire bound local folder, including hidden, ignored and outside-repository files. Run `node scripts/privacy-guard.cjs audit`. The scanner inventories file hashes, text/binary token formats, personal and absolute paths, email addresses, images, ZIP/WHL/ASAR members and reachable Git history. It never follows symlinks or junctions into another project. A link or unreadable/changing file leaves the audit incomplete.
2. Review the redacted report. README-linked images are explicitly accepted by the user's policy, but their exact bytes must still be reviewed when they change. Check new screenshots visually; code cannot certify their pixels. Inspect personal/business data, filenames, commit messages and metadata in addition to automatic matches. Keep actual secrets out of reports and chat responses.
3. For every potentially sensitive file, inspect imports, build inputs, runtime references and tests to decide whether it is needed. Do not infer that all untracked files are disposable. Several new source files are essential to LVX.
4. If it is nonessential local data, add a narrow ignore rule, preserve the file on disk and verify it is neither tracked nor staged. Local agent journals, private instructions, project saves and the previously identified personal import/inspection helpers are permanently denied by the guard, including when force-added. Already-tracked files require a deliberate index-only removal; ignoring them alone is insufficient.
5. If required code or configuration contains private information, make it portable and remove the actual private values. Use workspace-relative paths, user-selected inputs, environment configuration or the existing encrypted credential store. Preserve fail-closed behavior and functional contracts. Do not change a real secret into another hardcoded secret, strip required third-party licence attribution or automatically allowlist a suspicious value. Verify the affected behavior; rebuild and verify the desktop application whenever application code changes.
6. Rerun the full audit after remediation. Exact synthetic test fixtures and required upstream assets can be recorded in the hash-bound policies only after inspection and a concrete reason. Exceptions do not cover other files or later bytes. Unknown content remains blocked. If there are no sensitive findings, still report what was checked, the withheld local data and the remaining detection limits.
7. Prepare the intended local candidate commit only when authorized. The final publication audit must run after that commit, with a clean working tree. Return its report and exact commit to the user. Include any existing historical author credits/resource references; current ignore rules do not erase earlier GitHub objects. Wait for the user's explicit upload decision.
8. Only after the user has approved that exact report, record the decision with the command below, then perform only the authorized branch update. Never run the approval command merely because checks passed.

```text
node scripts/privacy-guard.cjs approve <report-id> --remote origin --user-approved
git push origin <reviewed-branch>
```

The receipt is local and binds the report bytes, complete scanned file snapshot, refs, exact commit, branch and GitHub destination. It becomes invalid when these change. An approval for one branch/destination does not authorize tags, deletions, multiple ref updates or a different remote. Same-content retries are allowed; new work requires a new report and user decision.

Reports, scanner output, tools and receipts stay inside `.git/privacy-guard/`. No saved project data is copied there; reports contain relative filenames, hashes, counts and masked findings. Portable JSON project saves must still use the project's mandatory private save directory.

## Hook behavior and limits

The commit guard inspects the actual staged blobs, even if working files differ. Portable project archives are also recognized by their JSON structure, so renaming an export is insufficient. The push guard examines intermediate outgoing commits as well as the final tree, so committing a private file and deleting it later does not evade the guard. Missing/stale approval blocks the push. An audit with unresolved publication findings cannot be approved.

The user retains the upload decision. Agents must not bypass hooks using `--no-verify`, alternate Git configuration, GitHub APIs, `gh`, another remote or a separate upload mechanism. Local hooks cannot prevent a person or a process with the same account from deliberately disabling them. They also cannot recall data already uploaded. No automatic detector can promise 100% anonymity, infer every personal name, decrypt every archive or understand every screenshot; report such gaps and resolve them before asking for publication approval.

The read-only GitHub CI checks supplement this workflow after a push; they cannot replace the local review before data leaves the computer.
