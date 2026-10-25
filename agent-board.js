/* Visual agent workspace. Native state and execution remain behind the agents IPC. */
const clone = (value) => JSON.parse(JSON.stringify(value));
const uuid = () => globalThis.crypto.randomUUID();
const PROVIDERS = {
  codex: "Codex",
  claude: "Claude",
  gemini: "Gemini",
  api: "Configured API",
};
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const workspaceKey = (value) =>
  String(value || "")
    .replaceAll("\\", "/")
    .replace(/\/+$/, "")
    .toLowerCase();

const appearanceOf = node => ({ color: '#49cde5', icon: 'robot', avatar: '', zoom: 1, hue: 0, ...node?.appearance });
const safeAvatar = value => typeof value === 'string' && value.length <= 350000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : '';
const WORKSPACE_FOLDER = '__workspace__';
export function projectCards(board, workspaceRoot) {
  return [{id:WORKSPACE_FOLDER,name:'Current workspace',path:workspaceRoot,position:board.view?.workspacePosition||{x:80,y:360},isWorkspace:true},...(board.projects||[])];
}

export function emptyBoard(id = uuid()) {
  return {
    schemaVersion: 1,
    id,
    name: "Untitled agent board",
    goal: "",
    acceptanceCriteria: "",
    mode: "manual",
    maxTurns: 8,
    concurrency: 1,
    nodes: [],
    edges: [],
    view: { zoom: 1, panX: 24, panY: 24 },
  };
}

export function validateDraft(board) {
  const errors = [];
  if (!String(board.name || "").trim()) errors.push("Give the board a name.");
  if (
    !Number.isInteger(board.maxTurns) ||
    board.maxTurns < 1 ||
    board.maxTurns > 100
  )
    errors.push("Turn limit must be an integer from 1 to 100.");
  if (
    !Number.isInteger(board.concurrency) ||
    board.concurrency < 1 ||
    board.concurrency > 4
  )
    errors.push("Concurrency must be an integer from 1 to 4.");
  const ids = new Set();
  const projects = new Set();
  if(board.projects!==undefined&&(!Array.isArray(board.projects)||board.projects.length>20))errors.push('Use up to 20 project folders.');
  for(const project of Array.isArray(board.projects)?board.projects:[]){
    if(!project.id||project.id===WORKSPACE_FOLDER||projects.has(project.id))errors.push('Project folder IDs must be unique.');
    projects.add(project.id);
    if(!String(project.name||'').trim())errors.push('Give every project folder a name.');
    if(!String(project.path||'').trim())errors.push('Choose a project folder on this computer.');
    if(![project.position?.x,project.position?.y].every(Number.isFinite))errors.push('Folder positions must be numbers.');
  }
  for (const node of board.nodes) {
    if (ids.has(node.id)) errors.push("Agent IDs must be unique.");
    ids.add(node.id);
    if(node.projectId&&!projects.has(node.projectId))errors.push('Every agent folder assignment must refer to a folder on this board.');
    if (!String(node.name || "").trim())
      errors.push("Every agent needs a name.");
    if (!Object.hasOwn(PROVIDERS, node.provider))
      errors.push("Choose a supported provider.");
    if (![node.position?.x, node.position?.y].every(Number.isFinite))
      errors.push("Agent positions must be numbers.");
    if (
      node.provider === "api" &&
      node.apiConfig?.provider !== "custom" &&
      !String(node.model || node.apiConfig?.model || "").trim()
    )
      errors.push("Choose an explicit model for this API provider.");
  }
  const pairs = new Set();
  for (const edge of board.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target))
      errors.push("Every connection must join existing agents.");
    if (edge.source === edge.target)
      errors.push("Connect two different agents.");
    const key = `${edge.source}\0${edge.target}`;
    if (pairs.has(key)) errors.push("This directed connection already exists.");
    pairs.add(key);
  }
  return [...new Set(errors)];
}

export function mergeSequenced(previous, incoming) {
  const byId = new Map(
    previous.map((item) => [item.id || `sequence:${item.sequence}`, item]),
  );
  for (const item of incoming)
    byId.set(item.id || `sequence:${item.sequence}`, item);
  return [...byId.values()].sort(
    (a, b) => (a.sequence || 0) - (b.sequence || 0),
  );
}

export function acceptsAgentEvent(
  event,
  workspaceRoot,
  boardId,
  afterSequence = 0,
) {
  return (
    event?.domain === "agents" &&
    event.type === "event" &&
    workspaceKey(event.workspaceRoot) === workspaceKey(workspaceRoot) &&
    event.boardId === boardId &&
    Number.isInteger(event.sequence) &&
    event.sequence > afterSequence
  );
}

export function connectionPath(source, target) {
  const sx = source.position.x + 230,
    sy = source.position.y + 64,
    tx = target.position.x,
    ty = target.position.y + 64;
  const bend = Math.max(65, Math.abs(tx - sx) * 0.45);
  if (tx >= sx)
    return {
      d: `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`,
      x: (sx + tx) / 2,
      y: (sy + ty) / 2 - 9,
    };
  const routeY = Math.min(sy, ty) - 90;
  return {
    d: `M ${sx} ${sy} C ${sx + 90} ${routeY}, ${tx - 90} ${routeY}, ${tx} ${ty}`,
    x: (sx + tx) / 2,
    y: routeY + 15,
  };
}

// Canvas-local endpoints on the facing rectangle edges. Measure rendered bounds
// so the ownership line follows transforms, native zoom and viewport clipping.
export function chatOwnershipLine(node, chat, canvas) {
  const center = r => ({x:r.left+r.width/2,y:r.top+r.height/2});
  const a=center(node),b=center(chat);
  const edge=(r,from,to)=>{
    const dx=to.x-from.x,dy=to.y-from.y;
    if (!dx&&!dy) return {x:r.left+r.width,y:from.y};
    const scale=Math.min(dx?r.width/2/Math.abs(dx):Infinity,dy?r.height/2/Math.abs(dy):Infinity);
    return {x:from.x+dx*scale,y:from.y+dy*scale};
  };
  const start=edge(node,a,b),end=edge(chat,b,a);
  return {x1:start.x-canvas.left,y1:start.y-canvas.top,x2:end.x-canvas.left,y2:end.y-canvas.top};
}

export function edgeLabelPosition(source, target, nodes) {
  const x = (source.position.x + 230 + target.position.x) / 2;
  const gap = target.position.x - source.position.x - 230;
  const candidates = [];
  if (gap >= 72)
    candidates.push({ x, y: (source.position.y + target.position.y) / 2 + 54 });
  const top = Math.min(source.position.y, target.position.y);
  for (let offset = 18; offset <= 2418; offset += 24)
    candidates.push({ x, y: top - offset });
  return (
    candidates.find(
      (label) =>
        !nodes.some((node) => {
          const left = node.position.x,
            top = node.position.y;
          return (
            label.x - 32 < left + 230 &&
            label.x + 32 > left &&
            label.y - 14 < top + (node.height || 160) &&
            label.y + 4 > top
          );
        }),
    ) || candidates.at(-1)
  );
}

export function friendlyMessageRoute(message, nodes) {
  const names = new Map(nodes.map((node) => [node.id, node.name]));
  const agent = names.get(message.agentId) || "Previous agent";
  const name = (id, fallback) =>
    id === "user" ? "You" : names.get(id) || fallback;
  const from = name(
    message.from,
    message.role === "user"
      ? "You"
      : message.role === "system"
        ? "System"
        : agent,
  );
  const to = name(message.to, message.role === "assistant" ? "You" : agent);
  return `${from} → ${to}`;
}

export function safeDraftExport(board) {
  const draft = clone(board);
  for (const node of draft.nodes) {
    if (!node.apiConfig) continue;
    delete node.apiConfig.apiKey;
    try {
      const endpoint = new URL(node.apiConfig.customEndpoint);
      endpoint.username = "";
      endpoint.password = "";
      for (const key of endpoint.searchParams.keys())
        if (/key|token|secret|pass|credential|authorization/i.test(key))
          endpoint.searchParams.set(key, "[excluded]");
      node.apiConfig.customEndpoint = endpoint.href;
    } catch {
      if (node.apiConfig.customEndpoint)
        node.apiConfig.customEndpoint = "[invalid endpoint excluded]";
    }
  }
  return { schemaVersion: 1, kind: "agent-board-draft", board: draft };
}

export function createResetScheduler(
  reset,
  { onError = () => {}, onSettled = () => {} } = {},
) {
  let running = null,
    again = false,
    closed = false;
  return {
    request() {
      if (closed) return Promise.resolve();
      again = true;
      if (running) return running;
      running = (async () => {
        let failure = null;
        do {
          again = false;
          try {
            await reset();
            failure = null;
          } catch (error) {
            failure = error;
          }
        } while (again && !closed);
        if (failure && !closed) onError(failure);
      })().finally(() => {
        running = null;
        if (!closed) onSettled();
      });
      return running;
    },
    get pending() {
      return !!running;
    },
    destroy() {
      closed = true;
      again = false;
    },
  };
}

/** Testable state coordinator. Drafts never become canonical without saveBoard. */
export function createBoardController({
  invoke,
  workspaceRoot,
  onChange = () => {},
  idFactory = uuid,
  requestSave,
}) {
  const boundWorkspaceRoot = String(workspaceRoot || "");
  let disposed = false,
    epoch = 0,
    refreshTask = null;
  const state = {
    boards: [],
    record: null,
    draft: emptyBoard(idFactory()),
    baseRevision: null,
    dirty: false,
    selectedAgentId: "",
    sessions: [],
    runs: [],
    messages: [],
    events: [],
    cursor: 0,
    hasMore: false,
    paused: false,
    capabilities: null,
    workflows: [],
    error: "",
    notice: "",
    busy: 0,
    conflict: false,
    missingBoard: false,
    acceptanceResult: null,
  };
  const notify = () => {
    if (!disposed) onChange(state);
  };
  const call = async (action, payload = {}) => {
    if (disposed) throw Error("This agent board has been closed.");
    if (!boundWorkspaceRoot)
      throw Error("Choose a workspace before using the agent board.");
    const result = await invoke(action, {
      ...payload,
      workspaceRoot: boundWorkspaceRoot,
    });
    if (disposed) throw Error("This agent board has been closed.");
    if (
      result?.workspaceRoot &&
      workspaceKey(result.workspaceRoot) !== workspaceKey(boundWorkspaceRoot)
    )
      throw Error("Workspace changed while the agent request was in progress.");
    if (result?.__lvxError) {
      const error = Error(result.__lvxError.message);
      Object.assign(error, result.__lvxError);
      throw error;
    }
    return result;
  };
  const fail = (error) => {
    state.error = error?.message || String(error);
    notify();
  };
  async function task(fn) {
    state.busy++;
    state.error = "";
    notify();
    try {
      return await fn();
    } catch (error) {
      fail(error);
      throw error;
    } finally {
      state.busy--;
      notify();
    }
  }
  function edit(change) {
    change(state.draft);
    state.dirty = true;
    notify();
  }
  async function listBoards() {
    const result = await call("listBoards");
    state.boards = result.records || [];
    notify();
  }
  function applySnapshot(snapshot, reset = false) {
    const stale =
      state.record?.id === snapshot.board.id &&
      state.record.revision > snapshot.board.revision;
    if (!stale) {
      state.record = snapshot.board;
      if (!state.dirty) {
        state.draft = clone(snapshot.board.value);
        state.baseRevision = snapshot.board.revision;
      } else if (state.baseRevision !== snapshot.board.revision)
        state.conflict = true;
    }
    state.sessions = snapshot.sessions || [];
    state.runs = (snapshot.runs || []).sort((a, b) =>
      String(a.createdAt || "").localeCompare(String(b.createdAt || "")),
    );
    state.paused = !!snapshot.paused;
    state.messages = mergeSequenced(
      reset ? [] : state.messages,
      snapshot.messages || [],
    );
    state.events = mergeSequenced(
      reset ? [] : state.events,
      snapshot.events || [],
    );
    state.cursor = snapshot.cursor ?? state.cursor;
    state.hasMore = !!snapshot.hasMore;
    if (!state.draft.nodes.some((n) => n.id === state.selectedAgentId))
      state.selectedAgentId = state.draft.nodes[0]?.id || "";
    notify();
  }
  async function load(boardId, { discard = false } = {}) {
    if (state.dirty && !discard)
      throw Error(
        "Save the current draft, or choose Discard draft before opening another board.",
      );
    const token = ++epoch;
    const snapshot = await call("snapshot", {
      boardId,
      afterSequence: 0,
      limit: 200,
    });
    if (token !== epoch || disposed) return;
    state.dirty = false;
    state.conflict = false;
    state.missingBoard = false;
    state.baseRevision = null;
    state.acceptanceResult = null;
    applySnapshot(snapshot, true);
  }
  async function refresh({ all = false } = {}) {
    if (!state.record) return;
    if (refreshTask?.epoch === epoch) {
      refreshTask.again = true;
      refreshTask.all ||= all;
      return refreshTask.promise;
    }
    const token = epoch,
      boardId = state.record.id;
    const pending = { epoch: token, again: false, all, promise: null };
    refreshTask = pending;
    pending.promise = (async () => {
      do {
        pending.again = false;
        const cursor = state.cursor;
        const snapshot = await call("snapshot", {
          boardId,
          afterSequence: cursor,
          limit: 200,
        });
        if (token !== epoch || disposed) return;
        applySnapshot(snapshot);
        if (state.hasMore && state.cursor <= cursor)
          throw Error(
            "History paging did not advance. Retry refresh or export the complete history.",
          );
      } while (pending.again || (pending.all && state.hasMore));
    })();
    try {
      await pending.promise;
    } finally {
      if (refreshTask === pending) refreshTask = null;
    }
  }
  async function resetFromCanonical() {
    if (!state.record) return listBoards();
    const boardId = state.record.id,
      token = ++epoch;
    try {
      const snapshot = await call("snapshot", {
        boardId,
        afterSequence: 0,
        limit: 200,
      });
      if (token !== epoch || disposed) return;
      // A restored archive may intentionally have lower revisions and sequences.
      state.record = snapshot.board;
      state.missingBoard = false;
      state.acceptanceResult = null;
      state.conflict = state.dirty;
      state.error = "";
      applySnapshot(snapshot, true);
      await refresh({ all: true });
      if (token !== epoch || disposed) return;
      await listBoards();
      if (token !== epoch || disposed) return;
      state.notice =
        "Workspace history reloaded after import. No agent work was replayed.";
      notify();
    } catch (error) {
      if (token !== epoch || disposed) return;
      state.conflict = true;
      state.missingBoard =
        error.code === "NOT_FOUND" ||
        /missing board|board.*not found|not found.*board/i.test(error.message);
      try {
        await listBoards();
      } catch {
        /* Keep the original reload error actionable. */
      }
      if (token !== epoch || disposed) return;
      notify();
      throw Error(
        state.missingBoard
          ? "This board no longer exists in the restored workspace. Your draft is preserved. Export draft to keep it, or Discard draft to start fresh and open another board."
          : `Cannot reload this board after the workspace changed. Your draft is preserved. ${error.message}`,
      );
    }
  }
  async function save(options = {}) {
    const mode = options.mode || "current";
    if (!["current", "new", "overwrite"].includes(mode)) throw Error("Choose how to save this board.");
    if (state.conflict && mode === "current")
      throw Error(
        "Saved board content changed. Your draft is preserved; discard it to reload the canonical board before saving.",
      );
    const original = clone(state.draft), board = clone(original);
    if (options.name !== undefined) board.name = String(options.name).trim();
    let baseRevision = state.baseRevision;
    if (mode === "new") { board.id = idFactory(); baseRevision = null; }
    if (mode === "overwrite") {
      if (!options.targetId || !Number.isInteger(options.targetRevision) || options.targetRevision < 1)
        throw Error("Choose an existing board to overwrite.");
      board.id = options.targetId; baseRevision = options.targetRevision;
    }
    const errors = validateDraft(board);
    if (errors.length) throw Error(errors.join(" "));
    const validation = await call("validateBoard", { board });
    if (!validation.valid)
      throw Error(
        (validation.errors || ["Board validation failed."])
          .map((e) => e.message || e)
          .join(" "),
      );
    let result;
    try {
      result = await call("saveBoard", {
        board,
        expectedRevision: baseRevision,
      });
    } catch (error) {
      if (board.id === state.draft.id && /conflict|revision/i.test(`${error.code} ${error.message}`)) {
        state.conflict = true;
        notify();
      }
      throw error;
    }
    const switched = original.id !== result.record.id;
    state.record = result.record;
    state.baseRevision = result.record.revision;
    state.conflict = false;
    // Preserve keystrokes entered while the IPC was in flight.
    if (JSON.stringify(state.draft) === JSON.stringify(original)) {
      state.draft = clone(result.record.value);
      state.dirty = false;
    } else { state.draft.id = result.record.id; if (state.draft.name === original.name) state.draft.name = board.name; }
    state.missingBoard = false;
    if (switched) {
      epoch++;
      Object.assign(state, { sessions: [], runs: [], messages: [], events: [], cursor: 0, hasMore: false, acceptanceResult: null, paused: false });
      await refresh({ all: true });
    }
    state.notice = `Board saved: ${result.record.value.name}.`;
    await listBoards();
    notify();
    return result.record;
  }
  async function ensureSaved() {
    if (state.dirty || !state.record) {
      if (requestSave && !state.record) { if (!await requestSave()) throw Error("Save cancelled. Your draft is unchanged; no message or run was started."); }
      else await save();
    }
    return state.record.id;
  }
  let sendAttempt = null,
    goalAttempt = null;
  async function send(agentId, text) {
    if (!text.trim()) throw Error("Write a message first.");
    const boardId = await ensureSaved();
    if (
      !sendAttempt ||
      sendAttempt.boardId !== boardId ||
      sendAttempt.agentId !== agentId ||
      sendAttempt.text !== text
    )
      sendAttempt = { boardId, agentId, text, requestId: idFactory() };
    const result = await call("send", sendAttempt);
    await refresh({ all: true });
    sendAttempt = null;
    return result;
  }
  async function runGoal(agentIds) {
    if (!state.draft.goal.trim()) throw Error("Add a project goal first.");
    if (!state.draft.nodes.length) throw Error("Add an agent first.");
    const boardId = await ensureSaved();
    agentIds = agentIds?.length
      ? [...agentIds]
      : state.record.value.nodes.map((node) => node.id);
    const key = JSON.stringify({ boardId, agentIds, goal: state.draft.goal });
    if (!goalAttempt || goalAttempt.key !== key)
      goalAttempt = { key, requestId: idFactory() };
    const result = await call("runGoal", {
      boardId,
      agentIds,
      requestId: goalAttempt.requestId,
    });
    await refresh({ all: true });
    goalAttempt = null;
    return result;
  }
  async function action(action, payload = {}) {
    // Recovery controls must work even when a draft cannot currently be saved.
    const boardId =
      ["pause", "resume", "cancel", "newSession"].includes(action) &&
      state.record
        ? state.record.id
        : await ensureSaved();
    const result = await call(action, { boardId, ...payload });
    await refresh({ all: true });
    return result;
  }
  async function newSession(agentId) {
    if (!state.record) await ensureSaved();
    await refresh({ all: true });
    const session = state.sessions.find((s) => s.agentId === agentId);
    if (!session)
      throw Error("Save this new agent before starting its conversation.");
    return action("newSession", {
      agentId,
      expectedGeneration: session.generation,
    });
  }
  async function capabilities() {
    state.capabilities = await call("capabilities");
    notify();
    return state.capabilities;
  }
  async function exportBoard() {
    if (!state.record) throw Error("Save this board before exporting history.");
    return call("exportBoard", { boardId: state.record.id });
  }
  async function initialize() {
    const results = await Promise.allSettled([
      listBoards(),
      capabilities(),
      call("listWorkflows").then((result) => {
        state.workflows = result.records || [];
        notify();
      }),
    ]);
    const errors = results
      .filter((r) => r.status === "rejected")
      .map((r) => r.reason.message);
    if (errors.length) {
      state.error = errors.join(" ");
      notify();
    }
  }
  return {
    state,
    task,
    edit,
    save,
    send,
    runGoal,
    action,
    newSession,
    refresh,
    listBoards,
    resetFromCanonical,
    load,
    capabilities,
    exportBoard,
    exportDraft() {
      return safeDraftExport(state.draft);
    },
    initialize,
    fail,
    select(id) {
      state.selectedAgentId = id;
      notify();
    },
    newBoard() {
      if (state.dirty)
        throw Error(
          "Save or discard the current draft before creating another board.",
        );
      epoch++;
      Object.assign(state, {
        record: null,
        draft: emptyBoard(idFactory()),
        baseRevision: null,
        dirty: false,
        conflict: false,
        missingBoard: false,
        error: "",
        notice: "",
        selectedAgentId: "",
        sessions: [],
        runs: [],
        messages: [],
        events: [],
        cursor: 0,
        hasMore: false,
        paused: false,
        acceptanceResult: null,
      });
      notify();
    },
    async discard() {
      if (state.record && !state.missingBoard)
        await load(state.record.id, { discard: true });
      else {
        state.dirty = false;
        this.newBoard();
      }
    },
    async deleteBoard() {
      if (!state.record) throw Error("This board has not been saved.");
      await call("deleteBoard", {
        boardId: state.record.id,
        expectedRevision: state.baseRevision,
      });
      state.dirty = false;
      this.newBoard();
      await listBoards();
    },
    destroy() {
      disposed = true;
      epoch++;
    },
  };
}

export function mountAgentBoard(
  container,
  { invoke, onEvent, workspaceRoot, initialBoardId = '', announce = () => {}, chooseProjectFolder, onOpenTasks, initialToolsOpen=false },
) {
  const icon = (name) => name === 'expand'
    ? '<svg class="lvx-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/></svg>'
    : globalThis.window?.LVXIcons?.svg(name) || "";
  const button = (action, label, ico = "plus", extra = "") =>
    `<button type="button" data-ab-action="${action}" ${extra}>${icon(ico)}<span>${label}</span></button>`;
  const field = (label, name, type = "text", extra = "") =>
    `<label class="ab-field">${label}<input name="${name}" type="${type}" ${extra}></label>`;
  const area = (label, name, extra = "") =>
    `<label class="ab-field">${label}<textarea name="${name}" ${extra}></textarea></label>`;
  const select = (label, name, options) =>
    `<label class="ab-field">${label}<select name="${name}">${options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select></label>`;
  container.innerHTML = `<section class="agent-board" aria-label="AI Agent Board">
    <header class="ab-heading"><div><h2 tabindex="-1">${icon("network")} AI Agent Board</h2><p>Open Chat on several agents to keep their conversations side by side. Dotted lines show which agent owns each chat.</p></div><span class="ab-revision" data-ab="revision"></span></header>
    <p class="ab-start-guide">Choose a folder → add an agent → assign its folder → save your board → open Chat or run a goal. Native agents work in their assigned folders; API agents only chat.</p>
    <div class="ab-notice" data-ab="notice" role="status" aria-live="polite"></div>
    <div class="ab-confirm" data-ab="confirm" hidden></div>
    <div class="ab-toolbar ab-board-tools">${select("Saved boards", "saved-board", [["", "Choose a board"]])}${button("load", "Open board", "folder")}${button("new", "New board", "plus")}${button("save", "Save board", "save", 'class="ab-primary"')}${button("discard", "Discard draft", "undo")}${button("delete-board", "Delete board", "trash")}${button("export", "Export full history", "download")}${button("export-draft", "Export draft", "download")}</div>
    <div class="ab-goal-strip"><p data-ab="goal-readout"></p>${button("edit-goal", "Edit goal", "target")}</div>
    <details class="ab-settings"><summary>${icon("target")} Project goal and collaboration</summary>
      <div class="ab-form-grid">${field("Board name", "board-name")}${select(
        "Message routing",
        "board-mode",
        [
          ["manual", "Manual conversations"],
          ["linked", "Linked agents — directed connections"],
        ],
      )}</div>
      <div class="ab-form-grid">${area("Project goal", "board-goal", 'placeholder="What should the agents accomplish?"')}${area("Acceptance criteria", "board-criteria", 'placeholder="What evidence would demonstrate a good result?"')}</div>
      <div class="ab-toolbar">${field("Maximum turns per goal run", "board-turns", "number", 'min="1" max="100"')}${field("Concurrent agents", "board-concurrency", "number", 'min="1" max="4"')}${select("Linked checks workflow", "board-workflow", [["", "No linked checks"]])}</div>
      <p class="ab-help">Run goal shares your goal and acceptance criteria with the selected starters and linked recipients. Full assistant replies follow enabled arrows within the turn limit. Manual chat sends your message unchanged without automatic goal context; linked checks run only when you choose Run checks.</p>
    </details>
    <div class="ab-toolbar ab-run-tools">${select("Start goal with", "goal-starter", [["", "All agents"]])}${button("goal", "Run goal", "play", 'class="ab-run"')}${button("pause", "Pause queue", "pause")}${button("resume", "Resume queue", "play")}${button("stop", "Stop runs", "stop", 'class="ab-danger"')}${button("checks", "Run checks", "check")}${button("refresh", "Refresh history", "refresh")}</div>
    <p class="ab-run-status" data-ab="run-status">No run yet. Transport and linked check results appear separately.</p>
    <p class="ab-help">Drag empty board space to pan. Ctrl+wheel zooms. Connected agents receive full replies; use Run checks to test their work.</p>
    <div class="ab-workspace">
      <section class="ab-map" aria-label="Agent canvas and connections">
        <div class="ab-canvas-tools ab-toolbar">${button("fullscreen", "Full screen", "expand")}${button("setup-tools", "Set up tools", "download")}${button('add-project','Add project folder','folder')}${button("add", "Add agent", "robot", 'class="ab-primary"')}${button('open-tasks','Tasks & graph review','check')}${button("zoom-out", "Zoom out", "minus")}${button("zoom-in", "Zoom in", "plus")}${button("fit", "Fit board", "target")}${button("tidy", "Tidy board", "network")}${button("pan-left", "Pan left", "hand")}${button("pan-right", "Pan right", "hand")}${button("pan-up", "Pan up", "up")}${button("pan-down", "Pan down", "down")}${button("toggle-inspector", "Settings & history", "settings")}<output data-ab="zoom">100%</output></div>
        <div class="ab-canvas" data-ab="canvas" role="group" tabindex="0" aria-label="Agent canvas. Select an agent to open chat. Drag a node to move it; position fields are also available.">
          <div class="ab-scene" data-ab="scene"><svg class="ab-project-links" data-ab="project-links" aria-label="Agent folder assignments"></svg><svg class="ab-edges" data-ab="edges" aria-label="Directed agent connections"></svg><div data-ab="nodes"></div><div data-ab="projects"></div></div>
          <p class="ab-canvas-empty" data-ab="canvas-empty">Your current workspace is shown below.<br>Add project folders as needed, then add agents and choose where they work.</p>
          <svg class="ab-chat-links" data-ab="chat-links" aria-hidden="true"></svg>
          <div class="ab-floating-chats" data-ab="chat-windows"></div>
        </div>
        <div class="ab-chat-dock" data-ab="chat-dock" role="group" aria-label="Minimized conversations"></div>
        <details class="ab-list-editor"><summary>${icon("keyboard")} Agents and connections · keyboard controls</summary>
          <div class="ab-toolbar">${button("back-to-canvas", "Back to canvas", "network")}</div>
          <div class="ab-toolbar">${select("Selected agent", "agent-selection", [["", "No agents"]])}${button("select-agent", "Open agent", "comment")}</div>
          <div data-ab="agent-editor" hidden>
            <div class="ab-form-grid">${field("Agent name", "agent-name")}${select("Provider", "agent-provider", Object.entries(PROVIDERS))}</div>
            ${select('Work in folder','agent-project',[['','Current workspace']])}<p class="ab-help" data-ab="agent-folder-hint"></p><p class="ab-help">To move an existing native conversation, use New conversation first, then save the folder change. Earlier messages stay in history.</p>
            <details class="ab-appearance" open><summary>How this agent looks</summary><div class="ab-form-grid">${field("Node color", "agent-color", "color")}${select("Fallback icon", "agent-icon", [["robot","Robot"],["code","Code"],["shield","Shield"],["book","Book"],["target","Target"],["network","Network"]])}${field("Picture zoom", "agent-picture-zoom", "range", 'min="1" max="3" step="0.1"')}${field("Picture hue", "agent-picture-hue", "range", 'min="0" max="360" step="1"')}</div><label class="ab-field">Profile picture from this computer<input name="agent-picture" type="file" accept="image/png,image/jpeg,image/webp"></label>${button("clear-picture", "Use fallback icon", "robot")}<p class="ab-help">PNG, JPEG or WebP, up to 256 KB. Pictures are saved with this board.</p></details>
            <p class="ab-provider-hint" data-ab="provider-hint"></p>
            <details><summary>Model, instructions and permissions</summary><div class="ab-form-grid">${field("Model (blank = provider default)", "agent-model")}${field("Effort (blank = provider default)", "agent-effort")}${select("Native permissions", "agent-permission", [["native", "Provider native policy"]])}</div>${area("Optional instructions sent with this agent", "agent-instructions", 'placeholder="Leave blank to use the native agent without added instructions."')}<p class="ab-help">These are your explicit instructions. The board adds no hidden role or planning prompt. Native permission requests can block a turn; read the chat evidence to recover.</p></details>
            <div data-ab="api-fields" hidden><div class="ab-form-grid">${select(
              "API provider",
              "api-provider",
              [
                ["custom", "Custom compatible endpoint"],
                ["openai", "OpenAI"],
                ["anthropic", "Anthropic"],
                ["google", "Google"],
              ],
            )}${field("API model", "api-model")}${field("Custom endpoint", "api-endpoint", "url")}${field("API key (leave blank to retain saved key)", "api-key", "password", 'autocomplete="new-password" data-sensitive="true"')}</div><p class="ab-help">API use has separate billing. Credentials are protected by the desktop credential store before saving. API context uses this agent’s conversation history.</p></div>
            <div class="ab-toolbar">${field("Position X", "agent-x", "number", 'step="10"')}${field("Position Y", "agent-y", "number", 'step="10"')}${button("remove-agent", "Remove selected agent", "trash")}</div>
          </div>
          <section class="ab-project-editor"><h3>Project folders</h3>${select('Folder on board','project-selection',[[WORKSPACE_FOLDER,'Current workspace']])}${field('Folder name','project-name')}${field('Folder path','project-path','text','readonly')}
          <p data-ab="project-status" class="ab-help"></p><div class="ab-toolbar">${field('Folder position X','project-x','number')}${field('Folder position Y','project-y','number')}</div><div class="ab-toolbar">${button('project-approve','Choose folder again','folder')}${button('project-disconnect','Disconnect assigned agents','unlink')}${button('project-remove','Remove folder card','trash')}</div></section>
          <h3>Agents that communicate</h3><p class="ab-help">These arrows forward full replies. Folder links show where native agents work.</p><div class="ab-toolbar">${select("From agent", "edge-source", [["", "Choose source"]])}${select("To agent", "edge-target", [["", "Choose target"]])}${button("connect", "Connect agents", "link")}</div>
          <ul class="ab-connection-list" data-ab="connection-list"></ul>
        </details>
      </section>
      <aside class="ab-chat ab-inspector" aria-label="Selected agent conversation">
        <header><h3 data-ab="chat-title">Select an agent</h3><p data-ab="session-status">No agent selected.</p><details data-ab="session-evidence"><summary>Session provenance</summary><pre></pre></details></header>
        <div class="ab-toolbar">${button("edit-agent", "Agent settings", "settings")}${button("new-session", "New conversation", "plus")}${button("history", "Load more history", "book")}</div>
        <p class="ab-help" data-ab="history-status"></p>
        <div class="ab-transcript" data-ab="transcript" role="region" tabindex="0" aria-label="Full agent transcript"></div>
        <form class="ab-compose" data-ab="compose">${area("Message to selected agent", "chat-message", 'rows="4" placeholder="Write a message. Ctrl+Enter sends."')}<button type="submit" class="ab-primary">${icon("comment")}<span>Send message</span></button><p class="ab-help">Your message is sent unchanged, without automatic goal context. Queued and failed attempts remain visible.</p></form>
      </aside>
    </div>
    <details class="ab-task-tools" data-ab="task-tools"><summary>Tasks & graph review</summary><p>Use tasks to split a goal into jobs, choose an owner, and review the result. Use graph review to let agents inspect a test workflow and propose changes you can approve.</p><div data-ab="tasks-host"></div></details>
    <details class="ab-capabilities"><summary>${icon("plug")} Provider connections</summary><p>Check connection detects installed CLI versions only. Sign in using each provider’s own CLI. Native login is not checked, and this action sends no model prompt.</p>${button("capabilities", "Check connection", "refresh")}<ul data-ab="capabilities"></ul></details>
    <details class="ab-evidence"><summary>${icon("activity")} Runs, checks and full event evidence</summary><div data-ab="run-evidence"></div><div data-ab="acceptance-evidence"></div><pre data-ab="events"></pre></details>
  </section>`;
  const root = container.querySelector(".agent-board"),
    q = (name) => root.querySelector(`[data-ab="${name}"]`),
    f = (name) => root.querySelector(`[name="${name}"]`);
  let destroyed = false,
    drag = null,
    refreshTimer = null,
    seenSequence = 0,
    eventBoard = "",
    pendingConfirm = null,
    editorAgent = "",
    lastChatKey = "",
    lastEvidence = "",
    lastCapabilities = "",
    lastSelected = "",
    rendering = false;
  let fullscreenPlaceholder = null, fullscreenFocus = null, panelDrag = null, panelZ = 1;
  const chatDrafts = new Map();
  const folderStatuses=new Map();let selectedProjectId=WORKSPACE_FOLDER,tasksMount=null,tasksKey='',tasksEpoch=0;
  const inspector = root.querySelector('.ab-inspector');
  // Keep the existing accessible, complete transcript and provenance inspector.
  // Its editor now lives beside the board instead of taking canvas space below.
  inspector.prepend(root.querySelector('.ab-list-editor'));
  const controller = createBoardController({
    invoke,
    workspaceRoot,
    onChange: render,
    requestSave: () => openSaveDialog(),
  });
  const state = controller.state;
  let closeSaveDialog = null;
  async function openSaveDialog() {
    if (closeSaveDialog || destroyed) return false;
    await controller.listBoards();
    if (destroyed) return false;
    const launcher = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'ab-save-dialog';
    dialog.setAttribute('aria-labelledby', 'ab-save-title');
    dialog.innerHTML = `<form><h2 id="ab-save-title">Save board</h2><label>Board name<input name="save-name" required maxlength="200" autocomplete="off"></label><label>How to save<select name="save-mode"><option value="new">Save as a new board</option><option value="overwrite">Overwrite an existing board</option></select></label><label data-save-target>Board to overwrite<select name="save-target"></select></label><p data-save-help></p><label data-save-confirm><input type="checkbox" name="save-confirm"> I want to overwrite this board’s saved settings and layout.</label><p data-save-error role="alert"></p><footer><button type="button" data-save-cancel>Cancel</button><button type="submit" data-save-submit>Save new board</button></footer></form>`;
    const form = dialog.querySelector('form'), name = form.elements.namedItem('save-name'), mode = form.elements.namedItem('save-mode'), target = form.elements.namedItem('save-target'), confirm = form.elements.namedItem('save-confirm');
    const records = state.boards.map(clone);
    name.value = state.draft.name === 'Untitled agent board' ? '' : state.draft.name;
    target.innerHTML = records.map(record => `<option value="${esc(record.id)}">${esc(record.value.name)} · revision ${record.revision} · ${esc(record.id.slice(0,8))}</option>`).join('');
    mode.querySelector('[value="overwrite"]').disabled = !records.length;
    if (state.record && !state.conflict && records.some(r => r.id === state.record.id)) { mode.value = 'overwrite'; target.value = state.record.id; }
    let saving = false, settled = false, finish;
    const done = new Promise(resolve => { finish = resolve; });
    const close = (saved = false) => { if (settled) return; settled = true; dialog.close(); dialog.remove(); closeSaveDialog = null; if (launcher?.isConnected) launcher.focus({preventScroll:true}); finish(saved); };
    closeSaveDialog = () => close(false);
    const update = () => {
      const overwrite = mode.value === 'overwrite';
      dialog.querySelector('[data-save-target]').hidden = !overwrite;
      dialog.querySelector('[data-save-confirm]').hidden = !overwrite;
      confirm.required = overwrite;
      dialog.querySelector('[data-save-submit]').textContent = overwrite ? 'Overwrite board' : 'Save new board';
      const record = records.find(r => r.id === target.value);
      dialog.querySelector('[data-save-help]').textContent = overwrite ? `Replace “${record?.value.name || ''}” with the current draft. Its existing chat history stays with that board. History from a different board is not copied.` : 'Create a separate board with these agents, connections and layout. Existing boards and their chat history stay unchanged. Chat history is not copied.';
    };
    mode.addEventListener('change', () => { confirm.checked = false; update(); });
    target.addEventListener('change', () => { confirm.checked = false; update(); });
    dialog.querySelector('[data-save-cancel]').onclick = () => { if (!saving) close(); };
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (!saving) close(); });
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (saving || settled) return;
      const error = dialog.querySelector('[data-save-error]'); error.textContent = '';
      if (!name.value.trim()) { error.textContent = 'Give the board a name.'; name.focus(); return; }
      if (!form.reportValidity()) return;
      const record = records.find(r => r.id === target.value);
      saving = true; for (const el of form.elements) el.disabled = true;
      try { if(mode.value==='new'||record?.id!==state.record?.id)assertTaskToolsSettled();const saved = await controller.save({name:name.value,mode:mode.value,targetId:record?.id,targetRevision:record?.revision}); if (!settled) f('saved-board').value = saved.id; close(true); }
      catch (failure) { if (!settled) error.textContent = `${failure.message} Your draft is preserved. Cancel and open Save board again to review the latest saved boards.`; }
      finally { saving = false; if (!settled) for (const el of form.elements) el.disabled = false; }
    });
    document.body.append(dialog); update(); dialog.showModal(); name.focus(); name.select();
    return done;
  }
  const resetScheduler = createResetScheduler(
    () => controller.resetFromCanonical(),
    {
      onError: controller.fail,
      onSettled: () => {
        seenSequence = state.cursor;
      },
    },
  );
  const run = (fn) => controller.task(fn).catch(() => {});
  const tell = (text) => {
    state.notice = text;
    announce(text);
    render();
  };
  function setValue(name, value) {
    const target = f(name);
    if (
      target &&
      document.activeElement !== target &&
      target.value !== String(value ?? "")
    )
      target.value = value ?? "";
  }
  function options(name, items, value) {
    const target = f(name),
      signature = JSON.stringify(items);
    if (target.dataset.signature !== signature) {
      target.innerHTML = items
        .map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`)
        .join("");
      target.dataset.signature = signature;
    }
    if (
      document.activeElement !== target ||
      !items.some(([id]) => id === target.value)
    )
      target.value = value || "";
  }
  function requestConfirm(text, callback) {
    pendingConfirm = callback;
    q("confirm").hidden = false;
    q("confirm").innerHTML =
      `<p>${esc(text)}</p>${button("confirm", "Confirm", "check")}${button("cancel-confirm", "Keep current state", "close")}`;
    q("confirm").querySelector("button").focus();
  }
  function downloadJSON(name, value) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function selected() {
    return state.draft.nodes.find((n) => n.id === state.selectedAgentId);
  }
  function updateNode(change) {
    const id = state.selectedAgentId;
    controller.edit((board) => {
      const node = board.nodes.find((n) => n.id === id);
      if (node) change(node);
    });
  }
  function sessionFor(id) {
    return state.sessions.find((s) => s.agentId === id);
  }
  function folderStatus(project){
    if(project.isWorkspace)return {allowed:true,summary:'Current workspace. Conversations and board history are stored here.'};
    const key=workspaceKey(project.path);
    if(!folderStatuses.has(key)){
      folderStatuses.set(key,{allowed:false,pending:true,summary:'Checking folder access…'});
      Promise.resolve(invoke('projectFolderStatus',{path:project.path,workspaceRoot})).then(result=>{
        folderStatuses.set(key,result);if(!destroyed)render();
      }).catch(error=>{folderStatuses.set(key,{allowed:false,summary:error.message||'Choose this folder again to check access.'});if(!destroyed)render();});
    }
    return folderStatuses.get(key);
  }
  function taskToolsPending(){return tasksMount===false||!!tasksMount?.hasUnsavedChanges?.()||!!tasksMount?.isBusy?.();}
  function assertTaskToolsSettled(){if(taskToolsPending())throw Error('Save or discard your work plan or task draft, and wait for running reviews to finish or stop them, before changing boards.');}
  async function ensureTasks(){
    const key=state.record?.id||'';
    if(tasksKey===key&&tasksMount)return tasksMount;
    if(tasksKey===key&&tasksMount===false)return;
    if(tasksMount&&taskToolsPending())return tasksMount;
    if(tasksMount?.destroy)tasksMount.destroy();else tasksMount?.unmount?.();tasksMount=false;tasksKey=key;
    const epoch=++tasksEpoch,host=q('tasks-host');host.replaceChildren();
    if(typeof onOpenTasks!=='function'){host.textContent='Tasks and graph review are available when the desktop workspace tools are connected.';return;}
    try{
      const mounted=await onOpenTasks({host,boardId:key||undefined});
      if(destroyed||epoch!==tasksEpoch){if(mounted?.destroy)mounted.destroy();else mounted?.unmount?.();return;}
      tasksMount=mounted||{};
      if(mounted?.ready)await mounted.ready;
    }catch(error){if(!destroyed&&epoch===tasksEpoch){host.textContent=error.message||'Tasks could not be opened. Close and reopen this section to try again.';tasksMount={failed:true};}throw error;}
  }
  async function openTasks(){if(tasksMount?.failed){tasksMount=null;tasksKey='__retry__';}q('task-tools').open=true;await ensureTasks();q('task-tools').scrollIntoView({block:'nearest'});}
  function editProject(change){
    controller.edit(board=>{
      if(selectedProjectId===WORKSPACE_FOLDER){board.view||={zoom:1,panX:24,panY:24};const p={position:{...(board.view.workspacePosition||{x:80,y:360})}};change(p);board.view.workspacePosition=p.position;}
      else {const project=(board.projects||[]).find(p=>p.id===selectedProjectId);if(project)change(project);}
    });
  }
  function render() {
    if (destroyed || rendering) return;
    rendering = true;
    try {
      const board = state.draft,
        node = selected();
      q("revision").textContent =
        (state.record ? `Revision ${state.record.revision}` : "New board") +
        (state.dirty ? " · unsaved changes" : "");
      root.querySelector('[data-ab-action="export-draft"]').hidden =
        !state.dirty && !state.missingBoard;
      q("notice").textContent =
        state.error ||
        (state.conflict
          ? "Saved board content changed. Your draft is preserved; discard it to reload the canonical board before saving."
          : state.busy
            ? "Working…"
            : state.notice);
      q("notice").classList.toggle("ab-error", !!state.error || state.conflict);
      q("notice").setAttribute("role", state.error ? "alert" : "status");
      if (eventBoard !== state.record?.id) {
        eventBoard = state.record?.id;
        seenSequence = 0;
      }
      options(
        "saved-board",
        [
          ["", "Choose a board"],
          ...state.boards.map((r) => [r.id, r.value.name]),
        ],
        f("saved-board").value || state.record?.id,
      );
      setValue("board-name", board.name);
      setValue("board-goal", board.goal);
      setValue("board-criteria", board.acceptanceCriteria);
      setValue("board-mode", board.mode);
      setValue("board-turns", board.maxTurns);
      setValue("board-concurrency", board.concurrency);
      q("goal-readout").textContent = board.goal.trim()
        ? `${board.name} · ${board.goal.slice(0, 180)}${board.goal.length > 180 ? "…" : ""}`
        : `${board.name} · No project goal yet. You can chat with an agent or edit the goal.`;
      q("goal-readout").title = board.goal;
      options(
        "board-workflow",
        [
          ["", "No linked checks"],
          ...state.workflows.map((r) => [
            r.id,
            r.value?.name || r.name || r.id,
          ]),
        ],
        board.acceptanceWorkflowId,
      );
      const agents = board.nodes.map((n) => [n.id, n.name]);
      const folders=projectCards(board,workspaceRoot);
      if(!folders.some(p=>p.id===selectedProjectId))selectedProjectId=WORKSPACE_FOLDER;
      options('project-selection',folders.map(p=>[p.id,p.name]),selectedProjectId);
      const project=folders.find(p=>p.id===selectedProjectId),status=folderStatus(project);
      setValue('project-name',project.name);f('project-name').disabled=!!project.isWorkspace;
      setValue('project-path',project.path);setValue('project-x',project.position.x);setValue('project-y',project.position.y);
      q('project-status').textContent=status.summary;
      for(const action of ['project-approve','project-remove','project-disconnect'])root.querySelector('.ab-project-editor [data-ab-action="'+action+'"]').disabled=!!project.isWorkspace||state.busy>0;
      root.querySelector('[data-ab-action="add-project"]').disabled=typeof chooseProjectFolder!=='function'||state.busy>0;
      options('agent-project',[['','Current workspace'],...(board.projects||[]).map(p=>[p.id,p.name])],node?.projectId||'');
      options(
        "goal-starter",
        [["", "All agents"], ...agents],
        f("goal-starter").value,
      );
      options(
        "agent-selection",
        [["", "Choose an agent"], ...agents],
        state.selectedAgentId,
      );
      options(
        "edge-source",
        [["", "Choose source"], ...agents],
        f("edge-source").value,
      );
      options(
        "edge-target",
        [["", "Choose target"], ...agents],
        f("edge-target").value,
      );
      q("agent-editor").hidden = !node;
      if (node) {
        // Selecting another node is deliberate; event refresh never replaces the editor.
        if (editorAgent !== node.id) {
          editorAgent = node.id;
          for (const input of q("agent-editor").querySelectorAll(
            "input,textarea",
          ))
            input.value = "";
        }
        setValue("agent-name", node.name);
        setValue("agent-provider", node.provider);
        setValue("agent-model", node.model);
        f("agent-model").closest("label").firstChild.textContent =
          node.provider === "api"
            ? "Model override (otherwise use API model below)"
            : "Model (blank = provider default)";
        setValue("agent-effort", node.effort);
        setValue("agent-instructions", node.instructions);
        setValue("agent-x", node.position.x);
        setValue("agent-y", node.position.y);
        const assigned=folders.find(p=>p.id===(node.projectId||WORKSPACE_FOLDER));
        q('agent-folder-hint').textContent=node.provider==='api'
          ? `API chat only. ${assigned?.name||'Current workspace'} is a folder label; this provider has no local file tools.`
          : `${assigned?.path||workspaceRoot} · ${folderStatus(assigned||folders[0]).summary}`;
        const appearance = appearanceOf(node);
        setValue('agent-color', /^#[a-f0-9]{6}$/i.test(appearance.color) ? appearance.color : '#49cde5');
        setValue('agent-icon', appearance.icon);
        setValue('agent-picture-zoom', appearance.zoom);
        setValue('agent-picture-hue', appearance.hue);
        const capability = state.capabilities?.providers?.find(
          (p) => p.id === node.provider,
        );
        const permissions = Array.isArray(capability?.supports?.permissions)
          ? capability.supports.permissions.filter((p) => p !== "native")
          : [];
        options(
          "agent-permission",
          [
            ["native", "Provider native policy"],
            ...permissions.map((p) => [p, p]),
            ...(!["native", ...permissions].includes(node.permission)
              ? [[node.permission, `${node.permission} — unavailable`]]
              : []),
          ],
          node.permission,
        );
        f("agent-effort").disabled =
          node.provider === "api" || capability?.supports?.effort === false;
        q("provider-hint").textContent =
          node.provider === "api"
            ? "Configured API route — connection and credentials are verified only by an actual requested turn."
            : `${PROVIDERS[node.provider]} · ${capability ? (capability.installed ? "CLI detected" : "CLI unavailable") : "detection pending"} · native login not checked${capability?.error ? " · " + capability.error : ""}${capability?.supports?.effort === false ? " · effort override unavailable" : ""}`;
        q("api-fields").hidden = node.provider !== "api";
        setValue("api-provider", node.apiConfig?.provider || "custom");
        setValue("api-model", node.apiConfig?.model || "");
        f("api-model").closest("label").firstChild.textContent =
          node.apiConfig?.provider === "custom"
            ? "API model (blank sends 'default'; endpoint must support this alias)"
            : "API model (required unless a model override is set)";
        f("api-model").required =
          node.provider === "api" &&
          node.apiConfig?.provider !== "custom" &&
          !node.model.trim();
        setValue("api-endpoint", node.apiConfig?.customEndpoint || "");
      } else editorAgent = "";
      renderCanvas();
      renderProjects();
      renderConnections();
      renderChat();
      renderChatWindows();
      renderEvidence();
      renderCapabilities();
      const active = state.runs.filter((r) =>
        ["running", "queued", "pending", "paused"].includes(
          String(r.status).toLowerCase(),
        ),
      );
      const latest = state.runs.at(-1);
      q("run-status").textContent =
        (state.paused ? "Queue paused. " : "") +
        (latest
          ? `Transport: ${latest.status} · Linked checks: ${latest.acceptance || "UNREVIEWED"} · ${latest.turns ?? 0} turns. ${active.length ? `${active.length} active run(s).` : ""}`
          : "No run yet. Transport and linked check results appear separately.");
      for (const action of [
        "save",
        "load",
        "new",
        "delete-board",
        "discard",
        "add",
        "connect",
        "goal",
        "checks",
        "new-session",
      ]) {
        const target = root.querySelector(`[data-ab-action="${action}"]`);
        if (target) target.disabled = state.busy > 0;
      }
      root.querySelector('[data-ab-action="checks"]').disabled =
        state.busy > 0 || !board.acceptanceWorkflowId;
      root.querySelector('[data-ab-action="new-session"]').disabled =
        state.busy > 0 || !node;
      q("compose").querySelector("button").disabled = state.busy > 0 || !node;
      if(q('task-tools').open)void ensureTasks().catch(controller.fail);
    } finally {
      rendering = false;
    }
  }
  function renderCanvas() {
    const board = state.draft,
      view = board.view || { zoom: 1, panX: 24, panY: 24 };
    q("scene").style.transform =
      `translate(${view.panX}px,${view.panY}px) scale(${view.zoom})`;
    q("zoom").textContent = `${Math.round(view.zoom * 100)}%`;
    q("canvas-empty").hidden = !!board.nodes.length;
    const holder = q("nodes"),
      existing = new Map(
        [...holder.children].map((e) => [e.dataset.agentId, e]),
      );
    for (const node of board.nodes) {
      let element = existing.get(node.id);
      existing.delete(node.id);
      if (!element) {
        element = document.createElement("div");
        element.tabIndex = 0;
        element.setAttribute('role', 'group');
        element.setAttribute('aria-description', 'Press Enter or Space to open chat. Use Alt and arrow keys to move this agent. Settings and Chat are separate buttons.');
        element.className = "ab-node";
        element.dataset.agentId = node.id;
        element.innerHTML = `<span class="ab-node-heading"><span class="ab-avatar"></span><strong></strong></span><span class="ab-node-provider"></span><span class="ab-node-folder"></span><span class="ab-node-state"></span><span class="ab-node-preview"></span><span class="ab-node-actions">${button('node-settings','Settings','settings',`data-node-id="${esc(node.id)}"`)}${button('node-chat','Chat','comment',`data-node-id="${esc(node.id)}"`)}${button('repair-connection','Repair connection','plug',`data-node-id="${esc(node.id)}"`)}</span><span class="ab-node-ports" aria-hidden="true"></span>`;
        holder.append(element);
      }
      element.dataset.provider = node.provider;
      element.classList.toggle(
        "ab-selected",
        node.id === state.selectedAgentId,
      );
      element.setAttribute(
        "aria-current",
        String(node.id === state.selectedAgentId),
      );
      element.style.left = `${node.position.x}px`;
      element.style.top = `${node.position.y}px`;
      const appearance = appearanceOf(node), avatar = element.querySelector('.ab-avatar');
      element.style.setProperty('--agent-color', /^#[a-f0-9]{6}$/i.test(appearance.color) ? appearance.color : '#49cde5');
      const image = safeAvatar(appearance.avatar);
      const avatarKey = JSON.stringify([image, appearance.icon, appearance.zoom, appearance.hue]);
      if (avatar.dataset.key !== avatarKey) {
        avatar.dataset.key = avatarKey;
        avatar.replaceChildren();
        if (image) { const img = document.createElement('img'); img.src = image; img.alt = ''; img.style.transform = `scale(${Math.min(3,Math.max(1,Number(appearance.zoom)||1))})`; img.style.filter = `hue-rotate(${Math.min(360,Math.max(0,Number(appearance.hue)||0))}deg)`; avatar.append(img); }
        else avatar.innerHTML = icon(['robot','code','shield','book','target','network'].includes(appearance.icon) ? appearance.icon : 'robot');
      }
      element.querySelector("strong").textContent = node.name;
      const model = node.model || node.apiConfig?.model;
      const modelLabel = model
        ? model
        : node.provider === "api"
          ? node.apiConfig?.provider === "custom"
            ? "endpoint 'default' alias"
            : "model required"
          : "default model";
      element.querySelector(".ab-node-provider").textContent =
        PROVIDERS[node.provider] + " · " + modelLabel;
      const assigned=projectCards(board,workspaceRoot).find(p=>p.id===(node.projectId||WORKSPACE_FOLDER));
      element.querySelector('.ab-node-folder').textContent=(node.provider==='api'?'Folder label: ':'Works in: ')+(assigned?.name||'Missing folder');
      const session = sessionFor(node.id);
      element.querySelector(".ab-node-state").textContent =
        session?.status || "Ready for a new conversation";
      const message = state.messages
        .filter((m) => m.agentId === node.id && m.role === "assistant")
        .at(-1);
      element.querySelector(".ab-node-preview").textContent = message
        ? message.text.slice(0, 65) +
          (message.text.length > 65 ? "… (open full chat)" : "")
        : "Open chat";
      element.setAttribute(
        "aria-label",
        `${node.name}, ${PROVIDERS[node.provider]}, ${session?.status || "new conversation"}. Open conversation.`,
      );
    }
    for (const element of existing.values()) element.remove();
    const nodes = new Map(board.nodes.map((n) => [n.id, n]));
    const rectangles = board.nodes.map((node) => ({
      ...node,
      height:
        [...holder.children].find(
          (element) => element.dataset.agentId === node.id,
        )?.offsetHeight || 160,
    }));
    q("edges").innerHTML =
      `<defs><marker id="ab-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#26658c"/></marker></defs>` +
      board.edges
        .filter((e) => nodes.has(e.source) && nodes.has(e.target))
        .map((edge) => {
          const source = nodes.get(edge.source),
            target = nodes.get(edge.target),
            path = connectionPath(source, target),
            label = edgeLabelPosition(source, target, rectangles);
          return `<g class="${edge.enabled ? "" : "ab-edge-disabled"}" data-edge-id="${esc(edge.id)}" role="button" tabindex="0" aria-label="Connection settings: ${esc(source.name)} to ${esc(target.name)}"><title>${esc(source.name)} → ${esc(target.name)} · ${edge.enabled ? "enabled" : "disabled"}</title><path class="ab-edge-hit" d="${path.d}"/><path d="${path.d}" marker-end="url(#ab-arrow)"/><text x="${label.x}" y="${label.y}" text-anchor="middle">${edge.enabled ? "communicates: YES" : "communicates: NO"}</text></g>`;
        })
        .join("");
  }
  function renderProjects(){
    const board=state.draft,folders=projectCards(board,workspaceRoot),holder=q('projects');
    const existing=new Map([...holder.children].map(el=>[el.dataset.projectId,el]));
    for(const project of folders){
      let el=existing.get(project.id);existing.delete(project.id);
      if(!el){
        el=document.createElement('div');el.className='ab-project-node';el.dataset.projectId=project.id;el.tabIndex=0;el.setAttribute('role','group');
        el.innerHTML=`<strong class="ab-project-heading">${icon('folder')}<span></span></strong><p class="ab-project-path"></p><p class="ab-project-access"></p><div class="ab-project-actions">${button('project-settings','Folder settings','settings',`data-folder-id="${esc(project.id)}"`)}${project.isWorkspace?'':button('project-approve','Choose folder again','folder',`data-folder-id="${esc(project.id)}"`)}</div>`;
        holder.append(el);
      }
      el.style.left=project.position.x+'px';el.style.top=project.position.y+'px';
      el.querySelector('.ab-project-heading span').textContent=project.name;
      const path=el.querySelector('.ab-project-path');path.textContent=project.path;path.title=project.path;
      const status=folderStatus(project);el.querySelector('.ab-project-access').textContent=status.summary;
      el.dataset.allowed=String(status.allowed===true);el.classList.toggle('ab-project-selected',project.id===selectedProjectId);
      el.setAttribute('aria-label',`${project.name}, folder. ${project.path}. ${status.summary}`);
      const approve=el.querySelector('[data-ab-action="project-approve"]');if(approve)approve.hidden=status.allowed===true;
    }
    for(const el of existing.values())el.remove();
    const map=new Map(folders.map(p=>[p.id,p]));
    q('project-links').innerHTML=board.nodes.map(node=>{
      const project=map.get(node.projectId||WORKSPACE_FOLDER);if(!project)return '';
      const path=connectionPath(node,project),label=node.provider==='api'?'folder label · chat only':'works in';
      return `<g data-project-link="${esc(node.id)}"><title>${esc(node.name)} ${label} ${esc(project.name)}</title><path d="${path.d}"/><text x="${path.x}" y="${path.y}" text-anchor="middle">${label}</text></g>`;
    }).join('');
  }
  function renderConnections() {
    const nodeMap = new Map(state.draft.nodes.map((n) => [n.id, n.name]));
    const list = q("connection-list"),
      signature = JSON.stringify([state.draft.edges, [...nodeMap]]);
    if (list.dataset.signature === signature) return;
    list.dataset.signature = signature;
    list.innerHTML = state.draft.edges.length
      ? state.draft.edges
          .map(
            (e) =>
              `<li><label><input type="checkbox" data-edge-toggle="${esc(e.id)}" ${e.enabled ? "checked" : ""}> ${esc(nodeMap.get(e.source) || "Missing agent")} → ${esc(nodeMap.get(e.target) || "Missing agent")}</label>${button("disconnect", "Disconnect", "close", `data-edge-id="${esc(e.id)}"`)}</li>`,
          )
          .join("")
      : "<li>No connections. Add two agents and choose a direction above.</li>";
  }
  function openChat(agentId) {
    controller.select(agentId);
    controller.edit(board => {
      board.panels ||= [];
      let panel = board.panels.find(p => p.agentId === agentId);
      if (!panel) {
        const canvas=q('canvas'),offset=board.panels.length,columns=Math.max(1,Math.floor(canvas.clientWidth/410));
        const height=Math.round(Math.min(410,Math.max(280,canvas.clientHeight*.55)));
        // Start separate chats side by side below the usual node row, keeping
        // ownership lines visible instead of covering the agent at first open.
        panel = { agentId, x: 24 + (offset%columns)*410, y: Math.max(16,canvas.clientHeight-height-16-Math.floor(offset/columns)*40), width: 390, height, minimized: false };
        board.panels.push(panel);
      }
      for (const other of board.panels) if(other.agentId!==agentId)other.maximized=false;
      panel.minimized = false;
    });
    const panel = [...q('chat-windows').children].find(p => p.dataset.chatAgent === agentId);
    if (panel) { panel.style.zIndex = ++panelZ; panel.querySelector('textarea')?.focus({preventScroll:true}); }
    if (state.record) void controller.refresh({all:true}).catch(controller.fail);
  }
  function layoutChatWindow(el, panel) {
    if(panel.maximized){const canvas=q('canvas');el.style.left='8px';el.style.top='8px';el.style.width=Math.max(1,canvas.clientWidth-16)+'px';el.style.height=Math.max(1,canvas.clientHeight-16)+'px';return;}
    const canvas=q('canvas'),width=Math.min(panel.width,Math.max(1,canvas.clientWidth)),height=Math.min(panel.height,Math.max(1,canvas.clientHeight));
    el.style.width=width+'px';el.style.height=height+'px';
    el.style.left=Math.max(0,Math.min(panel.x,canvas.clientWidth-width))+'px';
    el.style.top=Math.max(0,Math.min(panel.y,canvas.clientHeight-height))+'px';
  }
  function renderChatWindows() {
    const holder = q('chat-windows'), board = state.draft;
    const panels = (board.panels || []).filter(p => board.nodes.some(n => n.id === p.agentId));
    const existing = new Map([...holder.children].map(el => [el.dataset.chatAgent, el]));
    for (const panel of panels) {
      const node = board.nodes.find(n => n.id === panel.agentId);
      let el = existing.get(panel.agentId); existing.delete(panel.agentId);
      if (!el) {
        el = document.createElement('section'); el.className = 'ab-chat-window'; el.dataset.chatAgent = panel.agentId;
        el.setAttribute('role','region');
        el.innerHTML = `<header class="ab-window-title" data-chat-drag><strong></strong><div>${button('chat-maximize','Maximize','expand')}${button('chat-minimize','Minimize','minus')}${button('chat-close','Close','close')}</div></header><div class="ab-window-connection"><p class="ab-window-status"></p>${button('repair-connection','Repair connection','plug',`data-node-id="${esc(node.id)}"`)}</div><div class="ab-window-messages" role="region" tabindex="0" aria-label="Complete conversation"></div><form class="ab-window-compose"><label>Message<textarea rows="2" placeholder="Write a message. Ctrl+Enter sends."></textarea></label><button type="submit">${icon('comment')}<span>Send</span></button><button type="button" class="ab-setup-tools" data-ab-action="setup-tools" title="Download and set up test tools">${icon('download')}<span>Set up</span></button></form><button type="button" class="ab-resize-handle" aria-label="Resize conversation" title="Drag to resize; arrow keys also resize">${icon('expand')}</button>`;
        holder.append(el);
      }
      el.hidden = panel.minimized;
      el.classList.toggle('ab-chat-maximized',!!panel.maximized);
      const maximize=el.querySelector('[data-ab-action="chat-maximize"]');
      maximize.querySelector('span').textContent=panel.maximized?'Restore size':'Maximize';
      maximize.setAttribute('aria-pressed',String(!!panel.maximized));
      if(panel.maximized)el.style.zIndex=10000;
      else if(el.style.zIndex==='10000')el.style.zIndex=++panelZ;
      el.setAttribute('aria-label', node.name + ' conversation window');
      el.querySelector('header strong').textContent = node.name;
      el.style.setProperty('--agent-color', /^#[a-f0-9]{6}$/i.test(appearanceOf(node).color) ? appearanceOf(node).color : '#49cde5');
      layoutChatWindow(el,panel);
      el.querySelector('.ab-window-status').textContent = `${PROVIDERS[node.provider]} · ${sessionFor(node.id)?.status || 'new conversation'} · ${state.hasMore ? 'loading more history…' : 'complete loaded history'}`;
      const messages = state.messages.filter(m => m.agentId === node.id || m.from === node.id || m.to === node.id);
      const transcript = el.querySelector('.ab-window-messages');
      const signature = JSON.stringify(messages), nearBottom = transcript.scrollHeight-transcript.scrollTop-transcript.clientHeight<80;
      if (transcript.dataset.signature !== signature) {
        transcript.dataset.signature = signature;
        transcript.replaceChildren();
        for (const message of messages) {
          const article = document.createElement('article'); article.className = 'ab-window-message'; article.dataset.messageId = message.id;
          const heading = document.createElement('strong'), body = document.createElement('pre');
          heading.textContent = `${friendlyMessageRoute(message,board.nodes)} · ${message.state || ''}`;
          body.textContent = message.text;
          article.append(heading,body);
          if (message.error) { const error = document.createElement('p'); error.textContent = message.error; article.append(error); }
          transcript.append(article);
        }
        if (!messages.length) transcript.textContent = 'No messages yet. Send a message or run the shared goal.';
        if (nearBottom) transcript.scrollTop = transcript.scrollHeight;
      }
      const textarea = el.querySelector('textarea'), key = `${board.id}:${node.id}`;
      if (document.activeElement !== textarea) textarea.value = chatDrafts.get(key) || '';
      el.querySelector('button[type="submit"]').disabled = state.busy > 0;
    }
    for (const el of existing.values()) el.remove();
    q('chat-dock').innerHTML = panels.map(p => button('chat-restore',board.nodes.find(n=>n.id===p.agentId).name + (p.minimized?' · restore chat':' · show chat'),'comment',`data-node-id="${esc(p.agentId)}"`)).join('');
    renderChatLinks();
  }
  function renderChatLinks(){
    const canvas=q('canvas'),svg=q('chat-links'),origin=canvas.getBoundingClientRect();
    svg.setAttribute('viewBox',`0 0 ${canvas.clientWidth} ${canvas.clientHeight}`);
    const lines=[];
    for(const panel of state.draft.panels||[]){
      if(panel.minimized)continue;
      const node=q('nodes').querySelector(`[data-agent-id="${CSS.escape(panel.agentId)}"]`),chat=q('chat-windows').querySelector(`[data-chat-agent="${CSS.escape(panel.agentId)}"]`);
      if(!node||!chat||chat.hidden)continue;
      const line=chatOwnershipLine(node.getBoundingClientRect(),chat.getBoundingClientRect(),{left:origin.left+canvas.clientLeft,top:origin.top+canvas.clientTop});
      lines.push(`<line data-chat-link="${esc(panel.agentId)}" x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}"/>`);
    }
    svg.innerHTML=lines.join('');
  }
  function restoreMaximizedChat(){
    const panel=(state.draft.panels||[]).find(p=>p.maximized&&!p.minimized);
    if(!panel)return false;
    controller.edit(board=>{board.panels.find(p=>p.agentId===panel.agentId).maximized=false;});
    q('chat-windows').querySelector(`[data-chat-agent="${CSS.escape(panel.agentId)}"] [data-ab-action="chat-maximize"]`)?.focus({preventScroll:true});
    return true;
  }
  function toggleFullscreen(exit = false) {
    if (fullscreenPlaceholder) {
      fullscreenPlaceholder.replaceWith(root); fullscreenPlaceholder = null;
      root.classList.remove('ab-fullscreen');
      root.removeAttribute('role'); root.removeAttribute('aria-modal');
      root.querySelector('[data-ab-action="fullscreen"] span').textContent = 'Full screen';
      fullscreenFocus?.focus?.({preventScroll:true});
    } else if (!exit) {
      fullscreenFocus = document.activeElement;
      fullscreenPlaceholder = document.createComment('agent board full-screen return');
      root.replaceWith(fullscreenPlaceholder); document.body.append(root);
      root.classList.add('ab-fullscreen');
      root.setAttribute('role','dialog'); root.setAttribute('aria-modal','true');
      root.querySelector('[data-ab-action="fullscreen"] span').textContent = 'Exit full screen';
      q('canvas').focus({preventScroll:true});
    }
    renderChatWindows();
  }
  const fullscreenKeys = event => {
    if(event.defaultPrevented||document.querySelector('dialog[open]'))return;
    if(event.key==='Escape'&&restoreMaximizedChat()){event.preventDefault();return;}
    if (!fullscreenPlaceholder) return;
    if (event.key === 'Escape') {event.preventDefault();toggleFullscreen(true);return;}
    if (event.key !== 'Tab') return;
    const items = [...root.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')].filter(el=>el.getClientRects().length&&!el.closest('[hidden]'));
    const first=items[0],last=items.at(-1);
    if (event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  };
  document.addEventListener('keydown',fullscreenKeys);
  function renderChat() {
    const node = selected(),
      session = node && sessionFor(node.id);
    q("chat-title").textContent = node
      ? node.name + " · conversation"
      : "Select an agent";
    q("session-status").textContent = node
      ? `${PROVIDERS[node.provider]} · ${session?.status || "new conversation"} · generation ${session?.generation ?? 0}${session?.lastError ? " · " + (typeof session.lastError === "string" ? session.lastError : JSON.stringify(session.lastError)) : ""}`
      : "Add or select an agent to chat.";
    q("session-evidence").querySelector("pre").textContent = JSON.stringify(
      session || {},
      null,
      2,
    );
    q("history-status").textContent =
      `${state.messages.length} messages loaded across this board. ${state.hasMore ? "More history is available." : "Loaded through sequence " + state.cursor + "."} New conversation preserves earlier generations and history.`;
    root.querySelector('[data-ab-action="history"]').disabled =
      !state.hasMore || state.busy > 0;
    const messages = state.messages.filter((m) => m.agentId === node?.id);
    const routeNodes = [
      ...(state.record?.value.nodes || []),
      ...state.draft.nodes,
    ];
    const key = JSON.stringify([
      node?.id,
      routeNodes.map((node) => [node.id, node.name]),
      messages,
    ]);
    if (key === lastChatKey) return;
    lastChatKey = key;
    const transcript = q("transcript"),
      nearBottom =
        transcript.scrollHeight -
          transcript.scrollTop -
          transcript.clientHeight <
        80,
      changedAgent = lastSelected !== node?.id;
    lastSelected = node?.id;
    const existing = new Map(
      [...transcript.children].map((e) => [e.dataset.messageId, e]),
    );
    if (changedAgent) transcript.replaceChildren();
    for (const message of messages) {
      let el = changedAgent ? null : existing.get(message.id);
      existing.delete(message.id);
      if (!el) {
        el = document.createElement("article");
        el.className = "ab-message";
        el.dataset.messageId = message.id;
        el.innerHTML =
          '<header></header><pre class="ab-message-body"></pre><details class="ab-message-context" data-ab-task-context hidden><summary></summary><p class="ab-help"></p><h4>Project goal</h4><pre data-context="goal"></pre><h4>Acceptance criteria</h4><pre data-context="criteria"></pre></details><details class="ab-message-transport" data-ab-transport-input hidden><summary>Exact current-turn input · recorded at dispatch</summary><pre></pre></details><details class="ab-message-provenance"><summary>Message provenance</summary><pre></pre></details>';
        transcript.append(el);
      }
      el.dataset.role = message.role;
      el.querySelector("header").textContent =
        `${friendlyMessageRoute(message, routeNodes)} · ${message.state || ""} · ${message.createdAt || ""}`;
      el.querySelector(".ab-message-body").textContent = message.text;
      const context = message.taskContext;
      const hasContext =
        context &&
        typeof context.goal === "string" &&
        typeof context.acceptanceCriteria === "string";
      const hasTransportInput = typeof message.transportInput === "string";
      const contextDetails = el.querySelector(".ab-message-context");
      contextDetails.hidden = !hasContext;
      contextDetails.querySelector("summary").textContent = hasTransportInput
        ? "Shared goal context · dispatch input recorded"
        : "Shared goal context · planned";
      contextDetails.querySelector("p").textContent = hasTransportInput
        ? "User-authored context captured for this run. Inspect the exact recorded current-turn input below; provider history and native context are separate. Recording input does not prove provider receipt or success."
        : "User-authored context captured for this run. No dispatched input is recorded for this message yet.";
      contextDetails.querySelector('[data-context="goal"]').textContent =
        hasContext ? context.goal : "";
      contextDetails.querySelector('[data-context="criteria"]').textContent =
        hasContext ? context.acceptanceCriteria : "";
      const transportDetails = el.querySelector(".ab-message-transport");
      transportDetails.hidden = !hasTransportInput;
      transportDetails.querySelector("pre").textContent = hasTransportInput
        ? message.transportInput
        : "";
      const { text, taskContext, transportInput, ...metadata } = message;
      el.querySelector(".ab-message-provenance pre").textContent =
        JSON.stringify(metadata, null, 2);
    }
    for (const element of existing.values()) element.remove();
    if (!messages.length) {
      transcript.innerHTML =
        '<p class="ab-empty-chat">No messages yet. Send a message or run the project goal.</p>';
    } else
      for (const el of transcript.querySelectorAll(".ab-empty-chat"))
        el.remove();
    if (nearBottom || changedAgent)
      transcript.scrollTop = transcript.scrollHeight;
  }
  function renderEvidence() {
    const signature = JSON.stringify([
      state.runs,
      state.events,
      state.acceptanceResult,
    ]);
    if (signature === lastEvidence) return;
    lastEvidence = signature;
    q("run-evidence").innerHTML = state.runs.length
      ? state.runs
          .map(
            (r) =>
              `<details><summary>Transport ${esc(r.status)} · Linked checks ${esc(r.acceptance || "UNREVIEWED")} · run ${esc(r.id)}</summary><pre>${esc(JSON.stringify(r, null, 2))}</pre></details>`,
          )
          .join("")
      : "<p>No runs recorded.</p>";
    q("acceptance-evidence").innerHTML = state.acceptanceResult
      ? `<h4>Linked check result</h4><pre>${esc(JSON.stringify(state.acceptanceResult, null, 2))}</pre>`
      : "";
    q("events").textContent = JSON.stringify(state.events, null, 2);
  }
  function renderCapabilities() {
    const signature = JSON.stringify(state.capabilities);
    if (signature === lastCapabilities) return;
    lastCapabilities = signature;
    q("capabilities").innerHTML =
      state.capabilities?.providers
        ?.map(
          (p) =>
            `<li><strong>${esc(p.name || PROVIDERS[p.id] || p.id)}</strong> · ${p.installed ? (p.id === "api" ? "API route available; credentials unchecked" : "CLI detected") : "Unavailable"}${p.version ? " · " + esc(p.version) : ""}<br><span>${esc(p.login || "Native login not checked")}${p.error ? " · " + esc(p.error) : ""}</span><details><summary>Detected capabilities</summary><pre>${esc(JSON.stringify(p, null, 2))}</pre></details></li>`,
        )
        .join("") ||
      "<li>Provider detection unavailable. Check connection to retry.</li>";
  }
  function adjustView(change) {
    controller.edit((board) => {
      board.view ||= { zoom: 1, panX: 24, panY: 24 };
      change(board.view);
    });
  }
  function fit() {
    const nodes = [
      ...state.draft.nodes.map(node=>({...node,height:q('nodes').querySelector(`[data-agent-id="${CSS.escape(node.id)}"]`)?.offsetHeight||200})),
      ...projectCards(state.draft,workspaceRoot).map(project=>({...project,height:q('projects').querySelector(`[data-project-id="${CSS.escape(project.id)}"]`)?.offsetHeight||200})),
    ];
    if (!nodes.length) {
      adjustView((view) =>
        Object.assign(view, { zoom: 1, panX: 24, panY: 24 }),
      );
      return;
    }
    const minX = Math.min(...nodes.map((n) => n.position.x)),
      minY = Math.min(...nodes.map((n) => n.position.y)),
      maxX = Math.max(...nodes.map((n) => n.position.x + 230)),
      maxY = Math.max(...nodes.map((n) => n.position.y + n.height));
    const zoom = Math.min(
      1,
      Math.max(
        0.2,
        Math.min(
          (q("canvas").clientWidth - 64) / (maxX - minX),
          (q("canvas").clientHeight - 64) / (maxY - minY),
        ),
      ),
    );
    adjustView((view) =>
      Object.assign(view, {
        zoom,
        panX: 32 - minX * zoom,
        panY: 32 - minY * zoom,
      }),
    );
  }
  async function handleAction(action, target) {
    switch (action) {
      case 'open-tasks':await openTasks();break;
      case 'add-project':{
        if(typeof chooseProjectFolder!=='function')throw Error('Open the desktop app to choose a project folder.');
        const chosen=await chooseProjectFolder();if(chosen?.cancelled||!chosen?.path)return;
        if(projectCards(state.draft,workspaceRoot).some(p=>workspaceKey(p.path)===workspaceKey(chosen.path)))throw Error('This folder is already on the board. Choose it in Work in folder for an agent.');
        const id=uuid(),name=String(chosen.path).split(/[\\/]/).filter(Boolean).at(-1)||'Project folder';
        folderStatuses.delete(workspaceKey(chosen.path));
        controller.edit(board=>{board.projects||=[];board.projects.push({id,name,path:chosen.path,position:{x:80+(board.projects.length%3)*300,y:580+Math.floor(board.projects.length/3)*220}});});
        selectedProjectId=id;render();root.classList.add('ab-inspector-open');root.querySelector('.ab-list-editor').open=true;f('project-name').focus();
        tell('Folder added. Select an agent and choose Work in folder to assign it. Save the board when you are ready.');break;
      }
      case 'project-settings':
        selectedProjectId=target.dataset.folderId||selectedProjectId;render();root.classList.add('ab-inspector-open');root.querySelector('.ab-list-editor').open=true;f('project-selection').focus();break;
      case 'project-approve':{
        selectedProjectId=target.dataset.folderId||selectedProjectId;
        const project=(state.draft.projects||[]).find(p=>p.id===selectedProjectId);if(!project)throw Error('Choose an added project folder.');
        if(typeof chooseProjectFolder!=='function')throw Error('Open the desktop app to approve this folder.');
        const selected=await chooseProjectFolder();if(selected?.cancelled||!selected?.path)return;
        if(workspaceKey(selected.path)!==workspaceKey(project.path))throw Error('Choose the same folder shown on the card to approve it. Use Add project folder for a different location.');
        folderStatuses.delete(workspaceKey(project.path));render();tell('Folder selected again. Its current access status is shown on the card.');break;
      }
      case 'project-disconnect':
        if(selectedProjectId===WORKSPACE_FOLDER)throw Error('The current workspace is the default folder.');
        controller.edit(board=>{for(const node of board.nodes)if(node.projectId===selectedProjectId)delete node.projectId;});tell('Assigned agents now use the current workspace in this draft. Save to apply; native conversations may need New conversation first.');break;
      case 'project-remove':{
        const id=target.dataset.folderId||selectedProjectId;if(id===WORKSPACE_FOLDER)throw Error('The current workspace card stays on this board.');
        const project=(state.draft.projects||[]).find(p=>p.id===id);if(!project)throw Error('Choose a project folder first.');
        requestConfirm(`Remove ${project.name} from this board? Assigned agents will return to the current workspace. The folder and its files stay on your computer.`,()=>{controller.edit(board=>{board.projects=board.projects.filter(p=>p.id!==id);for(const node of board.nodes)if(node.projectId===id)delete node.projectId;});selectedProjectId=WORKSPACE_FOLDER;render();});break;
      }
      case 'fullscreen': toggleFullscreen(); break;
      case 'setup-tools': {const id=target.closest('[data-chat-agent]')?.dataset.chatAgent||selected()?.id;await window.LVXSetup?.open({agentContext:{boardId:state.record?.id,agentId:id}});break;}
      case 'toggle-inspector': root.classList.toggle('ab-inspector-open'); break;
      case 'node-settings':
        controller.select(target.dataset.nodeId);
        root.classList.add('ab-inspector-open');
        root.querySelector('.ab-list-editor').open = true;
        f('agent-name').focus({preventScroll:true});
        break;
      case 'node-chat': case 'chat-restore': openChat(target.dataset.nodeId); break;
      case 'repair-connection': {
        const node=state.draft.nodes.find(n=>n.id===target.dataset.nodeId);
        if(!node)throw Error('This agent is no longer on the board.');
        const open=globalThis.window?.LVXAgentConnections?.open;
        if(typeof open!=='function')throw Error('Connection repair is unavailable. Restart LVX Test Studio to load the connection tools.');
        const result=await open({provider:node.provider,nodeName:node.name,nodeId:node.id,boardId:state.draft.id,workspaceRoot});
        // Diagnostics never resend a failed turn or overwrite the chat draft.
        if(!destroyed) {
          await controller.capabilities();
          if(result?.action==='settings'){
            restoreMaximizedChat();controller.select(node.id);root.classList.add('ab-inspector-open');root.querySelector('.ab-list-editor').open=true;f('agent-name').focus({preventScroll:true});
          } else target.isConnected&&target.focus({preventScroll:true});
        }
        break;
      }
      case 'chat-maximize': {
        const agentId=target.closest('[data-chat-agent]').dataset.chatAgent;
        controller.edit(board=>{const panel=board.panels.find(p=>p.agentId===agentId),maximize=!panel.maximized;for(const other of board.panels)other.maximized=false;panel.maximized=maximize;});
        break;
      }
      case 'chat-close': case 'chat-minimize': {
        const agentId = target.closest('[data-chat-agent]').dataset.chatAgent;
        const textarea = target.closest('[data-chat-agent]').querySelector('textarea');
        chatDrafts.set(`${state.draft.id}:${agentId}`,textarea.value);
        controller.edit(board => { board.panels = (board.panels || []).filter(p => action !== 'chat-close' || p.agentId !== agentId); const panel = board.panels.find(p=>p.agentId===agentId); if (panel) panel.minimized=true; });
        break;
      }
      case 'clear-picture': updateNode(node => { node.appearance = {...appearanceOf(node),avatar:''}; }); f('agent-picture').value = ''; break;
      case 'tidy': controller.edit(board => { board.nodes.forEach((node,index) => { node.position={x:50+(index%4)*330,y:50+Math.floor(index/4)*260}; });board.view||={zoom:1,panX:24,panY:24};board.view.workspacePosition={x:80,y:100+Math.max(1,Math.ceil(board.nodes.length/4))*260};(board.projects||[]).forEach((project,index)=>{project.position={x:380+(index%3)*300,y:board.view.workspacePosition.y+Math.floor(index/3)*220};}); }); fit(); break;
      case "edit-goal":
        root.querySelector(".ab-settings").open = true;
        f("board-goal").focus();
        break;
      case "edit-agent":
        if (!selected()) throw Error("Add or select an agent first.");
        root.classList.add('ab-inspector-open');
        root.querySelector(".ab-list-editor").open = true;
        f("agent-name").focus();
        break;
      case "back-to-canvas":
        root.querySelector(".ab-list-editor").open = false;
        q("canvas").scrollIntoView({ block: "start" });
        q("canvas").focus({ preventScroll: true });
        break;
      case "save":
        await openSaveDialog();
        break;
      case "load":
        assertTaskToolsSettled();
        if (!f("saved-board").value) throw Error("Choose a saved board first.");
        await controller.load(f("saved-board").value);
        break;
      case "new":
        assertTaskToolsSettled();
        controller.newBoard();
        break;
      case "discard":
        requestConfirm(
          "Discard unsaved board edits and reload the saved board? Chat history is retained.",
          () => run(() => controller.discard()),
        );
        break;
      case "delete-board":
        assertTaskToolsSettled();
        requestConfirm(
          "Delete this saved board? Active runs must be stopped first. Export its history before deleting if you need a copy.",
          () => run(() => {assertTaskToolsSettled();return controller.deleteBoard();}),
        );
        break;
      case "confirm": {
        const callback = pendingConfirm;
        pendingConfirm = null;
        q("confirm").hidden = true;
        callback?.();
        break;
      }
      case "cancel-confirm":
        pendingConfirm = null;
        q("confirm").hidden = true;
        break;
      case "add": {
        const id = uuid(),
          index = state.draft.nodes.length;
        controller.edit((board) =>
          board.nodes.push({
            id,
            name: `Agent ${index + 1}`,
            provider: "codex",
            model: "",
            effort: "",
            instructions: "",
            permission: "native",
            position: {
              x: 40 + (index % 3) * 300,
              y: 40 + Math.floor(index / 3) * 210,
            },
          }),
        );
        controller.select(id);
        root.classList.add('ab-inspector-open');
        root.querySelector(".ab-list-editor").open = true;
        f("agent-name").focus();
        break;
      }
      case "select-agent":
        controller.select(f("agent-selection").value);
        break;
      case "remove-agent": {
        const node = selected();
        if (!node) throw Error("Select an agent first.");
        requestConfirm(
          `Remove ${node.name} and its connections? Saved conversation evidence is retained by the runtime.`,
          () => {
            controller.edit((board) => {
              board.nodes = board.nodes.filter((n) => n.id !== node.id);
              board.panels = (board.panels || []).filter(p => p.agentId !== node.id);
              board.edges = board.edges.filter(
                (e) => e.source !== node.id && e.target !== node.id,
              );
            });
            controller.select(state.draft.nodes[0]?.id || "");
          },
        );
        break;
      }
      case "connect": {
        const source = f("edge-source").value,
          targetId = f("edge-target").value;
        if (!source || !targetId)
          throw Error("Choose source and target agents.");
        if (source === targetId) throw Error("Choose two different agents.");
        if (
          state.draft.edges.some(
            (e) => e.source === source && e.target === targetId,
          )
        )
          throw Error("This directed connection already exists.");
        controller.edit((board) =>
          board.edges.push({
            id: uuid(),
            source,
            target: targetId,
            enabled: true,
          }),
        );
        break;
      }
      case "disconnect":
        controller.edit((board) => {
          board.edges = board.edges.filter(
            (e) => e.id !== target.dataset.edgeId,
          );
        });
        break;
      case "goal": {
        if (!state.draft.goal.trim()) {
          root.querySelector(".ab-settings").open = true;
          f("board-goal").focus();
        }
        const starter = f("goal-starter").value;
        await controller.runGoal(starter ? [starter] : undefined);
        tell(
          "Goal and criteria queued for starters and linked agents. Follow transport and linked check results below; review goal criteria yourself.",
        );
        break;
      }
      case "pause":
        await controller.action("pause");
        tell("Queue paused. A running turn finishes normally.");
        break;
      case "resume":
        await controller.action("resume");
        tell(
          "Queue resumed. Interrupted turns require an explicit retry message or new goal run.",
        );
        break;
      case "stop":
        await controller.action("cancel");
        tell("Cancellation requested for this board.");
        break;
      case "new-session": {
        const node = selected();
        if (!node) throw Error("Select an agent first.");
        requestConfirm(
          `Start a new conversation for ${node.name}? Previous messages stay in history. Any old turn is fenced from this new generation.`,
          () =>
            run(async () => {
              await controller.newSession(node.id);
              tell("New conversation created.");
            }),
        );
        break;
      }
      case "checks":
        state.acceptanceResult = await controller.action("runAcceptance");
        tell("Linked check result available in evidence.");
        break;
      case "refresh":
        folderStatuses.clear();
        await controller.refresh({ all: true });
        break;
      case "history":
        await controller.refresh();
        break;
      case "capabilities":
        await controller.capabilities();
        tell(
          "CLI detection finished. Native login remains unchecked. No model prompt was sent.",
        );
        break;
      case "zoom-in":
        adjustView((view) => {
          view.zoom = Math.min(2, view.zoom + 0.1);
        });
        break;
      case "zoom-out":
        adjustView((view) => {
          view.zoom = Math.max(0.2, view.zoom - 0.1);
        });
        break;
      case "pan-left":
        adjustView((view) => {
          view.panX += 80;
        });
        break;
      case "pan-right":
        adjustView((view) => {
          view.panX -= 80;
        });
        break;
      case "pan-up":
        adjustView((view) => {
          view.panY += 80;
        });
        break;
      case "pan-down":
        adjustView((view) => {
          view.panY -= 80;
        });
        break;
      case "fit":
        fit();
        break;
      case "export": {
        if (!state.record)
          throw Error("Save this board before exporting history.");
        const exported = await controller.exportBoard();
        downloadJSON(`agent-board-${state.record.id}.json`, exported);
        tell("Full saved history exported. Unsaved edits are not included.");
        break;
      }
      case "export-draft":
        downloadJSON(
          `agent-board-draft-${state.draft.id}.json`,
          controller.exportDraft(),
        );
        tell(
          "Unsaved board settings exported. API keys and embedded endpoint credentials are excluded. Use Export full history for saved conversations.",
        );
        break;
    }
  }
  const onClick = (event) => {
    const target = event.target.closest("[data-ab-action]");
    if (target) {
      run(() => handleAction(target.dataset.abAction, target));
      return;
    }
    const edge = event.target.closest('g[data-edge-id]');
    if (edge) {
      root.classList.add('ab-inspector-open'); root.querySelector('.ab-list-editor').open = true;
      const input = [...q('connection-list').querySelectorAll('input')].find(input=>input.dataset.edgeToggle===edge.dataset.edgeId);
      input?.focus({preventScroll:true}); return;
    }
    const node = event.target.closest("[data-agent-id]");
    if (node && !drag?.moved) controller.select(node.dataset.agentId);
  };
  const boardFields = {
    "board-name": ["name", String],
    "board-goal": ["goal", String],
    "board-criteria": ["acceptanceCriteria", String],
    "board-mode": ["mode", String],
    "board-turns": ["maxTurns", Number],
    "board-concurrency": ["concurrency", Number],
    "board-workflow": ["acceptanceWorkflowId", String],
  };
  function onInput(event) {
    const input = event.target,
      name = input.name;
    if(name==='agent-project'){
      updateNode(node=>{if(input.value)node.projectId=input.value;else delete node.projectId;});return;
    }
    if(name==='project-name'&&selectedProjectId!==WORKSPACE_FOLDER){editProject(project=>{project.name=input.value;});return;}
    if(['project-x','project-y'].includes(name)&&input.value!==''&&Number.isFinite(input.valueAsNumber)){editProject(project=>{project.position[name==='project-x'?'x':'y']=input.valueAsNumber;});return;}
    const chat = input.closest('[data-chat-agent]');
    if (chat && input.tagName === 'TEXTAREA') { chatDrafts.set(`${state.draft.id}:${chat.dataset.chatAgent}`,input.value); return; }
    const cosmetics = {'agent-color':['color',String],'agent-icon':['icon',String],'agent-picture-zoom':['zoom',Number],'agent-picture-hue':['hue',Number]};
    if (cosmetics[name]) { const [key,convert]=cosmetics[name]; updateNode(node => { node.appearance={...appearanceOf(node),[key]:convert(input.value)}; }); return; }
    if (boardFields[name]) {
      const [key, convert] = boardFields[name];
      controller.edit((board) => {
        board[key] = convert(input.value);
      });
      return;
    }
    const nodeFields = {
      "agent-name": "name",
      "agent-provider": "provider",
      "agent-model": "model",
      "agent-effort": "effort",
      "agent-instructions": "instructions",
      "agent-permission": "permission",
    };
    if (nodeFields[name]) {
      updateNode((node) => {
        node[nodeFields[name]] = input.value;
        if (name === "agent-provider") {
          node.permission = "native";
          node.effort = "";
          if (input.value === "api")
            node.apiConfig ||= {
              provider: "custom",
              model: "",
              customEndpoint: "",
            };
          else delete node.apiConfig;
        }
      });
      return;
    }
    if (["agent-x", "agent-y"].includes(name)) {
      if (input.value !== "" && Number.isFinite(input.valueAsNumber))
        updateNode((node) => {
          node.position[name === "agent-x" ? "x" : "y"] = input.valueAsNumber;
        });
      return;
    }
    if (name?.startsWith("api-")) {
      const key = {
        "api-provider": "provider",
        "api-model": "model",
        "api-endpoint": "customEndpoint",
        "api-key": "apiKey",
      }[name];
      if (key)
        updateNode((node) => {
          node.apiConfig ||= {
            provider: "custom",
            model: "",
            customEndpoint: "",
          };
          if (name !== "api-key" || input.value)
            node.apiConfig[key] = input.value;
        });
    }
  }
  const onChange = (event) => {
    if(event.target.name==='project-selection'){selectedProjectId=event.target.value;render();return;}
    if (event.target.name === 'agent-picture') {
      const file = event.target.files?.[0], agentId = state.selectedAgentId, boardId = state.draft.id;
      if (!file) return;
      run(async () => {
        if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 256*1024) throw Error('Choose a PNG, JPEG or WebP picture no larger than 256 KB.');
        const value = await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Picture could not be read.'));reader.readAsDataURL(file);});
        const image = new Image(); image.src=value; await image.decode();
        if (image.width>4096 || image.height>4096 || !safeAvatar(value)) throw Error('Choose a picture no larger than 4096 × 4096 pixels.');
        if (state.draft.id!==boardId) return;
        controller.edit(board => { const node=board.nodes.find(n=>n.id===agentId);if(node)node.appearance={...appearanceOf(node),avatar:value}; });
      }); return;
    }
    if (event.target.dataset.edgeToggle) {
      const id = event.target.dataset.edgeToggle;
      controller.edit((board) => {
        board.edges.find((e) => e.id === id).enabled = event.target.checked;
      });
    } else if (event.target.name === "agent-selection")
      controller.select(event.target.value);
  };
  const onSubmit = (event) => {
    if (event.target.matches('.ab-window-compose')) {
      event.preventDefault();
      const window = event.target.closest('[data-chat-agent]'), agentId = window.dataset.chatAgent, input = window.querySelector('textarea'), text = input.value, draftKey = `${state.draft.id}:${agentId}`;
      run(async () => { await controller.send(agentId,text); if(input.value===text){input.value='';chatDrafts.delete(draftKey);}tell('Message queued.'); }); return;
    }
    if (event.target !== q("compose")) return;
    event.preventDefault();
    const input = f("chat-message"),
      text = input.value,
      agentId = state.selectedAgentId;
    if (!agentId) {
      controller.fail(Error("Select an agent first."));
      return;
    }
    run(async () => {
      await controller.send(agentId, text);
      if (input.value === text) input.value = "";
      tell("Message queued.");
    });
  };
  const onKey = (event) => {
    if(document.querySelector('dialog[open]'))return;
    if (event.key === 'Escape') {
      if(restoreMaximizedChat()){event.preventDefault();return;}
      if(fullscreenPlaceholder){event.preventDefault();toggleFullscreen(true);return;}
    }
    const chat = event.target.closest('[data-chat-agent]');
    const folder=event.target.closest('.ab-project-node');
    if(folder&&event.target===folder){
      if(event.altKey&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
        event.preventDefault();selectedProjectId=folder.dataset.projectId;editProject(project=>{project.position.x+=event.key==='ArrowLeft'?-10:event.key==='ArrowRight'?10:0;project.position.y+=event.key==='ArrowUp'?-10:event.key==='ArrowDown'?10:0;});return;
      }
      if(['Enter',' '].includes(event.key)){event.preventDefault();selectedProjectId=folder.dataset.projectId;render();root.classList.add('ab-inspector-open');root.querySelector('.ab-list-editor').open=true;f('project-selection').focus();return;}
    }
    if (chat && event.target.tagName === 'TEXTAREA' && event.key==='Enter' && (event.ctrlKey||event.metaKey)) {event.preventDefault();chat.querySelector('form').requestSubmit();return;}
    if (event.target.matches('.ab-resize-handle') && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {event.preventDefault();controller.edit(board=>{const p=board.panels.find(p=>p.agentId===chat.dataset.chatAgent);if(p.maximized)return;p.width=Math.min(2400,Math.max(280,p.width+(event.key==='ArrowRight'?20:event.key==='ArrowLeft'?-20:0)));p.height=Math.min(2400,Math.max(240,p.height+(event.key==='ArrowDown'?20:event.key==='ArrowUp'?-20:0)));});return;}
    const edge=event.target.closest('g[data-edge-id]');
    if(edge && ['Enter',' '].includes(event.key)){event.preventDefault();edge.dispatchEvent(new MouseEvent('click',{bubbles:true}));return;}
    if (
      event.target === f("chat-message") &&
      event.key === "Enter" &&
      (event.ctrlKey || event.metaKey)
    ) {
      event.preventDefault();
      q("compose").requestSubmit();
    }
    const node = event.target.closest("[data-agent-id]");
    if (node && (event.key==='Enter'||event.key===' ') && !event.altKey && event.target===node) {event.preventDefault();openChat(node.dataset.agentId);return;}
    if (
      node &&
      event.altKey &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      event.preventDefault();
      const dx =
          event.key === "ArrowLeft" ? -10 : event.key === "ArrowRight" ? 10 : 0,
        dy = event.key === "ArrowUp" ? -10 : event.key === "ArrowDown" ? 10 : 0;
      controller.edit((board) => {
        const value = board.nodes.find((n) => n.id === node.dataset.agentId);
        value.position.x += dx;
        value.position.y += dy;
      });
    }
  };
  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    const panel=event.target.closest('[data-chat-agent]');
    if(panel){
      const saved=(state.draft.panels||[]).find(p=>p.agentId===panel.dataset.chatAgent);
      if(!saved?.maximized)panel.style.zIndex=++panelZ;
      if(saved?.maximized)return;
      if(event.target.closest('.ab-resize-handle')||event.target.closest('[data-chat-drag]')&&!event.target.closest('button')){
        const rect=panel.getBoundingClientRect();panelDrag={element:panel,agentId:panel.dataset.chatAgent,resize:!!event.target.closest('.ab-resize-handle'),x:event.clientX,y:event.clientY,start:{x:parseFloat(panel.style.left),y:parseFloat(panel.style.top),width:rect.width,height:rect.height}};
        panel.setPointerCapture?.(event.pointerId);event.preventDefault();
      }
      return;
    }
    if(event.target.closest('button,g[data-edge-id]')) return;
    const folder=event.target.closest('.ab-project-node');
    if(folder){
      selectedProjectId=folder.dataset.projectId;
      const project=projectCards(state.draft,workspaceRoot).find(p=>p.id===selectedProjectId);
      drag={project:true,id:project.id,x:event.clientX,y:event.clientY,start:{...project.position},moved:false,element:folder};
      folder.setPointerCapture?.(event.pointerId);render();return;
    }
    const element = event.target.closest("[data-agent-id]");
    if (element) {
      const node = state.draft.nodes.find(
        (n) => n.id === element.dataset.agentId,
      );
      controller.select(node.id);
      drag = {
        id: node.id,
        x: event.clientX,
        y: event.clientY,
        start: { ...node.position },
        moved: false,
        element,
      };
    } else {
      drag = {
        pan: true,
        x: event.clientX,
        y: event.clientY,
        start: { ...state.draft.view },
        moved: false,
        element: q("canvas"),
      };
    }
    drag.element.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event) => {
    if(panelDrag){
      const dx=event.clientX-panelDrag.x,dy=event.clientY-panelDrag.y,el=panelDrag.element,s=panelDrag.start;
      if(panelDrag.resize){const w=q('canvas').clientWidth-s.x,h=q('canvas').clientHeight-s.y;el.style.width=Math.max(Math.min(280,w),Math.min(2400,s.width+dx,w))+'px';el.style.height=Math.max(Math.min(240,h),Math.min(2400,s.height+dy,h))+'px';}
      else{el.style.left=Math.max(0,Math.min(q('canvas').clientWidth-el.offsetWidth,s.x+dx))+'px';el.style.top=Math.max(0,Math.min(q('canvas').clientHeight-el.offsetHeight,s.y+dy))+'px';}
      renderChatLinks();
      return;
    }
    if (!drag) return;
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) < 4 && !drag.moved) return;
    drag.moved = true;
    if (drag.pan) {
      adjustView((view) => {
        view.panX = drag.start.panX + dx;
        view.panY = drag.start.panY + dy;
      });
      return;
    }
    const zoom = state.draft.view?.zoom || 1;
    if(drag.project){selectedProjectId=drag.id;editProject(project=>{project.position={x:Math.round(drag.start.x+dx/zoom),y:Math.round(drag.start.y+dy/zoom)};});return;}
    controller.edit((board) => {
      const node = board.nodes.find((n) => n.id === drag.id);
      if (node)
        node.position = {
          x: Math.round(drag.start.x + dx / zoom),
          y: Math.round(drag.start.y + dy / zoom),
        };
    });
  };
  const onPointerUp = () => {
    if(panelDrag){
      const p=panelDrag;panelDrag=null;
      controller.edit(board=>{
        const panel=board.panels?.find(v=>v.agentId===p.agentId);
        if(!panel)return;
        panel.x=parseFloat(p.element.style.left);panel.y=parseFloat(p.element.style.top);
        // Moving a window in a smaller viewport must not replace its normal
        // saved size with the temporary display clamp.
        if(p.resize){panel.width=Math.max(280,parseFloat(p.element.style.width));panel.height=Math.max(240,parseFloat(p.element.style.height));}
      });return;
    }
    if (drag?.moved) {
      const previous = drag;
      setTimeout(() => {
        if (drag === previous) drag = null;
      }, 0);
    } else drag = null;
  };
  const onWheel = event => {
    if (!event.ctrlKey && !event.metaKey) return;
    if (event.target.closest('[data-chat-agent]')) return;
    event.preventDefault();
    const rect=q('canvas').getBoundingClientRect(), x=event.clientX-rect.left, y=event.clientY-rect.top;
    adjustView(view=>{ const previous=view.zoom, zoom=Math.min(2,Math.max(.2,previous*(event.deltaY>0?.9:1.1))); view.panX=x-(x-view.panX)*zoom/previous;view.panY=y-(y-view.panY)*zoom/previous;view.zoom=zoom; });
  };
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  root.addEventListener("submit", onSubmit);
  root.addEventListener("keydown", onKey);
  const onDetailsToggle=event=>{if(event.target===q('task-tools')&&event.target.open){if(tasksMount?.failed){tasksMount=null;tasksKey='__retry__';}void ensureTasks().catch(controller.fail);}};
  root.addEventListener('toggle',onDetailsToggle,true);
  q("canvas").addEventListener("pointerdown", onPointerDown);
  q("canvas").addEventListener("pointermove", onPointerMove);
  q("canvas").addEventListener("pointerup", onPointerUp);
  q("canvas").addEventListener("pointercancel", onPointerUp);
  q('canvas').addEventListener('wheel',onWheel,{passive:false});
  const unsubscribe = onEvent?.((event) => {
    const resetEvent =
      (event?.domain === "agents" && event.type === "reset") ||
      (event?.domain === "workspace" &&
        event.type === "changed" &&
        Object.hasOwn(event, "imported") &&
        typeof event.imported === "number");
    if (
      resetEvent &&
      workspaceKey(event.workspaceRoot) === workspaceKey(workspaceRoot)
    ) {
      folderStatuses.clear();
      clearTimeout(refreshTimer);
      seenSequence = 0;
      void resetScheduler.request();
      return;
    }
    if (resetScheduler.pending) return;
    if (
      !acceptsAgentEvent(
        event,
        workspaceRoot,
        state.record?.id,
        Math.max(state.cursor, seenSequence),
      )
    )
      return;
    seenSequence = event.sequence;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(
      () => controller.refresh({ all: true }).catch(controller.fail),
      80,
    );
  });
  const chatViewportObserver=new ResizeObserver(()=>{for(const panel of state.draft.panels||[]){const el=q('chat-windows').querySelector('[data-chat-agent=\"'+CSS.escape(panel.agentId)+'\"]');if(el)layoutChatWindow(el,panel);}renderChatLinks();});chatViewportObserver.observe(q('canvas'));
  render();
  const ready=run(async () => { await controller.initialize(); if (initialBoardId) await controller.load(initialBoardId);if(initialToolsOpen)await openTasks(); });
  return {
    ready,
    loadBoard:id=>controller.task(()=>{assertTaskToolsSettled();return controller.load(id);}),
    openTasks,
    hasUnsavedChanges:()=>state.dirty||taskToolsPending(),
    destroy() {
      tasksEpoch++;tasksMount?.destroy?.();if(!tasksMount?.destroy)tasksMount?.unmount?.();
      closeSaveDialog?.();
      toggleFullscreen(true);
      destroyed = true;
      resetScheduler.destroy();
      clearTimeout(refreshTimer);
      unsubscribe?.();
      document.removeEventListener('keydown',fullscreenKeys);
      chatViewportObserver.disconnect();
      controller.destroy();
      root.removeEventListener("click", onClick);
      root.removeEventListener("input", onInput);
      root.removeEventListener("change", onChange);
      root.removeEventListener("submit", onSubmit);
      root.removeEventListener("keydown", onKey);
      root.removeEventListener('toggle',onDetailsToggle,true);
      q("canvas").removeEventListener("pointerdown", onPointerDown);
      q("canvas").removeEventListener("pointermove", onPointerMove);
      q("canvas").removeEventListener("pointerup", onPointerUp);
      q("canvas").removeEventListener("pointercancel", onPointerUp);
      q('canvas').removeEventListener('wheel',onWheel);
      container.replaceChildren();
    },
  };
}
