# Agent runtime

`createService({dataDir, workspaceRoot, workspace, emit, requestAI, redact,
runAcceptance})` returns `handle`, `setWorkspace` and `close`. Production callers
must provide a stable app-private `dataDir`, the existing canonical workspace
service, and the host's trust and workspace checks. Before changing the workspace
service's root, await this service's cancellation/drain through `setWorkspace` or
`close`. `setWorkspace` never changes the canonical service itself.

The public actions and board schema follow the studio contract. State lives in
`agent-boards`, `agent-sessions`, `agent-runs`, `agent-messages` and `agent-events`.
Each state change and its event commit in one canonical transaction. A private
native-session provenance key stays in `dataDir`; it is not a provider credential
and is not part of workspace archives or board exports. Unsigned, modified,
foreign-project and foreign-installation native IDs require an explicit new
conversation. Exported IDs are metadata and do not authorize imported resumes.

Messages receive immutable board-local creation sequences; events share the same
monotonic counter. `snapshot(afterSequence, limit)` pages the merged creation/event
index, and its `cursor` advances through that index. `hasMore` indicates another
page. Messages referred to by events in the page are also returned with their
**current** complete canonical state, even if their creation sequence precedes the
cursor. Clients merge messages by ID and use the returned cursor, not the maximum
message sequence. Runs and sessions are current complete projections on every
page. `exportBoard` returns the complete retained history after credential
redaction. Stored message bodies, full-chat views and peer deliveries retain the
complete text. Node cards use an explicitly marked 100-character preview.

Manual sends stay in the selected conversation and receive no automatic task
context. Each goal run snapshots the user-authored goal and acceptance criteria
as immutable `taskContext`. Every starter and linked recipient receives that
snapshot. A starter's goal appears once; peers receive the snapshot followed by
the unchanged complete assistant body and a visible sender/recipient header.
No standing rules, synthetic roles, extra agent turns or provider defaults are
added. In linked mode, completed assistant text is delivered only over enabled
directed links. Ordinary delivery waits for an idle recipient. Per-board
concurrency is a user-selected positive integer without an application maximum.
A turn budget of zero follows each route until its leaves, withholding automatic
replays to ancestors so cycles finish naturally. A positive user-selected budget
permits iterative cyclic delivery and has no application maximum. Pausing
holds queued deliveries while an active turn finishes. Cancellation stops owned
process trees, cancels pending messages and preserves current-generation partial
output, protocol and diagnostics as cancelled evidence without routing it.

Only messages admitted by this live service can launch. Their immutable payload
and board configuration fingerprints are checked and consumed before execution.
The fingerprints bind the run and message task context, and active attempts also
bind the exact recorded input. Goal/criteria wording can be edited on the board
while a run is queued or active; the admitted run keeps its original snapshot.
Changes to executable agent settings or links still require stopping active work.
Restarted, imported, replaced, cancelled or already attempted queue records are
never automatically replayed. Active attempt IDs fence late results against
canonical record replacement. A post-effect persistence failure quarantines the
agent until the user reviews effects and explicitly creates a new conversation.

Native providers use their official executable, or the known official npm JS
entry through Node, without composed shells. Blank native model/effort settings
produce no overrides. Native permissions produce no product override; only Codex
offers the verified read-only/workspace-write selections. Claude and Gemini expose
native policy only. Explicit instructions are optional additions: Codex developer
instructions, Claude appended system instructions, or a visible Gemini user-text
prefix. No provider config, project guidance, hooks or authentication files are
modified. Version probes send no model prompt and do not prove authentication.

At dispatch, incoming `message.text` remains the original raw goal, manual message
or peer body. `message.transportInput` records the exact input supplied to the
native/API adapter, including goal context and any explicitly chosen Gemini user
prefix. Queued messages expose planned `taskContext` without a `transportInput`
until dispatch. The recorded input identifies the attempt; provider outcome and
completion receipts separately show whether it succeeded. Without an explicit
user prefix, manual input reaches the adapter byte-exact.

The configured API callback receives that exact current prompt and complete eligible
user/assistant turns from the current conversation generation as `messages`, plus
optional user-authored system additions. Eligible prior turns have completed,
blocked, limit, partial or error outcomes. Incoming history uses its actual stored
`transportInput`; assistant history retains the raw response. Older rows without
this field use only their original raw/header input, without invented historical
task context. New undispatched messages are excluded. Cancelled and interrupted
turns remain stored, visible and exportable, but are deliberately excluded from later API
context to avoid replaying uncertain cancelled work. Prior generations are also
excluded. Native provider resume may retain its own partial conversation context.
OpenAI, Anthropic and Google nodes require an explicit model. A blank custom API
model sends the literal model alias `default`; the endpoint must accept or map
that alias. Choose an explicit model when the endpoint does not support it.
Typed blocked/incomplete API errors retain their full partial text and cannot
route peers as completed output.
Text with an unknown or missing completion receipt is retained as partial output
and is not forwarded automatically, including for custom endpoints.

Execution outcomes are completed, blocked, limit, partial, error, cancelled or
interrupted. These are separate from acceptance (`UNREVIEWED`, `VERIFIED`,
`FAILED`). Only an explicit `runAcceptance` invocation calls the connected saved
workflow executor. The callback receives an AbortSignal; cancellation and workspace
selection abort and drain it. A verdict applies only to the latest run whose board
state stayed unchanged during checks. A native completion receipt proves transport
completion, not task correctness or model-quality parity.
Acceptance metadata uses the latest run's original acceptance-criteria snapshot.

Tests use labelled deterministic subprocess/API fixtures and real canonical SQLite
storage. They do not authenticate providers, send paid model requests or assess
model quality. Composed input and native/API output have no local byte ceiling.
Native turns and API requests have no deadline by default; optional authored
transport deadlines and output budgets remain enforceable and cancellable.
Unspecified API token budgets are omitted. Anthropic Messages requires an explicit
positive output token budget; the agent API settings expose that provider requirement.
Provider-installed
tools, native permissions, account limits and CLI updates can still block actual
work and are reported without silently creating a fresh conversation.

## Visible work and importing agent tests

A running attempt exposes an ephemeral, attempt-bound activity snapshot. Native
provider events show completed assistant message text and coarse tool activity;
reasoning blocks, tool commands and tool output are not turned into chat text.
The API adapter reports that it is waiting when that endpoint returns only a
complete response. A one-second clock keeps elapsed time visible. The final
message and existing protocol evidence remain the durable execution receipt.

Chat delivery can be one agent or explicit directed collaboration. Collaborative
chat forwards only successful complete replies over enabled arrows, inside the
saved turn budget; manual chat retains its single-turn behavior. Actual peer
records identify sender, recipient, state and full forwarded text in both chats
and the board's Messages between agents section.

Import agent tests previews selected JSON exports or structured reply bundles.
It validates supported test source and workflow shapes without evaluating code,
checks dependencies and conflicts, and saves all chosen exports in one revision
checked transaction only after review. It never overwrites existing records or
runs imported content. Project archives containing additional data such as
baselines should use the complete Project & backup import flow instead.
