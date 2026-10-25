# Support matrix

| Capability | Supported contract | Verification boundary |
|---|---|---|
| Desktop | Windows x64 / Electron 44.9.3 | Local source and packaged runs; check current evidence dates |
| Browser preview | Chromium static UI | Desktop bridge unavailable |
| Native AI agents | Official installed Codex / Claude Code / Gemini CLIs | Structured process fixtures verified; version detection is not account authentication or live answer quality |
| AI API routes | Explicit provider/model or custom server | Main-process transport with complete conversation history and strict completion states |
| Visual agent boards | Workspace-scoped nodes, directed peers, chats, recovery and linked native checks | See [agent guide](AGENT-STUDIO.md) and source-bound receipts |
| Native tests | Installed Node/Python/Java/.NET plus matching framework | Readiness must be checked before running |
| Team service | Authenticated loopback service | Remote exposure requires an administered TLS/auth deployment |
| OS credentials | Electron safeStorage with an available encryption backend | Fail closed when unavailable |
| Releases | Local unsigned development builds | Signing certificate and remote CI configuration are external prerequisites |
| macOS / Linux | Not certified | No successful platform jobs have been recorded |

Use `npm run setup` for pinned local browser/assets. A clean Windows CI workflow is provided; a workflow file is not evidence that a hosted job ran. Report problems using the issue templates with a minimal authorized fixture and redacted evidence.
