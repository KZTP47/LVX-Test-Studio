"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(
  path.join(__dirname, "../agent-board.js"),
  "utf8",
);
const modulePromise = import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
const copy = (v) => JSON.parse(JSON.stringify(v));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const agent = (id = "a") => ({
  id,
  name: "FIXTURE " + id,
  provider: "codex",
  model: "",
  effort: "",
  instructions: "",
  permission: "native",
  position: { x: 40, y: 40 },
});
let counter = 0;
const makeId = () =>
  `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

async function harness() {
  const api = await modulePromise,
    calls = [],
    boards = new Map(),
    sessions = new Map(),
    history = new Map();
  let sequence = 0;
  const invoke = async (action, payload = {}) => {
    calls.push({ action, payload: copy(payload) });
    if (action === "capabilities")
      return {
        providers: [
          {
            id: "codex",
            installed: true,
            login: "native-login-not-checked",
            supports: {
              resume: true,
              permissions: ["native", "read-only"],
              effort: true,
            },
          },
        ],
      };
    if (action === "listBoards")
      return { records: [...boards.values()].map(copy) };
    if (action === "listWorkflows") return { records: [] };
    if (action === "validateBoard") return { valid: true, errors: [] };
    if (action === "saveBoard") {
      const prior = boards.get(payload.board.id);
      if ((prior?.revision ?? null) !== payload.expectedRevision) {
        const e = Error("FIXTURE revision conflict");
        e.code = "CONFLICT";
        throw e;
      }
      const record = {
        id: payload.board.id,
        revision: (prior?.revision || 0) + 1,
        value: copy(payload.board),
      };
      boards.set(record.id, record);
      for (const node of record.value.nodes)
        if (!sessions.has(node.id))
          sessions.set(node.id, {
            agentId: node.id,
            generation: 1,
            status: "idle",
          });
      return { record: copy(record) };
    }
    if (action === "snapshot") {
      const record = boards.get(payload.boardId);
      if (!record) throw Error("FIXTURE missing board");
      const rows = (history.get(record.id) || []).filter(
          (m) => m.sequence > payload.afterSequence,
        ),
        page = rows.slice(0, payload.limit);
      return {
        board: copy(record),
        sessions: copy([...sessions.values()]),
        runs: [],
        messages: copy(page),
        events: [],
        cursor: page.at(-1)?.sequence ?? payload.afterSequence,
        hasMore: rows.length > page.length,
      };
    }
    if (action === "send") {
      const message = {
        id: payload.requestId,
        sequence: ++sequence,
        boardId: payload.boardId,
        agentId: payload.agentId,
        role: "user",
        text: payload.text,
        state: "queued",
      };
      history.set(payload.boardId, [
        ...(history.get(payload.boardId) || []),
        message,
      ]);
      return { message, runId: "FIXTURE-run" };
    }
    if (action === "runGoal") return { runId: "FIXTURE-goal" };
    if (action === "exportBoard")
      return {
        schemaVersion: 1,
        board: copy(boards.get(payload.boardId).value),
      };
    if (action === "cancel" || action === "pause" || action === "resume")
      return { cancelled: true };
    if (action === "newSession") {
      assert.equal(
        payload.expectedGeneration,
        sessions.get(payload.agentId).generation,
      );
      const next = {
        ...sessions.get(payload.agentId),
        generation: payload.expectedGeneration + 1,
      };
      sessions.set(payload.agentId, next);
      return copy(next);
    }
    throw Error("Unexpected FIXTURE action " + action);
  };
  const controller = api.createBoardController({
    invoke,
    workspaceRoot: "F:\\fixture-workspace",
    idFactory: makeId,
  });
  return { ...api, controller, invoke, calls, boards, sessions, history };
}

test("empty workspace is empty and probes never send a model message", async () => {
  const { controller, calls } = await harness();
  await controller.initialize();
  assert.deepEqual(controller.state.draft.nodes, []);
  assert.deepEqual(controller.state.messages, []);
  assert.deepEqual(calls.map((c) => c.action).sort(), [
    "capabilities",
    "listBoards",
    "listWorkflows",
  ]);
  assert.equal(
    controller.state.capabilities.providers[0].login,
    "native-login-not-checked",
  );
});

test('named save creates an independent copy without moving chat history', async () => {
  const h = await harness(), c = h.controller;
  c.edit(b => { b.name = 'Original'; b.nodes.push(agent()); });
  const original = await c.save();
  await c.send('a', 'Original conversation');
  const created = await c.save({mode:'new',name:'  Team Åäö  '});
  assert.notEqual(created.id, original.id);
  assert.equal(created.value.name, 'Team Åäö');
  assert.equal(h.boards.size, 2);
  assert.equal(h.boards.get(original.id).value.name, 'Original');
  assert.deepEqual(created.value.nodes, original.value.nodes);
  assert.equal(c.state.messages.length, 0);
  assert.equal(h.history.get(original.id).length, 1);
  assert.equal(c.state.dirty, false);
});

test('explicit overwrite replaces chosen board with revision protection and preserves unrelated board', async () => {
  const h = await harness(), c = h.controller;
  c.edit(b => b.name = 'First'); const first = await c.save();
  const second = await c.save({mode:'new',name:'Second'});
  c.edit(b => b.goal = 'Replacement goal');
  await assert.rejects(c.save({mode:'overwrite',name:'Revised',targetId:first.id,targetRevision:7}), /revision conflict/);
  assert.equal(c.state.conflict, false);
  assert.equal(c.state.draft.goal, 'Replacement goal');
  const saved = await c.save({mode:'overwrite',name:'Revised',targetId:first.id,targetRevision:first.revision});
  assert.equal(saved.id, first.id); assert.equal(saved.revision, 2);
  assert.equal(saved.value.goal, 'Replacement goal');
  assert.equal(h.boards.get(second.id).value.name, 'Second');
  await c.load(second.id); assert.equal(c.state.draft.name, 'Second');
  await c.load(first.id); assert.equal(c.state.draft.name, 'Revised');
});

test('invalid named save never writes or mutates the draft', async () => {
  const h = await harness(), c = h.controller, before = copy(c.state.draft);
  await assert.rejects(c.save({mode:'new',name:'  '}), /Give the board a name/);
  await assert.rejects(c.save({mode:'overwrite',name:'Chosen'}), /Choose an existing board/);
  assert.deepEqual(c.state.draft, before); assert.equal(h.boards.size, 0);
});

test('cancelled first save prevents implicit message dispatch', async () => {
  const api = await modulePromise, calls = [];
  const c = api.createBoardController({workspaceRoot:'FIXTURE',invoke:async action=>{calls.push(action);},requestSave:async()=>false});
  c.edit(b => b.nodes.push(agent()));
  await assert.rejects(c.send('a','Do not dispatch'), /Save cancelled/);
  assert.deepEqual(calls, []); assert.equal(c.state.dirty, true);
});

test("validation rejects broken topology and invalid budgets while permitting bounded cycles", async () => {
  const { emptyBoard, validateDraft } = await modulePromise;
  const board = emptyBoard("FIXTURE-board");
  board.nodes = [agent("a"), agent("b")];
  board.edges = [
    { id: "one", source: "a", target: "b", enabled: true },
    { id: "two", source: "b", target: "a", enabled: true },
  ];
  assert.deepEqual(validateDraft(board), []);
  board.maxTurns = 101;
  board.concurrency = 0;
  board.nodes[1].position.x = NaN;
  board.edges.push({ id: "bad", source: "a", target: "missing" });
  const errors = validateDraft(board);
  assert.equal(errors.length, 4);
  assert.ok(errors.some((e) => e.includes("existing agents")));
  board.edges = [
    { id: "self", source: "a", target: "a" },
    { id: "self2", source: "a", target: "a" },
  ];
  assert.ok(validateDraft(board).some((e) => e.includes("different agents")));
  assert.ok(validateDraft(board).some((e) => e.includes("already exists")));
});

test("event filter rejects other workspace, board, stale or malformed events", async () => {
  const { acceptsAgentEvent } = await modulePromise;
  const event = {
    domain: "agents",
    type: "event",
    workspaceRoot: "F:\\FIXTURE\\",
    boardId: "board",
    sequence: 3,
  };
  assert.equal(acceptsAgentEvent(event, "f:/fixture", "board", 2), true);
  for (const patch of [
    { workspaceRoot: "F:\\other" },
    { boardId: "other" },
    { sequence: 2 },
    { sequence: "4" },
    { domain: "execution" },
    { type: "progress" },
  ])
    assert.equal(
      acceptsAgentEvent({ ...event, ...patch }, "F:\\fixture", "board", 2),
      false,
    );
});

test("history merges updated message states without truncating unicode or peer text", async () => {
  const { mergeSequenced } = await modulePromise;
  const text = "FIXTURE Åäö 漢字 👩🏽‍💻\n".repeat(20000);
  const taskContext = {
    goal: "FIXTURE shared goal Åäö 漢字",
    acceptanceCriteria: "FIXTURE criteria 👩🏽‍💻\nComplete evidence",
  };
  const transportInput =
    "FIXTURE exact recorded input\n" +
    taskContext.goal +
    "\n" +
    taskContext.acceptanceCriteria +
    "\n" +
    text;
  const result = mergeSequenced(
    [{ id: "one", sequence: 1, state: "queued", text }],
    [
      {
        id: "two",
        sequence: 2,
        role: "peer",
        text,
        taskContext,
        transportInput,
      },
      { id: "one", sequence: 1, state: "completed", text },
    ],
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].state, "completed");
  assert.equal(result[1].text, text);
  assert.equal(result[0].text.length, text.length);
  assert.deepEqual(result[1].taskContext, taskContext);
  assert.equal(result[1].transportInput, transportInput);
  assert.equal(result[0].taskContext, undefined);
});

test("save validates through IPC and uses canonical revision; new board has no demos", async () => {
  const { controller, calls } = await harness();
  controller.edit((b) => b.nodes.push(agent()));
  await controller.save();
  assert.equal(controller.state.baseRevision, 1);
  assert.equal(controller.state.dirty, false);
  controller.edit((b) => {
    b.name = "FIXTURE saved second revision";
  });
  await controller.save();
  assert.deepEqual(
    calls
      .filter((c) => c.action === "saveBoard")
      .map((c) => c.payload.expectedRevision),
    [null, 1],
  );
  assert.equal(calls.filter((c) => c.action === "validateBoard").length, 2);
  controller.newBoard();
  assert.deepEqual(controller.state.draft.nodes, []);
  assert.equal(controller.state.record, null);
});

test("keystrokes during save stay in the unsaved draft while canonical record advances", async () => {
  const { createBoardController, emptyBoard } = await modulePromise;
  const gate = deferred();
  let saved;
  const controller = createBoardController({
    workspaceRoot: "FIXTURE",
    idFactory: makeId,
    invoke: async (action, payload) => {
      if (action === "validateBoard") return { valid: true };
      if (action === "saveBoard") {
        saved = copy(payload.board);
        await gate.promise;
        return { record: { id: saved.id, revision: 1, value: saved } };
      }
      if (action === "listBoards") return { records: [] };
      throw Error(action);
    },
  });
  controller.edit((b) => {
    b.name = "FIXTURE first";
  });
  const saving = controller.save();
  await new Promise((resolve) => setImmediate(resolve));
  controller.edit((b) => {
    b.name = "FIXTURE typed during save";
  });
  gate.resolve();
  await saving;
  assert.equal(controller.state.record.value.name, "FIXTURE first");
  assert.equal(controller.state.draft.name, "FIXTURE typed during save");
  assert.equal(controller.state.dirty, true);
  assert.equal(controller.state.baseRevision, 1);
  assert.equal(
    controller.state.draft.schemaVersion,
    emptyBoard("FIXTURE").schemaVersion,
  );
});

test("revision conflict preserves draft and recovery controls bypass an unsavable draft", async () => {
  const { controller, boards, calls } = await harness();
  controller.edit((b) => b.nodes.push(agent()));
  await controller.save();
  await controller.refresh();
  const saved = boards.get(controller.state.record.id);
  saved.revision = 2;
  saved.value.name = "FIXTURE remote edit";
  controller.edit((b) => {
    b.name = "FIXTURE local edit";
  });
  await assert.rejects(controller.save(), /revision conflict/);
  assert.equal(controller.state.draft.name, "FIXTURE local edit");
  assert.equal(controller.state.baseRevision, 1);
  assert.equal(controller.state.conflict, true);
  const saves = calls.filter((c) => c.action === "saveBoard").length;
  await controller.action("cancel");
  await controller.newSession("a");
  assert.equal(calls.filter((c) => c.action === "saveBoard").length, saves);
  assert.equal(controller.state.draft.name, "FIXTURE local edit");
  assert.equal(
    calls.find((c) => c.action === "newSession").payload.expectedGeneration,
    1,
  );
  await controller.discard();
  assert.equal(controller.state.draft.name, "FIXTURE remote edit");
  assert.equal(controller.state.dirty, false);
});

test("failed send retries reuse UUID and preserve exact user text; success clears attempt", async () => {
  const h = await harness();
  const { controller, calls } = h;
  controller.edit((b) => b.nodes.push(agent()));
  await controller.save();
  let tries = 0;
  const ids = [];
  const text = "  FIXTURE exact\nÅäö <tag>  ";
  // Route only send through a faulting wrapper; canonical snapshots use the same fixture store.
  const c = h.createBoardController({
    workspaceRoot: "FIXTURE",
    idFactory: makeId,
    invoke: async (action, payload) => {
      if (action === "send") {
        ids.push(payload.requestId);
        if (++tries === 1) throw Error("FIXTURE lost response");
      }
      return h.invoke(action, payload);
    },
  });
  await c.load(controller.state.record.id);
  await assert.rejects(c.send("a", text), /lost response/);
  await c.send("a", text);
  assert.equal(ids[0], ids[1]);
  assert.equal(c.state.messages[0].text, text);
  await c.send("a", text);
  assert.notEqual(ids[1], ids[2]);
  assert.equal(calls.filter((item) => item.action === "send").length, 2);
});

test("snapshot pages expose complete history and explicit load-more state", async () => {
  const { controller, history } = await harness();
  controller.edit((b) => b.nodes.push(agent()));
  await controller.save();
  history.set(
    controller.state.record.id,
    Array.from({ length: 451 }, (_, index) => ({
      id: "FIXTURE-" + index,
      sequence: index + 1,
      agentId: "a",
      role: index % 2 ? "assistant" : "peer",
      text: "FIXTURE full message " + index,
    })),
  );
  await controller.load(controller.state.record.id);
  assert.equal(controller.state.messages.length, 200);
  assert.equal(controller.state.hasMore, true);
  await controller.refresh({ all: true });
  assert.equal(controller.state.messages.length, 451);
  assert.equal(controller.state.cursor, 451);
  assert.equal(controller.state.hasMore, false);
});

test("a successful send with a failed history refresh retains its retry UUID", async () => {
  const h = await harness();
  h.controller.edit((board) => board.nodes.push(agent()));
  await h.controller.save();
  let failRefresh = false;
  const ids = [];
  const controller = h.createBoardController({
    workspaceRoot: "FIXTURE",
    idFactory: makeId,
    invoke: async (action, payload) => {
      if (action === "send") {
        ids.push(payload.requestId);
        if (ids.length === 1) failRefresh = true;
        return { runId: "FIXTURE-already-queued" };
      }
      if (action === "snapshot" && failRefresh) {
        failRefresh = false;
        throw Error("FIXTURE refresh unavailable after successful queue");
      }
      return h.invoke(action, payload);
    },
  });
  await controller.load(h.controller.state.record.id);
  await assert.rejects(
    controller.send("a", "FIXTURE retry"),
    /refresh unavailable/,
  );
  await controller.send("a", "FIXTURE retry");
  assert.equal(ids[0], ids[1]);
});

test("a snapshot from a previous selected board cannot overwrite the new board", async () => {
  const { createBoardController, emptyBoard } = await modulePromise;
  const gate = deferred();
  const controller = createBoardController({
    workspaceRoot: "FIXTURE",
    idFactory: makeId,
    invoke: async (action, payload) => {
      if (action !== "snapshot") throw Error(action);
      if (payload.boardId === "old") await gate.promise;
      return {
        board: {
          id: payload.boardId,
          revision: 1,
          value: emptyBoard(payload.boardId),
        },
        sessions: [],
        runs: [],
        messages: [],
        events: [],
        cursor: 0,
        hasMore: false,
      };
    },
  });
  const old = controller.load("old");
  await controller.load("new");
  gate.resolve();
  await old;
  assert.equal(controller.state.record.id, "new");
  assert.equal(controller.state.draft.id, "new");
});

test("late older revision cannot roll back a saved canonical board", async () => {
  const h = await harness();
  h.controller.edit((b) => b.nodes.push(agent()));
  await h.controller.save();
  const c = h.createBoardController({
    workspaceRoot: "FIXTURE",
    idFactory: makeId,
    invoke: async (action, payload) => {
      const result = await h.invoke(action, payload);
      if (action === "snapshot" && payload.afterSequence === 0)
        result.board.revision = 1;
      return result;
    },
  });
  await c.load(h.controller.state.record.id);
  c.edit((b) => {
    b.name = "FIXTURE newer";
  });
  await c.save();
  await c.refresh();
  assert.equal(c.state.record.revision, 2);
  assert.equal(c.state.draft.name, "FIXTURE newer");
});

test("destroy prevents late board loads from notifying or adopting data", async () => {
  const { createBoardController, emptyBoard } = await modulePromise,
    gate = deferred();
  let notifications = 0;
  const controller = createBoardController({
    workspaceRoot: "FIXTURE",
    idFactory: makeId,
    onChange: () => notifications++,
    invoke: async () => {
      await gate.promise;
      return { board: { id: "late", revision: 1, value: emptyBoard("late") } };
    },
  });
  const loading = controller.load("late");
  controller.destroy();
  gate.resolve();
  await assert.rejects(loading, /closed/);
  assert.equal(controller.state.record, null);
  assert.equal(notifications, 0);
  await assert.rejects(controller.capabilities(), /closed/);
});

test("goal dispatch uses explicit starter UUID and rejects empty goal before IPC", async () => {
  const { controller, calls } = await harness();
  await assert.rejects(controller.runGoal(), /goal/);
  assert.equal(calls.length, 0);
  controller.edit((b) => {
    b.goal = "FIXTURE user goal";
    b.nodes.push(agent());
  });
  await controller.runGoal(["a"]);
  const payload = calls.find((c) => c.action === "runGoal").payload;
  assert.deepEqual(payload.agentIds, ["a"]);
  assert.match(payload.requestId, /^[a-f0-9-]{36}$/);
});

test("All agents dispatch includes every node while explicit starter excludes peers", async () => {
  const { controller, calls } = await harness();
  controller.edit((board) => {
    board.goal = "FIXTURE all-agent goal";
    board.nodes.push(agent("one"), agent("two"), agent("three"));
  });
  await controller.runGoal();
  await controller.runGoal(["two"]);
  const starts = calls.filter((call) => call.action === "runGoal");
  assert.deepEqual(starts[0].payload.agentIds, ["one", "two", "three"]);
  assert.deepEqual(starts[1].payload.agentIds, ["two"]);
  assert.notEqual(starts[0].payload.requestId, starts[1].payload.requestId);
});

test("every controller invocation binds its captured workspace and rejects caller override", async () => {
  const { controller, calls } = await harness();
  await controller.initialize();
  controller.edit((board) => {
    board.nodes.push(agent());
    board.goal = "FIXTURE bound goal";
  });
  await controller.save();
  await controller.load(controller.state.record.id);
  await controller.send("a", "FIXTURE bound message");
  await controller.runGoal();
  await controller.action("pause", { workspaceRoot: "F:\\other-workspace" });
  await controller.newSession("a");
  await controller.exportBoard();
  assert.ok(calls.length > 12);
  for (const call of calls)
    assert.equal(
      call.payload.workspaceRoot,
      "F:\\fixture-workspace",
      call.action,
    );
});

test("mismatched workspace responses and late closed-view responses are not adopted", async () => {
  const { createBoardController } = await modulePromise;
  const controller = createBoardController({
    workspaceRoot: "F:\\selected-workspace",
    idFactory: makeId,
    invoke: async () => ({
      workspaceRoot: "F:\\other-workspace",
      providers: [{ id: "WRONG" }],
    }),
  });
  await assert.rejects(controller.capabilities(), /Workspace changed/);
  assert.equal(controller.state.capabilities, null);
  const gate = deferred();
  const old = createBoardController({
    workspaceRoot: "F:\\old-workspace",
    idFactory: makeId,
    invoke: async () => {
      await gate.promise;
      return { providers: [{ id: "OLD" }] };
    },
  });
  const pending = old.capabilities();
  old.destroy();
  const current = createBoardController({
    workspaceRoot: "F:\\new-workspace",
    idFactory: makeId,
    invoke: async () => ({ providers: [{ id: "CURRENT" }] }),
  });
  await current.capabilities();
  gate.resolve();
  await assert.rejects(pending, /closed/);
  assert.equal(old.state.capabilities, null);
  assert.equal(current.state.capabilities.providers[0].id, "CURRENT");
});

test("API models are explicit except custom server defaults; native defaults remain blank", async () => {
  const { emptyBoard, validateDraft } = await modulePromise;
  const board = emptyBoard("FIXTURE-api-model");
  const node = agent();
  board.nodes.push(node);
  assert.deepEqual(validateDraft(board), []);
  node.provider = "api";
  for (const provider of ["openai", "anthropic", "google"]) {
    node.apiConfig = { provider, model: "" };
    assert.ok(
      validateDraft(board).some((error) => error.includes("explicit model")),
    );
    node.apiConfig.model = "FIXTURE-explicit-model";
    assert.deepEqual(validateDraft(board), []);
    node.apiConfig.model = "";
    node.model = "FIXTURE-override";
    assert.deepEqual(validateDraft(board), []);
    node.model = "";
  }
  node.apiConfig = {
    provider: "custom",
    model: "",
    customEndpoint: "http://127.0.0.1:1/fixture",
  };
  assert.deepEqual(validateDraft(board), []);
});

test("restored lower cursor replaces canonical history and preserves an unsaved draft as conflict", async () => {
  const h = await harness();
  h.controller.edit((board) => board.nodes.push(agent()));
  await h.controller.save();
  const id = h.controller.state.record.id;
  h.boards.get(id).revision = 5;
  h.history.set(id, [
    {
      id: "old",
      sequence: 90,
      agentId: "a",
      text: "FIXTURE old history",
      state: "running",
    },
  ]);
  await h.controller.load(id);
  h.controller.edit((board) => {
    board.name = "FIXTURE retained draft";
  });
  h.boards.get(id).revision = 1;
  h.boards.get(id).value.name = "FIXTURE imported canonical";
  h.history.set(id, [
    {
      id: "restored",
      sequence: 1,
      agentId: "a",
      text: "FIXTURE restored history",
      state: "interrupted",
    },
  ]);
  const dispatches = h.calls.filter((call) =>
    ["send", "runGoal", "resume"].includes(call.action),
  ).length;
  await h.controller.resetFromCanonical();
  assert.equal(h.controller.state.cursor, 1);
  assert.deepEqual(
    h.controller.state.messages.map((message) => message.id),
    ["restored"],
  );
  assert.equal(h.controller.state.record.revision, 1);
  assert.equal(
    h.controller.state.record.value.name,
    "FIXTURE imported canonical",
  );
  assert.equal(h.controller.state.draft.name, "FIXTURE retained draft");
  assert.equal(h.controller.state.baseRevision, 5);
  assert.equal(h.controller.state.dirty, true);
  assert.equal(h.controller.state.conflict, true);
  await assert.rejects(h.controller.save(), /canonical board/);
  assert.equal(
    h.calls.filter((call) =>
      ["send", "runGoal", "resume"].includes(call.action),
    ).length,
    dispatches,
  );
  await h.controller.discard();
  assert.equal(h.controller.state.draft.name, "FIXTURE imported canonical");
});

test("structural reset adopts clean restored revisions and deleted boards leave a visible recoverable error", async () => {
  const h = await harness();
  h.controller.edit((board) => board.nodes.push(agent()));
  await h.controller.save();
  const id = h.controller.state.record.id;
  h.boards.get(id).value.name = "FIXTURE restored same-revision value";
  await h.controller.resetFromCanonical();
  assert.equal(
    h.controller.state.draft.name,
    "FIXTURE restored same-revision value",
  );
  assert.equal(h.controller.state.conflict, false);
  const before = JSON.stringify(h.controller.state.draft);
  h.boards.delete(id);
  await assert.rejects(
    h.controller.resetFromCanonical(),
    /no longer exists.*draft is preserved/,
  );
  assert.equal(JSON.stringify(h.controller.state.draft), before);
  assert.equal(h.controller.state.conflict, true);
  assert.equal(h.controller.state.record.id, id);
  assert.equal(h.controller.state.missingBoard, true);
  assert.deepEqual(h.controller.state.boards, []);
  const exported = h.controller.exportDraft();
  assert.equal(exported.board.name, h.controller.state.draft.name);
  await h.controller.discard();
  assert.equal(h.controller.state.record, null);
  assert.equal(h.controller.state.dirty, false);
  assert.equal(h.controller.state.missingBoard, false);
  h.controller.newBoard();
  const survivor = h.emptyBoard("FIXTURE-survivor");
  h.boards.set(survivor.id, { id: survivor.id, revision: 1, value: survivor });
  await h.controller.load(survivor.id);
  assert.equal(h.controller.state.record.id, survivor.id);
});

test("draft recovery export excludes keys and endpoint credentials without modifying the draft", async () => {
  const { safeDraftExport, emptyBoard } = await modulePromise;
  const board = emptyBoard("FIXTURE-secret-draft");
  board.nodes.push({
    ...agent(),
    provider: "api",
    apiConfig: {
      provider: "custom",
      apiKey: "FIXTURE_KEY_PRIVATE",
      customEndpoint:
        "https://FIXTURE_USER:FIXTURE_PASSWORD@example.test/api?token=FIXTURE_TOKEN&q=safe",
      model: "",
    },
  });
  const exported = safeDraftExport(board),
    serialized = JSON.stringify(exported);
  assert.doesNotMatch(
    serialized,
    /FIXTURE_KEY_PRIVATE|FIXTURE_USER|FIXTURE_PASSWORD|FIXTURE_TOKEN/,
  );
  assert.match(serialized, /q=safe/);
  assert.equal(board.nodes[0].apiConfig.apiKey, "FIXTURE_KEY_PRIVATE");
});

test("two committed resets during an async restore finish at the latest archive", async () => {
  const { createResetScheduler } = await modulePromise,
    gate = deferred();
  let current = "FIXTURE archive A",
    adopted = null;
  const captures = [],
    errors = [];
  const scheduler = createResetScheduler(
    async () => {
      const captured = current;
      captures.push(captured);
      if (captures.length === 1) await gate.promise;
      adopted = captured;
    },
    { onError: (error) => errors.push(error.message) },
  );
  const first = scheduler.request();
  current = "FIXTURE archive B";
  const second = scheduler.request();
  assert.equal(first, second);
  gate.resolve();
  await first;
  assert.deepEqual(captures, ["FIXTURE archive A", "FIXTURE archive B"]);
  assert.equal(adopted, "FIXTURE archive B");
  assert.deepEqual(errors, []);
  assert.equal(scheduler.pending, false);
});

test("a stale reset rejection cannot mark a newly opened board missing or conflicted", async () => {
  const { createBoardController, emptyBoard } = await modulePromise;
  const gate = deferred();
  let deferOld = false,
    lists = 0;
  const controller = createBoardController({
    workspaceRoot: "FIXTURE",
    idFactory: makeId,
    invoke: async (action, payload) => {
      if (action === "listBoards") {
        lists++;
        return { records: [] };
      }
      if (action !== "snapshot") throw Error(action);
      if (deferOld && payload.boardId === "old") return gate.promise;
      return {
        board: {
          id: payload.boardId,
          revision: 1,
          value: emptyBoard(payload.boardId),
        },
        messages: [],
        events: [],
        sessions: [],
        runs: [],
        cursor: 0,
        hasMore: false,
      };
    },
  });
  await controller.load("old");
  deferOld = true;
  const resetting = controller.resetFromCanonical();
  await controller.load("current");
  const error = Error("FIXTURE old board not found");
  error.code = "NOT_FOUND";
  gate.reject(error);
  await resetting;
  assert.equal(controller.state.record.id, "current");
  assert.equal(controller.state.draft.id, "current");
  assert.equal(controller.state.conflict, false);
  assert.equal(controller.state.missingBoard, false);
  assert.equal(controller.state.notice, "");
  assert.equal(lists, 0);
});

test("a reset follow-up finishing after another board opens cannot publish its old notice", async () => {
  const { createBoardController, emptyBoard } = await modulePromise;
  const gate = deferred();
  let listing = false;
  const controller = createBoardController({
    workspaceRoot: "FIXTURE",
    idFactory: makeId,
    invoke: async (action, payload) => {
      if (action === "listBoards") {
        listing = true;
        await gate.promise;
        return { records: [] };
      }
      if (action !== "snapshot") throw Error(action);
      return {
        board: {
          id: payload.boardId,
          revision: 1,
          value: emptyBoard(payload.boardId),
        },
        messages: [],
        events: [],
        sessions: [],
        runs: [],
        cursor: 0,
        hasMore: false,
      };
    },
  });
  await controller.load("old");
  const resetting = controller.resetFromCanonical();
  while (!listing) await new Promise((resolve) => setImmediate(resolve));
  await controller.load("current");
  gate.resolve();
  await resetting;
  assert.equal(controller.state.record.id, "current");
  assert.equal(controller.state.notice, "");
  assert.equal(controller.state.conflict, false);
  assert.equal(controller.state.missingBoard, false);
});

test("compact edge labels avoid short-gap cards and chat routes use friendly names", async () => {
  const { edgeLabelPosition, friendlyMessageRoute } = await modulePromise;
  const one = agent("one"),
    two = agent("two");
  one.name = "FIXTURE Author";
  two.name = "FIXTURE Reviewer";
  two.position = { x: 280, y: 40 };
  const label = edgeLabelPosition(one, two, [one, two]);
  for (const node of [one, two])
    assert.ok(
      label.y + 4 <= node.position.y || label.y - 14 >= node.position.y + 160,
    );
  assert.equal(
    friendlyMessageRoute(
      { agentId: "one", from: "one", to: "user", role: "assistant" },
      [one, two],
    ),
    "FIXTURE Author → You",
  );
  assert.equal(
    friendlyMessageRoute(
      { agentId: "two", from: "one", to: "two", role: "peer" },
      [one, two],
    ),
    "FIXTURE Author → FIXTURE Reviewer",
  );
  assert.equal(
    friendlyMessageRoute(
      { agentId: "two", from: "user", to: "two", role: "user" },
      [one, two],
    ),
    "You → FIXTURE Reviewer",
  );
  assert.doesNotMatch(
    friendlyMessageRoute(
      { agentId: "one", from: "UUID-hidden", to: "user", role: "assistant" },
      [one, two],
    ),
    /UUID-hidden/,
  );
});

test("forward and backward connection geometry remain visible and finite", async () => {
  const { connectionPath } = await modulePromise,
    a = agent(),
    b = agent("b");
  b.position = { x: 400, y: 200 };
  for (const route of [connectionPath(a, b), connectionPath(b, a)]) {
    assert.match(route.d, /^M /);
    assert.match(route.d, / C /);
    assert.ok(Number.isFinite(route.x));
    assert.ok(Number.isFinite(route.y));
    assert.doesNotMatch(route.d, /NaN|Infinity/);
  }
});

test(
  "actual Chromium renderer: edit, connect, chat, live focus, reset and responsive controls (FIXTURE transport)",
  { timeout: 45000 },
  async () => {
    const http = require("node:http");
    const repo = path.join(__dirname, "..");
    process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(
      repo,
      ".external/playwright-browsers",
    );
    const { chromium } = require("playwright");
    const server = http.createServer((req, res) => {
      const files = {
        "/agent-board.js": ["agent-board.js", "text/javascript"],
        "/agent-board.css": ["assets/agent-board.css", "text/css"],
        "/icons.js": ["icons.js", "text/javascript"],
      };
      if (files[req.url]) {
        const [file, type] = files[req.url];
        res.setHeader("Content-Type", type);
        res.end(fs.readFileSync(path.join(repo, file)));
        return;
      }
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/agent-board.css"><style>body{margin:16px;background:#e8f4ff}main{max-width:1500px;margin:auto}</style></head><body><main id="mount"></main><script src="/icons.js"></script></body></html>',
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    let browser;
    const errors = [];
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({
        viewport: { width: 1366, height: 900 },
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.evaluate(async () => {
        const { mountAgentBoard } = await import("/agent-board.js");
        const fixture = {
          records: [],
          messages: [],
          sessions: [],
          runs: [],
          sequence: 0,
          calls: [],
          listener: null,
        };
        window.fixture = fixture;
        const cp = (v) => JSON.parse(JSON.stringify(v));
        fixture.emit = () =>
          fixture.listener?.({
            domain: "agents",
            type: "event",
            workspaceRoot: "F:\\FIXTURE",
            boardId: fixture.records[0].id,
            sequence: fixture.sequence,
          });
        const invoke = async (action, payload = {}) => {
          fixture.calls.push({ action, payload: cp(payload) });
          if(action==='projectFolderStatus')return {allowed:fixture.folderAllowed===true,exists:true,summary:fixture.folderAllowed?'Fixture folder approved':'Choose this folder again to allow agents to work there.'};
          if (action === "capabilities")
            return {
              providers: ["codex", "claude", "gemini"].map((id) => ({
                id,
                name: id,
                installed: true,
                login: "native-login-not-checked",
                supports: { permissions: ["native"], effort: id !== "gemini" },
              })),
            };
          if (action === "listBoards") return { records: cp(fixture.records) };
          if (action === "listWorkflows") return { records: [] };
          if (action === "validateBoard") return { valid: true };
          if (action === "saveBoard") {
            const i = fixture.records.findIndex(
                (r) => r.id === payload.board.id,
              ),
              prior = fixture.records[i];
            if ((prior?.revision ?? null) !== payload.expectedRevision)
              throw Error("FIXTURE conflict");
            const record = {
              id: payload.board.id,
              revision: (prior?.revision || 0) + 1,
              value: cp(payload.board),
            };
            if (i === -1) fixture.records.push(record);
            else fixture.records[i] = record;
            for (const node of record.value.nodes)
              if (!fixture.sessions.some((s) => s.agentId === node.id))
                fixture.sessions.push({
                  agentId: node.id,
                  generation: 1,
                  status: "idle",
                });
            return { record: cp(record) };
          }
          if (action === "snapshot") {
            const record = fixture.records.find(
              (r) => r.id === payload.boardId,
            );
            if (!record) {
              const error = Error("FIXTURE board not found");
              error.code = "NOT_FOUND";
              throw error;
            }
            const snapshot = {
              board: cp(record),
              sessions: cp(fixture.sessions),
              runs: cp(fixture.runs),
              messages: cp(fixture.messages),
              events: [],
              cursor: fixture.sequence,
              hasMore: false,
            };
            if (fixture.snapshotGate) {
              const gate = fixture.snapshotGate;
              fixture.snapshotGate = null;
              fixture.snapshotStarted = true;
              await gate;
            }
            return snapshot;
          }
          if (action === "send") {
            fixture.messages.push({
              id: crypto.randomUUID(),
              sequence: ++fixture.sequence,
              agentId: payload.agentId,
              from: "user",
              to: payload.agentId,
              role: "user",
              text: payload.text,
              transportInput: payload.text,
              state: "completed",
            });
            fixture.messages.push({
              id: crypto.randomUUID(),
              sequence: ++fixture.sequence,
              agentId: payload.agentId,
              from: payload.agentId,
              to: "user",
              role: "assistant",
              text: "FIXTURE reply Åäö\nFull output preserved.",
              state: "completed",
            });
            fixture.runs.push({
              id: "FIXTURE-run",
              status: "completed",
              acceptance: "UNREVIEWED",
              turns: 1,
            });
            return { runId: "FIXTURE-run" };
          }
          if (action === "runGoal") {
            const board = fixture.records.find(
              (record) => record.id === payload.boardId,
            ).value;
            fixture.taskContext = cp({
              goal: board.goal,
              acceptanceCriteria: board.acceptanceCriteria,
            });
            return { runId: "FIXTURE-all-agent-goal" };
          }
          if (action === "newSession") {
            const session = fixture.sessions.find(
              (s) => s.agentId === payload.agentId,
            );
            if (session.generation !== payload.expectedGeneration)
              throw Error("FIXTURE generation conflict");
            session.generation++;
            return cp(session);
          }
          throw Error("Unexpected FIXTURE renderer action " + action);
        };
        window.fixtureMount = mountAgentBoard(
          document.querySelector("#mount"),
          {
            invoke,
            workspaceRoot: "F:\\FIXTURE",
            chooseProjectFolder:async()=>{fixture.folderAllowed=true;return {path:'F:\\EXTERNAL\\Fixture repository'};},
            onOpenTasks:({host,boardId})=>{fixture.tasksOpened=(fixture.tasksOpened||0)+1;fixture.tasksBoardId=boardId;host.innerHTML='<label>Fixture task draft<textarea name="fixture-task-draft"></textarea></label>';return {destroy(){fixture.tasksDestroyed=(fixture.tasksDestroyed||0)+1;}};},
            onEvent: (callback) => {
              fixture.listener = callback;
              return () => {
                fixture.listener = null;
              };
            },
          },
        );
        fixture.remount = () => {
          fixtureMount.destroy();
          window.fixtureMount = mountAgentBoard(
            document.querySelector("#mount"),
            {
              invoke,
              workspaceRoot: "F:\\FIXTURE",
              onEvent: (callback) => {
                fixture.listener = callback;
                return () => {
                  fixture.listener = null;
                };
              },
            },
          );
        };
      });
      await page.waitForFunction(() =>
        fixture.calls.some((c) => c.action === "capabilities"),
      );
      assert.equal(await page.locator("[data-agent-id]").count(), 0);
      const action = (name) => page.locator(`[data-ab-action="${name}"]`),
        field = (name) => page.locator(`[name="${name}"]`);
      await page.evaluate(()=>fixtureMount.ready);
      assert.equal(await page.locator('.ab-project-node').count(),1,'Default workspace folder is visible without seeding a saved project');
      assert.equal(await page.evaluate(()=>fixture.records.length),0);
      await page.evaluate(()=>fixtureMount.openTasks());
      await field('fixture-task-draft').fill('Unsent task draft stays here');
      await page.locator('[data-ab="task-tools"]').evaluate(el=>el.open=false);
      await action('open-tasks').click();
      assert.equal(await field('fixture-task-draft').inputValue(),'Unsent task draft stays here');
      assert.equal(await page.evaluate(()=>fixture.tasksOpened),1,'Reopening tools does not remount and erase task drafts');
      assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.action==='saveBoard').length),0,'Reading tasks never forces a board save');
      await page.locator('[data-ab="task-tools"]').evaluate(el=>el.open=false);
      await action('add-project').click();
      await field('project-name').fill('Fixture repository folder');
      const projectId=await field('project-selection').inputValue();
      await field('project-x').fill('120');await field('project-y').fill('440');
      await page.locator('.ab-project-node[data-project-id="__workspace__"]').focus();await page.keyboard.press('Alt+ArrowRight');
      assert.equal(await field('project-x').inputValue(),'90','Workspace card supports keyboard movement');
      assert.equal(
        await page.locator(".ab-settings").evaluate((element) => element.open),
        false,
      );
      const initialCanvasTop = await page
        .locator('[data-ab="canvas"]')
        .evaluate((element) => element.getBoundingClientRect().top);
      assert.ok(
        initialCanvasTop < 620,
        "FIXTURE first fold exposes the canvas",
      );
      await action("edit-goal").click();
      await action("add").click();
      await field("agent-name").fill("FIXTURE Writer");
      await field('agent-project').selectOption(projectId);
      assert.match(await page.locator('[data-ab="agent-folder-hint"]').textContent(),/EXTERNAL/);
      await field("board-name").fill("FIXTURE board");
      const first = await field("agent-selection").inputValue();
      await action("add").click();
      await field("agent-name").fill("FIXTURE Reviewer");
      await field("agent-provider").selectOption("claude");
      await field("agent-x").fill("280");
      const second = await field("agent-selection").inputValue();
      await field("edge-source").selectOption(first);
      await field("edge-target").selectOption(second);
      await action("connect").click();
      assert.equal(await page.locator('[data-ab="edges"] g').count(), 1);
      assert.match(
        await page.locator('[data-ab="edges"] g title').textContent(),
        /FIXTURE Writer → FIXTURE Reviewer/,
      );
      assert.equal(
        await page.locator('[data-ab="edges"] text').textContent(),
        "communicates: YES",
      );
      assert.equal(
        await page.evaluate(() => {
          const label = document
            .querySelector('[data-ab="edges"] text')
            .getBoundingClientRect();
          return [...document.querySelectorAll("[data-agent-id]")].every(
            (element) => {
              const node = element.getBoundingClientRect();
              return (
                label.right <= node.left ||
                label.left >= node.right ||
                label.bottom <= node.top ||
                label.top >= node.bottom
              );
            },
          );
        }),
        true,
        "FIXTURE short-gap label never covers either card",
      );
      await action("save").click();
      await require("../scripts/board-save-helper.cjs").completeBoardSave(page);
      await page.waitForFunction(
        () =>
          fixture.records.length === 1 &&
          document.querySelector('[data-ab="revision"]').textContent ===
            "Revision 1",
      );
      assert.equal(await page.evaluate(()=>fixture.records[0].value.projects[0].name),'Fixture repository folder');
      assert.equal(await page.evaluate(()=>fixture.records[0].value.nodes[0].projectId),projectId);
      assert.equal(await page.evaluate(()=>fixture.records[0].value.view.workspacePosition.x),90);
      assert.equal(await page.locator('[data-ab="project-links"] g').count(),2);
      assert.match(await page.locator('[data-ab="project-links"]').textContent(),/works in/);
      await field('project-selection').selectOption(projectId);
      await action('project-disconnect').click();
      await field('agent-selection').selectOption(first);
      assert.equal(await field('agent-project').inputValue(),'','Disconnect returns assigned agents to current workspace');
      await field('agent-project').selectOption(projectId);
      await page.evaluate(()=>{fixture.folderAllowed=false;});
      await action('refresh').click();
      await page.waitForFunction(()=>document.querySelector('.ab-project-node:not([data-project-id="__workspace__"]) .ab-project-access').textContent.includes('Choose this folder again'));
      await page.locator('.ab-project-node:not([data-project-id="__workspace__"]) [data-ab-action="project-approve"]').click();
      await page.waitForFunction(()=>document.querySelector('.ab-project-node:not([data-project-id="__workspace__"]) .ab-project-access').textContent.includes('approved'));
      await page.locator('.ab-project-editor [data-ab-action="project-remove"]').click();
      await action('confirm').click();
      assert.equal(await page.locator('.ab-project-node').count(),1,'Removing folder retains the workspace card');
      assert.equal(await field('agent-project').inputValue(),'','Removing folder unassigns agents without an automatic session reset');
      assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.action==='newSession').length),0);
      await field('agent-selection').selectOption(second);
      assert.equal(await field("goal-starter").inputValue(), "");
      assert.equal(
        await field("goal-starter").locator("option:checked").textContent(),
        "All agents",
      );
      const originalGoal =
        "FIXTURE shared goal Åäö 漢字 👩🏽‍💻\nKeep the full goal.";
      const originalCriteria =
        "FIXTURE criteria Åäö\nPreserve Unicode 漢字 and complete evidence.";
      await field("board-goal").fill(originalGoal);
      await field("board-criteria").fill(originalCriteria);
      await action("goal").click();
      await page.waitForFunction(() =>
        fixture.calls.some((call) => call.action === "runGoal"),
      );
      assert.deepEqual(
        await page.evaluate(
          () =>
            fixture.calls.find((call) => call.action === "runGoal").payload
              .agentIds,
        ),
        [first, second],
      );
      await field("chat-message").fill("FIXTURE exact message\nÅäö");
      await page.locator('[data-ab="compose"] button').click();
      await page.waitForFunction(() =>
        document
          .querySelector('[data-ab="transcript"]')
          .textContent.includes("FIXTURE reply Åäö"),
      );
      assert.match(
        await page.locator('[data-ab="run-status"]').textContent(),
        /completed.*UNREVIEWED/,
      );
      assert.match(
        await page
          .locator('.ab-message[data-role="assistant"]>header')
          .textContent(),
        /FIXTURE Reviewer → You/,
      );
      const manual = page.locator('.ab-message[data-role="user"]').first();
      assert.equal(
        await manual.locator(".ab-message-body").textContent(),
        "FIXTURE exact message\nÅäö",
      );
      assert.equal(
        await manual.locator(".ab-message-context").isVisible(),
        false,
      );
      await manual.locator(".ab-message-transport summary").click();
      assert.equal(
        await manual.locator(".ab-message-transport pre").textContent(),
        "FIXTURE exact message\nÅäö",
      );
      await field("chat-message").fill("FIXTURE unsent draft remains focused");
      await field("chat-message").focus();
      await page.evaluate(() => {
        window.fixtureNode = document.querySelector("[data-agent-id]");
        fixture.messages.push({
          id: "FIXTURE-context-peer",
          sequence: ++fixture.sequence,
          agentId: fixture.records[0].value.nodes[1].id,
          role: "peer",
          from: fixture.records[0].value.nodes[0].id,
          to: fixture.records[0].value.nodes[1].id,
          text: "FIXTURE visible live peer message Åäö 漢字\nTerse response without requirements.",
          taskContext: JSON.parse(JSON.stringify(fixture.taskContext)),
          state: "queued",
        });
        fixture.emit();
      });
      await page.waitForFunction(() =>
        document
          .querySelector('[data-ab="transcript"]')
          .textContent.includes("FIXTURE visible live peer message"),
      );
      assert.equal(
        await field("chat-message").inputValue(),
        "FIXTURE unsent draft remains focused",
      );
      assert.equal(
        await page.evaluate(() => document.activeElement.name),
        "chat-message",
      );
      assert.equal(
        await page.evaluate(
          () =>
            window.fixtureNode === document.querySelector("[data-agent-id]"),
        ),
        true,
      );
      const peer = page.locator(
        '.ab-message[data-message-id="FIXTURE-context-peer"]',
      );
      const rawPeerBody =
        "FIXTURE visible live peer message Åäö 漢字\nTerse response without requirements.";
      assert.equal(
        await peer.locator(".ab-message-body").textContent(),
        rawPeerBody,
      );
      assert.match(
        await peer.locator(".ab-message-context summary").textContent(),
        /planned/,
      );
      assert.equal(
        await peer.locator(".ab-message-transport").isVisible(),
        false,
      );
      await peer.locator(".ab-message-context summary").click();
      assert.equal(
        await peer.locator('[data-context="goal"]').textContent(),
        originalGoal,
      );
      assert.equal(
        await peer.locator('[data-context="criteria"]').textContent(),
        originalCriteria,
      );
      assert.match(
        await peer.locator(".ab-message-context p").textContent(),
        /No dispatched input is recorded/,
      );
      await field("board-goal").fill(
        "FIXTURE later unsaved goal must not replace run context",
      );
      await field("board-criteria").fill(
        "FIXTURE later unsaved criteria must not replace run context",
      );
      assert.equal(
        await peer
          .locator('[data-ab-task-context] [data-context="goal"]')
          .textContent(),
        originalGoal,
      );
      assert.equal(
        await peer
          .locator('[data-ab-task-context] [data-context="criteria"]')
          .textContent(),
        originalCriteria,
      );
      await field("chat-message").focus();
      const actualInput = await page.evaluate(() => {
        const message = fixture.messages.find(
          (message) => message.id === "FIXTURE-context-peer",
        );
        fixture.exactTransportInput =
          "[FIXTURE shared task context]\nGoal:\n" +
          message.taskContext.goal +
          "\nAcceptance criteria:\n" +
          message.taskContext.acceptanceCriteria +
          "\n[FIXTURE peer body]\n" +
          message.text;
        message.transportInput = fixture.exactTransportInput;
        message.state = "running";
        fixture.sequence++;
        fixture.emit();
        return fixture.exactTransportInput;
      });
      await page.waitForFunction(
        () =>
          !document.querySelector(
            '.ab-message[data-message-id="FIXTURE-context-peer"] .ab-message-transport',
          ).hidden,
      );
      assert.equal(
        await page.evaluate(() => document.activeElement.name),
        "chat-message",
      );
      assert.equal(
        await field("chat-message").inputValue(),
        "FIXTURE unsent draft remains focused",
      );
      assert.equal(
        await peer
          .locator(".ab-message-context")
          .evaluate((element) => element.open),
        true,
      );
      assert.match(
        await peer.locator(".ab-message-context summary").textContent(),
        /dispatch input recorded/,
      );
      await peer.locator(".ab-message-transport summary").click();
      assert.equal(
        await peer.locator(".ab-message-transport pre").textContent(),
        actualInput,
      );
      assert.equal(
        await peer.locator("[data-ab-transport-input] pre").textContent(),
        actualInput,
      );
      assert.match(
        await peer.locator("[data-ab-transport-input] summary").textContent(),
        /Exact current-turn input/,
      );
      assert.equal(
        await peer.locator(".ab-message-body").textContent(),
        rawPeerBody,
      );
      assert.equal(
        await peer.locator('[data-context="goal"]').textContent(),
        originalGoal,
      );
      assert.equal(
        await peer.locator('[data-context="criteria"]').textContent(),
        originalCriteria,
      );
      await action("new-session").click();
      await action("confirm").click();
      await page.waitForFunction(() => fixture.sessions[1].generation === 2);
      assert.match(
        await page.locator('[data-ab="transcript"]').textContent(),
        /FIXTURE exact message/,
      );
      if (process.env.LVX_AGENT_BOARD_CAPTURE) {
        await page.locator(".ab-settings").evaluate((element) => {
          element.open = false;
        });
        await action("back-to-canvas").click();
        await page.setViewportSize({ width: 1366, height: 900 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: process.env.LVX_AGENT_BOARD_CAPTURE,
          fullPage: false,
        });
      }
      await action("edit-goal").click();
      await field("board-name").fill("FIXTURE unsaved name before restore");
      const beforeRestoreDispatches = await page.evaluate(
        () =>
          fixture.calls.filter((call) =>
            ["send", "runGoal", "resume"].includes(call.action),
          ).length,
      );
      await page.evaluate(() => {
        const record = fixture.records[0],
          agentId = record.value.nodes[1].id;
        record.revision = 1;
        record.value.name = "FIXTURE canonical restored board";
        fixture.sequence = 1;
        fixture.messages = [
          {
            id: "FIXTURE-restored",
            sequence: 1,
            agentId,
            from: record.value.nodes[0].id,
            to: agentId,
            role: "peer",
            text: "FIXTURE restored low cursor",
            state: "interrupted",
          },
        ];
        fixture.listener({
          domain: "agents",
          type: "reset",
          workspaceRoot: "F:\\FIXTURE",
        });
      });
      await page.waitForFunction(() =>
        document
          .querySelector('[data-ab="transcript"]')
          .textContent.includes("FIXTURE restored low cursor"),
      );
      assert.doesNotMatch(
        await page.locator('[data-ab="transcript"]').textContent(),
        /FIXTURE exact message|FIXTURE reply/,
      );
      assert.equal(
        await field("board-name").inputValue(),
        "FIXTURE unsaved name before restore",
      );
      assert.match(
        await page.locator('[data-ab="notice"]').textContent(),
        /draft is preserved/,
      );
      await page.evaluate(() => {
        fixture.snapshotStarted = false;
        fixture.snapshotGate = new Promise((resolve) => {
          fixture.releaseSnapshot = resolve;
        });
        fixture.messages[0].text = "FIXTURE archive A delayed snapshot";
        fixture.listener({
          domain: "agents",
          type: "reset",
          workspaceRoot: "F:\\FIXTURE",
        });
      });
      await page.waitForFunction(() => fixture.snapshotStarted === true);
      await page.evaluate(() => {
        fixture.messages[0].text = "FIXTURE archive B latest snapshot";
        fixture.listener({
          domain: "agents",
          type: "reset",
          workspaceRoot: "F:\\FIXTURE",
        });
        fixture.releaseSnapshot();
      });
      await page.waitForFunction(() =>
        document
          .querySelector('[data-ab="transcript"]')
          .textContent.includes("FIXTURE archive B latest snapshot"),
      );
      assert.doesNotMatch(
        await page.locator('[data-ab="transcript"]').textContent(),
        /archive A delayed/,
      );
      await page.evaluate(() => {
        const record = fixture.records[0],
          agentId = record.value.nodes[1].id;
        fixture.messages.push({
          id: "FIXTURE-after-restore",
          sequence: ++fixture.sequence,
          agentId,
          from: record.value.nodes[0].id,
          to: agentId,
          role: "peer",
          text: "FIXTURE new low sequence event",
          state: "completed",
        });
        fixture.emit();
      });
      await page.waitForFunction(() =>
        document
          .querySelector('[data-ab="transcript"]')
          .textContent.includes("FIXTURE new low sequence event"),
      );
      await page.locator(".ab-settings").evaluate((element) => {
        element.open = false;
      });
      await action("edit-agent").click();
      await action("back-to-canvas").click();
      for (const width of [1964, 1366, 683]) {
        await page.setViewportSize({ width, height: 900 });
        const layout = await page.evaluate(() => {
          const root = document.querySelector(".agent-board");
          const controls = [
            ...root.querySelectorAll(".ab-toolbar>button"),
          ].filter((e) => e.getClientRects().length);
          const clipped = controls
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.left < 0 || r.right > innerWidth + 1;
            })
            .map((e) => e.textContent);
          const overlaps = [];
          for (let i = 0; i < controls.length; i++)
            for (let j = i + 1; j < controls.length; j++) {
              const a = controls[i].getBoundingClientRect(),
                b = controls[j].getBoundingClientRect();
              if (
                a.left < b.right - 1 &&
                a.right > b.left + 1 &&
                a.top < b.bottom - 1 &&
                a.bottom > b.top + 1
              )
                overlaps.push([
                  controls[i].textContent,
                  controls[j].textContent,
                ]);
            }
          return {
            rootWidth: root.clientWidth,
            scrollWidth: root.scrollWidth,
            clipped,
            overlaps,
          };
        });
        assert.ok(
          layout.scrollWidth <= layout.rootWidth + 1,
          `FIXTURE width ${width}: horizontal overflow ${JSON.stringify(layout)}`,
        );
        assert.deepEqual(
          layout.clipped,
          [],
          `FIXTURE width ${width}: clipped controls`,
        );
        assert.deepEqual(
          layout.overlaps,
          [],
          `FIXTURE width ${width}: overlapping controls`,
        );
      }
      assert.deepEqual(errors, []);
      await page.evaluate(() => fixture.remount());
      await page.waitForFunction(
        () =>
          document.querySelector('[name="saved-board"]').options.length === 2,
      );
      await field("saved-board").selectOption(
        await page.evaluate(() => fixture.records[0].id),
      );
      await action("load").click();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-ab="revision"]').textContent ===
          "Revision 1",
      );
      await field("agent-selection").evaluate((element) => {
        element.closest("details").open = true;
        element.closest('.agent-board').classList.add('ab-inspector-open');
      });
      await field("agent-selection").selectOption(second);
      await page.waitForFunction(() =>
        document
          .querySelector('[data-ab="transcript"]')
          .textContent.includes("FIXTURE new low sequence event"),
      );
      assert.equal(
        await page.evaluate(
          () =>
            fixture.calls.filter((call) =>
              ["send", "runGoal", "resume"].includes(call.action),
            ).length,
        ),
        beforeRestoreDispatches,
      );
      assert.equal(
        await page.evaluate(() =>
          fixture.calls.every(
            (call) => call.payload.workspaceRoot === "F:\\FIXTURE",
          ),
        ),
        true,
      );
      await action("edit-goal").click();
      await field("board-name").fill("FIXTURE draft after remote deletion");
      await page.evaluate(() => {
        const survivor = JSON.parse(JSON.stringify(fixture.records[0]));
        survivor.id = "FIXTURE-survivor";
        survivor.value.id = survivor.id;
        survivor.value.name = "FIXTURE surviving board";
        fixture.records = [survivor];
        fixture.messages = [];
        fixture.listener({
          domain: "agents",
          type: "reset",
          workspaceRoot: "F:\\FIXTURE",
        });
      });
      await page.waitForFunction(() =>
        document
          .querySelector('[data-ab="notice"]')
          .textContent.includes("no longer exists"),
      );
      assert.equal(
        await field("board-name").inputValue(),
        "FIXTURE draft after remote deletion",
      );
      assert.equal(
        await field("saved-board")
          .locator('option[value="FIXTURE-survivor"]')
          .count(),
        1,
      );
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        action("export-draft").click(),
      ]);
      const stream = await download.createReadStream();
      let draftText = "";
      for await (const chunk of stream) draftText += chunk.toString();
      assert.match(draftText, /FIXTURE draft after remote deletion/);
      await action("discard").click();
      await action("confirm").click();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-ab="revision"]').textContent ===
          "New board",
      );
      await field("saved-board").selectOption("FIXTURE-survivor");
      await action("load").click();
      await page.waitForFunction(() =>
        document
          .querySelector('[data-ab="goal-readout"]')
          .textContent.includes("FIXTURE surviving board"),
      );
      assert.deepEqual(errors, []);
      await page.evaluate(() => fixtureMount.destroy());
      assert.equal(await page.locator(".agent-board").count(), 0);
    } finally {
      await browser?.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

test('chat ownership geometry uses facing visible edges and canvas-relative coordinates', async () => {
  const {chatOwnershipLine}=await modulePromise;
  assert.deepEqual(chatOwnershipLine({left:0,top:0,width:100,height:100},{left:300,top:0,width:100,height:100},{left:10,top:20}),{x1:90,y1:30,x2:290,y2:30});
  assert.deepEqual(chatOwnershipLine({left:0,top:0,width:100,height:100},{left:200,top:200,width:100,height:100},{left:0,top:0}),{x1:100,y1:100,x2:200,y2:200});
  const moved=chatOwnershipLine({left:-40,top:20,width:200,height:100},{left:700,top:200,width:390,height:410},{left:-100,top:-80});
  assert.ok(Object.values(moved).every(Number.isFinite));
  assert.ok(moved.x1<=260&&moved.x2>=800,'Line reaches actual transformed rectangles, including a panned negative node position');
  const overlap=chatOwnershipLine({left:0,top:0,width:100,height:100},{left:0,top:0,width:100,height:100},{left:0,top:0});
  assert.ok(Object.values(overlap).every(Number.isFinite),'Overlapping centers never produce NaN SVG geometry');
});

test('derived workspace card and optional projects keep legacy boards empty and folder assignments valid', async () => {
  const {emptyBoard,projectCards,validateDraft}=await modulePromise;
  const board=emptyBoard('board');
  assert.equal(Object.hasOwn(board,'projects'),false);
  assert.deepEqual(projectCards(board,'F:\\workspace')[0],{id:'__workspace__',name:'Current workspace',path:'F:\\workspace',position:{x:80,y:360},isWorkspace:true});
  board.nodes.push(agent('a'));board.projects=[{id:'repo',name:'Repository',path:'F:\\repo',position:{x:20,y:500}}];board.nodes[0].projectId='repo';
  assert.deepEqual(validateDraft(board),[]);
  board.nodes[0].projectId='missing';assert.match(validateDraft(board).join(' '),/folder assignment/);
  board.nodes[0].projectId='repo';board.projects.push({...board.projects[0]});assert.match(validateDraft(board).join(' '),/unique/);
  board.projects.pop();board.projects[0].position.x=NaN;assert.match(validateDraft(board).join(' '),/Folder positions/);
});

test('controller preserves folder drafts and history when board save is rejected', async () => {
  const {createBoardController}=await modulePromise;
  const calls=[];const controller=createBoardController({workspaceRoot:'F:\\workspace',invoke:async(action,payload)=>{calls.push(action);if(action==='validateBoard')return {valid:true};if(action==='saveBoard')throw Object.assign(Error('Create a new conversation before moving this agent.'),{code:'SESSION_RESET_REQUIRED'});throw Error('Unexpected fixture action '+action);}});
  controller.edit(board=>{board.name='Folder draft';board.projects=[{id:'repo',name:'Repository',path:'F:\\repo',position:{x:20,y:300}}];board.nodes.push({...agent('a'),projectId:'repo'});});
  await assert.rejects(()=>controller.save(),/new conversation/);
  assert.equal(controller.state.draft.nodes[0].projectId,'repo');assert.equal(controller.state.dirty,true);
  assert.ok(!calls.includes('newSession'),'Folder edits never silently reset conversation identity');
  controller.destroy();
});
