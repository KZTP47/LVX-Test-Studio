import { collectApiSnapshots, retainPartialEvidence, networkConnections, apiSection } from './api-scan-model.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = name => window.LVXIcons.svg(name);
const button = (action, label, extra = '') => `<button type="button" data-aa="${action}" ${extra}>${label}</button>`;
const field = (name, label, value = '', type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const area = (name, label, value = '') => `<label>${label}<textarea name="${name}" rows="5" spellcheck="false">${esc(value)}</textarea></label>`;
const emptyAtlas = () => ({ version: 1, services: [], endpoints: [], connections: [], candidates: [], diagnostics: [] });
const records = result => result?.records || result || [];
export { networkConnections, apiSection } from './api-scan-model.js';
export function networkMarkup(atlas) {
  const activity = service => atlas.connections.filter(edge => edge.source === service.id || edge.target === service.id).length;
  const orderedServices = [...atlas.services].sort((left, right) => activity(right) - activity(left) || atlas.endpoints.filter(ep => ep.serviceId === right.id).length - atlas.endpoints.filter(ep => ep.serviceId === left.id).length);
  const columns = [orderedServices.map(service => ({ ...service, title: service.name?.split('/').at(-1) || service.title, type: 'repository' })), atlas.apiServices || [], [...(atlas.externalNodes || []), ...(atlas.connections.some(edge => !edge.target && !edge.externalId) ? [{ id: 'unresolved', title: 'Target unresolved', type: 'unknown' }] : [])]];
  const positions = new Map(), nodes = columns.flat(), edges = networkConnections(atlas);
  columns.forEach((column, x) => column.forEach((node, y) => positions.set(node.id, { x: 20 + x * 320, y: 110 + y * 120 })));
  const width = 960, height = Math.max(230, 115 + Math.max(...columns.map(column => column.length), 1) * 120);
  const short = (value, size = 27) => String(value || '').length > size ? String(value).slice(0, size - 1) + '…' : String(value || '');
  return `<div class="aa-network" role="region" aria-label="Interactive service dependency graph" tabindex="0"><svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-label="Repositories, API services and external destinations" role="group"><defs><marker id="aa-arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M1 1L7 4L1 7"/></marker></defs>${['Repositories', 'Declared API services', 'External / unknown destinations'].map((label, index) => `<text class="aa-column-label" x="${20 + index * 320}" y="24">${label}</text>`).join('')}${edges.map((edge, index) => {
    const source = positions.get(edge.source), target = positions.get(edge.targetApiServiceId || edge.target || edge.externalId || 'unresolved');
    if (!source || !target) return '';
    const sx = source.x + 220, sy = source.y + 42, tx = source.x === target.x ? target.x + 220 : target.x, ty = target.y + 42;
    const bend = source.x === target.x ? sx + 50 + index % 3 * 12 : (sx + tx) / 2;
    const over = target.x - source.x > 320, routeY = 50 + index % 3 * 18;
    const d = over ? `M${sx} ${sy}C${sx + 45} ${sy} ${sx + 45} ${routeY} ${sx + 70} ${routeY}H${tx - 36}V${ty - 14}Q${tx - 36} ${ty} ${tx} ${ty}` : `M${sx} ${sy}C${bend} ${sy} ${bend} ${ty} ${tx} ${ty}`;
    let label = edge.url; try { label = new URL(edge.url).pathname; } catch {}
    return `<g data-aa="connection" data-connection="${esc(edge.id)}" role="button" tabindex="0" aria-label="${esc(edge.method + ' ' + edge.url + ', ' + edge.confidence)}" class="aa-network-edge ${edge.target ? '' : 'aa-unresolved'}"><title>${esc(edge.url + '\n' + edge.confidence + '\n' + edge.evidence.path)}</title><path class="aa-edge-hit" d="${d}"/><path class="aa-edge-line" d="${d}" marker-end="url(#aa-arrowhead)"/><text x="${source.x === target.x ? bend : (sx + tx) / 2}" y="${over ? routeY - 6 : (sy + ty) / 2 - 8 + index % 2 * 16}" text-anchor="middle">${edge.kind === 'ownership' ? '' : esc(edge.declarationCount > 1 ? edge.declarationCount + ' configured URLs' : short(edge.method + ' ' + label, 25))}</text></g>`;
  }).join('')}${nodes.map(node => {
    const point = positions.get(node.id), count = atlas.endpoints.filter(ep => node.type === 'api-service' ? ep.apiServiceId === node.id : ep.serviceId === node.id).length;
    const detail = node.type === 'external' ? 'External destination · unverified' : node.type === 'api-service' ? count + ' endpoints · OpenAPI' : node.type === 'unknown' ? 'Needs source confirmation' : count + ' endpoints · ' + (node.scanStatus || 'scanned');
    return `<g class="aa-network-node ${node.type === 'external' ? 'aa-external-node' : node.type === 'api-service' ? 'aa-api-service-node' : ''}" data-aa="section" data-section="${esc(node.id)}" role="button" tabindex="0" aria-label="Open ${esc(node.title)} endpoints" transform="translate(${point.x},${point.y})"><title>${esc(node.title + '\n' + (node.name || '') + '\n' + detail)}</title><rect width="220" height="84" rx="10"/><text x="14" y="26">${esc(short(node.title))}</text><text x="14" y="49" class="aa-network-count">${esc(short(detail, 32))}</text><text x="14" y="68" class="aa-network-count">${esc(short(node.name || '', 32))}</text></g>`;
  }).join('')}</svg></div>`;
}
function exampleSources(repo, index) {
  const providers = ['web-client', 'checkout-api', 'shared-tools'];
  const name = providers[index % providers.length], next = providers[(index + 1) % providers.length];
  const path = index === 1 ? '/orders/{id}' : '/health';
  const document = { openapi: '3.0.3', info: { title: name, version: '1.0' }, servers: [{ url: 'http://' + name + '.example.test' }], paths: { [path]: { get: { summary: index === 1 ? 'Read an order' : 'Check service health', responses: { 200: { description: 'Healthy response', content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string' } } } } } } } } } } };
  return [{ path: 'openapi.json', content: JSON.stringify(document) }, { path: 'src/service.js', content: `fetch('http://${next}.example.test/${index === 0 ? 'orders/{id}' : 'health'}');` }];
}
export async function mountApiAtlas(host, { invoke, workspaceRoot, desktop = true, isCurrent = () => true, onOpenGraph, getCredentialReference = () => '' } = {}) {
  let active = true, record = null, data = { version: 1, atlas: emptyAtlas(), tests: [] }, history = [], selected = '', serviceFilter = '', query = '', tab = 'api', busy = false, draft = null, draftDirty = false, draftKey = 0, runningId = '', sourceFailed = false;
  let section = null, bubbleAnchor = null, bubbleOrigin = null, browserOpen = false, panelNotice = '';
  let anchorFraction = .5, bubblePlacement = null, pointerFrame = 0;
  const bubbleObserver = new ResizeObserver(() => schedulePointer());
  let panelTab='tests', authors=[], authorId='native:codex', aiGoal='', aiTarget='endpoint', aiRequest='', aiNotice='', aiOptionsError='', optionsLoaded=false, proposals=[], proposalDraft=null;
  let apiSetup=false, apiSaving=false, apiConfigError='', apiDraft={model:'',maxTokens:8192,customEndpoint:''};
  const current = () => active && isCurrent();
  const call = (domain, action, payload = {}) => invoke(domain, action, { ...payload, workspaceRoot });
  host.innerHTML = `<section class="aa-workspace" aria-label="Service API and contract workspace"><div class="studio-page-title"><h2 tabindex="-1">APIs & contracts</h2><p>See what your services share. Select a connection or endpoint, then check the response and the shape of its data.</p></div><div class="aa-toolbar">${button('scan', icon('refresh') + ' Scan repository APIs', 'class="aero-button-primary"')}${button('scan-local', 'Map imported source')}${button('repositories', 'GitHub sign-in & repositories')}${button('run-all', icon('play') + ' Run all saved tests')}${button('stop', 'Stop current run', 'hidden')}<label>Find an API<input name="aa-search" type="search" placeholder="Service, method or path"></label><label>Service<select name="aa-service"><option value="">All services</option></select></label></div><p class="aa-notice" role="status" aria-live="polite"></p><div class="aa-body"></div></section>`;
  const root = host.querySelector('.aa-workspace'), body = root.querySelector('.aa-body'), notice = root.querySelector('.aa-notice');
  function say(message, error = false) { if (!current()) return; notice.textContent = message; if (section) { panelNotice = message; const local = body.querySelector('.aa-bubble-notice'); if (local) { local.textContent = message; local.setAttribute('role', error ? 'alert' : 'status'); } } notice.setAttribute('role', error ? 'alert' : 'status'); const editor=body.querySelector('.aa-editor'); if(editor){let local=editor.querySelector('.aa-editor-notice');if(!local){local=document.createElement('p');local.className='aa-editor-notice';local.setAttribute('role','alert');editor.querySelector('.aa-actions').before(local);}local.textContent=error?message+' Your draft is kept. Correct the fields and save again; reopen this view after a revision conflict.':'';} }
  function canLeave() { return !draftDirty || window.confirm('Leave this unsaved API test draft? Saved tests and run results are preserved.'); }
  function openSection(kind, id, control, pointer) {
    if (!canLeave()) return;
    const next = apiSection(data.atlas, kind, id); if (!next) return;
    section = next; panelTab='tests'; proposalDraft=null; panelNotice = ''; bubblePlacement = null; bubbleAnchor = pointer && (pointer.clientX || pointer.clientY) ? {left:pointer.clientX,right:pointer.clientX,top:pointer.clientY,bottom:pointer.clientY,width:0,height:0} : control?.getBoundingClientRect() || null; bubbleOrigin = control ? { ...control.dataset } : null;
    anchorFraction = .5;
    const path = control?.querySelector('.aa-edge-hit');
    if (path && pointer && (pointer.clientX || pointer.clientY)) {
      let best = Infinity; const length = path.getTotalLength(), matrix = path.getScreenCTM();
      for (let i = 0; i <= 160; i++) { const p = path.getPointAtLength(length * i / 160).matrixTransform(matrix), d = Math.hypot(p.x - pointer.clientX, p.y - pointer.clientY); if (d < best) { best = d; anchorFraction = i / 160; } }
    }
    selected = next.endpoints.some(ep => ep.id === selected) ? selected : next.endpoints[0]?.id || '';
    draft = null; draftDirty = false; paint(); body.querySelector('.aa-bubble h3')?.focus({ preventScroll: true });
  }
  function closeSection() {
    if (!canLeave()) return;
    section = null; bubbleObserver.disconnect(); proposalDraft=null; draft = null; draftDirty = false; paint();
    const control = [...body.querySelectorAll('[data-aa]')].find(control => bubbleOrigin && Object.entries(bubbleOrigin).every(([key, value]) => control.dataset[key] === value));
    control?.focus();
  }
  function positionBubble() {
    const bubble = body.querySelector('.aa-bubble'); if (!bubble) return;
    const anchor = bubbleAnchor, width = Math.min(1060, innerWidth - 32, Math.max(760, innerWidth - (anchor?.right || 0) - 40)), height = Math.min(780, innerHeight - 48);
    const left = Math.max(16, Math.min(anchor ? anchor.right + 24 : (innerWidth - width) / 2, innerWidth - width - 16));
    const top = Math.max(24, Math.min(anchor ? anchor.top - 80 : (innerHeight - height) / 2, innerHeight - height - 24));
    bubblePlacement ||= {left,top,width};
    bubble.style.cssText = `left:${Math.max(16,Math.min(bubblePlacement.left,innerWidth-bubblePlacement.width-16))}px;top:${Math.max(24,Math.min(bubblePlacement.top,innerHeight-height-24))}px;width:${Math.min(bubblePlacement.width,innerWidth-32)}px;max-height:${height}px`;
    bubbleObserver.disconnect(); bubbleObserver.observe(bubble); bubbleObserver.observe(root); const graph=body.querySelector('.aa-network');if(graph)bubbleObserver.observe(graph); schedulePointer();
    for (const control of body.querySelectorAll('.aa-network [data-aa]')) control.setAttribute('aria-expanded', String(!!bubbleOrigin && Object.entries(bubbleOrigin).every(([key,value]) => control.dataset[key] === value))); 
  }
  function sourceControl() { return [...body.querySelectorAll('[data-aa]')].find(control => bubbleOrigin && Object.entries(bubbleOrigin).every(([key,value]) => control.dataset[key] === value)); }
  function sourcePoint(source=sourceControl()) { const path=source?.querySelector('.aa-edge-hit'),r=source?.getBoundingClientRect();return path?path.getPointAtLength(path.getTotalLength()*anchorFraction).matrixTransform(path.getScreenCTM()):r?{x:r.left+r.width/2,y:r.top+r.height/2}:null; }
  function schedulePointer() { if (!section || pointerFrame) return; pointerFrame = requestAnimationFrame(() => { pointerFrame = 0; trackPointer(); }); }
  function trackPointer() {
    const bubble = body.querySelector('.aa-bubble'), source = sourceControl(), connector = bubble?.querySelector('.aa-bubble-connector'), note = bubble?.querySelector('.aa-anchor-note');
    if (!connector) return;
    const tip = sourcePoint(source);
    let visible = !!tip && tip.x >= 0 && tip.x <= innerWidth && tip.y >= 0 && tip.y <= innerHeight;
    for (let parent = source?.parentElement; parent && visible; parent = parent.parentElement) {
      const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX) && (tip.x < box.left || tip.x > box.right)) visible = false;
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY) && (tip.y < box.top || tip.y > box.bottom)) visible = false;
    }
    const box = bubble.getBoundingClientRect(), covered = tip && tip.x >= box.left && tip.x <= box.right && tip.y >= box.top && tip.y <= box.bottom;
    connector.toggleAttribute('hidden', !visible || covered); note.hidden = visible && !covered || !bubbleOrigin;
    if (note.firstElementChild) note.firstElementChild.textContent = covered ? 'The selected connection is behind this panel.' : 'The selected connection is off-screen.';
    if (!visible || covered) return;
    const clamp = (v,a,b) => Math.max(a,Math.min(b,v)); let a,b;
    if (tip.x < box.left || tip.x > box.right) { const x = tip.x < box.left ? box.left+1 : box.right-1, y = clamp(tip.y,box.top+30,box.bottom-30); a={x,y:y-10};b={x,y:y+10}; }
    else { const y = tip.y < box.top ? box.top+1 : box.bottom-1, x = clamp(tip.x,box.left+30,box.right-30);a={x:x-10,y};b={x:x+10,y}; }
    connector.setAttribute('viewBox',`0 0 ${innerWidth} ${innerHeight}`); connector.dataset.anchorX=tip.x; connector.dataset.anchorY=tip.y;
    connector.querySelector('path').setAttribute('d',`M${tip.x} ${tip.y}L${a.x} ${a.y}L${b.x} ${b.y}Z`);
  }
  function resizeBubble() { bubblePlacement = null; positionBubble(); }
  async function refreshAiData() {
    const [saved, pending] = await Promise.all([call('workspace','read',{collection:'api-atlas',id:'workspace'}),call('workspace','list',{collection:'api-atlas-proposals'})]);
    if (!current()) return;
    if (saved) { record=saved; data=saved.value; } proposals=records(pending);
  }
  async function loadAuthors() {
    try { const result=await call('host','apiAtlasAiOptions'); if(!current())return;authors=result.choices;optionsLoaded=true;aiOptionsError='';if(!authors.some(item=>item.id===authorId))authorId=authors[0]?.id||''; }
    catch(error){if(!current())return;aiOptionsError=error.message;}
    paint();
  }
  function proposalMarkup(item) {
    const p=item.value, pending=p.state==='pending', editable=data.atlas.endpoints.some(ep=>ep.id===p.test?.endpointId)&&['api','contract'].includes(p.test?.kind);
    return `<article class="aa-proposal" data-proposal="${esc(item.id)}"><h4>${esc(p.test?.name||'AI proposal needing review')}</h4><small>${esc(p.test?.kind||'Test')} · ${esc(p.author?.provider||'AI')} ${esc(p.author?.model||'')} · ${esc(p.state)}</small><p>${esc(p.rationale||'Inspect the request and expectations before accepting.')}</p>${p.validationError?`<p role="alert">${esc(p.validationError)}</p>`:''}<details><summary>Inspect generated request, expectations and source scope</summary><pre>${esc(JSON.stringify(p,null,2))}</pre></details>${pending?`<div class="aa-actions">${button('accept-proposal','Accept test',`data-proposal="${esc(item.id)}" ${busy||p.validationError?'disabled':''}`)}${button('review-proposal','Review and edit',`data-proposal="${esc(item.id)}" ${busy||!editable?'disabled':''}`)}${button('reject-proposal','Reject',`data-proposal="${esc(item.id)}" ${busy?'disabled':''}`)}</div>`:p.state==='accepted'?'<p>Accepted into All API &amp; contract tests. It has not been run automatically.</p>':'<p>Rejected; no runnable test was added.</p>'}</article>`;
  }
  function aiMarkup() {
    const relevant=proposals.filter(item=>item.value.scope?.kind===section?.kind&&item.value.scope?.id===section?.id),pending=relevant.filter(item=>item.value.state==='pending'),reviewed=relevant.filter(item=>item.value.state!=='pending');
    const author=authors.find(item=>item.id===authorId),option=item=>`<option value="${esc(item.id)}" ${item.id===authorId?'selected':''}>${esc(item.name)}</option>`;
    const choices=[['Subscription / native login',authors.filter(item=>item.id.startsWith('native:'))],['API keys',authors.filter(item=>item.apiKeyProfile)],['Saved agents',authors.filter(item=>item.id.startsWith('agent:'))]].filter(([,items])=>items.length).map(([name,items])=>`<optgroup label="${name}">${items.map(option).join('')}</optgroup>`).join('');
    return `<section class="aa-ai-assistance" aria-label="AI test assistance"><h4>Create tests with AI</h4><p>Choose a subscription tool or use your own API key. Send this connection’s endpoint definitions and your request to the selected provider, then review its suggestions below.</p><div class="aa-fields"><label>AI provider<select name="aa-ai-author" ${aiRequest||apiSaving?'disabled':''}>${choices||'<option>Loading providers…</option>'}</select></label><label>Generate tests for<select name="aa-ai-target"><option value="endpoint" ${aiTarget==='endpoint'?'selected':''}>Selected endpoint</option><option value="connection" ${aiTarget==='connection'?'selected':''}>This connection / section</option></select></label></div>${author?.apiKeyProfile?`<div class="aa-api-setup">${apiSetup?`<section class="aa-api-config" aria-label="API key configuration"><h4>${authorId.startsWith('setup:')?'Add API key':'Edit API settings'}</h4><div class="aa-fields">${field('aa-api-model','Model ID',apiDraft.model,'text','autocomplete="off" placeholder="Model ID from your provider"')}${field('aa-api-key',authorId.startsWith('api:')?'API key (leave empty to keep saved key)':'API key','','password','autocomplete="off" spellcheck="false"')}${author.provider==='custom'?field('aa-api-endpoint','Full chat completions endpoint',apiDraft.customEndpoint,'url','placeholder="https://your-provider.example/v1/chat/completions"'):''}${field('aa-api-tokens','Output token limit',apiDraft.maxTokens,'number','min="1" step="1"')}</div><p>Keys are stored encrypted on this computer. Saving does not contact the provider. Generation uses your API account’s billing.</p>${apiConfigError?`<p role="alert">${esc(apiConfigError)}</p>`:''}<div class="aa-actions">${button('save-api-provider',apiSaving?'Saving…':'Save API provider',apiSaving?'disabled':'')}${authorId.startsWith('api:')?button('cancel-api-provider','Cancel'):''}</div></section>`:`<p>API key saved · ${esc(author.model)} ${button('edit-api-provider','Edit API settings',aiRequest?'disabled':'')}</p>`}</div>`:''}<label>What should the tests check?<textarea name="aa-ai-goal" rows="4" placeholder="For example: check successful responses, missing IDs and the response contract.">${esc(aiGoal)}</textarea></label><div class="aa-actions">${button('generate-ai',aiRequest?'Generating proposals…':'Generate test proposals',busy||aiRequest||apiSetup||apiSaving||!optionsLoaded||!section?.endpoints.length?'disabled':'')}${aiRequest?button('cancel-ai','Cancel generation'):''}${button('ai-providers','Manage saved agents / native tools')}${button('refresh-ai-providers','Refresh providers',apiSaving||aiRequest?'disabled':'')}</div>${aiOptionsError?`<p role="alert">${esc(aiOptionsError)}</p>`:''}<p class="aa-ai-status" role="status" aria-live="polite">${aiNotice?'<strong>App status:</strong> '+esc(aiNotice):''}</p><section class="aa-ai-response" aria-label="AI response and suggestions"><header><h4>AI response &amp; suggestions</h4><p>Everything in this section is generated by AI. Review the suggested request and expectations before accepting a test.</p></header><div class="aa-ai-response-body"><h5>Proposals for this connection (${pending.length} pending)</h5>${pending.map(proposalMarkup).join('')||'<p>No pending suggestions. Generate proposals using the controls above.</p>'}${reviewed.length?`<details class="aa-ai-reviewed"><summary>Reviewed AI suggestions (${reviewed.length})</summary>${reviewed.map(proposalMarkup).join('')}</details>`:''}</div></section></section>`;
  }
  function editApiProvider(){
    const author=authors.find(item=>item.id===authorId);apiSetup=true;apiConfigError='';apiDraft={model:author?.model||'',maxTokens:author?.maxTokens||8192,customEndpoint:author?.customEndpoint||''};paint();
  }
  async function saveApiProvider(){
    const author=authors.find(item=>item.id===authorId),keyInput=body.querySelector('[name="aa-api-key"]');
    const apiKey=keyInput?.value||'';if(keyInput)keyInput.value='';apiSaving=true;apiConfigError='';
    // Never embed entered keys in generated HTML. On failure the key must be
    // re-entered; model and non-secret settings remain in the draft.
    paint();
    try{const saved=await call('host','apiAtlasAiSaveProvider',{provider:author.provider,...apiDraft,apiKey,expectedRevision:author.revision??null});if(!current())return;authorId=saved.id;apiSetup=false;aiNotice='API provider saved. Choose Generate test proposals when ready.';await loadAuthors();}
    catch(error){if(current())apiConfigError=error.message;}
    finally{apiSaving=false;if(current())paint();}
  }
  async function generateAi() {
    if(aiRequest||apiSetup||apiSaving||authorId.startsWith('setup:')||!section)return;
    const scope={kind:section.kind,id:section.id,...(aiTarget==='endpoint'?{endpointId:selected}:{})};
    aiRequest=crypto.randomUUID();aiNotice='Generating proposals for '+section.title+'…';paint();
    try { const result=await call('host','apiAtlasAiGenerate',{requestId:aiRequest,authorId,goal:aiGoal,scope,expectedRevision:record?.revision});if(!current())return;await refreshAiData();aiNotice=result.count+' proposals imported for review. Accepting a test does not run it.'; }
    catch(error){if(current())aiNotice=error.message;}
    finally{aiRequest='';if(current())paint();}
  }
  async function reviewProposal(item,decision,test) {
    if(!item)throw Error('Reload the proposal list before reviewing this test.');
    await call('host','apiAtlasAiReview',{id:item.id,expectedRevision:item.revision,decision,...(test?{test}:{})});
    if(!current())return;await refreshAiData();if(proposalDraft?.id===item.id){proposalDraft=null;draft=null;draftDirty=false;}aiNotice=decision==='accept'?'Test accepted into the dashboard. It has not been run.':'Proposal rejected.';
  }
  async function persist(next) {
    if (!desktop || !workspaceRoot || sourceFailed) throw Error('Open a working desktop project before saving API tests.');
    const value = await window.LVXCredentials.protect(next, 'Service API tests');
    if (!current()) throw Error('This API workspace was closed.');
    const reply = await call('workspace', 'transact', { records: [{ collection: 'api-atlas', id: 'workspace', value, expectedRevision: record?.revision ?? null }] });
    const revision = reply.changes?.find(change => change.id === 'workspace')?.revision;
    if (!Number.isSafeInteger(revision)) throw Error('Storage did not confirm the saved tests. Reopen APIs & contracts.');
    record = { revision }; data = value;
    window.dispatchEvent(new CustomEvent('lvx-api-atlas-changed'));
  }
  const endpoint = () => data.atlas.endpoints.find(endpoint => endpoint.id === selected);
  function testsFor(endpointId = selected) { return data.tests.filter(test => test.endpointId === endpointId); }
  function latest(test) { const all=history.filter(run => run.testId === test.id).sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));return all.find(run=>run.definitionVersion===test.updatedAt)||all[0]; }
  function evidence(source) { return `${source.kind} · ${source.path}${source.line ? ':' + source.line : ''}${source.commit ? ' · ' + source.commit.slice(0, 8) : ''}${source.draft ? ' · local draft' : ''}`; }
  function testMarkup(test) {
    const previous = latest(test), result = previous && previous.definitionVersion === test.updatedAt ? previous : previous ? { ...previous, status: 'CHANGED SINCE RUN' } : null, disabled = busy ? 'disabled' : '';
    return `<tr><td><strong>${esc(test.name)}</strong><small>${test.origin ? 'Imported · ' + esc(test.origin.kind) : 'Created in LVX'}${data.atlas.endpoints.some(ep => ep.id === test.endpointId && !ep.retainedRequest) ? '' : ' · Outside current scan'}</small></td><td><span class="aa-method">${esc(test.method)}</span><code>${esc(test.url)}</code></td><td>${test.kind === 'contract' ? 'Status + response contract' : 'HTTP status'} ${esc(test.expectedStatus)}</td><td class="aa-status" data-status="${esc(result?.status || 'NOT RUN')}">${esc(result?.status || 'NOT RUN')}${result ? `<small>${esc(result.duration ?? '—')} ms · ${esc(new Date(result.finishedAt).toLocaleString())}</small>` : ''}</td><td><div class="aa-row-actions">${button('run', 'Run', `data-test="${esc(test.id)}" ${disabled}`)}${button('edit', 'Edit', `data-test="${esc(test.id)}" ${disabled}`)}${button('delete', 'Delete', `data-test="${esc(test.id)}" ${disabled}`)}</div></td></tr>${result ? `<tr class="aa-result-row"><td colspan="5"><details><summary>Inspect ${esc(test.name)} result · ${esc(result.status)}</summary>${result.error ? `<p role="alert">${esc(result.error)}</p>` : ''}<ul>${(result.checks || []).map(check => `<li>${check.passed ? 'Passed' : 'Failed'}: ${esc(check.name)}${check.actual !== undefined ? ' · actual ' + esc(check.actual) : ''}${check.expected !== undefined ? ' · expected ' + esc(check.expected) : ''}${check.violations?.length ? `<pre>${esc(JSON.stringify(check.violations, null, 2))}</pre>` : ''}</li>`).join('')}</ul><details><summary>Response and run definition</summary><pre>${esc(JSON.stringify(result, null, 2))}</pre></details><details><summary>Previous runs (${history.filter(run => run.testId === test.id).length})</summary><ol>${history.filter(run => run.testId === test.id).sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt))).map(run => `<li>${esc(run.status)} · ${esc(run.finishedAt)} · ${esc(run.id)}</li>`).join('')}</ol></details></details></td></tr>` : ''}`;
  }
  function editorMarkup() {
    if (!draft) return '';
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
    return `<form class="aa-editor" aria-label="Endpoint test editor"><h4>${proposalDraft ? 'Review AI test proposal' : draft.id ? 'Edit saved test' : 'Create ' + (draft.kind === 'contract' ? 'contract' : 'API') + ' test'}</h4><div class="aa-fields">${field('name', 'Test name', draft.name, 'text', 'required')}<label>Method<select name="method">${methods.map(method => `<option ${draft.method === method ? 'selected' : ''}>${method}</option>`).join('')}</select></label>${field('url', 'Full request URL', draft.url, 'url', 'required')}${field('expectedStatus', 'Expected HTTP status', draft.expectedStatus, 'number', 'min="100" max="599" required')}${field('timeoutMs', 'Timeout (ms)', draft.timeoutMs, 'number', 'min="1" required')}${field('maxLatency', 'Maximum response time (ms; 0 = no check)', draft.maxLatency || 0, 'number', 'min="0"')}</div><p>Replace path and query placeholders with test values. Runs contact this URL using the saved method and body.</p><details ${draft.kind === 'contract' ? 'open' : ''}><summary>Headers, request body and assertions</summary><div class="aa-fields aa-long-fields">${area('headers', 'Request headers (JSON; credentials are encrypted on save)', JSON.stringify(draft.headers || {}, null, 2))}${area('body', 'Request body', draft.body || '')}${field('bodyContains', 'Response must contain (optional)', draft.bodyContains || '')}${draft.kind === 'contract' ? area('schema', 'Response JSON schema', draft.schema === undefined ? '' : JSON.stringify(draft.schema, null, 2)) + `<label>Schema dialect<select name="dialect"><option value="draft-07" ${draft.dialect !== '2020-12' ? 'selected' : ''}>JSON Schema draft-07 / OpenAPI 3.0</option><option value="2020-12" ${draft.dialect === '2020-12' ? 'selected' : ''}>JSON Schema 2020-12 / OpenAPI 3.1</option></select></label>${Object.hasOwn(draft, 'expectedBody') ? area('expectedBody', 'Exact Pact response body (JSON)', JSON.stringify(draft.expectedBody, null, 2)) : ''}` : ''}${area('expectedHeaders', 'Expected response headers (JSON; optional)', JSON.stringify(draft.expectedHeaders || {}, null, 2))}</div></details><div class="aa-actions"><button type="submit" class="aero-button-success" ${busy ? 'disabled' : ''}>${proposalDraft ? 'Accept reviewed AI test' : 'Save and apply test'}</button>${button('cancel-draft', 'Cancel', busy ? 'disabled' : '')}</div></form>`;
  }
  function paint() {
    if (!current()) return;
    const focused = body.contains(document.activeElement) ? document.activeElement : null, focusControl=focused?.closest('[data-aa]'), focusData=focusControl?{...focusControl.dataset}:null;
    const oldEditor = body.querySelector('.aa-editor'), keepEditor = draft && oldEditor?.dataset.draftKey === String(draftKey) ? oldEditor : null;
    const atlas = data.atlas, ep = endpoint();
    const filter = root.querySelector('[name="aa-service"]'); filter.innerHTML = '<option value="">All services</option>' + atlas.services.map(service => `<option value="${esc(service.id)}" ${serviceFilter === service.id ? 'selected' : ''}>${esc(service.title)}</option>`).join('');
    const visible = atlas.endpoints.filter(ep => (!serviceFilter || ep.serviceId === serviceFilter) && (!query || [ep.method, ep.path, ep.name, atlas.services.find(s => s.id === ep.serviceId)?.name].join(' ').toLowerCase().includes(query)));
    root.querySelector('[data-aa="scan"]').disabled = busy || !desktop || !workspaceRoot || sourceFailed;
    root.querySelector('[data-aa="scan-local"]').disabled = busy || !desktop || !workspaceRoot || sourceFailed;
    root.querySelector('[data-aa="run-all"]').disabled = busy || !data.tests.length || draftDirty;
    root.querySelector('[data-aa="stop"]').hidden = !runningId;
    body.innerHTML = !atlas.services.length ? `<div class="aa-empty"><h3>Connect your repository APIs</h3><p>Import repositories in GitHub Actions, then scan here. OpenAPI descriptions, literal HTTP calls, Postman collections and Pact files become a shared service map.</p><p>The scan reads source files; it does not run repository code or send API requests.</p>${button('repositories', 'Open GitHub Actions')}</div>` : `<p class="aa-coverage">${atlas.endpoints.length} endpoints · ${atlas.connections.length} connection declarations · ${data.tests.length} saved tests · scanned ${esc(new Date(atlas.scannedAt).toLocaleString())}</p><details class="aa-coverage"><summary>What this map can see</summary><p>${esc(atlas.coverage)}</p><p>Workflow names provide repository context. An API edge does not imply a CI job calls that API.</p>${atlas.diagnostics.length ? `<ul>${atlas.diagnostics.map(d => `<li>${esc(d.path)}: ${esc(d.message)}</li>`).join('')}</ul>` : '<p>No parser diagnostics in this scan.</p>'}</details><div class="aa-layout"><div class="aa-map"><h3>Service connections</h3><p>Arrows show caller → provider or external destination. Dashed connections have no verified provider. Select an arrow to inspect its source.</p><div class="aa-services">${atlas.services.filter(s => !serviceFilter || s.id === serviceFilter).map(service => `<section class="aa-service" data-service="${esc(service.id)}"><header><div><h4>${esc(service.title)}${service.example ? ' · example' : ''}</h4><p>${esc(service.name)} · ${esc(service.workflow || 'No workflow selected')}</p></div><span>${service.scannedFiles} source files</span></header><div class="aa-endpoints">${visible.filter(ep => ep.serviceId === service.id).map(ep => { const tests = testsFor(ep.id), failed = tests.some(test => ['FAILED', 'ERROR'].includes(latest(test)?.status)); return button('endpoint', `<span class="aa-method">${esc(ep.method)}</span><span><strong>${esc(ep.path)}</strong><small>${esc((atlas.apiServices?.find(service => service.id === ep.apiServiceId)?.title || '') + ' · ' + (ep.summary || ep.confidence || 'Declared API'))} · ${tests.length ? tests.length + ' tests' : 'No tests yet'}${failed ? ' · Needs attention' : ''}</small></span>`, `data-endpoint="${esc(ep.id)}" aria-pressed="${selected === ep.id}"`); }).join('') || '<p>No endpoints in this filter. A source-only consumer may still have outgoing calls.</p>'}</div><ul class="aa-connections">${atlas.connections.filter(c => c.source === service.id).map(connection => { const target = [...atlas.services, ...(atlas.externalNodes || [])].find(s => s.id === (connection.target || connection.externalId)); return `<li>${button('connection', `<svg viewBox="0 0 48 16" aria-hidden="true" class="aa-connection-line ${target ? '' : 'aa-unresolved'}"><path d="M0 8H42M36 2L43 8L36 14"/></svg><span>${esc(connection.method)} ${esc(connection.url)}<small>→ ${esc(target?.title || 'Target unresolved')} · ${esc(connection.confidence)}</small></span>`, `data-connection="${esc(connection.id)}"`)}<small>${esc(evidence(connection.evidence))}</small></li>`; }).join('') || '<li>No outgoing calls found in this snapshot.</li>'}</ul></section>`).join('')}</div></div><section class="aa-inspector" aria-label="Endpoint tests">${ep ? `<header><h3>${esc(ep.summary || ep.path)}</h3><p><span class="aa-method">${esc(ep.method)}</span> <code>${esc(ep.path)}</code></p><p>${esc(ep.description)}</p></header><details><summary>Source evidence and API definition</summary><ul>${ep.evidence.map(source => `<li>${esc(evidence(source))}${source.pointer ? '<code>' + esc(source.pointer) + '</code>' : ''}</li>`).join('')}</ul><pre>${esc(JSON.stringify(ep, null, 2))}</pre></details><div class="aa-tabs" role="group" aria-label="Test type">${button('tab-api', 'API tests (' + testsFor().filter(t => t.kind === 'api').length + ')', `aria-pressed="${tab === 'api'}"`)}${button('tab-contract', 'Contract tests (' + testsFor().filter(t => t.kind === 'contract').length + ')', `aria-pressed="${tab === 'contract'}"`)}</div><p>${tab === 'api' ? 'Does this endpoint return what you expect?' : 'Does the response keep the data shape other services rely on?'}</p><div class="aa-actions">${button('new', 'Create ' + (tab === 'api' ? 'API' : 'contract') + ' test', busy ? 'disabled' : '')}${button('run-endpoint', 'Run endpoint tests', busy || !testsFor().length || draftDirty ? 'disabled' : '')}${button('graph', 'Add endpoint tests to workflow', busy || !testsFor().length || draftDirty ? 'disabled' : '')}</div>${editorMarkup()}<p>${testsFor().length} saved tests for this endpoint. ${button('show-library', 'View all saved tests')}</p>${importsMarkup(ep)}</section>` : '<h3>Choose a connection or endpoint</h3><p>Select a method and path on the service map. Its tests, contracts and run evidence will appear here.</p><p>API tests check behavior. Contract tests check that response data keeps its agreed shape.</p>'}</section></div>`;
    const incomplete = atlas.services.filter(service => service.scanStatus && service.scanStatus !== 'scanned');
    if (incomplete.length) {
      const report = document.createElement('section'); report.className = 'aa-scan-report'; report.setAttribute('aria-label', 'Repository scan coverage');
      report.innerHTML = `<h3>Repository scan coverage</h3><p>${incomplete.length} of ${atlas.services.length} repositories need more source. Existing endpoints and saved tests remain available.</p><ul>${incomplete.map(service => `<li><strong>${esc(service.name)}</strong> · ${esc(service.scanStatus)} · ${service.scannedFiles} files inspected<ul>${atlas.diagnostics.filter(d => d.serviceId === service.id).map(d => `<li>${esc(d.message)}</li>`).join('')}</ul></li>`).join('')}</ul>${button('retry-scan', 'Retry repository scan', busy ? 'disabled' : '')} ${button('repositories', 'Open GitHub sign-in')}</section>`;
      body.prepend(report);
    }
    const editor = body.querySelector('.aa-editor');
    if (atlas.services.length) { const network = document.createElement('section'); network.innerHTML = networkMarkup(atlas); body.prepend(network); }
    if (editor) { if (keepEditor) editor.replaceWith(keepEditor); const kept = body.querySelector('.aa-editor'); kept.dataset.draftKey = String(draftKey); for (const control of kept.querySelectorAll('button')) control.disabled = busy; }
    const unmatched = atlas.candidates.filter(candidate => !candidate.endpointId);
    if (unmatched.length) {
      const section = document.createElement('section'); section.className = 'aa-unmatched'; section.innerHTML = `<h3>Repository requests without a matched endpoint</h3><p>These request templates have source evidence. Their provider has not been identified in this map.</p>${unmatched.map(candidate => `<details><summary>${esc(candidate.evidence.kind)} · ${esc(candidate.name)}</summary><p>${esc(candidate.review)}</p><p>${esc(candidate.blocked || '')}</p><pre>${esc(JSON.stringify(candidate, null, 2))}</pre>${candidate.blocked ? '' : button('adopt-import', 'Review request as an endpoint test', `data-candidate="${esc(candidate.id)}" ${busy ? 'disabled' : ''}`)}</details>`).join('')}`; body.append(section);
    }
    const layout = body.querySelector('.aa-layout');
    if (section && layout) {
      section = apiSection(atlas, section.kind, section.id) || section;
      const scope = new Set(section.endpoints.map(ep => ep.id));
      if (!scope.has(selected)) selected = section.endpoints[0]?.id || '';
      const map = layout.querySelector('.aa-map');
      map.innerHTML = '<h4>Relevant endpoints (' + section.endpoints.length + ')</h4><div class="aa-endpoints">' + section.endpoints.map(ep => button('endpoint', '<span class="aa-method">' + esc(ep.method) + '</span><span><strong>' + esc(ep.path) + '</strong><small>' + esc(ep.summary || ep.confidence || 'Declared API') + ' · ' + testsFor(ep.id).length + ' saved tests</small></span>', 'data-endpoint="' + esc(ep.id) + '" aria-pressed="' + (selected === ep.id) + '"')).join('') + '</div>';
      if (!section.endpoints.length) {
        map.innerHTML += '<p>No mapped endpoints for this connection. Import the provider API description or scan more source.</p>';
        layout.querySelector('.aa-inspector').innerHTML = '<h4>Source destination</h4><p>' + esc(section.edge?.url || section.title) + '</p><p>LVX has not identified a provider endpoint here. Review the source before creating a request test.</p>' + (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(section.edge?.method) && /^https?:\/\//.test(section.edge?.url) ? button('review-connection', 'Review this request as a test') : '') + button('repositories', 'Open provider repositories');
      }
      const bubble = document.createElement('section'); bubble.className = 'aa-bubble'; bubble.setAttribute('popover','manual'); bubble.setAttribute('role','dialog'); bubble.setAttribute('aria-modal','false'); bubble.setAttribute('aria-labelledby','aa-bubble-title');
      bubble.innerHTML = '<svg class="aa-bubble-connector" aria-hidden="true" hidden><path/></svg><header class="aa-bubble-header"><div><h3 id="aa-bubble-title" tabindex="-1">' + esc(section.title) + '</h3><p>' + esc(section.description) + '</p></div>' + (runningId ? button('stop', 'Stop current run') : '') + button('close-section', icon('close'), 'aria-label="Close connection panel" title="Close connection panel"') + '</header><details class="aa-connection-evidence"><summary>Connection source evidence (' + section.evidence.length + ')</summary><ul>' + section.evidence.map(source => '<li>' + esc(evidence(source)) + '</li>').join('') + '</ul></details><p class="aa-bubble-notice" role="status" aria-live="polite">' + esc(panelNotice) + '</p><div class="aa-anchor-note" hidden><span></span> ' + button('show-anchor','Show selected connection') + '</div><div class="aa-panel-tabs" role="tablist" aria-label="Connection tools">' + button('panel-tests','Tests &amp; endpoints', 'role="tab" aria-selected="' + (panelTab==='tests') + '" aria-controls="aa-test-pane" id="aa-tests-tab"') + button('panel-ai','AI assistance', 'role="tab" aria-selected="' + (panelTab==='ai') + '" aria-controls="aa-ai-pane" id="aa-ai-tab"') + '</div><div class="aa-bubble-content"><div class="aa-test-pane" id="aa-test-pane" role="tabpanel" aria-labelledby="aa-tests-tab" ' + (panelTab==='tests'?'':'hidden') + '></div><div class="aa-ai-pane" id="aa-ai-pane" role="tabpanel" aria-labelledby="aa-ai-tab" ' + (panelTab==='ai'?'':'hidden') + '>' + aiMarkup() + '</div></div>';
      bubble.querySelector('.aa-test-pane').append(layout); body.append(bubble); bubble.showPopover(); positionBubble();
    } else if (layout) {
      const browser = document.createElement('details'); browser.className = 'aa-browser'; browser.open = browserOpen;
      browser.innerHTML = '<summary>Browse all endpoints (' + atlas.endpoints.length + ')</summary>'; layout.replaceWith(browser); browser.append(layout); browser.ontoggle = () => { browserOpen = browser.open; };
    }
    const library = document.createElement('section'); library.className = 'aa-test-library'; library.setAttribute('aria-label','All API and contract tests');
    library.innerHTML = '<h3 tabindex="-1">All API &amp; contract tests</h3><p>' + data.tests.filter(test => test.kind === 'api').length + ' API tests · ' + data.tests.filter(test => test.kind === 'contract').length + ' contract tests. Includes tests created here, reviewed repository imports and retained tests outside the current scan. This list is independent of the selected connection and search filters.</p><div class="aa-table-scroll"><table><caption>All saved endpoint tests</caption><thead><tr><th>Test &amp; origin</th><th>Request</th><th>Expected result</th><th>Last run</th><th>Actions</th></tr></thead><tbody>' + (data.tests.map(testMarkup).join('') || '<tr><td colspan="5">No saved tests yet. Select a connection or endpoint, then create an API or contract test.</td></tr>') + '</tbody></table></div>';
    body.append(library);
    const proposalSection=document.createElement('section');proposalSection.className='aa-proposal-library';proposalSection.setAttribute('aria-label','AI generated test proposals');
    const pending=proposals.filter(item=>item.value.state==='pending'),reviewed=proposals.filter(item=>item.value.state!=='pending');
    proposalSection.innerHTML=(aiRequest?'<p role="status">App status: '+esc(aiNotice)+'</p>'+button('cancel-ai','Cancel generation'):'')+'<section class="aa-ai-response" aria-label="All AI responses and suggestions"><header><h3>AI response &amp; suggestions</h3><p>Everything in this section is generated by AI. Inspect or edit each suggestion, then accept or reject it. Accepted tests appear in the test list above.</p></header><div class="aa-ai-response-body"><h4>All AI generated test proposals ('+pending.length+' pending)</h4>'+(pending.map(proposalMarkup).join('')||'<p>No pending AI proposals. Open a connection and choose AI assistance to create some.</p>')+(reviewed.length?'<details><summary>Reviewed proposals ('+reviewed.length+')</summary>'+reviewed.map(proposalMarkup).join('')+'</details>':'')+'</div></section>';body.append(proposalSection);
    if (focused && keepEditor?.contains(focused)) focused.focus({preventScroll:true});
    else if (focusData) { const replacement=[...body.querySelectorAll('[data-aa]')].find(control=>Object.entries(focusData).every(([key,value])=>control.dataset[key]===value)); replacement?.focus({preventScroll:true}); }
  }
  function importsMarkup(ep) {
    const candidates = data.atlas.candidates.filter(candidate => candidate.endpointId === ep.id || !candidate.endpointId && candidate.serviceId === ep.serviceId && (() => { try { return new URL(candidate.url).pathname === ep.path; } catch { return candidate.url.split('?')[0] === ep.path; } })());
    return `<details class="aa-imports" open><summary>Repository test imports (${candidates.length})</summary>${candidates.map(candidate => `<article><h4>${esc(candidate.name)} · ${esc(candidate.evidence.kind)}</h4><p>${esc(candidate.review)}</p><p>${esc(evidence(candidate.evidence))}</p>${candidate.blocked ? `<p>${esc(candidate.blocked)}</p>` : button('import', 'Review imported test', `data-candidate="${esc(candidate.id)}" ${busy ? 'disabled' : ''}`)}<details><summary>Original imported expectations</summary><pre>${esc(JSON.stringify(candidate, null, 2))}</pre></details></article>`).join('') || '<p>No matching Postman or Pact interactions were found. Tests embedded in arbitrary code stay available in the repository editor.</p>'}</details>`;
  }
  async function scan(localOnly = false) {
    if (!canLeave()) return;
    busy = true; section = null; panelNotice = ''; draft = null; draftDirty = false; paint(); say('Reading API descriptions and HTTP source at each imported commit…');
    try {
      const saved = await call('workspace', 'read', { collection: 'github-workflow-views', id: 'repository-lanes' });
      const repositories = saved?.value?.repositories || [];
      if (!repositories.length) throw Error('Import repositories in GitHub Actions first, then scan again.');
      const snapshots = await collectApiSnapshots(repositories, { localOnly, isCurrent: current, onProgress: say,
        loadSources: (repo, index) => repo.example ? { files: repo.files?.some(file => /openapi|swagger|pact|postman/i.test(file.path)) ? repo.files : exampleSources(repo, index), skipped: [], complete: true } : call('githubStudio', 'apiSources', { repository: repo.fullName, commit: repo.commit, credentialReference: getCredentialReference() || undefined })
      });
      const atlas = retainPartialEvidence(data.atlas, await call('githubStudio', 'apiDiscover', { repositories: snapshots }));
      if (!current()) return;
      await persist({ ...data, atlas }); selected = atlas.endpoints.some(ep => ep.id === selected) ? selected : atlas.endpoints[0]?.id || '';
      const incomplete = atlas.services.filter(service => service.scanStatus !== 'scanned').length;
      say(incomplete ? `Map saved with partial coverage: ${incomplete}/${repositories.length} repositories need more source. See Repository scan coverage for the reason and recovery.` : 'Scan saved. Review source evidence and imported tests before running them.', !!incomplete);
    } finally { busy = false; paint(); }
  }
  function startDraft(kind, test = null, proposal = null) {
    if (!canLeave()) return;
    const ep = endpoint(); if (!ep) return;
    proposalDraft=proposal;
    draft = test ? structuredClone(test) : { kind, endpointId: ep.id, name: (ep.summary || ep.method + ' ' + ep.path) + (kind === 'contract' ? ' contract' : ' response'), method: ep.method, url: (ep.baseUrl || '') + ep.path, expectedStatus: ep.expectedStatus || 200, timeoutMs: 10000, headers: {}, body: '', ...(kind === 'contract' && ep.schema !== undefined ? { schema: ep.schema, dialect: ep.dialect } : {}) };
    draftKey++; tab = draft.kind; draftDirty = false; paint(); body.querySelector('.aa-editor input')?.focus();
  }
  async function saveDraft(form) {
    const values = new FormData(form), test = { ...draft, id: draft.id || crypto.randomUUID(), endpointId: selected, updatedAt: new Date().toISOString(), name: values.get('name').trim(), method: values.get('method'), url: values.get('url').trim(), expectedStatus: Number(values.get('expectedStatus')), timeoutMs: Number(values.get('timeoutMs')), maxLatency: Number(values.get('maxLatency')), body: values.get('body'), bodyContains: values.get('bodyContains'), headers: JSON.parse(values.get('headers') || '{}'), expectedHeaders: JSON.parse(values.get('expectedHeaders') || '{}') };
    if (test.kind === 'contract') { const schema = values.get('schema'); if (schema.trim()) test.schema = JSON.parse(schema); else delete test.schema; test.dialect = values.get('dialect'); if (values.has('expectedBody')) test.expectedBody = JSON.parse(values.get('expectedBody')); }
    await call('githubStudio', 'apiValidateTest', { test });
    if(proposalDraft){const {id,updatedAt,origin,...definition}=test;await reviewProposal(proposalDraft,'accept',definition);proposalDraft=null;}
    else await persist({ ...data, tests: [...data.tests.filter(item => item.id !== test.id), test] });
    draft = null; draftDirty = false; paint(); say('Test saved. It can now be rerun from this endpoint or added to a workflow.');
  }
  async function runTests(tests) {
    if (!tests.length || busy) return;
    if (draftDirty) throw Error('Save or cancel the test draft before running saved tests.');
    busy = true;
    try {
      for (const test of tests) {
        if (!current()) break;
        runningId = crypto.randomUUID(); paint(); say('Running ' + test.name + '…');
        const run = await call('host', 'apiAtlasRun', { testId: test.id, requestId: runningId, expectedRevision: record.revision });
        history.push(run);
        if (window.testHistoryManager) window.testHistoryManager.recordExecution('api-atlas:' + test.id, test.name, { status: run.status, executionTime: run.duration || 0, errorMessage: run.error || null });
        if (run.status === 'CANCELLED') break;
      }
      say('Run finished. Inspect each result for assertions, response data and previous runs.');
    } finally { busy = false; runningId = ''; paint(); }
  }
  async function addGraph() {
    const ep = endpoint(), tests = testsFor();
    const id = crypto.randomUUID();
    const graph = { schemaVersion: 1, id, name: 'API checks · ' + ep.method + ' ' + ep.path, nodes: tests.map((test, index) => ({ id: 'api-' + test.id, type: test.kind === 'contract' ? 'api-contract' : 'api-performance', position: { x: 70 + index % 3 * 300, y: 90 + Math.floor(index / 3) * 180 }, data: { name: test.name, url: test.url, method: test.method, expectedStatus: test.expectedStatus, timeoutMs: test.timeoutMs, schema: test.schema, apiAtlasDefinition: structuredClone(test), apiAtlasEndpointId: ep.id } })), edges: [], concurrency: 2 };
    const validation = await call('execution', 'validateWorkflow', { workflow: graph });
    if (!validation.valid) throw Error(validation.errors.join(' '));
    await call('workspace', 'transact', { records: [{ collection: 'workflows', id, value: graph, expectedRevision: null }] });
    say('Saved workflow with ' + tests.length + ' endpoint tests.');
    onOpenGraph?.(id);
  }
  const onEscape = event => { if (event.key === 'Escape' && section) { event.preventDefault(); event.stopPropagation(); closeSection(); } };
  document.addEventListener('keydown', onEscape, true);
  window.addEventListener('resize', resizeBubble);
  document.addEventListener('scroll', schedulePointer, true);
  const act = work => Promise.resolve().then(work).catch(error => say(error.message, true));
  root.onclick = event => {
    const control = event.target.closest('[data-aa]'); if (!control || control.disabled) return;
    const action = control.dataset.aa;
    if (busy && !['stop','close-section','show-library','cancel-ai'].includes(action)) return;
    if (action === 'scan' || action === 'retry-scan') void act(() => scan());
    if (action === 'scan-local') void act(() => scan(true));
    if (action === 'repositories') void window.LVXStudio.open('githubActions');
    if (action === 'endpoint') { if (control.closest('.aa-bubble')) { if (canLeave()) { selected = control.dataset.endpoint; draft = null; draftDirty = false; paint(); body.querySelector('.aa-inspector h3')?.focus({preventScroll:true}); } } else openSection('endpoint', control.dataset.endpoint, control, event); }
    if (action === 'panel-tests' || action === 'panel-ai') { panelTab=action==='panel-ai'?'ai':'tests';paint();if(panelTab==='ai'&&!optionsLoaded)void loadAuthors(); }
    if (action === 'generate-ai') void generateAi();
    if (action === 'cancel-ai') void act(()=>call('host','cancelRequest',{requestId:aiRequest}));
    if (action === 'refresh-ai-providers') void loadAuthors();
    if (action === 'edit-api-provider') editApiProvider();
    if (action === 'cancel-api-provider') {apiSetup=false;apiConfigError='';paint();}
    if (action === 'save-api-provider'&&!apiSaving) void saveApiProvider();
    if (action === 'ai-providers') void window.LVXStudio.open('agentBoard');
    if (['accept-proposal','reject-proposal'].includes(action)) void act(async()=>{if(draftDirty)throw Error('Save or cancel your current test draft before reviewing another proposal.');busy=true;paint();try{await reviewProposal(proposals.find(item=>item.id===control.dataset.proposal),action==='accept-proposal'?'accept':'reject');}finally{busy=false;paint();}});
    if (action === 'review-proposal') {const item=proposals.find(item=>item.id===control.dataset.proposal);if(item&&canLeave()){draft=null;draftDirty=false;const scope=item.value.scope;if(section?.kind!==scope.kind||section?.id!==scope.id)openSection(scope.kind,scope.id,control);selected=item.value.test.endpointId;panelTab='tests';startDraft(item.value.test.kind,{...item.value.test,id:undefined},item);body.querySelector('.aa-editor input')?.focus();}}
    if (action === 'connection') openSection('connection', control.dataset.connection, control, event);
    if (action === 'section') openSection('node', control.dataset.section, control, event);
    if (action === 'close-section') closeSection();
    if (action === 'show-anchor') { sourceControl()?.scrollIntoView({block:'center',inline:'center'}); bubblePlacement=null; requestAnimationFrame(()=>{const p=sourcePoint();if(p)bubbleAnchor={left:p.x,right:p.x,top:p.y,bottom:p.y};positionBubble();}); }
    if (action === 'show-library') { closeSection(); if (!section) { body.querySelector('.aa-test-library').scrollIntoView({block:'start'}); body.querySelector('.aa-test-library h3').focus({preventScroll:true}); } }
    if (action === 'review-connection') void act(async () => {
      if (!canLeave()) return;
      const edge = section?.edge; if (!edge || !/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(edge.method)) return;
      const url = new URL(edge.url); if (!['http:', 'https:'].includes(url.protocol)) return;
      const ep = { id: 'connection-request-' + edge.id, connectionId: edge.id, serviceId: edge.source, method: edge.method, path: url.pathname + url.search, baseUrl: url.origin, summary: edge.method + ' ' + url.pathname, description: 'Source request with an unverified provider. Confirm the target before running.', evidence: [edge.evidence], expectedStatus: 200 };
      if (!data.atlas.endpoints.some(item => item.id === ep.id)) await persist({...data, atlas:{...data.atlas, endpoints:[...data.atlas.endpoints,ep]}});
      selected = ep.id; startDraft('api');
    });
    if (action?.startsWith('tab-') && canLeave()) { tab = action === 'tab-api' ? 'api' : 'contract'; draft = null; draftDirty = false; paint(); }
    if (action === 'new') startDraft(tab);
    if (action === 'cancel-draft' && canLeave()) { proposalDraft=null; draft = null; draftDirty = false; paint(); }
    if (action === 'edit') void act(async () => {
      const test = data.tests.find(test => test.id === control.dataset.test);
      if (!canLeave()) return;
      draft = null; draftDirty = false;
      if (!data.atlas.endpoints.some(ep => ep.id === test.endpointId)) {
        const serviceId = data.atlas.services[0]?.id || 'saved-requests';
        const service = { id: serviceId, title: 'Saved requests', name: 'Local saved requests', scannedFiles: 0 };
        const ep = { id: test.endpointId, serviceId, method: test.method, path: new URL(test.url).pathname, summary: test.name, evidence: [], retainedRequest: true, description: 'Retained test request; no endpoint was found in the latest scan.' };
        await persist({ ...data, atlas: { ...data.atlas, services: data.atlas.services.length ? data.atlas.services : [service], endpoints: [...data.atlas.endpoints, ep] } });
      }
      openSection('endpoint', test.endpointId, control); selected = test.endpointId; draftDirty = false; startDraft(test.kind, test);
    });
    if (action === 'import') { const candidate = data.atlas.candidates.find(c => c.id === control.dataset.candidate); startDraft(candidate.kind, { ...candidate, id: undefined, endpointId: selected, origin: candidate.evidence, timeoutMs: 10000 }); say(candidate.review); }
    if (action === 'adopt-import') void act(async () => {
      if (!canLeave()) return;
      const candidate = data.atlas.candidates.find(c => c.id === control.dataset.candidate), id = 'request-' + candidate.id;
      let path; try { path = new URL(candidate.url).pathname; } catch { path = candidate.url; }
      const ep = { id, serviceId: candidate.serviceId, method: candidate.method, path, baseUrl: '', summary: candidate.name, description: 'Imported request target. The provider service is unresolved.', evidence: [candidate.evidence], expectedStatus: candidate.expectedStatus };
      await persist({ ...data, atlas: { ...data.atlas, endpoints: [...data.atlas.endpoints.filter(ep => ep.id !== id), ep], candidates: data.atlas.candidates.map(item => item.id === candidate.id ? { ...item, endpointId: id } : item) } });
      draftDirty = false; draft = null; openSection('endpoint', id, control); selected = id; startDraft(candidate.kind, { ...candidate, id: undefined, endpointId: id, origin: candidate.evidence, timeoutMs: 10000 });
    });
    if (action === 'delete') void act(async () => { if (!window.confirm('Delete this saved test? Previous run evidence is kept.')) return; await persist({ ...data, tests: data.tests.filter(test => test.id !== control.dataset.test) }); paint(); say('Test deleted.'); });
    if (action === 'run') void act(() => runTests(data.tests.filter(test => test.id === control.dataset.test)));
    if (action === 'run-all') void act(() => runTests(data.tests));
    if (action === 'run-endpoint') void act(() => runTests(testsFor()));
    if (action === 'stop') void act(() => call('host', 'cancelRequest', { requestId: runningId }));
    if (action === 'graph') void act(addGraph);
  };
  root.oninput = event => { if(event.target.name==='aa-ai-goal')aiGoal=event.target.value; const setting={'aa-api-model':'model','aa-api-tokens':'maxTokens','aa-api-endpoint':'customEndpoint'}[event.target.name];if(setting)apiDraft[setting]=event.target.value; if (event.target.closest('.aa-editor')) draftDirty = true; if (event.target.name === 'aa-search') { query = event.target.value.toLowerCase(); if (query) browserOpen = true; paint(); } };
  root.onchange = event => { if(event.target.name==='aa-ai-author'){authorId=event.target.value;apiSetup=false;apiConfigError='';if(authorId.startsWith('setup:'))editApiProvider();else paint();} if(event.target.name==='aa-ai-target')aiTarget=event.target.value; if (event.target.name === 'aa-service') { serviceFilter = event.target.value; paint(); } };
  root.onkeydown = event => { if(event.target.closest('.aa-panel-tabs')&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();panelTab=panelTab==='ai'?'tests':'ai';paint();body.querySelector('[data-aa="panel-'+panelTab+'"]')?.focus();if(panelTab==='ai'&&!optionsLoaded)void loadAuthors();return;} const target = event.target.closest('g[data-aa]'); if (target && ['Enter', ' '].includes(event.key)) { event.preventDefault(); target.dispatchEvent(new MouseEvent('click', { bubbles: true })); } };
  root.onsubmit = event => { if (!event.target.matches('.aa-editor')) return; event.preventDefault(); if (busy) return; void act(async () => { busy = true; try { await saveDraft(event.target); } finally { busy = false; paint(); } }); };
  try {
    if (desktop && workspaceRoot) {
      const [saved, runs, board] = await Promise.all([call('workspace', 'read', { collection: 'api-atlas', id: 'workspace' }), call('workspace', 'list', { collection: 'api-atlas-runs' }), call('workspace', 'read', { collection: 'github-workflow-views', id: 'repository-lanes' })]);
      if (saved) { if (saved.value.version !== 1 || !Array.isArray(saved.value.tests) || !Array.isArray(saved.value.atlas?.endpoints)) throw Error('The saved API map has an unsupported format. Restore a project backup.'); record = saved; data = saved.value; }
      if (!saved && board?.value?.repositories?.length) data.atlas = await call('githubStudio', 'apiDiscover', { repositories: await collectApiSnapshots(board.value.repositories, { localOnly: true }) });
      history = records(runs).map(record => record.value);
      proposals=records(await call('workspace','list',{collection:'api-atlas-proposals'}));
    }
  } catch (error) { sourceFailed = true; say('Cannot load saved API data: ' + error.message, true); }
  selected = data.atlas.endpoints[0]?.id || ''; paint();
  if (!desktop || !workspaceRoot) say('Choose a desktop project folder in Project setup to scan repositories and save API tests.');
  return { canLeave, unmount() { active = false; if(aiRequest)void call('host','cancelRequest',{requestId:aiRequest}).catch(()=>{}); document.removeEventListener('keydown', onEscape, true); window.removeEventListener('resize', resizeBubble); document.removeEventListener('scroll', schedulePointer, true); bubbleObserver.disconnect(); if (pointerFrame) cancelAnimationFrame(pointerFrame); body.querySelector('.aa-bubble')?.remove(); if (runningId) void call('host', 'cancelRequest', { requestId: runningId }).catch(() => {}); root.onclick = root.onsubmit = root.oninput = root.onchange = root.onkeydown = null; }, selectEndpoint(id) { openSection('endpoint', id); } };
}

// Add the same endpoint entry points to the existing repository workflow lanes.
export async function attachRepositoryApiLinks(root, { invoke, workspaceRoot, repositories = [], isCurrent = () => true } = {}) {
  if (!workspaceRoot) return;
  const record = await invoke('workspace', 'read', { workspaceRoot, collection: 'api-atlas', id: 'workspace' });
  if (!isCurrent()) return;
  const atlas = record?.value?.atlas;
  root.querySelector('.aa-repository-overview')?.remove();
  if (repositories.length) {
    const ids = new Set(repositories.filter(repo => atlas?.services.some(service => service.id === repo.id && service.commit === repo.commit)).map(repo => repo.id));
    const visible = { ...emptyAtlas(), services: repositories.map(repo => atlas?.services.find(service => ids.has(repo.id) && service.id === repo.id) || { id: repo.id, name: repo.fullName, title: repo.fullName.split('/').at(-1), scanStatus: 'not scanned' }),
      endpoints: atlas?.endpoints.filter(ep => ids.has(ep.serviceId)) || [], connections: atlas?.connections.filter(edge => ids.has(edge.source) && (!edge.target || ids.has(edge.target))) || [], apiServices: (atlas?.apiServices || []).filter(service => ids.has(service.repositoryId)), externalNodes: atlas?.externalNodes || [] };
    const overview = document.createElement('section'); overview.className = 'aa-workspace aa-repository-overview'; overview.setAttribute('aria-label', 'Repository and service connections');
    overview.innerHTML = `<h3>Repository & service connections</h3><p>Source-backed API links across the repositories on this board. External destinations have dashed arrows; a missing arrow means no connection has been identified in the imported source.</p>${networkMarkup(visible)}<p class="aa-overview-evidence" role="status">Select an arrow to inspect its source, or scan repository APIs for wider coverage.</p>${button('overview-apis', 'Open APIs & contracts')}`;
    overview.onclick = event => {
      const control = event.target.closest('[data-aa]'); if (!control) return;
      if (control.dataset.aa === 'connection') {
        const edge = networkConnections(visible).find(edge => edge.id === control.dataset.connection);
        overview.querySelector('.aa-overview-evidence').textContent = `${edge.method} ${edge.url} · ${edge.confidence} · ${edge.evidence.path}:${edge.evidence.line || 1} · ${edge.evidence.commit || 'local source'}`;
      } else window.dispatchEvent(new CustomEvent('lvx-open-api-atlas'));
    };
    overview.onkeydown = event => { const edge = event.target.closest('g[data-aa]'); if (edge && ['Enter', ' '].includes(event.key)) { event.preventDefault(); edge.dispatchEvent(new MouseEvent('click', { bubbles: true })); } };
    root.prepend(overview);
  }
  for (const lane of root.querySelectorAll('.gw-lane')) {
    lane.querySelector('.aa-lane-ports')?.remove();
    const name = lane.querySelector('h3')?.textContent, service = atlas?.services.find(service => service.name === name), endpoints = atlas?.endpoints.filter(ep => ep.serviceId === service?.id) || [];
    const section = document.createElement('section'); section.className = 'aa-lane-ports'; section.setAttribute('aria-label', 'API connections for ' + name);
    section.innerHTML = `<strong>Service APIs</strong>${endpoints.slice(0, 10).map(ep => button('lane-endpoint', esc(ep.method) + ' ' + esc(ep.path), `data-endpoint="${esc(ep.id)}"`)).join('')}${button('lane-all', endpoints.length ? 'All ' + endpoints.length + ' endpoints & tests' : 'Scan APIs & contracts')}${atlas?.connections.filter(c => c.source === service?.id).map(connection => `<span>→ ${esc([...atlas.services, ...(atlas.externalNodes || [])].find(s => s.id === (connection.target || connection.externalId))?.title || 'Unresolved target')} · ${esc(connection.confidence)}</span>`).join('') || ''}`;
    section.onclick = event => { const control = event.target.closest('[data-aa]'); if (control) window.dispatchEvent(new CustomEvent('lvx-open-api-atlas', { detail: { endpointId: control.dataset.endpoint } })); };
    lane.append(section);
  }
}

export async function appendApiRunHistory(host,{invoke,workspaceRoot,isCurrent=()=>true}={}) {
  const result=await invoke('workspace','list',{workspaceRoot,collection:'api-atlas-runs'});
  if(!isCurrent())return;
  const runs=records(result).map(record=>record.value).sort((a,b)=>String(b.finishedAt).localeCompare(String(a.finishedAt)));
  const section=document.createElement('section');section.className='studio-section aa-workspace';
  section.innerHTML=`<h3>API & contract test results</h3><p>Endpoint runs and workflow copies share their evidence here. Workflow copies retain the definition used in that run.</p><button type="button" data-open-api>Open APIs & contracts</button>${runs.length?`<div class="aa-table-scroll"><table><caption>Endpoint run history</caption><thead><tr><th>Test</th><th>Result</th><th>When</th><th>Evidence</th></tr></thead><tbody>${runs.map(run=>`<tr><td>${esc(run.name)}${run.workflowRunId?'<small>Workflow '+esc(run.workflowRunId)+'</small>':''}</td><td class="aa-status" data-status="${esc(run.status)}">${esc(run.status)}</td><td>${esc(run.finishedAt)}</td><td><details><summary>Inspect run</summary><pre>${esc(JSON.stringify(run,null,2))}</pre><button type="button" data-endpoint="${esc(run.endpointId)}">Open endpoint tests</button></details></td></tr>`).join('')}</tbody></table></div>`:'<p>No API runs yet. Create a test from a service endpoint to start.</p>'}`;
  section.onclick=event=>{const control=event.target.closest('button');if(control)window.dispatchEvent(new CustomEvent('lvx-open-api-atlas',{detail:{endpointId:control.dataset.endpoint}}));};host.append(section);
}
