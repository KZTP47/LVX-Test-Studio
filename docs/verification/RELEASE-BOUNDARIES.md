# Historical 0.2.0 release boundaries

This document preserves the earlier local-only delivery scope. The current 0.3.0 Machina integration is described in [MACHINA-MIGRATION.md](../MACHINA-MIGRATION.md), with current build, installer, clean-room, Machina E2E, private-remote and independent-review receipts in this directory. The current user request explicitly authorizes repository pushes and private visibility. Hosted Windows CI was attempted but GitHub blocked the job before execution because of account billing/spending limits.

# Local candidate and external checks

The local candidate is version 0.2.0. Read `final-delivery-results.json` for the measured source digest, installer hash and check counts. That receipt is written only after all required local reports match the same application source.

The implementation follows the owner's confirmed light, visual-first flow. Advanced source, parameters, fixtures, typed mappings and full evidence remain available. MIT was explicitly selected by the owner. Ordinary profiles are not populated with example tests.

Three original acceptance outcomes retain an explicit qualification:

| Item | Implemented and locally checked | Remaining evidence |
|---|---|---|
| FW-25 | Named accessibility tree, dialog semantics, keyboard focus lifecycle, accessible workflow list, actual keyboard recovery and 200% zoom | An actual screen-reader session has not been recorded. Automated accessibility-tree checks are not a substitute for that receipt. |
| FW-27 | Protected signing workflow, checksums, installer upgrade/reinstall/launch/uninstall and cryptographic update/rollback controls | No publisher certificate was supplied. The local installer is unsigned; a genuinely signed candidate must be verified separately. |
| FW-28 | Pinned setup, Windows workflow configuration, local clean-directory install and source/packaged checks | No hosted Windows workflow run has been submitted or observed. The local clean-directory receipt does not claim otherwise. |

No public release, repository push, certificate purchase or always-running update service is part of this local delivery. macOS and Linux remain uncertified. Native tests execute with the current operating-system account's permissions after workspace trust.

All other roadmap dispositions refer to the current measured local Windows contract and documented engine limits. They are not a promise of defect-free software or support for arbitrary external infrastructure.
