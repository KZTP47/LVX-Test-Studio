'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {randomUUID} = require('node:crypto');

function validatePayload(value) {
  let bytes = 0;
  const visit = (item, depth) => {
    if (depth > 30) throw new Error('Payload nesting limit exceeded');
    if (item === null || typeof item === 'boolean' || typeof item === 'number') {
      if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Invalid numeric payload');
      return;
    }
    if (typeof item === 'string') { bytes += Buffer.byteLength(item); if(bytes > 16 * 1024 * 1024) throw new Error('Payload too large'); return; }
    if (typeof item !== 'object' || (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)) throw new Error('Payload must contain plain data');
    for (const [key, val] of Object.entries(item)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe payload key');
      bytes += key.length; visit(val, depth + 1);
    }
    if (bytes > 16 * 1024 * 1024) throw new Error('Payload too large');
  };
  visit(value, 0); return value;
}

function assertScopedPath(root, candidate = '.', {mustExist = true, directory = false} = {}) {
  if (!root) throw new Error('Choose a workspace first');
  const canonicalRoot = fs.realpathSync(root);
  const requested = path.resolve(canonicalRoot, candidate);
  const relative = path.relative(canonicalRoot, requested);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Path is outside the selected workspace');
  // Resolve every existing ancestor: non-existing write destinations must not bypass symlinks.
  let ancestor = requested;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor); if (parent === ancestor) throw new Error('No existing path ancestor'); ancestor = parent;
  }
  const actualAncestor = fs.realpathSync(ancestor);
  const canonicalRelative = path.relative(canonicalRoot, actualAncestor);
  if (canonicalRelative === '..' || canonicalRelative.startsWith('..' + path.sep) || path.isAbsolute(canonicalRelative)) throw new Error('Linked path escapes the selected workspace');
  if (mustExist && !fs.existsSync(requested)) throw new Error('Workspace path does not exist');
  if (directory && fs.existsSync(requested) && !fs.statSync(requested).isDirectory()) throw new Error('Expected a workspace directory');
  return requested;
}

function validateSender(event, {webContentsId, allowedUrl}) {
  if (!event || event.sender?.id !== webContentsId || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted IPC sender');
  const url = event.senderFrame.url;
  const allowed = typeof allowedUrl === 'string' ? allowedUrl : pathToFileURL(allowedUrl?.path || '').href;
  if (!allowed || url.split('#')[0].split('?')[0] !== allowed.split('#')[0].split('?')[0]) throw new Error('Untrusted IPC origin');
  return true;
}

function createPreviewPolicy({allowNetworkOrigins = [], websiteTarget = false} = {}) {
  if(typeof websiteTarget!=='boolean')throw Error('Website target mode must be a boolean');
  const origins = [...new Set(allowNetworkOrigins.map(value => {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.origin !== value) throw new Error('Preview allowlist requires exact HTTP(S) origins');
    return url.origin;
  }))];
  const allowsUrl = value => {
    try { const url = new URL(value); return ['data:', 'blob:'].includes(url.protocol) || (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && (websiteTarget || origins.includes(url.origin))) || (websiteTarget&&['ws:','wss:'].includes(url.protocol)&&!url.username&&!url.password); } catch { return false; }
  };
  return {
    webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, spellcheck: false, webviewTag:false, partition:'lvx-preview-'+randomUUID()},
    contentSecurityPolicy: `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: ${origins.join(' ')}; style-src 'unsafe-inline' ${origins.join(' ')}; img-src data: blob: ${origins.join(' ')}; font-src data: ${origins.join(' ')}; connect-src ${origins.length ? origins.join(' ') : "'none'"}; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`,
    allowsUrl,
    allowsNavigation: value => websiteTarget && (()=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}})(),
    allowPermission: () => false,
    allowWindowOpen: () => ({action: 'deny'}),
    networkOrigins: origins,
    websiteTarget
  };
}
function configurePreviewContents(contents,policy=createPreviewPolicy()){
  if(!contents?.session)throw new Error('Preview WebContents is required');
  contents.setWindowOpenHandler(policy.allowWindowOpen);
  contents.on('will-navigate',(event,url)=>{if(!policy.allowsNavigation(url))event.preventDefault();});
  contents.on('will-redirect',(event,url)=>{if(!policy.allowsNavigation(url))event.preventDefault();});
  contents.on('will-attach-webview',event=>event.preventDefault());
  contents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  contents.session.setPermissionCheckHandler(()=>false);
  contents.session.on('will-download',(event)=>event.preventDefault());
  contents.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!policy.allowsUrl(details.url)}));
  // Real website targets retain their server's CSP and origin semantics. They
  // still have a private sandbox/partition, no preload/Node, denied permissions,
  // no downloads/popups and no file: access. Legacy inline uploads remain offline.
  contents.session.webRequest.onHeadersReceived((details,callback)=>callback({responseHeaders:policy.websiteTarget?details.responseHeaders:{...details.responseHeaders,'Content-Security-Policy':[policy.contentSecurityPolicy]}}));
  return policy;
}
function preparePreviewHtml(html,policy=createPreviewPolicy()){
  if(typeof html!=='string'||html.length>8*1024*1024)throw new Error('Preview HTML must be text below 8 MiB');
  const escaped=policy.contentSecurityPolicy.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  // This meta element is parsed before any untrusted content, including a supplied <head>.
  return '<!doctype html><meta http-equiv="Content-Security-Policy" content="'+escaped+'">'+html;
}
module.exports = {validatePayload, assertScopedPath, validateSender, createPreviewPolicy,configurePreviewContents,preparePreviewHtml};
