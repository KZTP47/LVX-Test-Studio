# AI board connection routing

The inspected Nexus implementation uses straight center-to-center SVG lines for agent communication, workspace assignments and chat ownership. See `theMiddleOf`, `drawSwarmLines` and `drawOneSwarmLine` in [the pinned Nexus source](https://github.com/KZTP47/nexus-harness/blob/d5b799b80e4ade5b22cb0377e085ddc96c65c1d7/src/our_harness/ui/app.js#L12062).

LVX follows that geometry on its AI board, clipping the visible line to the facing card boundaries and measuring actual card sizes. Workspace links remain dashed; directed agent links retain arrows and enabled/disabled controls. Selecting an agent emphasizes its workspace links. Graph workflow curves remain unchanged. No Nexus memory vault or private chat was accessed.
