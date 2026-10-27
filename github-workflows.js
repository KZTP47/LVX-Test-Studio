import { parseDocument } from './assets/vendor/yaml/index.js';
import { mountRepositoryEditor } from './github-repo-editor.js';
import { mountGraphCompanions } from './graph-companions.js';
import { applyWorkflowProposal, repositoryBoardContext, boardApiContext } from './graph-companion-model.js';
import { attachRepositoryApiLinks } from './api-atlas.js';

const model = window.LVXGitHubWorkflows;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icon = name => window.LVXIcons.svg(name);
let sessionToken = '';
let sessionEpoch = 0;
export const githubCredentialReference = () => sessionToken;

export async function mountGitHubWorkflows(host, { invoke, workspaceRoot, desktop = false, isCurrent = () => true, onEvent, onManageAgents } = {}) {
  let active = true, board = { version: 1, repositories: [] }, record = null, savedRaw = null, queue = Promise.resolve(), view = 'graph', zoom = 1, readFailed = false;
  const controllers = new Map(), errors = new Map(), selectedJobs = new Map(), graphs = new Map();
  let editorMount = null, editorRepoId = null;
  let companions = null, closePreview = null;
  const browserKey = 'lvx_github_workflows_browser_v1', collection = 'github-workflow-views', id = 'repository-lanes';
  const current = () => active && isCurrent();
  const usable = !desktop || !!workspaceRoot;
  host.innerHTML = `<div class="gw-workspace"><div class="studio-page-title"><h2 tabindex="-1">GitHub Actions</h2><p>Compare repository workflows. Choose a YAML file in each lane, then select a job to inspect its steps.</p></div>
    <form class="gw-import" aria-label="Import GitHub repository"><label>GitHub repository<input name="repository" placeholder="owner/repository or GitHub URL" required autocomplete="off"></label><label>Branch, tag or commit<input name="ref" placeholder="Default branch" autocomplete="off"></label><label>GitHub token <small>${desktop ? '(optional; stored encrypted by desktop)' : '(desktop app only)'}</small><input name="token" type="password" placeholder="Public repositories need no token" autocomplete="off" ${desktop ? '' : 'disabled'}></label><button type="submit" class="aero-button-primary">${icon('download')} Import repository</button></form>
    <div class="gw-toolbar"><div class="gw-view" role="group" aria-label="Workflow display"><button type="button" data-action="graph" aria-pressed="true">${icon('network')} Graph</button><button type="button" data-action="list" aria-pressed="false">${icon('list')} Job list</button></div><div class="gw-zoom" role="group" aria-label="Graph zoom"><button type="button" data-action="zoom-out" aria-label="Zoom out">−</button><output aria-label="Zoom level">100%</output><button type="button" data-action="zoom-in" aria-label="Zoom in">+</button><button type="button" data-action="zoom-reset">Reset zoom</button></div><button type="button" data-action="examples">${icon('folder')} Load example repositories</button><button type="button" data-action="forget" ${sessionToken ? '' : 'hidden'}>Remove saved sign-in</button></div>
    <p class="gw-storage">${desktop ? workspaceRoot ? 'Repository snapshots and selections are saved in this project.' : 'Choose a project folder in Project setup before importing repositories.' : 'Browser preview: public repositories are supported. Snapshots stay in this browser; private repository sign-in requires the desktop app.'} Open a repository studio to edit source, inspect matrix variants and reusable workflows, review changes, and fetch GitHub runs.</p>
    <p class="gw-notice" role="status" aria-live="polite"></p><div class="gw-editor-host"></div><div class="gw-lanes" aria-label="Repository workflow lanes"></div></div>`;
  const root = host.querySelector('.gw-workspace'), form = root.querySelector('form'), lanes = root.querySelector('.gw-lanes'), notice = root.querySelector('.gw-notice');
  const editorHost = root.querySelector('.gw-editor-host');
  const apiButton = document.createElement('button'); apiButton.type = 'button'; apiButton.textContent = 'APIs & contracts'; apiButton.onclick = () => window.dispatchEvent(new CustomEvent('lvx-open-api-atlas')); root.querySelector('.gw-toolbar').append(apiButton);
  const dirty = repo => (repo.files || []).some(file => file.originalContent === null ? !file.isDeleted : file.isDeleted || file.content !== file.originalContent);
  const service = (action, payload = {}) => invoke('githubStudio', action, { ...payload, workspaceRoot, ...(sessionToken && !payload.simulated && action !== 'demo' ? { credentialReference: sessionToken } : {}) });
  function fromSnapshot(snapshot, previous) {
    const result = { ...previous, ...snapshot, id: previous?.id || snapshot.fullName.toLowerCase() + '@' + snapshot.ref, example: !!previous?.example || !!snapshot.simulated || !!snapshot.example };
    result.workflows = result.files.filter(file => file.kind === 'workflow' && !file.isDeleted).map(file => ({ path: file.path, source: file.content, sha: file.sha }));
    result.selected = result.workflows.some(file => file.path === previous?.selected) ? previous.selected : result.workflows[0]?.path || '';
    return result;
  }
  async function openEditor(repo) {
    if (!desktop) { say('Open the rebuilt desktop app to edit repository source and publish reviewed changes. Public workflow viewing remains available here.'); return; }
    if (!workspaceRoot) throw Error('Choose a project folder before editing repository files.');
    if (editorRepoId) return;
    if (!repo.files) {
      if (repo.example) {
        const snapshot = await service('demo', { repository: repo.fullName, ref: 'main', simulated: true });
        if (!current()) return;
        const hydrated = fromSnapshot(snapshot, repo); hydrated.ref = repo.ref;
        await change(next => { const index = next.repositories.findIndex(item => item.id === repo.id); if (index < 0) throw Error('This repository was removed while importing its test files.'); next.repositories[index] = hydrated; return next; }, 'Imported workflow and test sources.');
        repo = board.repositories.find(item => item.id === repo.id);
      } else {
        // Saved workflow bytes already belong to this immutable commit. Opening
        // an editor must not depend on GitHub or on the repository's test count.
        repo = { ...repo, sourceScope: 'workflows', sourceInventoryComplete: false,
          files: repo.workflows.map(file => ({ path: file.path, content: file.source, originalContent: file.source, sha: file.sha, mode: '100644', kind: 'workflow', isDeleted: false })) };
      }
    }
    if (!current() || editorRepoId) return;
    errors.delete(repo.id);
    editorMount?.unmount(); editorRepoId = repo.id; lanes.hidden = true; form.hidden = true; root.querySelector('.gw-toolbar').hidden = true;
    try {
    const mounted = await mountRepositoryEditor(editorHost, { repo, call: service, isCurrent: () => current() && editorRepoId === repo.id,
      save: async updated => { await change(next => { const index = next.repositories.findIndex(item => item.id === repo.id); if (index < 0) throw Error('This repository was removed.'); next.repositories[index] = updated; return next; }, 'Repository draft saved.'); return board.repositories.find(item => item.id === repo.id); },
      close: async () => { editorMount?.unmount(); editorMount = null; editorRepoId = null; editorHost.replaceChildren(); lanes.hidden = false; form.hidden = false; root.querySelector('.gw-toolbar').hidden = false; paint(); }
    });
    if (!current() || editorRepoId !== repo.id) mounted.unmount(); else editorMount = mounted;
    } catch (error) {
      editorRepoId = null; editorMount = null; editorHost.replaceChildren(); lanes.hidden = false; form.hidden = false; root.querySelector('.gw-toolbar').hidden = false;
      throw error;
    }
  }
  const say = (message, error = false) => { if (!current()) return; notice.textContent = message; notice.setAttribute('role', error ? 'alert' : 'status'); notice.classList.toggle('gw-error', error); };
  const control = (action, label, repo, ico) => `<button type="button" data-action="${action}" data-repo="${esc(repo.id)}" aria-label="${esc(label + ' ' + repo.fullName)}">${icon(ico)} ${label}</button>`;
  function graphFor(file) {
    if (!file) return null;
    if (!graphs.has(file.source)) { try { graphs.set(file.source, { graph: model.workflowGraph(file.source, parseDocument) }); } catch (error) { graphs.set(file.source, { error: error.message }); } }
    return graphs.get(file.source);
  }
  function sourceLink(repo, path = '') {
    if (repo.example) return '';
    const url = 'https://github.com/' + repo.fullName + '/blob/' + encodeURIComponent(repo.commit) + '/' + path.split('/').map(encodeURIComponent).join('/');
    return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open on GitHub ${icon('external-link')}</a>`;
  }
  function graphMarkup(repo, graph) {
    if (view === 'list') return `<ul class="gw-job-list">${graph.nodes.map(node => `<li><button type="button" data-job="${esc(node.id)}" data-repo="${esc(repo.id)}" aria-pressed="${selectedJobs.get(repo.id) === node.id}"><strong>${esc(node.name)}</strong><span>${esc(node.kind)} · ${node.steps.length} steps · Needs: ${esc(node.needs.join(', ') || 'none')}</span></button></li>`).join('')}</ul>`;
    const byId = new Map(graph.nodes.map(node => [node.id, node]));
    const paths = graph.edges.map(edge => {
      const from = byId.get(edge.source), to = byId.get(edge.target), x = from.x + 208, y = from.y + 42, tx = to.x, ty = to.y + 42;
      const midpoint = (x + tx) / 2;
      return `<path d="M${x},${y} C${midpoint},${y} ${midpoint},${ty} ${tx},${ty}" class="gw-edge"><title>${esc(edge.source + ' → ' + edge.target)}</title></path><path d="M${tx - 7},${ty - 4} L${tx},${ty} L${tx - 7},${ty + 4}" class="gw-arrow"/>`;
    }).join('');
    const text = (value, max) => value.length > max ? value.slice(0, max - 1) + '…' : value;
    return `<div class="gw-canvas" role="region" aria-label="${esc(repo.fullName)} dependency graph" tabindex="0"><svg class="gw-diagram" width="${graph.width * zoom}" height="${graph.height * zoom}" viewBox="0 0 ${graph.width} ${graph.height}" role="group" aria-label="Workflow jobs">${paths}${graph.nodes.map(node => `<g class="gw-node ${node.blocked ? 'gw-blocked' : ''}" transform="translate(${node.x},${node.y})" role="button" tabindex="0" aria-label="${esc(node.name + ', ' + node.kind + ', needs ' + (node.needs.join(', ') || 'none'))}" aria-pressed="${selectedJobs.get(repo.id) === node.id}" data-job="${esc(node.id)}" data-repo="${esc(repo.id)}"><title>${esc(node.name + '\n' + node.id)}</title><rect width="208" height="84" rx="12"/><text x="14" y="25" class="gw-node-name">${esc(text(node.name, 23))}</text><text x="14" y="45" class="gw-node-id">${esc(text(node.id, 27))}</text><text x="14" y="66" class="gw-node-kind">${esc(node.test ? 'Test runner · ' + node.steps.length + ' steps' : node.kind + ' · ' + node.steps.length + ' steps')}</text></g>`).join('')}</svg></div>`;
  }
  function inspector(repo, node) {
    if (!node) return '<p class="gw-hint">Select a job to see its runner, conditions and steps.</p>';
    const value = node.value;
    return `<section class="gw-inspector" aria-label="${esc(node.name)} details"><div class="gw-inspector-heading"><h4>${esc(node.name)}</h4><span>${esc(node.kind)}</span>${control('close-job', 'Close job details', repo, 'close')}</div><dl><div><dt>Job ID</dt><dd>${esc(node.id)}</dd></div><div><dt>Needs</dt><dd>${esc(node.needs.join(', ') || 'No dependencies')}</dd></div><div><dt>Runner</dt><dd>${esc(typeof value['runs-on'] === 'string' ? value['runs-on'] : value['runs-on'] ? JSON.stringify(value['runs-on']) : value.uses ? 'Defined by reusable workflow' : 'Not specified')}</dd></div><div><dt>Condition</dt><dd>${esc(value.if ?? 'Default success condition')}</dd></div></dl>${value.uses ? `<p>Uses <code>${esc(value.uses)}</code></p>` : ''}${value.strategy?.matrix ? `<p>Matrix (shown as one source job)</p><pre>${esc(JSON.stringify(value.strategy.matrix, null, 2))}</pre>` : ''}${node.steps.length ? `<ol class="gw-steps">${node.steps.map((step, index) => `<li><strong>${esc(step?.name || step?.uses || 'Step ' + (index + 1))}</strong><pre>${esc(step?.run ?? step?.uses ?? JSON.stringify(step))}</pre></li>`).join('')}</ol>` : '<p>No inline steps in this job.</p>'}<details><summary>Complete job configuration</summary><pre>${esc(JSON.stringify(value, null, 2))}</pre></details></section>`;
  }
  function paint() {
    if (!current()) return;
    const focus = document.activeElement?.closest('[data-action],[data-job],select[data-repo]');
    const focusKey = focus && { action: focus.dataset.action, job: focus.dataset.job, repo: focus.dataset.repo, select: focus.tagName === 'SELECT' };
    root.querySelector('[data-action="examples"]').disabled = !usable || readFailed;
    form.querySelector('button').disabled = !usable || readFailed || controllers.has('import');
    root.querySelector('[data-action="forget"]').hidden = !sessionToken;
    root.querySelector('output').textContent = Math.round(zoom * 100) + '%';
    root.querySelector('[data-action="zoom-out"]').disabled = view !== 'graph' || zoom <= .6;
    root.querySelector('[data-action="zoom-in"]').disabled = view !== 'graph' || zoom >= 1.6;
    for (const mode of ['graph', 'list']) root.querySelector('[data-action="' + mode + '"]').setAttribute('aria-pressed', String(view === mode));
    lanes.innerHTML = board.repositories.length ? board.repositories.map(repo => {
      const file = repo.workflows.find(file => file.path === repo.selected), result = graphFor(file), graph = result?.graph;
      return `<article class="gw-lane" aria-label="${esc(repo.fullName)} workflow"><header><div class="gw-repo-heading">${icon('branch')}<div><h3>${esc(repo.fullName)}</h3><p>${esc(repo.ref)} · ${repo.example ? '<span class="gw-example">Example repository</span>' : `<span title="${esc(repo.commit)}">${esc(repo.commit.slice(0, 8))}</span> · Snapshot ${esc(new Date(repo.importedAt).toLocaleString())}`}</p></div></div><div class="gw-lane-actions">${control('edit-repository', 'Edit workflow & tests', repo, 'edit')}${repo.example ? '' : control('refresh', controllers.has(repo.id) ? 'Refreshing…' : 'Refresh', repo, 'refresh')}${control('remove', 'Remove repository', repo, 'trash')}</div></header><div class="gw-workflow-picker"><label>Workflow YAML<select data-repo="${esc(repo.id)}" aria-label="Workflow for ${esc(repo.fullName)}" ${repo.workflows.length ? '' : 'disabled'}>${repo.workflows.map(file => `<option value="${esc(file.path)}" ${repo.selected === file.path ? 'selected' : ''}>${esc(file.path.replace('.github/workflows/', ''))}</option>`).join('') || '<option>No workflows found</option>'}</select></label>${graph ? `<span class="gw-workflow-name">${esc(graph.name)}</span><span>${graph.nodes.length} jobs · ${graph.edges.length} dependencies</span><span class="gw-triggers">${esc(graph.triggers.join(' · ') || 'No trigger specified')}</span>` : ''}</div>${errors.has(repo.id) ? `<p role="alert" class="gw-error">${esc(errors.get(repo.id))} The previous snapshot is still shown.</p>` : ''}${!file ? '<div class="gw-empty"><h4>No workflow YAML files</h4><p>This repository snapshot has no .yml or .yaml files in .github/workflows. Add a workflow on GitHub, then refresh.</p></div>' : result.error ? `<p role="alert" class="gw-error">Cannot draw this workflow: ${esc(result.error)}</p>` : `${graph.diagnostics.length ? `<ul class="gw-diagnostics" aria-label="Workflow diagnostics">${graph.diagnostics.map(message => `<li>${esc(message)}</li>`).join('')}</ul>` : ''}${graph.nodes.length ? graphMarkup(repo, graph) + inspector(repo, graph.nodes.find(node => node.id === selectedJobs.get(repo.id))) : '<p class="gw-hint">This workflow has no jobs.</p>'}`}${file ? `<details class="gw-source"><summary>View exact YAML source · ${esc(file.path)}</summary>${sourceLink(repo, file.path)}<pre>${esc(file.source)}</pre></details>` : ''}</article>`;
    }).join('') : `<div class="gw-empty"><h3>${readFailed ? 'Saved repositories could not be loaded' : 'See your repositories together'}</h3><p>${readFailed ? 'Reopen this view after fixing storage. Your saved records have been preserved.' : 'Import a GitHub repository above. Each repository gets its own workflow lane, with an independent YAML selection.'}</p>${readFailed ? '' : '<p>To try the graph offline, choose Load example repositories.</p>'}</div>`;
    if (desktop && workspaceRoot) void attachRepositoryApiLinks(lanes,{invoke,workspaceRoot,repositories:board.repositories,isCurrent:current}).catch(error=>say('API connections could not load: '+error.message,true));
    if (focusKey) {
      const next = [...root.querySelectorAll('[data-action],[data-job],select[data-repo]')].find(el => el.dataset.repo === focusKey.repo && (focusKey.select ? el.tagName === 'SELECT' : focusKey.job ? el.dataset.job === focusKey.job : el.dataset.action === focusKey.action));
      next?.focus({ preventScroll: true });
    }
  }
  function change(update, message) {
    const work = queue.then(async () => {
      if (!current()) return;
      const next = model.validateBoard(update(structuredClone(board)));
      if (!usable || readFailed) throw Error('Choose a working project folder before saving repository lanes.');
      if (desktop) {
        const reply = await invoke('workspace', 'transact', { workspaceRoot, records: [{ collection, id, value: next, expectedRevision: record?.revision ?? null }] });
        if (!current()) return;
        const revision = reply.changes?.find(item => item.id === id)?.revision;
        if (!Number.isSafeInteger(revision)) throw Error('Storage did not confirm the saved repository revision. Reopen this view.');
        record = { revision };
      } else {
        if (localStorage.getItem(browserKey) !== savedRaw) throw Error('This repository view changed in another window. Reopen it before saving.');
        const raw = JSON.stringify(next); localStorage.setItem(browserKey, raw); savedRaw = raw;
      }
      board = next; paint(); companions?.update(); say(message);
    });
    queue = work.catch(error => { say('Could not save repository view: ' + error.message, true); });
    return work;
  }
  async function load(repo = null) {
    const key = repo?.id || 'import';
    if (controllers.has(key)) return;
    const controller = new AbortController(); controllers.set(key, controller); errors.delete(key); paint();
    const input = form.elements;
    try {
      const repository = model.repositoryName(repo?.fullName || input.repository.value), ref = repo?.ref || input.ref.value;
      controller.repository = repository.toLowerCase();
      const previousDraft = repo || board.repositories.find(item => item.fullName.toLowerCase() === repository.toLowerCase() && (!ref || item.ref === ref));
      if (previousDraft && dirty(previousDraft) && !window.confirm('Replace local draft edits in ' + previousDraft.fullName + ' with a fresh GitHub snapshot?')) return;
      const typedToken = input.token.value.trim();
      if (typedToken) {
        input.token.value = '';
        const epoch = ++sessionEpoch, oldToken = sessionToken;
        const stored = (await window.LVXCredentials.protect({ token: typedToken }, 'GitHub Actions sign-in')).token;
        if (!current() || controller.signal.aborted || epoch !== sessionEpoch) { await invoke('security', 'deleteSecret', { reference: stored }); return; }
        sessionToken = stored;
        if (oldToken) await invoke('security', 'deleteSecret', { reference: oldToken });
      }
      const imported = desktop ? fromSnapshot(await service('snapshot', { repository, ref, scope: 'workflows' }), repo) : await model.importRepository({ repository, ref, token: sessionToken,
        request: (url, options) => window.LVXCredentials.request(url, options), signal: controller.signal });
      if (!current() || controller.signal.aborted) return;
      await change(next => {
        if (controller.signal.aborted) throw new DOMException('Import cancelled.', 'AbortError');
        const index = next.repositories.findIndex(item => repo ? item.id === repo.id : item.id === imported.id);
        if (repo && !next.repositories.some(item => item.id === repo.id)) return next;
        const previous = index >= 0 ? next.repositories[index] : null;
        if (previous && imported.workflows.some(file => file.path === previous.selected)) imported.selected = previous.selected;
        if (index >= 0) next.repositories[index] = imported;
        else next.repositories.push(imported);
        return next;
      }, 'Imported ' + imported.fullName + ' · ' + imported.workflows.length + ' workflows.');
    } catch (error) {
      if (current() && !controller.signal.aborted) { if (repo) errors.set(repo.id, error.message); say(error.message, true); }
    } finally { if (controllers.get(key) === controller) controllers.delete(key); paint(); }
  }
  form.onsubmit = event => { event.preventDefault(); void load(); };
  root.onchange = event => {
    if (event.target.matches('select[data-repo]')) {
      const id = event.target.dataset.repo, path = event.target.value; selectedJobs.delete(id);
      void change(next => { const repo = next.repositories.find(repo => repo.id === id); if (repo) repo.selected = path; return next; }, 'Workflow selection saved.').catch(() => paint());
    }
  };
  root.onkeydown = event => { if (event.target.matches('g[data-job]') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); } };
  root.onclick = event => {
    const target = event.target.closest('[data-action],[data-job]'); if (!target) return;
    event.stopPropagation();
    const repo = board.repositories.find(repo => repo.id === target.dataset.repo), action = target.dataset.action;
    if (target.dataset.job && repo) { selectedJobs.set(repo.id, target.dataset.job); paint(); return; }
    if (action === 'forget') {
      const reference = sessionToken; sessionToken = ''; sessionEpoch++;
      for (const controller of controllers.values()) controller.abort(); controllers.clear(); paint();
      if (reference) void invoke('security', 'deleteSecret', { reference }).then(() => say('Saved GitHub sign-in removed.')).catch(error => say('Sign-in is no longer in use, but its encrypted vault record could not be deleted: ' + error.message, true));
    }
    if (action === 'refresh' && repo) void load(repo);
    if (action === 'edit-repository' && repo) void openEditor(repo).catch(error => say(error.message, true));
    if (action === 'remove' && repo) {
      if (dirty(repo) && !window.confirm('Remove ' + repo.fullName + ' and its local draft edits from this view?')) return;
      for (const [key, controller] of controllers) if (key === repo.id || controller.repository === repo.fullName.toLowerCase()) { controller.abort(); controllers.delete(key); }
      errors.delete(repo.id); selectedJobs.delete(repo.id);
      void change(next => { next.repositories = next.repositories.filter(item => item.id !== repo.id); return next; }, 'Removed ' + repo.fullName + ' from this view.').then(() => form.elements.repository.focus()).catch(() => {});
    }
    if (action === 'examples') void change(next => { for (const repo of model.examples()) if (!next.repositories.some(item => item.id === repo.id)) next.repositories.push(repo); return next; }, 'Loaded three example repositories. These are offline illustrations.').catch(() => {});
    if (action === 'close-job' && repo) { selectedJobs.delete(repo.id); paint(); }
    if (['graph', 'list'].includes(action)) { view = action; paint(); }
    if (action?.startsWith('zoom-')) { zoom = action === 'zoom-reset' ? 1 : Math.max(.6, Math.min(1.6, Math.round((zoom + (action === 'zoom-in' ? .1 : -.1)) * 10) / 10)); paint(); }
  };
  function agentTargets() {
    return board.repositories.flatMap(repo => {
      const file = repo.workflows.find(file => file.path === repo.selected); if (!file) return [];
      const base = { kind:'github',id:repo.id,repository:repo.fullName,ref:repo.ref,workflow:file.path,source:file.source,name:repo.fullName + ' · ' + file.path.replace('.github/workflows/',''),element:() => [...lanes.children].find(el => el.getAttribute('aria-label') === repo.fullName + ' workflow') };
      return [base,...(graphFor(file)?.graph?.nodes || []).map(node => ({...base,job:node.id,name:base.name + ' → ' + node.name}))];
    });
  }
  async function previewAgentYAML(origin, source) {
    const repo = board.repositories.find(repo => repo.id === origin.id), file = repo?.workflows.find(file => file.path === origin.workflow);
    if (!file || repo.selected !== origin.workflow || file.source !== origin.source) throw Error('This workflow changed after the request. Ask the agent again using the current source.');
    const graph = model.workflowGraph(source,parseDocument);
    if (!graph.nodes.length || graph.diagnostics.length) throw Error('The suggested workflow needs correction: ' + (graph.diagnostics.join(' ') || 'No jobs.'));
    await new Promise((resolve,reject) => {
      const dialog = document.createElement('dialog'); dialog.className = 'gw-agent-preview'; dialog.setAttribute('aria-label','Review agent workflow draft');
      dialog.innerHTML = `<form method="dialog"><h3>Review workflow draft</h3><p>${esc(repo.fullName)} · ${esc(file.path)} · ${graph.nodes.length} jobs. Applying updates the local draft and graphs. Publishing remains a separate action.</p><div class="gw-agent-diff"><section><h4>Current workflow</h4><pre>${esc(file.source)}</pre></section><section><h4>Suggested workflow</h4><pre>${esc(source)}</pre></section></div><button value="cancel">Cancel</button><button type="button" data-apply-agent>Apply local draft</button><p role="alert"></p></form>`;
      root.append(dialog);
      const finish = () => { closePreview = null; dialog.remove(); resolve(); }; closePreview = finish;
      dialog.onclose = finish;
      dialog.querySelector('[data-apply-agent]').onclick = async () => {
        const button = dialog.querySelector('[data-apply-agent]'); button.disabled = true;
        try {
          await change(next => applyWorkflowProposal(next,origin,source),'Agent workflow draft applied locally. Review Changes & publish in the repository editor to publish.');
          dialog.close();
        } catch (error) { button.disabled = false; dialog.querySelector('[role="alert"]').textContent = error.message; }
      };
      dialog.showModal(); dialog.querySelector('[value="cancel"]').focus();
    });
  }
  const cleanup = { canLeave: () => companions?.canLeave() !== false && (editorMount?.canLeave?.() ?? true), unmount() { active = false; closePreview?.(); companions?.destroy(); editorMount?.unmount(); for (const controller of controllers.values()) controller.abort(); controllers.clear(); graphs.clear(); root.onclick = root.onchange = root.onkeydown = null; form.onsubmit = null; } };
  try {
    if (desktop && workspaceRoot) { record = await invoke('workspace', 'read', { workspaceRoot, collection, id }); if (record) board = model.validateBoard(record.value); }
    else if (!desktop) { savedRaw = localStorage.getItem(browserKey); if (savedRaw) board = model.validateBoard(JSON.parse(savedRaw)); }
  } catch (error) { readFailed = true; say(error.message, true); }
  paint();
  companions = mountGraphCompanions(root,{invoke,onEvent,workspaceRoot,surface:'github-actions',desktop,getTargets:agentTargets,
    getViewContext: async () => {
      const saved = await invoke('workspace','read',{collection:'api-atlas',id:'workspace',workspaceRoot});
      return { board: repositoryBoardContext(board.repositories), apiAtlas: boardApiContext(board.repositories,saved?.value?.atlas) };
    },onManage:onManageAgents,onApplyYAML:previewAgentYAML});
  await companions.ready;
  return cleanup;
}
