# Nexus folder-board comparison, 2026-10-25

Inspected Nexus source at `d5b799b80e4ade5b22cb0377e085ddc96c65c1d7` through the GitHub connector. The old local checkout was unavailable. No Nexus memory vault, private chats or credentials were accessed. Source was inspected, not copied.

[AGENT_BOARD.md](https://github.com/KZTP47/nexus-harness/blob/d5b799b80e4ade5b22cb0377e085ddc96c65c1d7/docs/AGENT_BOARD.md) describes one visual canvas with agents, folder projects, works-on assignments and agent communication routes. Nexus supports many-to-many project assignments and an active project per conversation. [team.py](https://github.com/KZTP47/nexus-harness/blob/d5b799b80e4ade5b22cb0377e085ddc96c65c1d7/src/our_harness/agent_runtime/team.py) supplies a chosen working directory to native sessions. Its v3 team runtime and its older visual board are distinct paths. This establishes the documented mechanism, not identical behavior in every Nexus build.

In LVX 0.7.4, Agent projects was the task/mission and graph-change review interface. It did not select a file directory; every native turn used the selected storage workspace as its working directory. The similar word project hid two different concepts.

LVX 0.8.0 keeps its existing board and introduces explicit folder cards and works-in links. Each agent has one current native working folder. Multiple agents can share a folder, and different agents can work in different folders. This is not complete Nexus many-to-many or pair-chat feature parity. The board and chats stay in the LVX storage workspace. Folder picker choices grant machine-local access for that storage workspace; imported paths require reselection, and native conversations cannot silently move directories.

The mission/task/graph tools are named Tasks & graph review and open inside the AI board. Their walkthrough distinguishes folders, agents and optional work plans. Existing mission/task records and graph-review operations remain compatible. API chat can analyse supplied text but has no native local-file tools; assigning a folder does not create that capability.
