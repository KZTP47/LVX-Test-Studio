# Reporting and boundaries

Report a reproducible vulnerability privately through GitHub security reporting if enabled. Otherwise open an issue asking for a private contact channel without posting credentials or exploit material targeting another person. Supply the affected version, local reproduction, expected boundary and redacted evidence.

Only run tests or scans against targets you own or are authorized to assess. Workspace trust permits execution of user-selected code with the account's permissions. It is not an operating-system sandbox. Separate preview windows have no desktop preload and deny permissions and unapproved network access. Do not load credentials or personal information into untrusted test content.

Credential storage must use an available OS encryption backend. Exports exclude credential values. Scanner findings are bounded evidence for supported rules, formats and adapter coverage; they do not prove a project is secure. Missing tools and incomplete coverage cannot pass a security gate.

Unsigned local builds are development artifacts. A public signed release additionally requires the owner's publisher identity and a verified signing pipeline. The update verifier rejects tampered, expired and replayed manifests; rollback requires a newer signed approval and an explicit choice.
