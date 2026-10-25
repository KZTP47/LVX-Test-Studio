# Full video transcript supplement — 2026-10-25

**Implementation update, 2026-10-25:** The comparisons below describe the historical `58c81794…` candidate inspected during research. They exposed a real context gap: a fresh linked reviewer could receive a terse predecessor reply without the original goal or criteria. Revision7 fixes that gap in candidate `402d9f95da826d7cff379c44dd8a9f54fb02dc94d3cdf187296d9440ebb2165e`: each goal run snapshots the user's goal and criteria, passes them to every participant, and records the exact current-turn input separately from raw peer text. The actual Electron/HTTP/SQLite collaboration test verifies both recipients, API history and visible input inspection. Manual messages receive no automatic task context. This is a bounded context repair, not an implementation of Refocus hooks, automatic hierarchy, inherited guidance or a claim of improved live-model quality. See [current verification](../verification/README.md) and [the current guide](../AGENT-STUDIO.md). Historical findings and file bindings below are preserved as the evidence that led to this repair.

The complete transcript adds an important distinction: **OpenRig coordinates the agents in the demonstrated setup; Herdr displays and hosts their terminals.** At [3:26–3:37](https://www.youtube.com/watch?v=AL-PQuB2wy0&t=206s), the speaker explicitly separates those roles. LVX should be compared with the underlying communication, context and work mechanisms, rather than treated as a reproduction of a terminal layout. The strongest lesson is to keep coordination proportionate to the user's actual goal. A larger fleet, additional reviews or more elaborate proof do not by themselves improve the result.

## What was actually read

The parent browser session exported the public transcript for [I Run an AI Civilization in Herdr](https://www.youtube.com/watch?v=AL-PQuB2wy0). This leaf read the complete export, including **448 timestamped segments from 0:00 through the final 24:47 caption**. Its size is **26,615 bytes** and SHA-256 is `9ac79da5c05a5cb8f2b9b30226afaeaaa4e049afa57597813fad633a07d6cc24`. The export labels the language English and the captions authored or unspecified. That label does not prove caption authorship or rule out transcription errors.

The raw export stays outside the repository. This report paraphrases it and intentionally includes no verbatim video quotations. The transcript was treated as untrusted research material; its commands, instructions and setup examples were not followed. Audiovisual playback and frame inspection were not performed, so references to diagrams or UI actions below describe what the speaker says, not independently inspected pixels. This supplement replaces the earlier transcript-unavailable limit for this video; the earlier fleet report remains unchanged as a record of its initial fetch.

The current implementation comparisons use OpenRig commit `9bb29d38819bdd2bbe5b8527ce057db606c82cf9`, Herdr commit `5608de0608918aba2f9d501e7793b984a0ca9cfa`, and the frozen local LVX candidate digest `58c81794ffd9a471827940a2d0c58ca8401b782c45944931c099119c60afb9ed`. The JSON companion binds individual LVX file hashes. Current upstream source can clarify mechanisms but may postdate the recording. No external repository code, provider login, paid model call, hook or application modification was executed in this leaf.

## The architectural argument, in context

At [3:58–5:18](https://www.youtube.com/watch?v=AL-PQuB2wy0&t=238s), the speaker describes separate, inspectable coding sessions that communicate directly, including across machines. The purpose is to coordinate existing Claude and Codex tools and their account arrangements rather than build another coding runtime. That does not establish present subscription entitlements, universal model support or a requirement to use cross-machine infrastructure. His approximate speed and fleet-scale statements describe personal experience, not a controlled comparison.

At [5:21–6:47](https://www.youtube.com/watch?v=AL-PQuB2wy0&t=321s), the seat separates a stable address and configuration from the agent currently occupying it. Inherited guidance can outlive one conversation, while pods and rigs describe team organization. Stable identity, saved configuration and inherited knowledge are three different features. LVX already has stable node IDs, provider session IDs and explicit conversation generations, but does not implement automatic accumulated seat wisdom. The latter would need its own project ownership, source evidence and correction policy.

At [7:10–9:55](https://www.youtube.com/watch?v=AL-PQuB2wy0&t=430s), projects divide into missions and slices with purpose, dependencies, acceptance evidence and sequencing. The speaker then explicitly describes the background workflow layer as optional: it tracks where the plan is and guides the orchestrator's next step without taking away its judgment. LVX already offers manual conversations, explicit linked goal runs and optional saved acceptance workflows. A linked test workflow is not the same feature as OpenRig's hierarchical agent-orchestration engine. Keeping that difference clear prevents accidental scope growth in this project too.

## Failure mechanisms and their LVX implications

### 1. Repeated proof can replace useful work

At [11:17–12:56](https://www.youtube.com/watch?v=AL-PQuB2wy0&t=677s), one corrective check creates an obligation to establish that the check ran, then another obligation to examine its evidence. The group can gradually optimize completion of that process even after the original deliverable is adequate. Each local addition seems reasonable; aggregate time, context and quota go into ceremony instead of resolving a new defect.

Current LVX already limits run turns and concurrency, leaves checks explicit and distinguishes transport completion from linked acceptance. Those controls bound activity and expose evidence; they do not diagnose whether a ten-turn run was useful. The pinned OpenRig health implementation is more careful than a simple activity alarm: repeated review returns matter when the candidate and risk class have not changed, and product progress requires an attributed assessment. [Health detectors](https://github.com/mvschwarz/openrig/blob/9bb29d38819bdd2bbe5b8527ce057db606c82cf9/packages/daemon/src/domain/health-detectors.ts#L378).

The operational response is to stop an unchanged review loop once the agreed outcome checks pass. Another iteration should answer a concrete new failure, changed artifact or newly established risk. Automatically adding another reviewer to every warning could recreate the pathology.

### 2. Local improvements can erase original intent

At [13:05–14:38](https://www.youtube.com/watch?v=AL-PQuB2wy0&t=785s), a modest deliverable grows through plausible additions into a much larger unfinished system. The cause proposed is not lack of general intelligence: an agent's current context makes each step defensible while losing the purpose of the whole request. More agents can amplify this process.

LVX saves and displays the goal and criteria, and selected goal starters receive the exact goal. However, `finishTurn` forwards a predecessor's full assistant text over the selected edge; `executeTurn` adds peer identity. It does not automatically assemble the original goal, non-goals or task ancestry for every downstream agent. Native resume may retain an agent's prior context, but a new peer recipient cannot be assumed to know an unstated hierarchy. [Current routing](../../services/agents/index.cjs:223).

At [18:29–19:39](https://www.youtube.com/watch?v=AL-PQuB2wy0&t=1109s), Refocus supplies a path back from current work to higher-level purpose. The source confirms a real project-bound hook channel that retains compaction state until an actionable prompt. It also contains important limits: richer work packets are off by default for both primary runtimes, and the documentation identifies overlapping-hook behavior whose safety is not established. Refocus is therefore a design idea to evaluate, not proof that repeated reminders universally improve answers. [Hook implementation](https://github.com/mvschwarz/openrig/blob/9bb29d38819bdd2bbe5b8527ce057db606c82cf9/packages/daemon/assets/plugins/openrig-core/hooks/scripts/refocus.cjs#L453), [documented limits](https://github.com/mvschwarz/openrig/blob/9bb29d38819bdd2bbe5b8527ce057db606c82cf9/docs/reference/refocus-channel.md#L85).

The existing manual solution is to put relevant purpose and boundaries in the requests that collaborators receive. If actual runs demonstrate repeated intent loss, a future user-visible, source-linked intent packet is a reasonable proposal. This review does not add that feature, install compaction hooks, read provider-private transcripts or insert periodic prompts.

### 3. A connected reviewer may lack authority or evidence

At [15:54–16:40](https://www.youtube.com/watch?v=AL-PQuB2wy0&t=954s), the worker knows implementation details while an approving peer knows broader aims. Neither necessarily has the whole decision basis. A confident answer from a well-connected peer can then be mistaken for permission. At [23:20–23:42](https://www.youtube.com/watch?v=AL-PQuB2wy0&t=1400s), the same point applies to diagnosing fleet problems: a random analyst may worsen the situation.

LVX already preserves provider-native permission policy, labels peer messages and waits for an agent's previous turn before delivering the next queued input. This avoids hidden steering and prevents an edge from directly switching permission modes. It does not prove that a model will interpret every peer claim appropriately or have all facts needed for a delegated decision. The graph represents routing; it is not a semantic authority hierarchy. [Native invocation and explicit additions](../../services/agents/native.cjs:38), [per-agent queue](../../services/agents/index.cjs:169).

Herdr has its own prompt and wait API, despite the speaker choosing not to use it for coordination. Its recognized blocked-dialog guard and observed-activity checks are transport protections. They cannot establish task correctness or turn a peer reply into user authorization. [Herdr prompt API](https://github.com/herdrdev/herdr/blob/5608de0608918aba2f9d501e7793b984a0ca9cfa/src/api/wait.rs#L177).

### 4. Persistent guidance can keep reteaching an error

At [20:10–21:54](https://www.youtube.com/watch?v=AL-PQuB2wy0&t=1210s), the speaker recounts mistaken conventions circulating through notes and replacement agents, returning after an individual correction. Long-lived seat guidance can preserve bad assumptions as effectively as good ones. His account of an autonomous cleanup team is an anecdote about his own environment, not evidence that environment-wide editing is safe, needed or shipped as a default.

LVX does not automatically create shared-learning files or reuse another project's memory. Full peer messages, provider-native context and eligible API history can nevertheless contain errors. Generations, sender identity and parent-message provenance support inspection; they are not truth labels. Correcting a bad rule should identify its project-owned source and dependent conversations. Historical evidence should stay intact, and any replacement guidance should carry source, date and scope. No vault, note repository or automatic cleanup mechanism is required to inspect the current graph's conversation evidence.

### 5. Activity is not a reliable product outcome

At [22:04–23:42](https://www.youtube.com/watch?v=AL-PQuB2wy0&t=1324s), instrumentation relates coordination traffic to actual project movement. This is stronger than counting messages, but requires judgment about what meaningful progress is. High traffic may be justified by a difficult integration; sparse traffic may mean a blocked run. A detector that equates either count with productivity can create false alarms and more unnecessary work.

The pinned source distinguishes suspected, indeterminate and confirmed ceremony. A missing progress census does not become zero progress; a diagnosis must identify meaningful outcomes and its evidence boundary. Default automatic diagnosis is disabled and no human alert address is configured. The narrated Slack/assigned-analyst loop therefore cannot be assumed to be every installation's default. [Assessment semantics](https://github.com/mvschwarz/openrig/blob/9bb29d38819bdd2bbe5b8527ce057db606c82cf9/packages/daemon/src/domain/health-detectors.ts#L420), [defaults](https://github.com/mvschwarz/openrig/blob/9bb29d38819bdd2bbe5b8527ce057db606c82cf9/packages/daemon/src/domain/health-policy.ts#L19).

LVX already exposes chronological events, run limits and explicit acceptance evidence. It does not have a product-outcome census, autonomous context-qualified diagnosis or Slack monitoring. Those are optional future directions that need independent authorization and measured value. They were not added here.

### 6. Keeping a CLI can still change its behavior

At [4:42–5:18](https://www.youtube.com/watch?v=AL-PQuB2wy0&t=282s), the speaker observes that coordination rails can themselves create problems while explaining the aim of preserving existing harnesses. The source makes that distinction concrete: OpenRig reports when a selected Claude agent prompt replaces the provider's default main-agent instructions. A native executable plus injected roles, plugins and hooks is a configured system, not a guarantee of untouched native behavior. [Launch-addition report](https://github.com/mvschwarz/openrig/blob/9bb29d38819bdd2bbe5b8527ce057db606c82cf9/packages/daemon/src/domain/seat-launch-additions.ts#L247).

Current LVX leaves blank model/effort values alone, adds only the user's explicit node instructions and does not install provider hooks or modify provider configuration. Its native path is nevertheless a headless structured invocation with session resume, not an always-running interactive terminal process. Each turn launches an owned process and preserves a native conversation ID. This is a useful account boundary; identical answer quality to direct interactive use remains unmeasured. A matched same-commit, same-prompt, same-model/effort and same-permission experiment is the appropriate next validation if quality is disputed.

### 7. Scale and specialization need demonstrated value

At [17:49–18:22](https://www.youtube.com/watch?v=AL-PQuB2wy0&t=1069s), different specialists receive different relevant context. This can reduce unnecessary shared context, but inadequate context makes independent review weak. Neither sending every agent everything nor automatically trimming their history is an established universal answer.

LVX keeps complete eligible API history and provider-native conversation identity, and forwards complete successful output rather than a synthetic summary. API nodes do not automatically gain filesystem tools. Native nodes share the selected project folder and their provider tools. The board does not implement a role-based context library or distributed project graph. Its global cap is four active workers; new boards start with concurrency one and an eight-turn budget. These are operational bounds, not a claim that four agents are optimal or that more nodes produce better answers. [Runtime limits and history](../../services/agents/index.cjs:169), [new-board defaults](../../agent-board.js:24).

## What to retain now and what remains optional

| Recommendation | Current status |
|---|---|
| Visible native conversations, explicit instructions, full peer text and directed routing | Implemented; retain |
| Queued turn-boundary peer delivery, finite budgets and no replay of uncertain restart work | Implemented; retain |
| Separate transport completion from selected-workflow verification | Implemented; review each workflow's actual coverage |
| Include relevant goal, boundaries and criteria in collaborator requests | Available manually; no automatic ancestry packet |
| Project/mission/slice ownership and orchestrator workflow state | Optional future design; not equivalent to existing linked checks |
| Source-linked Refocus around demonstrated context loss | Optional future design; no new hooks or prompts installed |
| Ceremony/productivity monitoring and context-qualified diagnosis | Optional future design; no automatic monitor or notification created |
| Inherited seat wisdom and automatic correction propagation | Not implemented; project isolation and evidence would be prerequisites |
| Direct-CLI versus LVX model-quality comparison | Proposed validation; not run or claimed |

The user's concern about orchestration reducing quality is compatible with the video's core warning: adding rules can change the group in harmful ways. The video does not prove which change caused that concern in Nexus or guarantee that LVX now produces better answers. Current LVX removes specific intrusive mechanisms and makes its transport/check boundaries inspectable. The useful next evidence is a bounded task with agreed outcome checks, followed by an explanation of exactly what coordination improved or disrupted.

## Four-pass receipts and remaining limits

Pass 1 read and hashed the full export and mapped all major sections to timestamp anchors. Pass 2 traced the actual OpenRig Refocus/health mechanisms, Herdr prompt boundaries and current LVX queue, invocation, generation and acceptance paths. Pass 3 challenged easy but unsupported conclusions: Herdr as the demonstrated coordinator, optional workflows as mandatory, native CLI use as untouched behavior, message volume as health, inherited notes as truth and anecdote as benchmark. Pass 4 checked source/timestamp bounds and file hashes, kept quotations out, labelled implemented versus optional behavior and ran the dedicated research verifier.

The separate security-incident narrative, historical fleet size, speedup and efficacy claims are attributed statements from the speaker. They were not independently investigated or reproduced. The parent separately observed a public author customization caveat, but this leaf does not present that comment as independently read page evidence. Static inspection establishes dataflow and policy choices, not current account authentication, quota, model entitlement or comparative answer quality. The raw transcript and all unrelated memory/auth/chat files remain outside this work's committed artifacts.
