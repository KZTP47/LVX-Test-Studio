'use strict';

const YAML = require('yaml');
const crypto = require('node:crypto');
const graphModel = require('../../github-workflow-model.js');

const own = (o, key) => Object.prototype.hasOwnProperty.call(o, key);
const mapping = o => o !== null && typeof o === 'object' && !Array.isArray(o);
const equal = (a, b) => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every(k => own(b, k) && equal(a[k], b[k]));
};
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function hash(source) { return crypto.createHash('sha256').update(source).digest('hex'); }
function parse(source) {
  if (typeof source !== 'string') fail('SOURCE_LIMIT', 'Workflow source must be text.');
  const tokens = [...new YAML.Parser().parse(source)];
  const docs = [...new YAML.Composer({ version: '1.2', uniqueKeys: true, stringKeys: true, keepSourceTokens: true }).compose(tokens)];
  if (docs.length !== 1) fail('INVALID_YAML', 'Visual editing requires exactly one YAML document.');
  const doc = docs[0];
  if (doc.errors.length) fail('INVALID_YAML', doc.errors.map(e => e.message).join('\n'));
  let data;
  try { data = doc.toJS({ maxAliasCount: -1 }); } catch (error) { fail('AMBIGUOUS_ALIAS', 'YAML aliases could not be safely resolved: ' + error.message); }
  try { JSON.stringify(data); } catch { fail('AMBIGUOUS_ALIAS', 'Cyclic YAML aliases cannot be edited visually.'); }
  if (!YAML.isMap(doc.contents)) fail('INVALID_WORKFLOW', 'Workflow root must be a mapping.');
  return { doc, data, tokens };
}
function at(doc, path) {
  let node = doc.contents;
  for (const key of path) {
    if (YAML.isAlias(node)) fail('AMBIGUOUS_ALIAS', 'This value is a YAML alias. Edit its source explicitly.');
    if (node?.anchor) fail('AMBIGUOUS_ALIAS', 'This value belongs to an anchored container. Edit its source explicitly.');
    if (!node || !YAML.isCollection(node)) return undefined;
    node = node.get(key, true);
  }
  if (YAML.isAlias(node)) fail('AMBIGUOUS_ALIAS', 'This value is a YAML alias. Edit its source explicitly.');
  return node;
}
function editableNode(node) {
  if (!node) return;
  if (node.anchor || YAML.isAlias(node)) fail('AMBIGUOUS_ALIAS', 'Editing an anchored or aliased value could change other consumers. Edit its source explicitly.');
}
function editableSubtree(node) { if (node) YAML.visit(node, (_key, child) => { if (child && typeof child === 'object') editableNode(child); }); }
function dataValue(value) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') fail('INVALID_VALUE', 'Workflow values must be JSON-compatible data.');
  let text;
  try { text = JSON.stringify(value); } catch { fail('INVALID_VALUE', 'Workflow values must be acyclic JSON-compatible data.'); }
  if (text === undefined) fail('SOURCE_LIMIT', 'Workflow value must be JSON-compatible data.');
  return JSON.parse(text);
}
const newline = s => s.includes('\r\n') ? '\r\n' : '\n';
const lineStart = (s, offset) => s.lastIndexOf('\n', offset - 1) + 1;
const indentAt = (s, offset) => offset - lineStart(s, offset);
function splice(source, start, end, replacement) {
  const next = source.slice(0, start) + replacement + source.slice(end);
  parse(next);
  return next;
}
function removeFlowItem(source, collection, astItems, index, start, end) {
  const comma = (index < astItems.length - 1 ? collection.items[index + 1] : collection.items[index]).start.find(t => t.type === 'comma');
  const ranges = [[start, end], ...(comma ? [[comma.offset, comma.offset + comma.source.length]] : [])].sort((a, b) => b[0] - a[0]);
  for (const [from, to] of ranges) source = source.slice(0, from) + source.slice(to);
  parse(source);
  return source;
}
function render(value, indent, nl, flow = false) {
  const doc = new YAML.Document(value);
  if (flow && YAML.isCollection(doc.contents)) doc.contents.flow = true;
  let s = doc.toString({ lineWidth: 0, indent: 2 }).replace(/\n$/, '');
  s = s.replace(/\n/g, nl + ' '.repeat(indent));
  return s;
}
function replaceNode(source, node, value) {
  editableSubtree(node);
  if (equal(node.toJSON(), value)) return source;
  const start = node.range[0], end = node.range[1], nl = newline(source);
  const parsed = parse(source);
  let inFlow = false;
  for (const token of parsed.tokens) if (token.type === 'document') YAML.CST.visit(token, (item, path) => {
    if (item.value?.offset === start) { inFlow = path.length > 0 && YAML.CST.visit.parentCollection(token, path)?.type === 'flow-collection'; return YAML.CST.visit.BREAK; }
  });
  if (YAML.isScalar(node) && typeof value === 'string') {
    // CST scalar updates retain header comments on literal/folded block scripts.
    const { doc, tokens } = parsed;
    let target;
    YAML.visit(doc, (_key, candidate) => { if (YAML.isScalar(candidate) && candidate.range?.[0] === start) target = candidate; });
    let type = node.type;
    const asYaml = YAML.parseDocument(value);
    let plainSafe = false;
    try { plainSafe = !asYaml.errors.length && typeof asYaml.toJS() === 'string' && asYaml.toJS() === value; } catch { /* Alias-like strings require quoting. */ }
    if (type === 'PLAIN' && (value.includes('\n') || !plainSafe)) type = value.includes('\n') && !inFlow ? 'BLOCK_LITERAL' : 'QUOTE_DOUBLE';
    YAML.CST.setScalarValue(target.srcToken, value, { type, afterKey: true, inFlow });
    const normalize = token => { if (!token || typeof token !== 'object') return; for (const [key, child] of Object.entries(token)) { if (key === 'source' && typeof child === 'string' && nl === '\r\n') token[key] = child.replace(/\r?\n/g, '\r\n'); else if (Array.isArray(child)) child.forEach(normalize); else if (child && typeof child === 'object') normalize(child); } };
    normalize(target.srcToken);
    const candidate = tokens.map(YAML.CST.stringify).join('');
    parse(candidate);
    return candidate;
  }
  const flow = inFlow || node.srcToken?.type === 'flow-collection' || YAML.isScalar(node) && value !== null && typeof value === 'object';
  let rendered = render(value, indentAt(source, start), nl, flow);
  // A block scalar's value range owns its terminating newline. Retain that boundary.
  if (source.slice(start, end).endsWith(nl) && !rendered.endsWith(nl)) rendered += nl;
  return splice(source, start, end, rendered);
}
function pairFor(parent, key) { return parent.items.find(pair => String(pair.key?.value) === String(key)); }
function setValue(source, path, value) {
  value = dataValue(value);
  const { doc } = parse(source), parent = path.length ? at(doc, path.slice(0, -1)) : null, node = at(doc, path);
  editableNode(node);
  if (node && equal(node.toJSON(), value)) return source;
  if (YAML.isMap(node) && mapping(value)) {
    // Mutate fields separately so replacing a form value cannot discard unrelated comments.
    for (const pair of node.items) if (!own(value, String(pair.key.value))) source = deleteValue(source, [...path, String(pair.key.value)]);
    for (const [key, item] of Object.entries(value)) source = setValue(source, [...path, key], item);
    return source;
  }
  if (node) return replaceNode(source, node, value);
  if (!YAML.isMap(parent)) fail('INVALID_PATH', 'The target parent must be an existing mapping.');
  editableNode(parent);
  const key = path.at(-1), token = parent.srcToken, nl = newline(source);
  if (token.type === 'flow-collection') {
    const endToken = token.end.find(t => t.type === 'flow-map-end');
    const item = render({ [key]: value }, 0, nl, true).slice(1, -1).trim();
    return splice(source, endToken.offset, endToken.offset, (parent.items.length ? ', ' : ' ') + item + ' ');
  }
  const indent = token.indent, end = parent.range[1];
  const fragment = render({ [key]: value }, indent, nl) + nl;
  const prefix = source.slice(0, end).endsWith('\n') ? '' : nl;
  return splice(source, end, end, prefix + ' '.repeat(indent) + fragment);
}
function deleteValue(source, path) {
  const { doc } = parse(source), parent = at(doc, path.slice(0, -1)), node = at(doc, path);
  if (!node) return source;
  editableNode(parent); editableSubtree(node);
  if (!YAML.isMap(parent)) fail('INVALID_PATH', 'Delete requires a mapping field.');
  const pair = pairFor(parent, path.at(-1)), token = parent.srcToken;
  if (parent.items.length === 1) return replaceNode(source, parent, {});
  if (token.type === 'flow-collection') {
    return removeFlowItem(source, token, parent.items, parent.items.indexOf(pair), pair.key.range[0], node.range[1]);
  }
  let start = lineStart(source, pair.key.range[0]);
  if (start === 0 && source.startsWith('\ufeff')) start = 1;
  const end = node.range[2];
  if (/\S/.test(source.slice(start, pair.key.range[0]))) {
    // First mapping field on a '- key:' line: retain the sequence indicator.
    return splice(source, pair.key.range[0], end, newline(source));
  }
  return splice(source, start, end, '');
}
function stepChange(source, jobId, kind, index, value) {
  const { doc } = parse(source), path = ['jobs', jobId, 'steps'], seq = at(doc, path);
  if (!seq) {
    if (kind !== 'add' || (index !== undefined && index !== 0)) fail('INVALID_STEP', 'This job has no steps.');
    return setValue(source, path, [value]);
  }
  editableNode(seq);
  if (!YAML.isSeq(seq)) fail('INVALID_STEP', 'Job steps must be a sequence.');
  const i = index === undefined ? seq.items.length : index;
  if (!Number.isSafeInteger(i) || i < 0 || i > seq.items.length || (kind !== 'add' && i === seq.items.length)) fail('INVALID_STEP', 'Step index is out of range.');
  const token = seq.srcToken, nl = newline(source);
  if (token.type === 'flow-collection') {
    if (kind === 'add') {
      const end = i === seq.items.length ? token.end.find(t => t.type === 'flow-seq-end').offset : seq.items[i].range[0];
      const fragment = render(value, 0, nl, true);
      return splice(source, end, end, i === seq.items.length ? (i ? ', ' : '') + fragment : fragment + ', ');
    }
    if (seq.items.length === 1) return replaceNode(source, seq, []);
    editableSubtree(seq.items[i]);
    return removeFlowItem(source, token, seq.items, i, seq.items[i].range[0], seq.items[i].range[1]);
  }
  const indent = token.indent;
  const startOf = n => token.items[n].start.find(t => t.type === 'seq-item-ind').offset;
  if (kind === 'delete') {
    editableSubtree(seq.items[i]);
    if (seq.items.length === 1) return replaceNode(source, seq, []);
    return splice(source, lineStart(source, startOf(i)), seq.items[i].range[2], '');
  }
  const end = i === seq.items.length ? seq.range[1] : lineStart(source, startOf(i));
  const fragment = ' '.repeat(indent) + render([value], indent, nl) + nl;
  return splice(source, end, end, (source.slice(0, end).endsWith('\n') ? '' : nl) + fragment);
}
function diagnostic(code, message, path = [], severity = 'error') { return { code, message, path, severity }; }
function inspectWorkflow(source) {
  const contentHash = typeof source === 'string' ? hash(source) : '';
  try {
    const { doc, data } = parse(source), diagnostics = doc.warnings.map(w => diagnostic('YAML_WARNING', w.message, [], 'warning'));
    if (!(typeof data.on === 'string' && data.on.trim()) && !(Array.isArray(data.on) && data.on.length && data.on.every(event => typeof event === 'string' && event.trim())) && !(mapping(data.on) && Object.keys(data.on).length)) diagnostics.push(diagnostic('TRIGGERS_MISSING', 'Workflow needs at least one trigger before publishing.', ['on']));
    if (!mapping(data.jobs)) diagnostics.push(diagnostic('JOBS_MAPPING', 'Workflow needs a jobs mapping.', ['jobs']));
    const jobs = Object.entries(mapping(data.jobs) ? data.jobs : {}).map(([id, value]) => {
      if (!mapping(value)) diagnostics.push(diagnostic('JOB_MAPPING', 'Job ' + id + ' must be a mapping.', ['jobs', id]));
      value = mapping(value) ? value : {};
      const needs = value.needs == null ? [] : Array.isArray(value.needs) ? value.needs : [value.needs];
      if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id)) diagnostics.push(diagnostic('JOB_ID', 'Job ID ' + id + ' is invalid.', ['jobs', id]));
      if (needs.some(n => typeof n !== 'string' || n.includes('${{'))) diagnostics.push(diagnostic('DYNAMIC_NEEDS', 'Job dependencies must be literal job IDs.', ['jobs', id, 'needs']));
      if (value.uses && (value.steps || value['runs-on'])) diagnostics.push(diagnostic('REUSABLE_FIELDS', 'Reusable workflow jobs cannot define steps or runs-on.', ['jobs', id]));
      if (value.uses) { try { parseReusableReference(value.uses, { repository: 'inspection/source', commit: '0'.repeat(40) }); } catch (error) { diagnostics.push(diagnostic('INVALID_REUSABLE', error.message, ['jobs', id, 'uses'])); } }
      if (!value.uses && !value['runs-on']) diagnostics.push(diagnostic('RUNNER_MISSING', 'Job ' + id + ' needs a runner.', ['jobs', id, 'runs-on']));
      const runner = value['runs-on'], labels = candidate => typeof candidate === 'string' ? !!candidate.trim() : Array.isArray(candidate) && candidate.length > 0 && candidate.every(label => typeof label === 'string' && label.trim());
      if (!value.uses && runner && !labels(runner) && !(mapping(runner) && (typeof runner.group === 'string' && runner.group.trim() || labels(runner.labels)))) diagnostics.push(diagnostic('INVALID_RUNNER', 'Runner must be a name, nonempty label array or runner group/labels mapping.', ['jobs', id, 'runs-on']));
      if (!value.uses && (!Array.isArray(value.steps) || !value.steps.length)) diagnostics.push(diagnostic('STEPS_EMPTY', 'Job ' + id + ' needs at least one step before publishing.', ['jobs', id, 'steps']));
      const steps = Array.isArray(value.steps) ? value.steps : [];
      const stepIds = new Set();
      steps.forEach((step, index) => {
        if (!mapping(step) || own(step, 'run') === own(step, 'uses') || (own(step, 'run') ? typeof step.run !== 'string' || !step.run.trim() : typeof step.uses !== 'string' || !step.uses.trim())) diagnostics.push(diagnostic('INVALID_STEP', 'Each step needs exactly one nonempty string run or uses field.', ['jobs', id, 'steps', index]));
        if (mapping(step) && step.id !== undefined) { if (typeof step.id !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(step.id) || stepIds.has(step.id)) diagnostics.push(diagnostic('INVALID_STEP_ID', 'Step IDs must be unique identifiers within a job.', ['jobs', id, 'steps', index, 'id'])); stepIds.add(step.id); }
      });
      return { id, name: String(value.name || id), needs, steps, value, kind: value.uses ? 'Reusable workflow' : value.strategy?.matrix ? 'Matrix job' : 'Job' };
    });
    if (!jobs.length) diagnostics.push(diagnostic('JOBS_EMPTY', 'Add at least one job before publishing.', ['jobs']));
    const ids = new Set(jobs.map(j => j.id)), edges = [];
    for (const job of jobs) for (const n of job.needs) {
      if (!ids.has(n)) diagnostics.push(diagnostic('MISSING_JOB', 'Job ' + job.id + ' needs missing job ' + n + '.', ['jobs', job.id, 'needs']));
      else edges.push({ source: n, target: job.id });
    }
    const incoming = new Map(jobs.map(j => [j.id, 0]));
    for (const edge of edges) incoming.set(edge.target, incoming.get(edge.target) + 1);
    const queue = jobs.filter(j => !incoming.get(j.id)).map(j => j.id), outgoing = new Map();
    for (const edge of edges) { const list = outgoing.get(edge.source) || []; list.push(edge); outgoing.set(edge.source, list); }
    for (let i = 0; i < queue.length; i++) for (const e of outgoing.get(queue[i]) || []) { incoming.set(e.target, incoming.get(e.target) - 1); if (!incoming.get(e.target)) queue.push(e.target); }
    if (queue.length !== jobs.length) diagnostics.push(diagnostic('DEPENDENCY_CYCLE', 'Dependencies contain a cycle.', ['jobs']));
    let graph;
    try { graph = graphModel.workflowGraph(source, YAML.parseDocument); } catch { graph = { nodes: jobs, edges, diagnostics: [] }; }
    const triggers = typeof data.on === 'string' ? [data.on] : Array.isArray(data.on) ? data.on : mapping(data.on) ? Object.keys(data.on) : [];
    return { source, contentHash, name: String(data.name || 'Unnamed workflow'), triggers, jobs, nodes: jobs, edges, diagnostics, editable: true, valid: !diagnostics.some(d => d.severity === 'error'), graph };
  } catch (error) {
    return { source, contentHash, name: 'Invalid workflow', triggers: [], jobs: [], nodes: [], edges: [], diagnostics: [diagnostic(error.code || 'INVALID_YAML', error.message)], editable: false, valid: false, graph: null };
  }
}
function editWorkflow(source, operation, options = {}) {
  if (options.expectedHash && hash(source) !== options.expectedHash) fail('STALE_SOURCE', 'Workflow source changed. Reload before editing.');
  const initial = source;
  const operations = Array.isArray(operation) ? operation : [operation];
  for (const op of operations) {
    if (!mapping(op)) fail('INVALID_OPERATION', 'A workflow operation is required.');
    const beforeSource = source, { doc, data } = parse(source);
    const id = op.jobId ?? op.id, job = mapping(data.jobs) && own(data.jobs, id) ? data.jobs[id] : undefined;
    const requireJob = () => { if (!mapping(job)) fail('MISSING_JOB', 'Choose an existing workflow job.'); at(doc, ['jobs', id]); };
    const update = (path, patch, remove = []) => {
      if (!mapping(patch) || !Array.isArray(remove)) fail('INVALID_OPERATION', 'Patch must be a mapping and remove must be a field list.');
      for (const key of remove) { if (typeof key !== 'string') fail('INVALID_OPERATION', 'Removed fields must be strings.'); source = deleteValue(source, [...path, key]); }
      for (const [key, value] of Object.entries(patch)) source = setValue(source, [...path, key], value);
    };
    if (op.type === 'setWorkflow') update([], op.patch || {}, op.remove);
    else if (op.type === 'addJob') {
      if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id || '')) fail('JOB_ID', 'Use a job ID starting with a letter or underscore.');
      if (job !== undefined) fail('DUPLICATE_JOB', 'A job with this ID already exists.');
      if (!mapping(op.value)) fail('JOB_MAPPING', 'New job must be a mapping.');
      if (!mapping(data.jobs)) source = setValue(source, ['jobs'], {});
      source = setValue(source, ['jobs', id], op.value);
    } else if (op.type === 'updateJob') { requireJob(); update(['jobs', id], op.patch || {}, op.remove); }
    else if (op.type === 'setNeeds') {
      requireJob();
      if (!Array.isArray(op.needs) || op.needs.some(n => typeof n !== 'string') || new Set(op.needs).size !== op.needs.length) fail('INVALID_NEEDS', 'Dependencies must be unique job IDs.');
      for (const need of op.needs) if (need === id || !own(data.jobs, need)) fail(need === id ? 'DEPENDENCY_CYCLE' : 'MISSING_JOB', 'Choose existing dependencies other than the job itself.');
      source = op.needs.length ? setValue(source, ['jobs', id, 'needs'], op.needs) : deleteValue(source, ['jobs', id, 'needs']);
    } else if (op.type === 'deleteJob') {
      requireJob();
      const dependents = Object.entries(data.jobs).filter(([other, value]) => other !== id && (Array.isArray(value?.needs) ? value.needs : [value?.needs]).includes(id));
      if (dependents.length && !op.detach) fail('JOB_REFERENCED', 'Other jobs depend on this job. Select detach dependencies before deleting.');
      for (const [other, value] of dependents) { const needs = (Array.isArray(value.needs) ? value.needs : [value.needs]).filter(n => n !== id); source = needs.length ? setValue(source, ['jobs', other, 'needs'], needs) : deleteValue(source, ['jobs', other, 'needs']); }
      source = deleteValue(source, ['jobs', id]);
    } else if (['addStep', 'updateStep', 'deleteStep'].includes(op.type)) {
      requireJob();
      if (job.uses) fail('REUSABLE_FIELDS', 'Reusable workflow jobs have no inline steps.');
      if (op.type === 'updateStep') {
        if (!Number.isSafeInteger(op.index) || op.index < 0 || !Array.isArray(job.steps) || op.index >= job.steps.length) fail('INVALID_STEP', 'Step index is out of range.');
        const path = ['jobs', id, 'steps', op.index];
        if (op.patch?.run !== undefined && op.patch?.uses === undefined) source = deleteValue(source, [...path, 'uses']);
        if (op.patch?.uses !== undefined && op.patch?.run === undefined) source = deleteValue(source, [...path, 'run']);
        update(path, op.patch || {}, op.remove);
      } else source = stepChange(source, id, op.type === 'addStep' ? 'add' : 'delete', op.index, op.type === 'addStep' ? dataValue(op.value) : undefined);
    } else fail('INVALID_OPERATION', 'Unknown workflow operation: ' + op.type);
    const before = inspectWorkflow(beforeSource), after = inspectWorkflow(source);
    for (const code of ['DEPENDENCY_CYCLE', 'MISSING_JOB', 'DYNAMIC_NEEDS']) {
      const introduced = after.diagnostics.find(d => d.code === code && !before.diagnostics.some(old => old.code === d.code && old.message === d.message && equal(old.path, d.path)));
      if (introduced) fail(code, introduced.message);
    }
  }
  const result = inspectWorkflow(source);
  return { ...result, changed: initial !== source };
}

const { expandMatrix } = require('./matrix.cjs');
function parseReusableReference(uses, { repository, commit } = {}) {
  if (typeof uses !== 'string' || uses.includes('${{') || uses.includes('\\') || /[\x00-\x20\x7f]/.test(uses)) fail('INVALID_REUSABLE', 'Reusable workflow reference must be a literal workflow path.');
  if (/^(?:\.\/|\$\/)\.github\/workflows\/[^/@]+\.ya?ml$/.test(uses)) {
    if (!repository || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(commit || '')) fail('INVALID_REUSABLE', 'Local reusable inspection needs repository and immutable commit.');
    return { repository: graphModel.repositoryName(repository), path: uses.slice(2), ref: commit, local: true, dynamic: false };
  }
  const match = uses.match(/^([^/]+\/[^/]+)\/(\.github\/workflows\/[^/@]+\.ya?ml)@(.+)$/);
  if (!match || match[3].startsWith('refs/')) fail('INVALID_REUSABLE', 'Use owner/repository/.github/workflows/file.yml@ref or a local workflow path.');
  return { repository: graphModel.repositoryName(match[1]), path: match[2], ref: match[3], local: false, dynamic: false };
}

module.exports = { inspectWorkflow, editWorkflow, expandMatrix, parseReusableReference };
