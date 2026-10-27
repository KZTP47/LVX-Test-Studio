'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { stopProcessTree } = require('../process-control.cjs');
const { nonnegative, longTimeout } = require('../capacity.cjs');

const MAX_BYTES = 0; // Compatibility export: 0 means no application output ceiling.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SUPPORTS = {
  codex: { resume: true, permissions: ['native', 'read-only', 'workspace-write'], effort: true },
  claude: { resume: true, permissions: ['native'], effort: true },
  gemini: { resume: true, permissions: ['native'], effort: false },
  api: { resume: false, permissions: ['native'], effort: false }
};

// Resolve only known binaries/official npm entry points. Never execute a shell shim.
function resolveExecutable(provider, { env = process.env, platform = process.platform } = {}) {
  if (!['codex','claude','gemini'].includes(provider)) return null;
  const fileExists = file => {try{return fs.statSync(file).isFile();}catch{return false;}};
  const dirs = [...new Set([env.PATH,env.Path,env.path].filter(Boolean).flatMap(value=>value.split(path.delimiter)).filter(p=>path.isAbsolute(p)))];
  const home=env.USERPROFILE||env.HOME;
  if(home&&path.isAbsolute(home))dirs.push(path.join(home,'.local','bin'));
  if(platform==='win32'&&env.APPDATA&&path.isAbsolute(env.APPDATA))dirs.push(path.join(env.APPDATA,'npm'));
  for (const dir of dirs) {
    const file = path.join(dir, provider + (platform === 'win32' ? '.exe' : ''));
    if (fileExists(file)) return { command: file, prefix: [] };
    const entry = provider === 'codex' ? path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js') : provider === 'claude'
      ? path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
      : provider === 'gemini' ? path.join(dir, 'node_modules', '@google', 'gemini-cli', 'dist', 'index.js') : null;
    if (entry && fileExists(entry)) return provider === 'claude'
      ? { command: entry, prefix: [] }
      : { command: process.execPath, prefix: [entry], env: { ELECTRON_RUN_AS_NODE: '1' } };
    if (provider === 'claude') {
      const js = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
      if (fileExists(js)) return { command: process.execPath, prefix: [js], env: { ELECTRON_RUN_AS_NODE: '1' } };
    }
  }
  // The desktop app keeps its official CLI in versioned user-local directories.
  // Explorer-launched apps can retain an older PATH after Codex is installed.
  if(provider==='codex'&&platform==='win32'&&env.LOCALAPPDATA&&path.isAbsolute(env.LOCALAPPDATA)){
    const base=path.join(env.LOCALAPPDATA,'OpenAI','Codex','bin');
    try{
      const candidates=fs.readdirSync(base,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>path.join(base,entry.name,'codex.exe')).filter(fileExists).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
      if(candidates[0])return {command:candidates[0],prefix:[]};
    }catch{}
  }
  return null;
}

function buildInvocation(provider, { node, session, text }) {
  const resume = session?.nativeSessionId;
  if (resume && !UUID.test(resume)) throw Error('Native session ID is invalid; explicitly create a new conversation.');
  if (!SUPPORTS[provider]?.permissions.includes(node.permission || 'native')) throw Error(`${provider} cannot guarantee the selected permission policy.`);
  if (node.effort && !SUPPORTS[provider].effort) throw Error(`${provider} does not expose a supported effort override.`);
  let args;
  const directories=[...new Set(node.additionalDirectories||[])];
  if(directories.some(p=>typeof p!=='string'||!path.isAbsolute(p)||p.includes('\0')))throw Error('Assigned agent folders must be absolute directories.');
  const input = text;
  if (provider === 'codex') {
    args = ['exec'];
    // exec resume accepts configuration overrides, but not exec's --sandbox flag.
    if (node.permission && node.permission !== 'native') args.push('-c', `sandbox_mode="${node.permission}"`);
    if (node.model) args.push('--model', node.model);
    if (node.effort) args.push('-c', `model_reasoning_effort="${node.effort}"`);
    if (node.instructions) args.push('-c', `developer_instructions=${JSON.stringify(node.instructions)}`);
    if(directories.length)args.push('-c','sandbox_workspace_write.writable_roots='+JSON.stringify(directories));
    if (resume) args.push('resume', resume);
    args.push('--skip-git-repo-check', '--json', '-');
  } else if (provider === 'claude') {
    args = ['--print', '--verbose', '--output-format', 'stream-json'];
    if (resume) args.push('--resume', resume);
    if (node.model) args.push('--model', node.model);
    if (node.effort) args.push('--effort', node.effort);
    if (node.instructions) args.push(`--append-system-prompt=${node.instructions}`);
    for(const directory of directories)args.push('--add-dir',directory);
  } else if (provider === 'gemini') {
    args = ['--output-format', 'stream-json'];
    for(const directory of directories)args.push('--include-directories',directory);
    if (resume) args.push('--resume', resume);
    if (node.model) args.push('--model', node.model);
    // Runtime owns the exact persisted input, including any explicit Gemini
    // user-prefix addition. Do not rewrite it inside the transport adapter.
  } else throw Error('Unknown native provider.');
  return { args, input };
}

function errorState(message) {
  if (/permission|approval|denied|refus|authentication|not logged|login|sign.in|unauthori[sz]ed|\b401\b|\b403\b/i.test(message)) return 'blocked';
  if (/rate.limit|quota|token.limit|max.turn|max.budget|context.window|resource.exhaust|length|truncat|too many requests|\b429\b/i.test(message)) return 'limit';
  return 'error';
}

function createNativeTransport({ resolve = resolveExecutable, spawnProcess = spawn, killTree = stopProcessTree, maxBytes = MAX_BYTES, timeoutMs = 0, configFile, probeTimeoutMs=0 } = {}) {
  nonnegative(maxBytes, 'Native output budget'); nonnegative(timeoutMs, 'Native deadline'); nonnegative(probeTimeoutMs, 'Connection deadline');
  const diagnostics = new Set();
  let configured={},configError='';if(configFile){try{const value=JSON.parse(fs.readFileSync(configFile,'utf8'));for(const provider of ['codex','claude','gemini'])if(typeof value[provider]==='string')configured[provider]=value[provider];}catch(error){if(error.code!=='ENOENT')configError='Saved tool locations could not be read. Automatic detection was used. Choose an executable to replace these settings.';}}
  function executableFor(provider){const file=configured[provider];if(file){try{if(fs.statSync(file).isFile())return {command:file,prefix:[]};}catch{}}return resolve(provider);}
  function configure(provider,file){
    if(!['codex','claude','gemini'].includes(provider))throw Error('Choose Codex, Claude Code or Gemini CLI.');
    if(typeof file!=='string'||!path.isAbsolute(file)||!fs.statSync(file).isFile()||process.platform==='win32'&&path.extname(file).toLowerCase()!=='.exe')throw Error('Choose the installed native CLI executable (.exe), not a shell shortcut.');
    const command=fs.realpathSync(file),next={...configured,[provider]:command};
    if(configFile){fs.mkdirSync(path.dirname(configFile),{recursive:true});const temp=configFile+'.'+require('node:crypto').randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(next,null,2));fs.renameSync(temp,configFile);}configured=next;configError='';return {provider,configured:true};
  }
  function inspectCommand(provider,args){
    const executable=executableFor(provider);if(!executable)return Promise.resolve({missing:true});
    return new Promise(resolveResult=>{
      let output='',settled=false,child,timer;
      const cancel=async()=>{finish({error:'Connection check cancelled.'});if(child)await killTree(child).catch(()=>{});};
      const finish=value=>{if(!settled){settled=true;timer?.();diagnostics.delete(cancel);resolveResult({...value,executable});}};
      try{child=spawnProcess(executable.command,[...executable.prefix,...args],{cwd:path.dirname(executable.command),windowsHide:true,shell:false,env:{...process.env,...executable.env},stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});}catch(error){finish({error:error.message});return;}
      diagnostics.add(cancel);
      if(probeTimeoutMs)timer=longTimeout(()=>{void killTree(child).catch(()=>{});finish({error:'Connection check timed out. Recheck or choose the installed executable.'});},probeTimeoutMs);
      for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{output+=data.toString();});
      child.once('error',error=>finish({error:error.message}));child.once('close',code=>finish({code,output:output.trim()}));
    });
  }
  async function diagnose(provider){
    if(!['codex','claude','gemini'].includes(provider))throw Error('Choose a supported native provider.');
    const version=await inspectCommand(provider,['--version']),base={provider,installed:!version.missing,executable:version.executable?.command||null,version:version.code===0?version.output:null,modelPromptSent:false,...(configError?{warning:configError}:{})};
    if(version.missing)return {...base,state:'missing',ready:false,summary:'The official CLI was not found. Choose an installed executable or open the publisher installation page.'};
    if(version.error||version.code!==0)return {...base,state:'broken',ready:false,summary:'The CLI could not start. Recheck or choose another installed executable.',detail:version.error||'Version check exited '+version.code+'.'};
    if(provider!=='codex')return {...base,state:'login-unchecked',ready:null,summary:'CLI found. Use Sign in if needed, then retry your message. No model prompt was sent.'};
    const login=await inspectCommand(provider,['login','status']);
    if(login.code===0)return {...base,state:'ready',ready:true,summary:'Codex is installed and signed in. You can retry the failed message or send a new one.'};
    return {...base,state:login.error?'check-failed':'sign-in-required',ready:false,summary:login.error?'The sign-in check could not finish. Recheck or sign in using the official tool.':'Sign in using the official Codex tool, then recheck this connection.',...(login.error?{detail:login.error}:{})};
  }
  function loginInvocation(provider){const executable=executableFor(provider);if(!['codex','claude','gemini'].includes(provider)||!executable)throw Error('Choose or install the official CLI first.');return {...executable,args:[...executable.prefix,...(provider==='codex'?['login']:[])]};}
  async function probe(provider) {
    const result=await inspectCommand(provider,['--version']);
    const base={id:provider,name:{codex:'Codex CLI',claude:'Claude Code',gemini:'Gemini CLI'}[provider],installed:!result.missing,login:'native-login-not-checked',supports:SUPPORTS[provider]};
    if(result.missing)return {...base,error:'Install the official CLI and make it available on PATH. Login remains managed by the CLI.'};
    if(result.error)return {...base,error:result.error};
    return result.code===0?{...base,version:result.output}:{...base,error:result.output||'Version probe exited '+result.code+'.'};
  }

  async function execute({ node, session, text, workspaceRoot, signal, onSession, onProgress }) {
    const executable = executableFor(node.provider);
    if (!executable) return { status: 'error', text: '', error: `Official ${node.provider} CLI is unavailable. Install it and use its native login.`, protocol: [] };
    const invocation = buildInvocation(node.provider, { node, session, text });
    if (signal?.aborted) return { status: 'cancelled', text: '', error: 'Cancelled before launch.', protocol: [] };
    return new Promise(resolveTurn => {
      let child, timer, terminated, bytes = 0, pending = '', stderr = '', output = '', nativeSessionId = null, completed = false, failure = null, identityFailure = false;
      const protocol = [], seenMessages = new Set(), identityCommits = [], decoder = new StringDecoder('utf8'), errDecoder = new StringDecoder('utf8');
      let commentary = '', hasFinalAnswer = false;
      let stopPromise;
      function stop(reason) {
        terminated ||= reason;
        if (reason === 'timeout') failure ||= `Native turn exceeded the ${timeoutMs} ms time limit. Execution may be incomplete; review effects before an explicit retry.`;
        return stopPromise ||= Promise.resolve().then(() => killTree(child)).catch(error => { failure ||= `Process cleanup failed: ${error.message}`; });
      }
      function accept(event) {
        protocol.push(event);
        const previousOutput=output;
        const id = event.thread_id || event.session_id;
        if (id) {
          if (!UUID.test(id) || (nativeSessionId && nativeSessionId !== id) || (session?.nativeSessionId && session.nativeSessionId !== id)) { identityFailure = true; failure = 'Provider returned a mismatched native session ID. Create a new conversation explicitly.'; }
          else if (!nativeSessionId) {
            nativeSessionId = id;
            if (onSession) identityCommits.push(Promise.resolve().then(() => onSession(id)).catch(error => { failure ||= `Native session binding could not be persisted: ${error.message}`; void stop('persistence'); }));
          }
        }
        if (node.provider === 'codex') {
          if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
            const item = event.item, key = item.id && 'codex:' + item.id;
            if (!key || !seenMessages.has(key)) {
              if (key) seenMessages.add(key);
              const text = item.text || '';
              if (item.phase === 'commentary') commentary += (commentary && text ? '\n\n' : '') + text;
              else {
                if (item.phase === 'final_answer' && !hasFinalAnswer) { output = ''; hasFinalAnswer = true; }
                output += (output && text ? '\n\n' : '') + text;
              }
            }
          }
          if (event.type === 'turn.completed') completed = true;
          if (event.type === 'turn.failed' || event.type === 'error') failure = event.error?.message || event.message || 'Codex turn failed.';
          if (event.item?.refusal) failure = `Refusal: ${event.item.refusal}`;
        } else if (node.provider === 'claude') {
          if (event.type === 'assistant' && !event.parent_tool_use_id) {
            const messageId = event.message?.id;
            if (!messageId || !seenMessages.has(messageId)) {
              if (messageId) seenMessages.add(messageId);
              for (const block of event.message?.content || []) {
                if (block.type === 'text') output += block.text || '';
                if (block.type === 'refusal') failure = `Refusal: ${block.refusal || block.text || 'Provider refusal'}`;
              }
            }
            if (event.message?.stop_reason === 'max_tokens') failure = 'Token limit reached.';
            if (event.message?.stop_reason === 'refusal') failure = 'Provider refusal.';
            if (event.error) failure = String(event.error);
          }
          if (event.type === 'result') {
            completed = event.subtype === 'success' && !event.is_error;
            if (!output && typeof event.result === 'string') output = event.result;
            if (!completed) failure = (event.errors || []).join('\n') || event.result || event.subtype || 'Claude turn failed.';
            if (event.permission_denials?.length) failure = 'Permission denied: native tools require approval in the CLI.';
            if (event.stop_reason === 'max_tokens') failure = 'Token limit reached.';
            if (event.stop_reason === 'refusal') failure = 'Provider refusal.';
          }
        } else {
          if (event.type === 'message' && event.role === 'assistant') output += event.content || '';
          if (event.type === 'error' && event.severity !== 'warning') failure = event.message || 'Gemini turn failed.';
          if (event.type === 'tool_result' && event.status === 'error' && /permission|approval|denied/i.test(event.error?.message || '')) failure = event.error.message;
          if (event.type === 'result') { completed = event.status === 'success'; if (!completed) failure = event.error?.message || event.error?.type || 'Gemini turn failed.'; }
        }
        if (!identityFailure && onProgress) {
          // Expose assistant messages and coarse tool activity only. Provider
          // reasoning/thinking blocks and tool command/output are not chat text.
          const tool=event.item?.type==='command_execution'||['tool_use','tool_result'].includes(event.type)||event.message?.content?.some(b=>b.type==='tool_use');
          const status=output!==previousOutput?'Writing reply…':tool?'Using a tool…':event.type==='turn.completed'||event.type==='result'?'Finishing reply…':'Agent is working…';
          try{onProgress({status,text:output || commentary});}catch{}
        }
        if (identityFailure) void stop('protocol');
      }
      function lines(final = false) {
        let newline;
        while ((newline = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, newline).trim(); pending = pending.slice(newline + 1);
          if (line) { try { accept(JSON.parse(line)); } catch { protocol.push({ type: 'invalid-output', text: line }); failure ||= 'Malformed JSON in native provider stream. Inspect retained protocol evidence and native CLI setup/version.'; void stop('protocol'); } }
        }
        if (final && pending.trim()) { try { accept(JSON.parse(pending)); } catch { protocol.push({ type: 'invalid-output', text: pending }); failure ||= 'Incomplete JSON in native provider stream.'; } pending = ''; }
      }
      const abort = () => void stop('cancelled');
      try {
        child = spawnProcess(executable.command, [...executable.prefix, ...invocation.args], { cwd: workspaceRoot, windowsHide: true, shell: false, env: { ...process.env, ...executable.env }, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
      } catch (error) { resolveTurn({ status: 'error', text: '', error: error.message, protocol }); return; }
      if(timeoutMs)timer = longTimeout(() => void stop('timeout'), timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      child.stdout.on('data', data => {
        bytes += data.length;
        if (maxBytes && bytes > maxBytes) { failure ||= `Native output exceeded the selected ${maxBytes} byte budget; output is partial.`; void stop('limit'); return; }
        pending += decoder.write(data); lines();
      });
      child.stderr.on('data', data => { bytes += data.length; if (maxBytes && bytes > maxBytes) { failure ||= 'Selected native output budget reached; output is partial.'; void stop('limit'); return; } stderr += errDecoder.write(data); });
      child.stdin.on('error', error => { if (error.code !== 'EPIPE') failure ||= error.message; });
      child.on('error', error => { failure ||= error.message; });
      child.on('close', async (code, processSignal) => {
        timer?.(); signal?.removeEventListener('abort', abort);
        pending += decoder.end(); stderr += errDecoder.end(); lines(true);
        await Promise.all(identityCommits);
        if (stopPromise) await stopPromise;
        let status;
        if (identityFailure) { status = 'error'; failure = 'Provider returned a mismatched native session ID. No replacement session was accepted.'; }
        else if (terminated === 'cancelled') status = 'cancelled';
        else if (terminated === 'limit' || terminated === 'timeout') status = output ? 'partial' : 'limit';
        else if (failure) status = errorState(failure);
        else if (code !== 0 || processSignal) { failure = stderr || `Native process exited ${code ?? processSignal}.`; status = errorState(failure); }
        else if (!nativeSessionId) { failure = 'No native session identity was received; continuity is unproven.'; status = 'error'; }
        else if (!completed) { failure = 'Provider stream ended without a completion receipt; execution may have occurred. No automatic retry.'; status = output ? 'partial' : 'error'; }
        else if (!output.trim()) { failure = 'Provider completed without assistant text; no result to route.'; status = 'error'; }
        else status = 'completed';
        resolveTurn({ status, text: output, nativeSessionId, error: failure || (status === 'cancelled' ? 'Cancelled by user.' : undefined), stderr, protocol, exitCode: code, invocation: { args: invocation.args, instructionMode: node.instructions ? (node.provider === 'gemini' ? 'visible-user-prefix' : 'explicit-additive-instructions') : 'native-default' } });
      });
      child.stdin.end(invocation.input, 'utf8');
    });
  }
  return { execute, probe, diagnose, configure, loginInvocation, cancelDiagnostics:()=>Promise.allSettled([...diagnostics].map(cancel=>cancel())) };
}

module.exports = { createNativeTransport, resolveExecutable, buildInvocation, errorState, SUPPORTS, MAX_BYTES, UUID };
