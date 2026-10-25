# LVX Machina source provenance

Imported from the user-supplied a3/Frontend/dist/win-unpacked/resources/app.asar. IMPORT-MANIFEST.json identifies the immutable archive and each published source file. Explicit privacy amendments retain the original digest alongside the amended digest; this is not a claim that the amended file is byte-identical to the original archive. This preserves the fuller local Machina variant beside the maintained Test Studio product at the repository root. It does not overwrite the transactional storage, native execution, credential or isolation fixes in Test Studio.

Environment files, caches, dependencies, generated binaries and user data are excluded. Historical test/demo source is retained here for comparison; Test Studio never seeds these examples automatically. This historical snapshot is not a newly certified standalone release. Feature parity is implemented and verified in the root product.

The public source also constructs a synthetic Slack token inside its archived security test. `fixtureAmendments` records the original and published test-file digests. The scanner receives exactly the same test input; the literal is assembled at runtime to avoid a GitHub push-protection false positive.
