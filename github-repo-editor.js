import { parseDocument, stringify } from './assets/vendor/yaml/index.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fileDirty = file => file.originalContent === null ? !file.isDeleted : file.isDeleted || file.content !== file.originalContent;
const filesOf = repo => (repo.files || []).filter(file => !file.isDeleted);
const button = (action, label, extra = '') => `<button type="button" data-gs="${action}" ${extra}>${esc(label)}</button>`;
const field = (label, name, value = '', type = 'text') => `<label class="gs-field">${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}"></label>`;
const area = (label, name, value = '', rows = 5) => `<label class="gs-field">${esc(label)}<textarea name="${name}" rows="${rows}" spellcheck="false">${esc(value)}</textarea></label>`;
const select = (label, name, choices, value = '') => `<label class="gs-field">${esc(label)}<select name="${name}">${choices.map(([key, title]) => `<option value="${esc(key)}" ${key === value ? 'selected' : ''}>${esc(title)}</option>`).join('')}</select></label>`;
const hashText = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('');
function normalizeRepo(repo) {
  const next = structuredClone(repo);
  next.workflows = filesOf(next).filter(file => file.kind === 'workflow').map(file => ({ path: file.path, source: file.content, sha: file.sha }));
  if (!next.workflows.some(file => file.path === next.selected)) next.selected = next.workflows[0]?.path || '';
  return next;
}

export function rebaseDrafts(previous, snapshot, publishedFiles = []) {
  const published = new Map(publishedFiles.map(file => [file.path, file.content]));
  const files = snapshot.files.map(file => ({ ...file }));
  for (const draft of previous.files.filter(fileDirty)) {
    const localContent = draft.isDeleted ? null : draft.content;
    if (published.has(draft.path) && published.get(draft.path) === localContent) continue;
    const index = files.findIndex(file => file.path === draft.path), baseline = files[index];
    const conflict = !published.has(draft.path) && (baseline?.content ?? null) !== draft.originalContent;
    const retained = { ...draft, originalContent: baseline?.content ?? null, sha: baseline?.sha ?? null, mode: baseline?.mode || draft.mode, ...(conflict ? { conflict: 'The remote baseline changed while this draft was unpublished. Review its source and diff before staging.' } : { conflict: null }) };
    if (index < 0) files.push(retained); else files[index] = retained;
  }
  return normalizeRepo({ ...previous, ...snapshot, files, id: previous.id, example: previous.example, lastPublication: previous.lastPublication });
}

export async function mountRepositoryEditor(host, { repo: initial, call, save, close, isCurrent = () => true }) {
  let repo = structuredClone(initial), active = true, tab = 'workflow', selectedPath = initial.selected, selectedJob = '', selectedCase = '', selectedTest = '', busy = false, unapplied = false;
  let graph = null, discovery = null, testData = null, preview = null, publication = initial.lastPublication || null, runs = null, jobs = null, selectedRun = '', watching = false, pollTimer = null, reusable = null;
  const live = () => active && isCurrent();
  const staged = new Set(initial.stagedPaths || []);
  let publishOptions = { 'publish-mode': 'pr', 'publish-target': initial.ref || 'main', 'publish-branch': 'lvx/review-' + crypto.randomUUID().slice(0, 8), 'publish-message': 'Update workflow and repository tests', 'publish-title': 'Update workflow and repository tests', 'publish-body': '', 'publish-merge': 'squash' };
  let reusableTrail = [];
  let jobsKey = '', reading = false, testDataKey = '';
  const lazy = () => !!repo.sourceScope && repo.sourceScope !== 'complete';
  host.innerHTML = '<section class="gs-editor" aria-label="Repository editing studio"><div class="gs-top"></div><p class="gs-notice" role="status" aria-live="polite"></p><div class="gs-body"><p>Opening saved workflow…</p></div></section>';
  const root = host.firstElementChild, top = root.querySelector('.gs-top'), body = root.querySelector('.gs-body'), notice = root.querySelector('.gs-notice');
  const say = (message, error = false) => { if (live()) { notice.textContent = message; notice.setAttribute('role', error ? 'alert' : 'status'); notice.classList.toggle('gw-error', error); } };
  const value = name => body.querySelector(`[name="${name}"]`)?.value ?? '';
  const checked = name => !!body.querySelector(`[name="${name}"]`)?.checked;
  const selectedFile = () => filesOf(repo).find(file => file.path === selectedPath);
  const api = (action, payload = {}) => call(action, { repository: repo.fullName, fullName: repo.fullName, ref: repo.ref, commit: repo.commit, baseCommit: repo.commit, baseTree: repo.baseTree, ...payload, simulated: !!repo.example });
  async function canLeave(fromOperation = false) { if (busy && !fromOperation && !reading) { say('Wait for the current repository operation to finish.'); return false; } return !unapplied || window.confirm('Discard the changes you have not applied to this repository draft?'); }
  async function work(fn, { readOnly = false } = {}) {
    if (busy || !live()) return;
    busy = true; reading = readOnly; root.setAttribute('aria-busy', 'true');
    const disabled = [...root.querySelectorAll('button,input,textarea,select')].map(control => [control, control.disabled]);
    for (const [control] of disabled) if (!readOnly || control.dataset.gs !== 'back') control.disabled = true;
    try { await fn(); } catch (error) { say(error.message || String(error), true); }
    finally { busy = false; reading = false; root.removeAttribute('aria-busy'); for (const [control, previous] of disabled) if (control.isConnected) control.disabled = previous; }
  }
  async function commit(next, message) {
    next = normalizeRepo(next);
    next.stagedPaths = [...staged].filter(path => next.files.some(file => file.path === path && fileDirty(file)));
    const saved = await save(next);
    if (!live()) return;
    repo = structuredClone(saved || next); preview = null; testData = null; unapplied = false; say(message); await render();
  }
  async function updateFile(path, source, expectedSource) {
    const next = structuredClone(repo), file = next.files.find(file => file.path === path && !file.isDeleted);
    if (!file || (expectedSource !== undefined && file.content !== expectedSource)) throw Error('This file changed. Reopen the current file before applying this edit.');
    file.content = source; staged.delete(path); await commit(next, 'Draft saved. Review and stage the changed file before publishing.');
  }
  async function finishPublication() {
    if (publication.state !== 'complete') return;
    const ref = publication.merged ? publication.targetBranch : publication.branch || publication.targetBranch;
    publication.snapshotPending = true;
    repo.lastPublication = publication;
    await save(repo);
    const snapshot = await api('snapshot', { ref, ...(lazy() ? { paths: repo.files.map(file => file.path) } : {}) });
    if (!live()) return;
    const updated = rebaseDrafts(repo, snapshot, publication.stagedFiles || []);
    publication.snapshotPending = false;
    updated.lastPublication = publication; updated.stagedPaths = [];
    const saved = await save(updated);
    repo = structuredClone(saved || updated); staged.clear(); testData = null;
    publishOptions['publish-target'] = ref;
    publishOptions['publish-branch'] = 'lvx/review-' + crypto.randomUUID().slice(0, 8);
  }
  function paintTop() {
    top.innerHTML = `<div class="gs-title"><h3>${esc(repo.fullName)}</h3><p>${esc(repo.ref)} · ${esc(repo.commit.slice(0, 12))}${repo.example ? ' · Offline example, publishing is simulated' : ''}</p>${button('back', 'Back to repository lanes')}</div><div class="gs-tabs" role="group" aria-label="Repository studio sections">${[['workflow', 'Workflow editor'], ['tests', 'Repository tests'], ['changes', 'Changes & publish'], ['runs', 'GitHub runs']].map(([key, label]) => button('tab', label, `data-tab="${key}" aria-pressed="${tab === key}"`)).join('')}<span>${repo.files.filter(fileDirty).length} changed files</span></div>`;
  }
  async function renderWorkflow() {
    const workflows = filesOf(repo).filter(file => file.kind === 'workflow');
    if (!workflows.some(file => file.path === selectedPath)) selectedPath = workflows[0]?.path || '';
    const file = selectedFile();
    if (!file) { body.innerHTML = `<p>No workflow files. Create a YAML workflow below.</p>${field('Workflow path', 'new-workflow-path', '.github/workflows/checks.yml')}${button('create-workflow', 'Create workflow')}`; return; }
    graph = await api('workflowInspect', { source: file.content }); if (!live()) return;
    if (!graph.editable) {
      body.innerHTML = `${select('Workflow file', 'workflow-path', workflows.map(file => [file.path, file.path]), selectedPath)}<p role="alert">This workflow needs source repair before structured editing.</p><pre>${esc((graph.diagnostics || []).map(item => item.message || item).join('\n'))}</pre>${area('Exact workflow YAML', 'raw-source', file.content, 22)}${button('save-source', 'Apply YAML source')}`;
      return;
    }
    const nodes = graph.jobs || graph.nodes || [];
    if (!nodes.some(job => job.id === selectedJob)) selectedJob = nodes[0]?.id || '';
    const job = nodes.find(job => job.id === selectedJob), jobValue = job?.value || {};
    const diagnosticText = (graph.diagnostics || []).map(item => typeof item === 'string' ? item : item.message).join('\n');
    body.innerHTML = `<div class="gs-tools">${select('Workflow file', 'workflow-path', workflows.map(file => [file.path, file.path]), selectedPath)}${button('new-workflow-form', 'New workflow file')}${button('delete-file', 'Delete workflow file', 'data-kind="workflow"')}${button('source-toggle', 'Edit YAML source')}</div>${diagnosticText ? `<pre class="gw-diagnostics">${esc(diagnosticText)}</pre>` : ''}<div class="gs-workflow-layout"><aside class="gs-job-nav"><h4>Jobs & dependencies</h4>${nodes.map(job => button('job', `${job.name || job.id} · ${job.id}`, `data-job="${esc(job.id)}" aria-pressed="${selectedJob === job.id}"`)).join('')}<div class="gs-add-job">${field('New job ID', 'new-job-id', 'new_check')}${button('add-job', 'Add job')}</div><details><summary>Workflow name and triggers</summary>${field('Workflow name', 'workflow-name', graph.name || '')}${area('Triggers (YAML value; existing filters and inputs stay visible)', 'workflow-on', stringify(parseDocument(file.content).toJS({ maxAliasCount: -1 }).on ?? 'workflow_dispatch'), 8)}${button('save-workflow-settings', 'Apply workflow settings')}</details></aside><section class="gs-job-details" aria-label="Workflow job editor">${job ? `<h4>${esc(job.name || job.id)} <small>${esc(job.kind || 'Job')}</small></h4>${field('Job name', 'job-name', jobValue.name || '')}${jobValue.uses ? `<p>Calls <code>${esc(jobValue.uses)}</code></p>${button('reusable', 'Inspect reusable workflow', `data-uses="${esc(jobValue.uses)}"`)}` : area('Runner (YAML value: text, labels or runner group)', 'job-runner', stringify(jobValue['runs-on'] ?? 'ubuntu-latest'), 3)}${field('Job condition', 'job-condition', jobValue.if ?? '')}<fieldset class="gs-needs"><legend>Run after these jobs</legend>${nodes.filter(other => other.id !== job.id).map(other => `<label><input type="checkbox" name="needs" value="${esc(other.id)}" ${(job.needs || []).includes(other.id) ? 'checked' : ''}>${esc(other.name || other.id)}</label>`).join('') || '<p>No other jobs.</p>'}</fieldset><div class="gs-tools">${button('save-job', 'Apply job changes')}${button('delete-job', 'Delete job')}<label><input type="checkbox" name="detach-job">Detach dependent jobs when deleting</label></div>${jobValue.strategy?.matrix ? `<details class="gs-matrix"><summary>Expand matrix variants</summary>${field('First combination (zero based)', 'matrix-offset', '0')}${field('Combinations per page (0 shows all)', 'matrix-count', '100')}${button('matrix', 'Show matrix combinations')}<div class="gs-matrix-result"></div></details>` : ''}<h4>Steps</h4>${jobValue.uses ? '<p>Steps are defined by the called workflow.</p>' : (jobValue.steps || []).map((step, index) => `<details class="gs-step"><summary>${index + 1}. ${esc(step.name || step.uses || 'Run command')}</summary>${area('Step configuration (YAML mapping)', 'step-' + index, stringify(step), 9)}${button('save-step', 'Apply step', `data-index="${index}"`)}${button('delete-step', 'Delete step', `data-index="${index}"`)}</details>`).join('') + `<details class="gs-step"><summary>Add a step</summary>${area('New step configuration', 'new-step', 'name: Run checks\nrun: npm test\n', 7)}${button('add-step', 'Add step')}</details>`}` : '<p>Add a job to begin.</p>'}</section></div><section class="gs-source-editor" hidden>${area('Exact workflow YAML', 'raw-source', file.content, 22)}${button('save-source', 'Apply YAML source')}</section><div class="gs-reusable"></div><div class="gs-new-workflow" hidden>${field('Workflow path', 'new-workflow-path', '.github/workflows/checks.yml')}${button('create-workflow', 'Create workflow')}</div>`;
  }
  async function renderTests() {
    if (lazy() && !repo.sourceIndex) {
      body.innerHTML = `<p>Workflow editing uses the saved snapshot. Browse repository tests to fetch the file list for this commit. Test source is downloaded only when you select a file.</p>${button('browse-tests', 'Browse repository tests')}`;
      return;
    }
    const files = filesOf(repo).filter(file => file.kind === 'test');
    const deleted = new Set(repo.files.filter(file => file.isDeleted).map(file => file.path));
    const choices = [...new Set([...(repo.sourceIndex || []).filter(file => file.kind === 'test' && !deleted.has(file.path)).map(file => file.path), ...files.map(file => file.path)])].sort();
    if (!choices.includes(selectedTest)) selectedTest = lazy() ? '' : files[0]?.path || '';
    const file = files.find(file => file.path === selectedTest);
    if (!testData || testDataKey !== selectedTest) {
      testData = file ? await api('repositoryTests', { files: repo.files.filter(item => item.kind !== 'test' || item.path === selectedTest) }) : { mapping: { links: [], diagnostics: [] } };
      testDataKey = selectedTest;
    }
    if (!live()) return;
    discovery = file ? await api('discoverTests', { path: file.path, source: file.content, frameworkHint: file.frameworkHint || '' }) : null;
    if (!live()) return;
    const cases = discovery?.cases || [];
    if (!cases.some(item => item.id === selectedCase)) selectedCase = cases.find(item => item.kind === 'case')?.id || cases[0]?.id || '';
    const item = cases.find(item => item.id === selectedCase);
    const bodyRange = item?.bodyRange;
    const bodySource = item?.bodySource ?? (bodyRange && file ? file.content.slice(bodyRange.start, bodyRange.end) : '');
    const links = (testData.mapping?.links || []).filter(link => link.filePath === selectedTest || link.path === selectedTest);
    const diagnostics = [...(discovery?.diagnostics || []), ...(testData.mapping?.diagnostics || [])];
    const frameworks = [['playwright', 'Playwright'], ['vitest', 'Vitest'], ['jest', 'Jest'], ['pytest', 'pytest'], ['unittest', 'unittest'], ['nunit', 'NUnit'], ['xunit', 'xUnit'], ['mstest', 'MSTest'], ['robot', 'Robot Framework']];
    const workflowFiles = filesOf(repo).filter(file => file.kind === 'workflow');
    body.innerHTML = `<div class="gs-tools">${choices.length ? select('Test file', 'test-path', [['', 'Choose a test file'], ...choices.map(path => [path, path])], selectedTest) : '<p>No test source files found.</p>'}${lazy() ? '<p>' + choices.length + ' test files · source loads when selected</p>' : ''}${button('new-test-form', 'Create test file')}${file ? button('delete-file', 'Delete test file', 'data-kind="test"') : ''}</div><div class="gs-test-layout"><aside class="gs-case-nav"><h4>Suites & cases</h4>${cases.map(item => button('case', `${item.kind === 'suite' ? 'Suite: ' : ''}${item.title ?? item.titleExpression ?? 'Dynamic title'}`, `data-case="${esc(item.id)}" aria-pressed="${item.id === selectedCase}"`)).join('') || '<p>No statically recognized test declarations. Inspect the source below.</p>'}${file ? button('new-case-form', 'Add test case') : ''}<details><summary>CI links for this file</summary>${links.length ? links.map(link => `<p><strong>${esc(link.workflowPath)} · ${esc(link.jobId)}</strong><br>${esc(link.confidence || 'inferred')} · ${esc((link.reasons || []).join(' '))}</p>`).join('') : '<p>No static CI command match found. Configuration or dynamic commands may select this file.</p>'}</details></aside><section class="gs-case-details" aria-label="Test case editor">${item ? `<h4>${esc(item.title ?? item.titleExpression ?? 'Dynamic declaration')}</h4><p>${esc(item.framework || discovery.framework || '')}${item.parameterized ? ' · Parameterized source template' : ''}</p>${field('Title / method name', 'case-title', item.title ?? '')}${area('Tags (one per line)', 'case-tags', (item.ownTags || []).join('\n'), 3)}<div class="gs-tools">${button('rename-case', 'Apply title', item.capabilities?.rename === false ? 'disabled' : '')}${button('tags-case', 'Apply tags', item.capabilities?.editTags === false ? 'disabled' : '')}${button('delete-case', 'Delete declaration', item.capabilities?.delete === false ? 'disabled' : '')}</div>${bodyRange ? `${area('Actions and assertions (body source)', 'case-body', bodySource, 12)}${button('body-case', 'Apply actions & assertions', item.capabilities?.editBody === false ? 'disabled' : '')}` : '<p>This declaration has no editable body.</p>'}<details open><summary>Detected assertions and routes</summary>${(item.assertions || []).map((assertion, index) => `<details><summary>Assertion ${index + 1} · ${esc(assertion.kind || 'check')}</summary>${area('Assertion source', 'assertion-' + index, assertion.source || assertion.text || '', 3)}${button('save-assertion', 'Apply assertion', `data-index="${index}" ${item.capabilities?.editBody === false ? 'disabled' : ''}`)}</details>`).join('') || '<p>No static assertion calls identified.</p>'}${(item.steps || []).length ? `<details><summary>Source actions & statements</summary>${item.steps.map((step, index) => `${area('Statement source', 'action-' + index, step.source, 3)}${button('save-action', 'Apply statement', `data-index="${index}" ${item.capabilities?.editBody === false ? 'disabled' : ''}`)}${button('delete-action', 'Delete statement', `data-index="${index}" ${item.capabilities?.editBody === false ? 'disabled' : ''}`)}`).join('')}</details>` : ''}${bodyRange && item.kind === 'case' ? `${area('New action or assertion source', 'append-action', '', 3)}${button('append-action', 'Add action or assertion', item.capabilities?.editBody === false ? 'disabled' : '')}` : ''}${(item.routes || []).map(route => `<p>${esc(route.kind)}: <code>${esc(route.value ?? route.expression ?? '')}</code></p>`).join('')}</details>` : '<p>Choose a test declaration, or add one.</p>'}${file ? `<details class="gs-file-source"><summary>Edit exact test file source</summary>${area('Test source', 'test-source', file.content, 20)}${button('save-test-source', 'Apply test source')}</details>` : ''}</section></div>${diagnostics.length ? `<details><summary>Discovery and linking diagnostics</summary><pre>${esc(diagnostics.map(item => item.message || String(item)).join('\n'))}</pre></details>` : ''}<section class="gs-new-case" hidden><h4>Add a test case</h4>${field('Title / method name', 'add-title', 'new test')}${select('Framework', 'add-framework', frameworks, discovery?.framework || 'playwright')}${select('Add inside suite', 'add-parent', [['', 'Top level'], ...cases.filter(item => item.kind === 'suite').map(item => [item.id, item.title || 'Suite'])], '')}${area('Body source (leave blank for a framework scaffold)', 'add-body', '', 6)}${button('add-case', 'Create case')}</section><section class="gs-new-test" hidden><h4>Create a test file</h4>${field('Repository path', 'create-path', 'tests/new.spec.ts')}${select('Framework', 'create-framework', frameworks, 'playwright')}${field('First test title', 'create-title', 'new check')}${area('Body source (optional)', 'create-body', '', 5)}<label><input type="checkbox" name="wire-test">Add an execution step to a workflow job</label>${select('Workflow to update', 'wire-workflow', workflowFiles.map(file => [file.path, file.path]), selectedPath)}${field('Job ID for the new step', 'wire-job', selectedJob)}<p>Automatic wiring uses a repository-relative path. Review project dependencies, runner setup and the resulting diff.</p>${button('create-test-file', 'Create file & optional CI step')}</section>`;
  }
  async function renderChanges() {
    const changes = repo.files.filter(fileDirty);
    body.innerHTML = `<h4>Review repository changes</h4><p>Original snapshot: <code>${esc(repo.commit)}</code>. Select complete files to stage. Edits invalidate the previous publish preview.</p><ul class="gs-change-list">${changes.map(file => `<li><label><input type="checkbox" data-stage="${esc(file.path)}" ${staged.has(file.path) ? 'checked' : ''}>${esc(file.path)} ${file.conflict ? `<span role="alert">${esc(file.conflict)}</span>${button('resolve-conflict', 'Mark conflict reviewed', `data-path="${esc(file.path)}"`)}` : ''}<strong>${file.isDeleted ? 'Deleted' : file.originalContent === null ? 'Added' : 'Modified'}</strong></label>${button('reset-file', 'Discard file changes', `data-path="${esc(file.path)}"`)}</li>`).join('') || '<li>No changes to publish.</li>'}</ul><div class="gs-publish-options">${select('Publish mode', 'publish-mode', [['pr', 'New branch and pull request'], ['merge', 'New branch, pull request, then merge'], ['direct', 'Commit directly to target branch']], 'pr')}${field('Target branch', 'publish-target', repo.ref || 'main')}${field('New review branch', 'publish-branch', 'lvx/review-' + crypto.randomUUID().slice(0, 8))}${field('Commit message', 'publish-message', 'Update workflow and repository tests')}${field('Pull request title', 'publish-title', 'Update workflow and repository tests')}${area('Pull request description', 'publish-body', '', 3)}${select('Merge method', 'publish-merge', [['squash', 'Squash'], ['merge', 'Merge commit'], ['rebase', 'Rebase']], 'squash')}</div>${button('preview', repo.example ? 'Preview simulated publication' : 'Prepare publish preview', !changes.length ? 'disabled' : '')}<section class="gs-publish-preview"></section>${publication ? publicationMarkup(publication) : ''}`;
    for (const [name, option] of Object.entries(publishOptions)) { const control = body.querySelector(`[name="${name}"]`); if (control) control.value = option; }
    if (preview) paintPreview();
  }
  function publicationMarkup(result) {
    const safeUrl = !result.simulated && /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/pull\/\d+$/.test(result.prUrl || '') ? result.prUrl : '';
    return `<section class="gs-publication" aria-label="Publication result"><h4>${result.simulated ? 'Simulated publication' : 'Publication'}: ${esc(result.state)}</h4><p>Phase: ${esc(result.phase)} · ${result.merged ? 'Merged' : 'Not merged'}</p>${result.branch ? `<p>Branch: <code>${esc(result.branch)}</code></p>` : ''}${result.commitSha ? `<p>Commit: <code>${esc(result.commitSha)}</code></p>` : ''}${safeUrl ? `<p><a href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer">Open pull request</a></p>` : result.prNumber ? `<p>Pull request #${result.prNumber}${result.simulated ? ' (offline example)' : ''}</p>` : ''}${result.error ? `<p role="alert">${esc(typeof result.error === 'string' ? result.error : result.error.message)}</p>` : ''}${result.state !== 'complete' || result.snapshotPending ? button('recover', 'Check publication outcome') : ''}</section>`;
  }
  function paintPreview() {
    const target = body.querySelector('.gs-publish-preview'); if (!target || !preview) return;
    target.innerHTML = `<h4>${preview.simulated ? 'Offline simulation' : 'GitHub publication'} — review before publishing</h4><p>${esc(preview.repository)} · ${esc(preview.baseCommit)} → ${esc(preview.targetBranch)} · ${esc(preview.mode)}</p><p>${preview.changes.length} staged files. All selected additions, updates and deletions are included in one commit.</p><pre class="gs-diff">${esc(preview.diff || preview.changes.map(change => change.diff || change.path).join('\n'))}</pre><label><input type="checkbox" name="confirm-publish">I reviewed these exact files, destination and diff.</label>${button('publish', preview.simulated ? 'Publish to offline example' : 'Publish reviewed changes')}`;
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!watching || !live() || tab !== 'runs') return;
    pollTimer = setTimeout(() => { if (document.hidden || busy) schedulePoll(); else void work(fetchRuns); }, Math.max(15000, Number(runs?.pollAfter || 30) * 1000));
  }
  async function fetchRuns() {
    try {
      const result = await api('listRuns', { workflowPath: selectedPath || repo.selected, expectedCommit: repo.commit });
      if (!live()) return;
      runs = result;
      const selected = (runs.runs || []).find(run => String(run.id) === selectedRun);
      if (selectedRun && !selected) { selectedRun = ''; jobs = null; jobsKey = ''; }
      if (selected) {
        const key = selectedRun + ':' + selected.attempt + ':' + selected.status + ':' + selected.conclusion;
        if (jobsKey !== key || selected.status !== 'completed') { jobs = await api('runJobs', { runId: Number(selectedRun), attempt: selected.attempt || 1 }); jobsKey = key; }
      }
      if (live() && tab === 'runs') paintRuns();
    } finally {
      clearTimeout(pollTimer);
      schedulePoll();
    }
  }
  function paintRuns() {
    body.innerHTML = `<h4>GitHub runs for this snapshot</h4><p>Only runs matching commit <code>${esc(repo.commit)}</code> are listed. Runtime job names may differ from YAML job IDs, so results are listed separately.</p><div class="gs-tools">${button('refresh-runs', 'Refresh runs')}${button('watch-runs', watching ? 'Stop watching runs' : 'Watch runs while this view is open')}</div>${runs ? `<p>Observed ${esc(runs.observedAt || '')}${runs.simulated ? ' · Offline example' : ''}</p>${(runs.runs || []).length ? select('Run and attempt', 'run-select', [['', 'Choose a run'], ...(runs.runs || []).map(run => [String(run.id), `${run.name || run.id} · ${run.status} · ${run.conclusion || 'no conclusion'} · attempt ${run.attempt || 1}`])], selectedRun) : '<p>No matching runs found. This is not a passing result.</p>'}` : '<p>Refresh to fetch run results.</p>'}${jobs ? `<ul class="gs-runtime-jobs">${(jobs.jobs || []).map(job => `<li><strong>${esc(job.name)}</strong> — ${esc(job.status)} / ${esc(job.conclusion || 'pending')}<details><summary>Runtime steps</summary>${(job.steps || []).map(step => `<p>${esc(step.name)} — ${esc(step.status)} / ${esc(step.conclusion || 'pending')}</p>`).join('')}</details></li>`).join('')}</ul>` : ''}`;
  }
  async function render() {
    if (!live()) return; paintTop();
    if (tab === 'workflow') await renderWorkflow();
    else if (tab === 'tests') await renderTests();
    else if (tab === 'changes') await renderChanges();
    else paintRuns();
  }
  function parseValue(source) { const doc = parseDocument(source, { uniqueKeys: true, stringKeys: true }); if (doc.errors.length) throw Error(doc.errors[0].message); return doc.toJS({ maxAliasCount: -1 }); }
  async function workflowEdit(operation) {
    const file = selectedFile(); if (!file) throw Error('Choose a workflow file.');
    const edited = await api('workflowEdit', { source: file.content, expectedHash: await hashText(file.content), operation });
    await updateFile(file.path, edited.source, file.content);
  }
  async function editCase(operation) {
    const file = filesOf(repo).find(file => file.path === selectedTest); if (!file) throw Error('Choose a test file.');
    const edited = await api('editTest', { path: file.path, source: file.content, caseId: selectedCase, expectedHash: discovery.fingerprint || discovery.sourceHash || await hashText(file.content), frameworkHint: file.frameworkHint || '', operation });
    selectedCase = ''; await updateFile(file.path, edited.source, file.content);
  }
  root.oninput = event => {
    const control = event.target;
    if (control.name?.startsWith('publish-')) { publishOptions[control.name] = control.value; preview = null; body.querySelector('.gs-publish-preview')?.replaceChildren(); return; }
    if (control.matches('input,textarea,select') && !control.matches('[data-stage],[name="confirm-publish"],[name="workflow-path"],[name="test-path"],[name="run-select"],[name^="matrix-"]')) unapplied = true;
  };
  root.onchange = event => {
    const target = event.target;
    if (target.dataset.stage) {
      if (target.checked) staged.add(target.dataset.stage); else staged.delete(target.dataset.stage);
      preview = null; body.querySelector('.gs-publish-preview')?.replaceChildren();
      void work(() => commit(structuredClone(repo), 'Staging selection saved.')); return;
    }
    if (target.name === 'workflow-path' || target.name === 'test-path') void work(async () => {
      if (!await canLeave(true)) { target.value = target.name === 'workflow-path' ? selectedPath : selectedTest; return; }
      if (target.name === 'workflow-path') { selectedPath = target.value; selectedJob = ''; }
      else {
        const previous = selectedTest; selectedTest = target.value; selectedCase = '';
        if (selectedTest && !filesOf(repo).some(file => file.path === selectedTest)) {
          say('Loading ' + selectedTest + ' from the saved commit…');
          try {
            const source = await api('sourceFile', { path: selectedTest });
            if (!live()) return;
            if (source.commit !== repo.commit || source.file?.path !== selectedTest) throw Error('The returned test source does not match this snapshot.');
            const next = structuredClone(repo); next.baseTree = source.baseTree;
            if (!next.files.some(file => file.path === selectedTest)) next.files.push(source.file);
            unapplied = false; await commit(next, 'Test source loaded and cached in this project.'); return;
          } catch (error) { selectedTest = previous; if (target.isConnected) target.value = previous; throw error; }
        }
      }
      unapplied = false; await render();
    }, { readOnly: target.name === 'test-path' });
    if (target.name === 'run-select') { selectedRun = target.value; void work(async () => { const selected = (runs.runs || []).find(run => String(run.id) === selectedRun), attempt = selected?.attempt || 1; jobs = selectedRun ? await api('runJobs', { runId: Number(selectedRun), attempt }) : null; jobsKey = selectedRun + ':' + attempt + ':' + selected?.status + ':' + selected?.conclusion; if (live()) paintRuns(); }); }
    if (target.name?.startsWith('publish-')) { publishOptions[target.name] = target.value; preview = null; body.querySelector('.gs-publish-preview')?.replaceChildren(); }
  };
  root.onclick = event => {
    const target = event.target.closest('[data-gs]'); if (!target) return; event.stopPropagation();
    const action = target.dataset.gs;
    if (action === 'back') { void (async () => { if (await canLeave()) { watching = false; clearTimeout(pollTimer); await close(); } })().catch(error => say(error.message, true)); return; }
    void work(async () => {
      if (action === 'browse-tests') {
        say('Loading the test file list for this commit…');
        const index = await api('sourceIndex');
        if (!live()) return;
        if (index.commit !== repo.commit) throw Error('The returned file list does not match this snapshot.');
        await commit({ ...repo, baseTree: index.baseTree, sourceIndex: index.entries, skipped: index.skipped }, 'Repository test list loaded. Choose a file to download its source.');
        return;
      }
      if (action === 'tab') { if (!await canLeave(true)) return; unapplied = false; tab = target.dataset.tab; if (tab !== 'runs') { watching = false; clearTimeout(pollTimer); } await render(); return; }
      if (action === 'job' || action === 'case') { if (!await canLeave(true)) return; unapplied = false; if (action === 'job') selectedJob = target.dataset.job; else selectedCase = target.dataset.case; await render(); return; }
      if (action === 'source-toggle') { const editor = body.querySelector('.gs-source-editor'); editor.hidden = !editor.hidden; return; }
      if (action === 'new-workflow-form') { body.querySelector('.gs-new-workflow').hidden = false; return; }
      if (action === 'new-test-form' || action === 'new-case-form') { body.querySelector(action === 'new-test-form' ? '.gs-new-test' : '.gs-new-case').hidden = false; return; }
      if (action === 'save-source') { const source = value('raw-source'), inspected = await api('workflowInspect', { source }); if (!inspected.editable) throw Error('Fix YAML source before applying: ' + (inspected.diagnostics || []).map(item => item.message || item).join(' ')); await updateFile(selectedPath, source, selectedFile().content); return; }
      if (action === 'save-test-source') { const file = filesOf(repo).find(file => file.path === selectedTest), source = value('test-source'); const result = await api('discoverTests', { path: file.path, source, frameworkHint: file.frameworkHint || '' }); if ((result.diagnostics || []).some(item => item.severity === 'error')) throw Error(result.diagnostics.filter(item => item.severity === 'error').map(item => item.message).join('\n')); await updateFile(file.path, source, file.content); return; }
      if (action === 'create-workflow') { const path = value('new-workflow-path').trim(); if (!/^\.github\/workflows\/[^/\\]+\.ya?ml$/i.test(path)) throw Error('Use a .yml or .yaml file directly inside .github/workflows.'); if (repo.files.some(file => file.path.toLowerCase() === path.toLowerCase())) throw Error('That workflow path already exists.'); const next = structuredClone(repo); next.files.push({ path, content: 'name: New workflow\non: workflow_dispatch\njobs: {}\n', originalContent: null, sha: null, kind: 'workflow', mode: '100644' }); selectedPath = path; await commit(next, 'New workflow draft saved. Add a job before publishing.'); return; }
      if (action === 'add-job') { selectedJob = value('new-job-id').trim(); await workflowEdit({ type: 'addJob', id: selectedJob, value: { 'runs-on': 'ubuntu-latest', steps: [{ name: 'Run checks', run: 'npm test' }] } }); return; }
      if (action === 'save-workflow-settings') { await workflowEdit({ type: 'setWorkflow', patch: { name: value('workflow-name'), on: parseValue(value('workflow-on')) } }); return; }
      if (action === 'save-job') { const job = (graph.jobs || graph.nodes).find(job => job.id === selectedJob), needs = [...body.querySelectorAll('[name="needs"]:checked')].map(field => field.value), condition = value('job-condition'); const patch = { name: value('job-name'), needs, ...(job.value.uses ? {} : { 'runs-on': parseValue(value('job-runner')) }), ...(condition ? { if: condition } : {}) }; await workflowEdit({ type: 'updateJob', id: selectedJob, patch, remove: condition ? [] : ['if'] }); return; }
      if (action === 'delete-job') { if (!window.confirm('Delete job ' + selectedJob + '? Review dependent jobs before publishing.')) return; await workflowEdit({ type: 'deleteJob', id: selectedJob, detach: checked('detach-job') }); return; }
      if (action === 'add-step') { await workflowEdit({ type: 'addStep', jobId: selectedJob, value: parseValue(value('new-step')) }); return; }
      if (action === 'save-step') { const index = Number(target.dataset.index), patch = parseValue(value('step-' + index)), currentStep = (graph.jobs || graph.nodes).find(job => job.id === selectedJob).value.steps[index]; await workflowEdit({ type: 'updateStep', jobId: selectedJob, index, patch, remove: Object.keys(currentStep).filter(key => !Object.hasOwn(patch, key)) }); return; }
      if (action === 'delete-step') { await workflowEdit({ type: 'deleteStep', jobId: selectedJob, index: Number(target.dataset.index) }); return; }
      if (action === 'matrix' || action === 'matrix-next') { const job = (graph.jobs || graph.nodes).find(job => job.id === selectedJob), result = await api('matrix', { matrix: job.value.strategy.matrix, offset: action === 'matrix-next' ? target.dataset.offset : value('matrix-offset'), limit: Number(value('matrix-count')) }); body.querySelector('.gs-matrix-result').innerHTML = `<p>${esc(result.total ?? 'Unknown total')} combinations${result.truncated ? ' · more combinations available' : ''}${result.dynamic ? ' · contains unresolved expressions' : ''}</p><pre>${esc(JSON.stringify(result.combinations, null, 2))}</pre>${result.nextOffset ? button('matrix-next', 'Next combinations', 'data-offset="' + esc(result.nextOffset) + '"') : ''}<p>${esc((result.diagnostics || []).map(item => item.message || item).join(' '))}</p>`; return; }
      if (action === 'reusable' || action === 'nested-reusable') {
        if (action === 'reusable') reusableTrail = [repo.fullName + '@' + repo.commit + ':' + selectedPath];
        const uses = target.dataset.uses, caller = action === 'nested-reusable' ? reusable : { repository: repo.fullName, commit: repo.commit };
        const local = /^[$.]\//.test(uses), path = uses.slice(2);
        if (local && caller.repository === repo.fullName && caller.commit === repo.commit && filesOf(repo).some(file => file.path === path)) {
          const file = filesOf(repo).find(file => file.path === path); reusable = { source: file.content, path, repository: repo.fullName, commit: repo.commit, draft: fileDirty(file) };
        } else reusable = await api('inspectReusable', { repository: caller.repository, fullName: caller.repository, commit: caller.commit, uses });
        const key = reusable.repository + '@' + reusable.commit + ':' + reusable.path;
        if (reusableTrail.includes(key)) throw Error('Reusable workflow cycle detected at ' + reusable.path + '.');
        reusableTrail.push(key);
        const source = reusable.source ?? reusable.content, inspected = await api('workflowInspect', { source });
        const region = body.querySelector('.gs-reusable');
        region.innerHTML = '<h4>Reusable workflow · ' + esc(reusable.repository) + ' · ' + esc(reusable.path) + '</h4><p>' + esc(reusable.commit) + (reusable.draft ? ' · Local draft' : '') + ' · Read-only inspection</p><pre>' + esc(source) + '</pre>' + (inspected.jobs || inspected.nodes || []).filter(job => job.value.uses).map(job => button('nested-reusable', 'Inspect ' + job.value.uses, 'data-uses="' + esc(job.value.uses) + '"')).join('');
        region.scrollIntoView({ block: 'nearest' }); return;
      }
      if (action === 'save-assertion' || action === 'save-action' || action === 'delete-action') { const index = Number(target.dataset.index); await editCase({ type: action === 'save-assertion' ? 'assertion' : 'step', index, source: action === 'delete-action' ? '' : value((action === 'save-assertion' ? 'assertion-' : 'action-') + index) }); return; }
      if (action === 'append-action') { const item = discovery.cases.find(item => item.id === selectedCase), addition = value('append-action'); if (!addition.trim()) throw Error('Enter an action or assertion to add.'); await editCase({type:'body',bodySource:(item.bodySource || '').trimEnd() + '\n' + addition}); return; }
      if (action === 'rename-case') { await editCase({ type: 'rename', caseId: selectedCase, title: value('case-title') }); return; }
      if (action === 'tags-case') { await editCase({ type: 'tags', caseId: selectedCase, tags: value('case-tags').split(/[\r\n,]+/).map(value => value.trim()).filter(Boolean) }); return; }
      if (action === 'body-case') { await editCase({ type: 'body', caseId: selectedCase, bodySource: value('case-body') }); return; }
      if (action === 'delete-case') { if (window.confirm('Delete this test declaration? Shared imports, helpers and neighboring tests are retained.')) await editCase({ type: 'delete', caseId: selectedCase }); return; }
      if (action === 'add-case') { await editCase({ type: 'add', parentId: value('add-parent') || null, framework: value('add-framework'), title: value('add-title'), bodySource: value('add-body') || undefined, tags: [] }); return; }
      if (action === 'create-test-file') { const path = value('create-path').trim(), wireFile = filesOf(repo).find(file => file.path === value('wire-workflow')); const result = await api('createTestFile', { path, paths: [...repo.files, ...(repo.sourceIndex || [])].map(file => file.path), framework: value('create-framework'), title: value('create-title'), bodySource: value('create-body') || undefined, ...(checked('wire-test') ? { wire: { path: wireFile.path, source: wireFile.content, jobId: value('wire-job') } } : {}) }); const next = structuredClone(repo); for (const file of result.files) { const existing = next.files.find(item => item.path === file.path); if (existing) { if (file.expectedSource !== undefined && existing.content !== file.expectedSource) throw Error('Workflow changed while creating the test file.'); existing.content = file.content; } else next.files.push(file); staged.delete(file.path); } selectedTest = path; await commit(next, 'Test file and requested workflow step saved together as drafts.'); return; }
      if (action === 'delete-file') { const path = target.dataset.kind === 'test' ? selectedTest : selectedPath; if (!window.confirm('Delete ' + path + ' from the repository draft? CI references will be shown for review.')) return; const next = structuredClone(repo), file = next.files.find(file => file.path === path); if (file.originalContent === null) next.files = next.files.filter(file => file.path !== path); else file.isDeleted = true; staged.delete(path); await commit(next, 'File deletion saved as a draft. Review CI references in the diff.'); return; }
      if (action === 'resolve-conflict') { const next = structuredClone(repo), file = next.files.find(file => file.path === target.dataset.path); if (!window.confirm('Have you compared the retained draft against its new remote baseline? Marking it reviewed allows staging.')) return; file.conflict = null; await commit(next, 'Remote baseline conflict marked reviewed.'); return; }
      if (action === 'reset-file') { if (!window.confirm('Discard changes to ' + target.dataset.path + '?')) return; const next = structuredClone(repo), file = next.files.find(file => file.path === target.dataset.path); if (file.originalContent === null) next.files = next.files.filter(item => item.path !== file.path); else { file.content = file.originalContent; file.isDeleted = false; } staged.delete(file.path); await commit(next, 'File restored to its imported source.'); return; }
      if (action === 'preview') { const paths = [...staged].filter(path => repo.files.some(file => file.path === path && fileDirty(file))); if (!paths.length) throw Error('Select at least one changed file to stage.'); preview = await api('previewStage', { files: repo.files, stagedPaths: paths, targetBranch: value('publish-target'), newBranch: value('publish-branch'), mode: value('publish-mode'), message: value('publish-message'), title: value('publish-title'), body: value('publish-body'), mergeMethod: value('publish-merge') }); unapplied = false; paintPreview(); say('Review the exact diff and destination before publishing.'); return; }
      if (action === 'publish') {
        if (!preview || !checked('confirm-publish')) throw Error('Review the diff and check its confirmation before publishing.');
        const receipt = { operationId: crypto.randomUUID(), previewId: preview.previewId, state: 'pending', phase: 'awaiting response', simulated: !!repo.example, targetBranch: preview.targetBranch, stagedFiles: preview.changes.map(file => ({ path: file.path, content: file.content })) };
        publication = receipt; repo.lastPublication = receipt;
        await save(repo);
        try { publication = { ...receipt, ...await api('publish', { previewId: preview.previewId, operationId: receipt.operationId }) }; }
        catch (error) { publication = { ...receipt, state: 'unknown', error: error.message }; }
        repo.lastPublication = publication; await save(repo);
        say((publication.simulated ? 'Simulated publication' : 'Publication') + ': ' + publication.state + '.', publication.state !== 'complete');
        try { await finishPublication(); } catch (error) { say('Publication result saved. Check its outcome to refresh the snapshot: ' + error.message, true); }
        preview = null; unapplied = false; await render(); return;
      }
      if (action === 'recover') {
        if (!publication?.operationId) throw Error('No publication operation is available.');
        if (publication.state !== 'complete') publication = { ...publication, ...await api('reconcile', { operationId: publication.operationId }) };
        repo.lastPublication = publication; await save(repo); await finishPublication(); say((publication.simulated ? 'Simulated publication' : 'Publication') + ': ' + publication.state + '.', publication.state !== 'complete'); await render(); return;
      }
      if (action === 'refresh-runs') { await fetchRuns(); return; }
      if (action === 'watch-runs') { watching = !watching; if (watching) await fetchRuns(); else { clearTimeout(pollTimer); paintRuns(); } return; }
    }, { readOnly: action === 'browse-tests' });
  };
  await work(render, { readOnly: true });
  return { canLeave, unmount() { active = false; watching = false; clearTimeout(pollTimer); root.onclick = root.oninput = root.onchange = null; } };
}
