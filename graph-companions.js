import { createBoardController, chatOwnershipLine, renderChatText, readAgentPicture } from './agent-board.js';
import { appendImportReviewAction } from './import-review-recovery.js';
import { Group, Tween, Easing } from './assets/vendor/tween.esm.js';
import { targetKey, workspaceKey, resolveCompanionContext, validatePlacements, contextualMessage, yamlProposal, graphProposal, roamingPoint, nodeRoamingPoint, AGENT_SIZE, savedAgentPoint, panelRect, savedPanel, resizePanel } from './graph-companion-model.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => window.LVXIcons?.svg(name) || '';
const safeImage = value => /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value || '') ? value : '';
const hueOf = color => {
  const [r,g,b] = [1,3,5].map(index => parseInt(color.slice(index,index+2),16)/255), max = Math.max(r,g,b), min = Math.min(r,g,b), delta = max-min;
  if (!delta) return 0;
  return ((max===r ? (g-b)/delta : max===g ? (b-r)/delta+2 : (r-g)/delta+4)*60+360)%360;
};
const button = (action, label, symbol, extra = '') => `<button type="button" data-gc="${action}" ${extra}>${icon(symbol)}${esc(label)}</button>`;

export function mountGraphCompanions(host, { invoke, onEvent, workspaceRoot, surface, getTargets, getViewContext, onManage, onApplyYAML, onApplyGraph, desktop = true, followCurrentGraph = false } = {}) {
  let active = true, busy = false, unavailable = false, controller, settingsRecord = null, settings = { version: 1, boardId: '', agents: [] }, frame, nextMotion = 0, timer, refreshPending = false, motionAllowed = true;
  const chats = new Map(), sprites = new Map(), motions = new Group(), reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let gesture = null, suppressClick = null, front = 1, lastGraphTarget = '';
  const root = document.createElement('section'); root.className = 'gc-root'; root.setAttribute('aria-label', 'Agents on this view');
  root.innerHTML = `<div class="gc-toolbar"><strong>${icon('robot')} Agents on this view</strong><label>Agent board<select name="gc-board" aria-label="Agent board"><option value="">Choose a saved board</option></select></label><label>Agent<select name="gc-agent" aria-label="Agent to place"><option value="">Choose an agent</option></select></label>${button('place', 'Place agent', 'plus')}${button('manage', 'Create / manage agents', 'settings')}${button('refresh', 'Refresh agents', 'refresh')}</div><p class="gc-help">Drag an agent to place it manually; click it to chat. Move conversations by their title bars and resize from their edges or corners. Gear settings control assignments and roaming. Messages use the agent’s configured folder.</p><p class="gc-notice" role="status" aria-live="polite"></p>`;
  host.prepend(root); host.classList.add('gc-surface');
  const overlay = document.createElement('div'); overlay.className = 'gc-overlay'; overlay.setAttribute('aria-label', 'Placed agents'); host.append(overlay);
  const windows = document.createElement('div'); windows.className = 'gc-windows'; windows.setAttribute('aria-label', 'Agent conversations'); document.body.append(windows);
  const links = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); links.classList.add('gc-links'); links.setAttribute('aria-hidden', 'true'); document.body.append(links);
  const notice = root.querySelector('.gc-notice'), boards = root.querySelector('[name="gc-board"]'), agentPicker = root.querySelector('[name="gc-agent"]');
  const targets = () => getTargets?.() || [];
  const contextFor = placement => resolveCompanionContext(placement, targets(), followCurrentGraph);
  const call = (domain, action, payload = {}) => invoke(domain, action, { ...payload, workspaceRoot });
  const say = (text, error = false) => { if (!active) return; notice.textContent = text; notice.setAttribute('role', error ? 'alert' : 'status'); for (const panel of chats.values()) {const label=panel.element.querySelector('.gc-chat-notice');label.textContent=error?text:'';label.setAttribute('role',error?'alert':'status');} };
  const state = () => controller?.state;
  const run = async (fn, accept) => {
    if (busy || !active || gesture) return;
    busy = true; renderControls();
    try { await accept?.(); return await fn(); } catch (error) {
      say(error.message, true);
      const recover = () => run(fn, error.acceptImportReview);
      appendImportReviewAction(notice, error, recover);
      for (const panel of chats.values()) appendImportReviewAction(panel.element.querySelector('.gc-chat-notice'), error, recover);
    }
    finally { busy = false; if (active) { renderControls(); renderAgents(); } }
  };
  async function persist(next) {
    const valid = validatePlacements(next);
    if (!active) throw Error('This view was closed.');
    const result = await call('workspace', 'transact', { records: [{ collection: 'graph-companions', id: surface, value: valid, expectedRevision: settingsRecord?.revision ?? null }] });
    if (!active) return;
    const revision = result.changes?.find(r => r.collection === 'graph-companions' && r.id === surface)?.revision;
    if (!Number.isSafeInteger(revision)) throw Error('Storage did not confirm the agent placements. Reopen this view.');
    settingsRecord = { revision }; settings = valid;
  }
  function renderControls() {
    if (!active) return;
    const list = state()?.boards || [], old = boards.value;
    boards.innerHTML = '<option value="">Choose a saved board</option>' + list.map(r => `<option value="${esc(r.id)}">${esc(r.value.name)}</option>`).join('');
    boards.value = state()?.record?.id || old;
    const selection = agentPicker.value;
    agentPicker.innerHTML = '<option value="">Choose an agent</option>' + (state()?.draft.nodes || []).filter(n => !settings.agents.some(a => a.agentId === n.id)).map(n => `<option value="${esc(n.id)}">${esc(n.name)}</option>`).join('');
    agentPicker.value = [...agentPicker.options].some(o => o.value === selection) ? selection : agentPicker.options[1]?.value || '';
    boards.disabled = busy || unavailable;
    agentPicker.disabled = busy || unavailable || !state()?.record;
    root.querySelector('[data-gc="place"]').disabled = busy || unavailable || !agentPicker.value;
    root.querySelector('[data-gc="refresh"]').disabled = busy || !desktop;
    for (const control of windows.querySelectorAll('button[type="submit"],[data-gc="save-profile"],[data-gc="remove"],[data-gc="clear-picture"],[name="picture"]')) control.disabled = busy || unavailable;
  }
  const messagesFor = id => {
    const session = state()?.sessions.find(s => s.agentId === id);
    return (state()?.messages || []).filter(m => m.agentId === id && (!session || m.generation === undefined || m.generation === session.generation));
  };
  function renderAgents() {
    if (!active || !controller) return;
    for (const [id, sprite] of sprites) if (!settings.agents.some(a => a.agentId === id) || !state().draft.nodes.some(n => n.id === id)) { sprite.remove(); sprites.delete(id); chats.get(id)?.element.remove(); chats.delete(id); }
    for (const placement of settings.agents) {
      const node = state().draft.nodes.find(n => n.id === placement.agentId); if (!node) continue;
      let sprite = sprites.get(node.id);
      if (!sprite) {
        sprite = document.createElement('div'); sprite.className = 'gc-sprite'; sprite.dataset.gcAgent = node.id;
        sprite.innerHTML = `<button type="button" data-gc="chat" class="gc-character" title="Drag to move · click to chat · Alt + arrow keys to move"><strong></strong><span class="gc-mascot"><span class="gc-profile"></span><img src="assets/agents/octopus-companion.png" alt="" draggable="false"></span><span class="gc-state"></span></button>${button('settings', '', 'settings', 'aria-label="Agent settings" class="gc-gear"')}`;
        overlay.append(sprite); sprites.set(node.id, sprite);
      }
      const color = /^#[a-f0-9]{6}$/i.test(node.appearance?.color) ? node.appearance.color : '#007b83';
      sprite.style.setProperty('--gc-agent-color', color);
      sprite.querySelector('.gc-mascot>img').style.filter = `hue-rotate(${hueOf(color)-315}deg)`;
      sprite.querySelector('strong').textContent = node.name;
      sprite.querySelector('.gc-gear').setAttribute('aria-label','Settings for '+node.name);
      const context = contextFor(placement); sprite.title = context ? `Assigned to ${context.name}` : 'Assignment missing. Open Settings to choose a current workflow.';
      const latest = messagesFor(node.id).at(-1), working = state().activity.some(a => a.agentId === node.id) || ['queued', 'running'].includes(latest?.state);
      sprite.querySelector('.gc-state').textContent = working ? 'Working' : latest?.state === 'error' ? 'Connection error' : context ? 'Ready · ' + (context.job || context.name) : 'Reassign';
      sprite.dataset.working = String(working);
      const profile = sprite.querySelector('.gc-profile'), avatar = safeImage(node.appearance?.avatar);
      const profileKey=JSON.stringify([avatar,node.appearance?.zoom,node.appearance?.hue,node.appearance?.icon]);
      if(sprite._profileKey!==profileKey){sprite._profileKey=profileKey;profile.innerHTML = avatar ? `<img src="${avatar}" alt="" style="transform:scale(${Math.max(.1,Number(node.appearance?.zoom)||1)});filter:hue-rotate(${Number(node.appearance?.hue)||0}deg)">` : icon(node.appearance?.icon || 'robot');}
      if (chats.has(node.id)) renderChat(node.id);
    }
    nextMotion = 0;
  }
  function targetOptions(value) { return targets().map(t => `<option value="${esc(targetKey(t))}" ${value === targetKey(t) ? 'selected' : ''}>${esc((followCurrentGraph ? 'Current graph · ' : '') + t.name)}</option>`).join(''); }
  const viewport = () => ({ width:innerWidth, height:innerHeight });
  function layoutPanel(id) {
    const panel = chats.get(id); if (!panel || gesture?.agentId === id && gesture.kind !== 'agent') return;
    const placement = settings.agents.find(a => a.agentId === id);
    panel.rect = panelRect(placement?.panel || panel.defaultGeometry, viewport());
    paintPanel(panel, panel.rect);
  }
  function paintPanel(panel, rect) {
    const minimized = panel.element.classList.contains('gc-minimized');
    const maximized = panel.element.classList.contains('gc-maximized');
    const display = maximized && !minimized ? {left:12,top:12,width:Math.max(1,innerWidth-24),height:Math.max(1,innerHeight-24)} : rect;
    Object.assign(panel.element.style, { left:display.left+'px', top:display.top+'px', width:(minimized?Math.min(260,rect.width):display.width)+'px', height:(minimized?44:display.height)+'px' });
    const toggle = panel.element.querySelector('[data-gc="maximize"]');
    toggle.setAttribute('aria-label', maximized ? 'Restore conversation size' : 'Maximize conversation');
    toggle.setAttribute('aria-pressed', String(maximized));
    toggle.title = maximized ? 'Restore conversation size' : 'Maximize conversation';
    toggle.innerHTML = icon(maximized ? 'restore' : 'maximize');
  }
  function toggleMaximize(id) {
    const panel = chats.get(id); if (gesture) endGesture(true);
    panel.element.classList.remove('gc-minimized'); panel.element.classList.toggle('gc-maximized');
    panel.element.style.zIndex = String(++front); layoutPanel(id);
  }
  function openChat(id, showSettings = false) {
    if (!chats.has(id)) {
      const el = document.createElement('section'); el.className = 'gc-chat'; el.dataset.gcChat = id;
      el.innerHTML = `<header><strong></strong>${button('minimize', '', 'minus', 'aria-label="Minimize conversation"')}${button('close', '', 'close', 'aria-label="Close conversation"')}</header><p class="gc-chat-context"></p><details class="gc-settings"><summary>${icon('settings')} Settings & assignment</summary><form data-profile><label>Agent name<input name="name" required></label><label>Agent color<input name="color" type="color"></label><label>Profile picture<input name="picture" type="file" accept="image/png,image/jpeg,image/webp"></label><div class="gc-picture-feedback"><span class="gc-picture-preview" aria-label="Profile picture preview"></span><p class="gc-picture-status" role="status"></p></div><label>Assignment<select name="target"></select></label><label class="gc-checkbox"><input name="roam" type="checkbox">Roam around this assignment</label>${button('clear-picture','Use default picture','robot')}<button type="submit" data-gc="save-profile">Save settings</button>${button('remove', 'Remove from this view', 'trash')}${button('manage', 'Provider & folder settings', 'settings')}</form></details><div class="gc-history" role="log" aria-label="Conversation and visible activity" aria-live="polite"></div><details class="gc-activity"><summary>Visible activity</summary><pre></pre></details><form data-chat><label>Message<textarea name="message" rows="2" required placeholder="Ask this agent about its assigned workflow"></textarea></label><div class="gc-chat-actions"><button type="submit">${icon('comment')} Send with context</button>${button('stop', 'Stop', 'stop')}</div></form><p class="gc-chat-notice" role="status"></p>`;
      windows.append(el); chats.set(id, { element: el, initialized: false, contextByMessage: new Map(), submission: null });
      const maximize = document.createElement('button'); maximize.type = 'button'; maximize.dataset.gc = 'maximize';
      el.querySelector('header [data-gc="close"]').before(maximize);
      const panel = chats.get(id), index = chats.size - 1, width = Math.min(360,innerWidth-24), height = Math.min(580,innerHeight*.7);
      const motion=document.createElement('div');motion.className='gc-motion-controls';motion.innerHTML=button('toggle-roam','Resume roaming','play')+'<span>Visual roaming only. Dragging pauses it.</span>';el.querySelector('.gc-chat-context').after(motion);
      const activity=el.querySelector('.gc-activity');activity.innerHTML='<summary><span class="gc-activity-dot" aria-hidden="true"></span>Visible activity <span data-activity-status></span></summary><p class="gc-activity-status"></p><pre class="gc-activity-output"></pre><details class="gc-activity-details"><summary>Technical details</summary><pre class="gc-activity-raw"></pre></details>';
      const reconnect=document.createElement('p');reconnect.className='gc-reconnect';reconnect.setAttribute('role','status');reconnect.id='gc-reconnect-'+surface+'-'+id;reconnect.hidden=true;el.querySelector('[data-chat]').prepend(reconnect);
      const earlier=document.createElement('details');earlier.className='gc-earlier';earlier.hidden=true;earlier.innerHTML='<summary>Earlier chats</summary><div role="log" aria-label="Earlier conversations, read only"></div>';el.querySelector('.gc-history').before(earlier);
      panel.defaultGeometry = savedPanel({left:Math.max(12,innerWidth-12-width-index*(width+12)),top:innerHeight-14-height,width,height},viewport());
      const body = document.createElement('div'); body.className = 'gc-chat-body';
      while (el.children.length > 1) body.append(el.children[1]);
      el.append(body);
      el.querySelector('header').tabIndex = 0; el.querySelector('header').title = 'Drag to move conversation · Alt + arrow keys to move';
      for (const edge of ['n','ne','e','se','s','sw','w','nw']) {
        const handle = document.createElement('div'); handle.className = 'gc-resize-handle'; handle.dataset.gcResize = edge;
        if (edge === 'se') { handle.tabIndex = 0; handle.setAttribute('role','button'); handle.setAttribute('aria-label','Resize conversation'); handle.title = 'Drag to resize · arrow keys resize'; }
        else handle.setAttribute('aria-hidden','true');
        el.append(handle);
      }
    }
    const panel = chats.get(id); panel.element.hidden = false; panel.element.classList.remove('gc-minimized');if(showSettings)panel.element.classList.remove('gc-maximized'); panel.element.style.zIndex = String(++front); renderChat(id);
    if (showSettings) panel.element.querySelector('details').open = true;
    panel.element.querySelector(showSettings ? '[name="name"]' : 'textarea').focus();
  }
  function renderMessages(container,messages,labelFor){
    const existing=new Map([...container.children].filter(el=>el.dataset.messageId).map(el=>[el.dataset.messageId,el])),cards=new Map();
    for(const child of [...container.childNodes])if(child.nodeType!==1||!child.dataset.messageId)child.remove();
    messages.forEach((message,index)=>{
      let item=existing.get(message.id);existing.delete(message.id);
      if(!item){item=document.createElement('article');item.className='gc-message';item.dataset.messageId=message.id;item.innerHTML='<div class="gc-bubble"><strong></strong><pre class="gc-message-text"></pre><p class="gc-message-error" hidden></p></div>';}
      item.dataset.role=message.role;item.querySelector('strong').textContent=labelFor(message);
      renderChatText(item.querySelector('.gc-message-text'),message,item);
      const error=item.querySelector('.gc-message-error');error.hidden=!message.error;error.textContent=message.error||'';
      if(container.children[index]!==item)container.insertBefore(item,container.children[index]||null);cards.set(message.id,item);
    });
    for(const item of existing.values())item.remove();return cards;
  }
  function updateActivity(id){
    const panel=chats.get(id);if(!panel)return;
    const pending=messagesFor(id).find(m=>['queued','running'].includes(m.state)),work=state().activity.find(a=>a.agentId===id),region=panel.element.querySelector('.gc-activity');
    const working=!!pending||!!work,started=Date.parse(pending?.startedAt||pending?.createdAt||work?.startedAt),seconds=Number.isFinite(started)?Math.max(0,Math.floor((Date.now()-started)/1000)):0;
    region.dataset.working=String(working);region.setAttribute('aria-busy',String(working));
    region.querySelector('[data-activity-status]').textContent=working?(pending?.state==='queued'?'Queued':'Working')+' · '+seconds+'s':'Idle';
    region.querySelector('.gc-activity-status').textContent=working?(work?.status||work?.progress?.status||(pending?.state==='queued'?'Waiting for this agent to start.':'Waiting for the agent’s next update.')):'No work is running.';
    region.querySelector('.gc-activity-output').textContent=work?.text||work?.progress?.text||'';
    region.querySelector('.gc-activity-raw').textContent=state().events.filter(e=>e.agentId===id).map(e=>JSON.stringify(e)).join('\n')||'No recorded events yet.';
  }
  function renderChat(id) {
    const panel = chats.get(id), el = panel.element, node = state().draft.nodes.find(n => n.id === id), placement = settings.agents.find(a => a.agentId === id); if (!node || !placement) return;
    el.querySelector('header strong').textContent = node.name;
    el.setAttribute('aria-label',node.name+' conversation');
    layoutPanel(id);
    el.style.setProperty('--gc-agent-color', node.appearance?.color || '#007b83');
    const roam=el.querySelector('[data-gc="toggle-roam"]');roam.textContent=placement.roam?'Pause roaming':'Resume roaming';roam.setAttribute('aria-pressed',String(placement.roam));
    el.querySelector('.gc-motion-controls span').textContent=reduced.matches?'System reduced motion is on.':'Visual roaming only. Dragging pauses it.';
    const session=state().sessions.find(s=>s.agentId===id),recovery=session?.recovery||(panel.sendRecovery?.expectedGeneration===session?.generation?panel.sendRecovery:null);
    const reconnect=el.querySelector('.gc-reconnect'),send=el.querySelector('[data-chat] button[type="submit"]');
    reconnect.hidden=!recovery;reconnect.textContent=recovery?.message||'';
    send.innerHTML=icon('comment')+(recovery?' Start new chat and send':' Send with context');
    if(recovery)el.querySelector('textarea').setAttribute('aria-describedby',reconnect.id);else el.querySelector('textarea').removeAttribute('aria-describedby');
    const context = contextFor(placement), folderId = node.activeProjectId || node.projectId;
    const picture=el.querySelector('.gc-picture-preview'),avatar=safeImage(node.appearance?.avatar);
    if(panel.pictureStatusAvatar!==undefined&&panel.pictureStatusAvatar!==avatar){panel.pictureStatus='';delete panel.pictureStatusAvatar;}
    if(picture.dataset.image!==avatar){picture.dataset.image=avatar;picture.replaceChildren();if(avatar){const image=document.createElement('img');image.src=avatar;image.alt='Saved profile picture';picture.append(image);}else picture.innerHTML=icon(node.appearance?.icon||'robot');}
    el.querySelector('.gc-picture-status').textContent=panel.pictureStatus||(avatar?'Picture saved on this board. Choose a file to replace it.':'No picture saved on this board. Choosing a file saves it automatically.');
    const folder = folderId ? state().draft.projects?.find(p => p.id === folderId)?.path : workspaceRoot;
    el.querySelector('.gc-chat-context').textContent = `${context ? (followCurrentGraph ? 'Current graph: ' : '') + context.name : 'Assignment missing — choose another in Settings'} · ${node.provider} · ${node.provider === 'api' ? 'Chat only; no local file tools' : 'Works in ' + (folder || 'unavailable folder')}`;
    if (!panel.initialized) {
      const form = el.querySelector('[data-profile]'); form.elements.name.value = node.name; form.elements.color.value = node.appearance?.color || '#007b83';
      form.elements.target.innerHTML = targetOptions(placement.target);
      if (!context) { const option = new Option('Assignment missing — choose a current target', placement.target, true, true); form.elements.target.prepend(option); }
      form.elements.roam.checked = placement.roam; panel.initialized = true;
    }
    const assignment = el.querySelector('[name="target"]'), options = targetOptions(context ? targetKey(context) : placement.target);
    if (panel.targetOptions !== options) {
      const selected = assignment.value;
      assignment.innerHTML = options;
      if (!context) assignment.prepend(new Option('Assignment missing — choose a current target', placement.target, true, true));
      else if (panel.profileDirty && [...assignment.options].some(option => option.value === selected)) assignment.value = selected;
      else assignment.value = targetKey(context);
      panel.targetOptions = options;
    }
    const history = el.querySelector('.gc-history'), messages = messagesFor(id), fingerprint = JSON.stringify(messages.map(m => [m.id,m.state,m.text,m.error]));
    const earlier=el.querySelector('.gc-earlier'),previous=state().messages.filter(m=>m.agentId===id&&m.generation!==undefined&&m.generation!==session?.generation),earlierFingerprint=JSON.stringify(previous.map(m=>[m.id,m.state,m.text,m.error]));
    earlier.hidden=!previous.length;
    if(panel.earlierFingerprint!==earlierFingerprint){panel.earlierFingerprint=earlierFingerprint;renderMessages(earlier.querySelector('div'),previous,message=>'Chat '+message.generation+' · '+(message.role==='user'?'You':message.role==='assistant'?node.name:'System'));}
    if (panel.fingerprint !== fingerprint) {
      const atEnd = history.scrollHeight - history.scrollTop - history.clientHeight < 65; panel.fingerprint = fingerprint;
      const cards=renderMessages(history,messages,message=>`${message.role==='user'?'You':message.role==='assistant'?node.name:'System'} · ${message.state||'received'}`);
      for (const message of messages) {
        const item=cards.get(message.id),origin=panel.contextByMessage.get(message.id);
        if(item._actionText===message.text&&item._actionState===message.state&&item._origin===origin)continue;
        item._actionText=message.text;item._actionState=message.state;item._origin=origin;item.querySelector('.gc-message-actions')?.remove();
        const actions=document.createElement('div');actions.className='gc-message-actions';
        const proposal = yamlProposal(message);
        if (proposal && onApplyYAML && origin) {
          const apply = document.createElement('button'); apply.type = 'button'; apply.textContent = 'Preview workflow draft';
          apply.onclick = () => void run(async () => { if (targetKey(contextFor(placement) || {}) !== targetKey(origin)) throw Error('The assignment changed. Ask again using the current workflow.'); await onApplyYAML({ ...origin }, proposal); }); actions.append(apply);
        }
        const graph = graphProposal(message);
        if (graph && onApplyGraph && origin?.kind === 'graph') {
          const apply = document.createElement('button'); apply.type = 'button'; apply.textContent = 'Preview graph draft';
          apply.onclick = () => void run(async () => { if (targetKey(contextFor(placement) || {}) !== targetKey(origin)) throw Error('The assignment changed. Ask again using the current graph.'); await onApplyGraph(origin,graph); }); actions.append(apply);
        }
        if(actions.childElementCount)item.append(actions);
      }
      if (!messages.length) history.textContent = 'No messages yet. Your next message includes the current assignment. Responses and visible actions appear here.';
      if (atEnd) history.scrollTop = history.scrollHeight;
    }
    updateActivity(id);
  }
  function syncOrigins() {
    for (const [id, panel] of chats) {
      // Pair only this view's explicit contextual send with the corresponding
      // completed reply. Historical replies from elsewhere cannot edit a lane.
      if (!panel.submission) continue;
      const messages = messagesFor(id), user = messages.find(m => m.role === 'user' && m.text === panel.submission.text && !panel.submission.before.has(m.id));
      if (!user) continue;
      const reply = messages.find(m => m.role === 'assistant' && m.parentMessageId === user.id);
      if (reply) { panel.contextByMessage.set(reply.id, panel.submission.context); panel.fingerprint = null; if (['completed','error','cancelled'].includes(reply.state)) panel.submission = null; }
      else if (['error','cancelled','blocked','partial','limit','interrupted'].includes(user.state)) panel.submission = null;
    }
  }
  function changed() { if (active) { syncOrigins(); renderControls(); renderAgents(); } }
  async function refresh() {
    if (refreshPending || !active || !controller) return; refreshPending = true;
    try { await controller.refresh({ all: true }); } catch (e) { say(e.message, true); } finally { refreshPending = false; }
  }
  async function act(event) {
    const control = event.target.closest('[data-gc]'); if (!control) return;
    const action = control.dataset.gc, id = control.closest('[data-gc-agent],[data-gc-chat]')?.dataset.gcAgent || control.closest('[data-gc-chat]')?.dataset.gcChat || control.dataset.agentId;
    if (action === 'save-profile') return;
    if (action === 'chat' || action === 'settings') { openChat(id, action === 'settings'); return; }
    if (action === 'close') { chats.get(id).element.hidden = true; return; }
    if (action === 'minimize') { chats.get(id).element.classList.toggle('gc-minimized'); layoutPanel(id); return; }
    if (action === 'maximize') { toggleMaximize(id); return; }
    if (action === 'manage') { if (canLeave()) onManage?.(state()?.record?.id); return; }
    if (action === 'clear-picture') { await saveProfilePicture(id,null); return; }
    await run(async () => {
      if(action==='toggle-roam'){const placement=settings.agents.find(a=>a.agentId===id);if(!placement)return;await persist({...settings,agents:settings.agents.map(a=>a.agentId===id?{...a,roam:!a.roam}:a)});const panel=chats.get(id);if(panel&&!panel.profileDirty)panel.initialized=false;nextMotion=0;say(placement.roam?'Visual roaming paused.':'Visual roaming resumed.');}
      if (action === 'refresh') { await loadSettings(); await controller.listBoards(); if (settings.boardId) await controller.load(settings.boardId, { discard: true }); unavailable = false; say('Agents refreshed.'); }
      if (action === 'place') {
        const agentId = agentPicker.value; if (!state().record || !state().draft.nodes.some(n => n.id === agentId) || settings.agents.some(a => a.agentId === agentId)) return;
        const target = targets()[0]; if (!target) throw Error('Open a graph or import a repository before placing agents.');
        await persist({ ...settings, boardId: state().record.id, agents: [...settings.agents, { agentId, target: targetKey(target), roam: true, x: .2 + (settings.agents.length % 3) * .25, y: .55 }] }); say('Agent placed. Click it to chat or choose an assignment with its gear.');
      }
      if (action === 'remove') { await persist({ ...settings, agents: settings.agents.filter(a => a.agentId !== id) }); say('Agent removed from this view.'); }
      if (action === 'stop') { await controller.action('cancel', { agentId: id }); say('Stop requested.'); }
    });
  }
  async function submit(event) {
    const form = event.target; if (!form.matches('[data-chat],[data-profile]')) return; event.preventDefault();
    const id = form.closest('[data-gc-chat]').dataset.gcChat, panel = chats.get(id);
    await run(async () => {
      const placement = settings.agents.find(a => a.agentId === id), context = contextFor(placement);
      if (form.matches('[data-chat]')) {
        const session=state().sessions.find(s=>s.agentId===id),recovery=session?.recovery||(panel.sendRecovery?.expectedGeneration===session?.generation?panel.sendRecovery:null);
        if (panel.submission || !recovery&&messagesFor(id).some(m => ['queued','running'].includes(m.state))) throw Error('Wait for this agent to finish, or use Stop before sending another message.');
        const raw = form.elements.message.value;
        const viewContext = await getViewContext?.();
        if (!active) return;
        const text = contextualMessage(raw, { ...context, ...viewContext });
        if(recovery){say('Starting a new chat. Your earlier messages will stay saved.');await controller.newSession(id,recovery.expectedGeneration);panel.sendRecovery=null;}
        const { element, ...snapshot } = context;
        panel.submission = { text, context: structuredClone(snapshot), before: new Set(messagesFor(id).map(m => m.id)) };
        // DOM elements belong to the renderer, not the request snapshot.
        try { await controller.send(id, text); if (form.elements.message.value === raw) form.elements.message.value = ''; say('Message sent with its assigned context.'); }
        catch (e) { panel.submission = null;if(['SESSION_MISMATCH','SESSION_RESET_REQUIRED'].includes(e.code)&&e.details?.recovery?.action==='newSession')panel.sendRecovery=e.details.recovery;throw e; }
      } else {
        const target = form.elements.target.value;
        if (!targets().some(t => targetKey(t) === target)) throw Error('Choose a current repository, workflow or job.');
        let avatar;
        if (form.elements.picture.files[0]) {
          avatar = await readAgentPicture(form.elements.picture.files[0]);
        }
        if (!form.elements.name.value.trim()) throw Error('Give the agent a name.');
        controller.edit(board => { const node = board.nodes.find(n => n.id === id); node.name = form.elements.name.value.trim(); node.appearance = { ...node.appearance, color: form.elements.color.value, ...(avatar !== undefined ? { avatar } : panel.clearPicture ? { avatar: '' } : {}) }; });
        await controller.save();
        await persist({ ...settings, agents: settings.agents.map(a => a.agentId === id ? { ...a, target, roam: form.elements.roam.checked } : a) });
        panel.initialized = false; panel.clearPicture = false; panel.profileDirty = false; say('Agent appearance and assignment saved.');
      }
    });
  }
  async function saveProfilePicture(id,file) {
    if(busy||!active)return;
    const panel=chats.get(id);if(!panel)return;
    panel.pictureStatus='Saving picture…';delete panel.pictureStatusAvatar;renderChat(id);
    await run(async()=>{
      try {
        const avatar=file?await readAgentPicture(file):'';
        await controller.savePicture(id,avatar);
        panel.element.querySelector('[name="picture"]').value='';panel.clearPicture=false;
        panel.pictureStatusAvatar=avatar;
        panel.pictureStatus=avatar?'Picture saved. It will stay when you refresh or reopen this board.':'Picture removed. The default icon is now saved.';
        say(avatar?'Profile picture saved on this board.':'Profile picture removed from this board.');
      } catch(error) {panel.pictureStatusAvatar=safeImage(state().draft.nodes.find(n=>n.id===id)?.appearance?.avatar);panel.pictureStatus='Picture not saved. '+error.message;throw error;}
      finally {if(active&&chats.has(id))renderChat(id);}
    });
  }
  async function loadSettings() {
    const saved = await call('workspace','read',{ collection:'graph-companions',id:surface });
    if (!active) return; settingsRecord = saved; settings = saved ? validatePlacements(saved.value) : { version:1,boardId:'',agents:[] };
  }
  boards.onchange = () => void run(async () => {
    const id = boards.value; if (!id || id === settings.boardId) return;
    if (!canDiscardDrafts()) return;
    const previous = state()?.record?.id;
    try { await controller.load(id); await persist({ version:1,boardId:id,agents:[] }); }
    catch (error) { if (previous) await controller.load(previous,{discard:true}); throw error; }
    for (const panel of chats.values()) panel.element.remove(); chats.clear(); say('Board selected. Choose agents to place on this view.');
  });
  agentPicker.onchange = () => renderControls();
  function boundsFor(placement) {
    const hostRect = host.getBoundingClientRect(), element=contextFor(placement)?.element?.(), rect = element?.getBoundingClientRect() || hostRect,toolbar=element?.querySelector('.ve-toolbar')?.getBoundingClientRect();
    const left = Math.max(hostRect.left,rect.left,toolbar?toolbar.right+8:0), top = Math.max(hostRect.top + root.offsetHeight,rect.top,0), right = Math.min(hostRect.right,rect.right), bottom = Math.min(hostRect.bottom,rect.bottom,innerHeight);
    return { x:left-hostRect.left, y:top-hostRect.top, width:Math.max(AGENT_SIZE.width,right-left), height:Math.max(AGENT_SIZE.height,bottom-top), visible:right-left>=100 && bottom-top>=100 };
  }
  function paintAgent(sprite, point) { sprite._position = {...point}; sprite.style.transform = `translate(${point.x}px,${point.y}px)`; }
  function saveGeometry(id, changes, message) {
    return run(async () => {
      await persist({...settings,agents:settings.agents.map(a => a.agentId === id ? {...a,...changes} : a)});
      const panel = chats.get(id);
      if (changes.roam === false && panel && !panel.profileDirty) panel.element.querySelector('[name="roam"]').checked = false;
      say(message);
      if(changes.roam===false){const resume=document.createElement('button');resume.type='button';resume.className='gc-inline-motion';resume.dataset.gc='toggle-roam';resume.dataset.agentId=id;resume.textContent='Resume roaming';notice.append(' ',resume);}
      return true;
    });
  }
  function pointerDown(event) {
    const chat = event.target.closest('[data-gc-chat]');
    if (chat) chat.style.zIndex = String(++front);
    if (busy || unavailable || gesture || event.button !== 0 || !event.isPrimary) return;
    const character = event.target.closest('.gc-character'), handle = event.target.closest('[data-gc-resize]'), header = event.target.closest('.gc-chat>header');
    if (!character && !handle && (!header || event.target.closest('button,input,select,textarea'))) return;
    const agentId = character?.closest('[data-gc-agent]')?.dataset.gcAgent || chat?.dataset.gcChat;
    const placement = settings.agents.find(a => a.agentId === agentId); if (!placement) return;
    if (chat?.classList.contains('gc-maximized') || handle && chat.classList.contains('gc-minimized')) return;
    const element = character || handle || header, kind = character ? 'agent' : handle ? 'resize' : 'panel';
    const sprite = sprites.get(agentId), panel = chats.get(agentId);
    if (character && !sprite?._position) return;
    gesture = {agentId,kind,element,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,moved:false,
      point:character?{...sprite._position}:null,bounds:character?boundsFor(placement):null,rect:character?null:{...panel.rect},edge:handle?.dataset.gcResize};
    sprite?._tween?.stop();
    element.setPointerCapture(event.pointerId); event.stopPropagation();
  }
  function pointerMove(event) {
    const g = gesture; if (!g || event.pointerId !== g.pointerId) return;
    if (!g.element.isConnected) { endGesture(true); return; }
    const dx = event.clientX-g.startX, dy = event.clientY-g.startY;
    if (!g.moved && Math.hypot(dx,dy)<5) return;
    g.moved = true; event.preventDefault(); event.stopPropagation();
    if (g.kind === 'agent') {
      const sprite = sprites.get(g.agentId); sprite.classList.add('gc-dragging');
      g.nextPoint = {x:Math.max(g.bounds.x,Math.min(g.bounds.x+g.bounds.width-AGENT_SIZE.width,g.point.x+dx)),y:Math.max(g.bounds.y,Math.min(g.bounds.y+g.bounds.height-AGENT_SIZE.height,g.point.y+dy))};
      paintAgent(sprite,g.nextPoint);
    } else {
      const panel = chats.get(g.agentId); panel.element.classList.add('gc-dragging');
      g.nextRect = g.kind === 'resize' ? resizePanel(g.rect,dx,dy,g.edge,viewport()) : panelRect(savedPanel({...g.rect,left:g.rect.left+dx,top:g.rect.top+dy},viewport()),viewport());
      paintPanel(panel,g.nextRect);
    }
  }
  function endGesture(cancelled = false) {
    const g = gesture; if (!g) return;
    gesture = null; if (g.element.hasPointerCapture(g.pointerId)) g.element.releasePointerCapture(g.pointerId);
    sprites.get(g.agentId)?.classList.remove('gc-dragging'); chats.get(g.agentId)?.element.classList.remove('gc-dragging');
    if (g.moved) suppressClick = {element:g.element,until:performance.now()+500};
    nextMotion = 0;
    if (cancelled || !g.moved) {
      if (g.kind === 'agent' && sprites.has(g.agentId)) paintAgent(sprites.get(g.agentId),g.point);
      else layoutPanel(g.agentId);
      return;
    }
    if (g.kind === 'agent') {
      void saveGeometry(g.agentId,{...savedAgentPoint(g.nextPoint,g.bounds),roam:false},'Agent position saved. Visual roaming paused.').then(saved => {if(!saved && sprites.has(g.agentId))paintAgent(sprites.get(g.agentId),g.point);}).finally(() => { nextMotion=0; });
    } else {
      void saveGeometry(g.agentId,{panel:savedPanel(g.nextRect,viewport())},'Conversation position and size saved.').finally(() => layoutPanel(g.agentId));
    }
  }
  function pointerUp(event) { if (!gesture || event.pointerId !== gesture.pointerId) return; if (gesture.moved) {event.preventDefault();event.stopPropagation();} endGesture(event.type === 'pointercancel'); }
  function interactionKeys(event) {
    if (gesture && event.key === 'Escape') {event.preventDefault();event.stopPropagation();endGesture(true);return;}
    if (!overlay.contains(event.target) && !windows.contains(event.target)) return;
    const maximized = event.target.closest('.gc-maximized');
    if (maximized && event.key === 'Escape') {event.preventDefault();event.stopPropagation();toggleMaximize(maximized.dataset.gcChat);return;}
    if (maximized) return;
    if (busy || gesture || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    const character = event.target.closest('.gc-character'), handle = event.target.closest('[data-gc-resize="se"]'), header = event.target.matches('.gc-chat>header') ? event.target : null;
    if (!handle && !(event.altKey && (character || header))) return;
    const id = character?.closest('[data-gc-agent]')?.dataset.gcAgent || (handle || header)?.closest('[data-gc-chat]')?.dataset.gcChat;
    const placement = settings.agents.find(a => a.agentId === id); if (!placement) return;
    event.preventDefault(); event.stopPropagation();
    const step = event.shiftKey ? 5 : 20, dx = event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0, dy = event.key==='ArrowDown'?step:event.key==='ArrowUp'?-step:0;
    if (character) {
      const sprite = sprites.get(id), bounds = boundsFor(placement); sprite._tween?.stop();
      void saveGeometry(id,{...savedAgentPoint({x:sprite._position.x+dx,y:sprite._position.y+dy},bounds),roam:false},'Agent position saved.');
    } else {
      const panel = chats.get(id), rect = handle ? resizePanel(panel.rect,dx,dy,'se',viewport()) : {...panel.rect,left:panel.rect.left+dx,top:panel.rect.top+dy};
      void saveGeometry(id,{panel:savedPanel(rect,viewport())},'Conversation position and size saved.').finally(()=>layoutPanel(id));
    }
  }
  const click = event => {
    if (suppressClick && performance.now()<suppressClick.until && suppressClick.element.contains(event.target)) {event.preventDefault();event.stopPropagation();return;}
    void act(event);
  }, submission = event => { void submit(event); };
  const profileInput = event => {
    const form=event.target.closest('[data-profile]');if(!form)return;
    const id=form.closest('[data-gc-chat]').dataset.gcChat,panel=chats.get(id);
    if(event.target.name==='picture'){if(event.type==='change'&&event.target.files[0])void saveProfilePicture(id,event.target.files[0]);return;}
    if(panel)panel.profileDirty=true;
  };
  const focusPanel = event => { const panel=event.target.closest('[data-gc-chat]');if(panel)panel.style.zIndex=String(++front); };
  root.addEventListener('click',click); overlay.addEventListener('click',click); windows.addEventListener('click',click); windows.addEventListener('submit',submission);
  windows.addEventListener('input',profileInput);windows.addEventListener('change',profileInput);
  windows.addEventListener('focusin',focusPanel);
  overlay.addEventListener('pointerdown',pointerDown); windows.addEventListener('pointerdown',pointerDown);
  document.addEventListener('pointermove',pointerMove,{capture:true,passive:false}); document.addEventListener('pointerup',pointerUp,true); document.addEventListener('pointercancel',pointerUp,true); document.addEventListener('keydown',interactionKeys,true);
  // Tween.js supplies interpolation and easing; LVX owns bounds and semantics.
  function animate(now) {
    if (!active) return; frame = requestAnimationFrame(animate);
    const hostRect = host.getBoundingClientRect();
    if (hostRect.width < 1 || hostRect.height < 1 || hostRect.bottom < 0 || hostRect.top > innerHeight || document.hidden) { links.replaceChildren(); return; }
    const moving = !reduced.matches;
    if (moving !== motionAllowed) { motionAllowed = moving; nextMotion = 0; for (const sprite of sprites.values()){sprite._tween?.stop();sprite.dataset.walking='false';} }
    if (now >= nextMotion) {
      nextMotion = now + 3700;
      let index = 0;
      for (const placement of settings.agents) {
        const sprite = sprites.get(placement.agentId); if (!sprite) continue;
        if (gesture?.agentId === placement.agentId && gesture.kind === 'agent') continue;
        const bounds = boundsFor(placement);
        sprite.hidden = !bounds.visible;
        if (sprite.hidden) { sprite._tween?.stop();sprite.dataset.walking='false';sprite._nearNode?.classList.remove('gc-roam-near');continue; }
        const interacting=sprite.matches(':hover,:focus-within'),travel=moving&&placement.roam&&!interacting;
        let point = roamingPoint(bounds,{...placement,roam:travel}, now/4800 + index++ * 2.4);
        sprite._nearNode?.classList.remove('gc-roam-near');sprite._nearNode=null;delete sprite.dataset.nearNode;
        if(travel){
          const hostRect=host.getBoundingClientRect(),candidates=[...(contextFor(placement)?.element?.()?.querySelectorAll('.ve-node,.gw-node')||[])].filter(node=>{const r=node.getBoundingClientRect();return r.right>hostRect.left+bounds.x&&r.left<hostRect.left+bounds.x+bounds.width&&r.bottom>hostRect.top+bounds.y&&r.top<hostRect.top+bounds.y+bounds.height;});
          if(candidates.length){const node=candidates[(Math.floor(now/7400)+index)%candidates.length],r=node.getBoundingClientRect();point=nodeRoamingPoint(bounds,{x:r.left-hostRect.left,y:r.top-hostRect.top,width:r.width,height:r.height});sprite._nearNode=node;node.classList.add('gc-roam-near');node.style.setProperty('--gc-near-color',sprite.style.getPropertyValue('--gc-agent-color'));sprite.dataset.nearNode=node.dataset.id||node.dataset.job||'node';sprite.title='Visual roaming near '+(node.querySelector('strong,.gw-node-name')?.textContent||sprite.dataset.nearNode)+'. Agent actions appear in Visible activity.';}
        }
        if (!travel && placement.roam && sprite._position && sprite.dataset.positioned) {
          point.x = Math.min(bounds.x+Math.max(0,bounds.width-AGENT_SIZE.width),Math.max(bounds.x,sprite._position.x));
          point.y = Math.min(bounds.y+Math.max(0,bounds.height-AGENT_SIZE.height),Math.max(bounds.y,sprite._position.y));
        }
        sprite._tween?.stop();
        const position = sprite._position ||= { ...point };
        sprite.dataset.walking=String(travel&&!!sprite.dataset.positioned&&Math.hypot(position.x-point.x,position.y-point.y)>2);
        if (!travel || !sprite.dataset.positioned) { Object.assign(position,point); sprite.style.transform = `translate(${point.x}px,${point.y}px)`; }
        else sprite._tween = new Tween(position,motions).to(point,3000).easing(Easing.Sinusoidal.InOut).onUpdate(() => { sprite.style.transform = `translate(${position.x}px,${position.y}px)`; }).onStop(() => {motions.remove(sprite._tween);sprite.dataset.walking='false';}).onComplete(() => {motions.remove(sprite._tween);sprite.dataset.walking='false';}).start(now);
        sprite.dataset.positioned = 'true';
      }
    }
    motions.update(now);
    const segments = [];
    for (const [id,panel] of chats) {
      const sprite = sprites.get(id); if (!sprite || sprite.hidden || panel.element.hidden) continue;
      const a = sprite.getBoundingClientRect(), b = panel.element.getBoundingClientRect(); if (a.bottom < 0 || a.top > innerHeight) continue;
      const line = chatOwnershipLine(a,b,{left:0,top:0}); segments.push(`<line x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}"/>`);
    }
    links.innerHTML = segments.join('');
  }
  const unsubscribe = onEvent?.(event => {
    if (!active || workspaceKey(event.workspaceRoot) !== workspaceKey(workspaceRoot)) return;
    if (event.domain === 'agents' && event.boardId === state()?.record?.id) { clearTimeout(timer); timer = setTimeout(() => void refresh(),80); }
  });
  function canDiscardDrafts() { return ![...chats.values()].some(p => p.element.querySelector('textarea').value.trim() || p.profileDirty || p.clearPicture || p.element.querySelector('[name="picture"]').files.length) || window.confirm('Leave this view and discard unsent messages or unsaved settings?'); }
  function canLeave() { if (busy || gesture) { say('Finish moving or resizing, and wait for the current save or request.',true); return false; } return canDiscardDrafts(); }
  const reposition = event => { if (event.type==='resize' && gesture) endGesture(true); nextMotion = 0; for (const id of chats.keys()) layoutPanel(id); };
  window.addEventListener('resize',reposition); document.addEventListener('scroll',reposition,true);
  const poll = setInterval(() => { if (state()?.activity.length || state()?.messages.some(m => ['queued','running'].includes(m.state))) void refresh(); },1400);
  const activityClock=setInterval(()=>{if(active&&!document.hidden)for(const id of chats.keys())updateActivity(id);},1000);
  const ready = (async () => {
    if (!desktop || !workspaceRoot) { unavailable = true; renderControls(); say('Choose a project in the desktop app to connect real agents. Repository graphs remain available.'); return; }
    controller = createBoardController({ invoke:(action,payload) => call('agents',action,payload),workspaceRoot,onChange:changed });
    try {
      await loadSettings(); await controller.listBoards(); if (!active) return;
      const missing = settings.boardId && !state().boards.some(board => board.id === settings.boardId);
      if (settings.boardId && !missing) await controller.load(settings.boardId);
      else if (!settings.boardId && state().boards[0]) await controller.load(state().boards[0].id);
      say(missing ? 'The saved agent board is no longer available. Choose another saved board or create one.' : state().boards.length ? 'Choose an agent and place it on this view.' : 'Create an agent board to get started.',!!missing);
    }
    catch (error) { unavailable = true; say(error.message,true); }
    renderControls(); renderAgents(); frame = requestAnimationFrame(animate);
  })();
  return { ready, update() { nextMotion = 0; const current=followCurrentGraph&&targets()[0];if(current&&targetKey(current)!==lastGraphTarget){lastGraphTarget=targetKey(current);say('Agents follow the current graph: '+current.name+'.');} for (const panel of chats.values()) if(!panel.profileDirty)panel.initialized = false; renderAgents(); }, canLeave,
    destroy() { endGesture(true); active = false; clearTimeout(timer); clearInterval(poll);clearInterval(activityClock);for(const sprite of sprites.values())sprite._nearNode?.classList.remove('gc-roam-near'); cancelAnimationFrame(frame); window.removeEventListener('resize',reposition); document.removeEventListener('scroll',reposition,true); document.removeEventListener('pointermove',pointerMove,true); document.removeEventListener('pointerup',pointerUp,true); document.removeEventListener('pointercancel',pointerUp,true); document.removeEventListener('keydown',interactionKeys,true); unsubscribe?.(); motions.removeAll(); controller?.destroy(); root.removeEventListener('click',click); overlay.removeEventListener('click',click); windows.removeEventListener('click',click); windows.removeEventListener('submit',submission); boards.onchange = agentPicker.onchange = null; root.remove(); overlay.remove(); windows.remove(); links.remove(); host.classList.remove('gc-surface'); } };
}
