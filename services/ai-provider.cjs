'use strict';
const { nonnegative, deadline } = require('./capacity.cjs');

// Shared main-process transport for explicit authored AI operations.
async function requestAI(args = {}, {resolveSecret, redact = value => value, fetch: request = globalThis.fetch} = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('AI request configuration must be an object.');
  const {provider, model, prompt = '', systemPrompt = ''} = args || {};
  const maxTokens = nonnegative(args.maxTokens ?? 0, 'Token budget');
  if (provider === 'anthropic' && !maxTokens) throw Error('Anthropic requires an explicit positive output token budget (maxTokens).');
  if (typeof prompt !== 'string' || typeof systemPrompt !== 'string') throw Error('AI instructions must be text.');
  const resolve = value => typeof value === 'string' && /^secret:[a-f0-9-]{36}$/i.test(value)
    ? (typeof resolveSecret === 'function' ? resolveSecret(value) : (() => {throw Error('Encrypted credentials are unavailable.');})()) : value;
  const apiKey = resolve(args.apiKey || args.authToken || '');
  const localRedact = value => {
    const safe = redact(value);
    if (typeof safe !== 'string' || !apiKey) return safe;
    return [String(apiKey),encodeURIComponent(String(apiKey))].reduce((text,key)=>text.split(key).join('[REDACTED]'),safe);
  };
  let requestDeadline;
  try {
    let url, headers = {'Content-Type':'application/json'}, body;
    const history = args.messages === undefined ? [{role:'user', content:prompt}] : args.messages;
    if (!Array.isArray(history) || !history.length || history.some(message => !message || !['user','assistant'].includes(message.role) || typeof message.content !== 'string')) throw Error('AI conversation requires user/assistant text messages.');
    const conversation = history.map(({role, content}) => ({role, content}));
    const messages = [...(systemPrompt ? [{role:'system', content:systemPrompt}] : []), ...conversation];
    if (provider === 'openai' || provider === 'custom') {
      url = provider === 'custom' ? resolve(args.customEndpoint) : 'https://api.openai.com/v1/chat/completions';
      if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
      body = {model:model || (provider === 'custom' ? 'default' : 'gpt-4o'), messages, ...(provider === 'custom' ? {temperature:0.3,...(maxTokens ? {max_tokens:maxTokens} : {})} : maxTokens ? {max_completion_tokens:maxTokens} : {})};
    } else if (provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages';
      Object.assign(headers, {'x-api-key':apiKey, 'anthropic-version':'2023-06-01'});
      body = {model:model || 'claude-sonnet-4-20250514', max_tokens:maxTokens, system:systemPrompt, messages:conversation};
    } else if (provider === 'google') {
      url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model || 'gemini-2.5-flash') + ':generateContent';
      headers['x-goog-api-key']=apiKey;
      body = {systemInstruction:{parts:[{text:systemPrompt}]},contents:conversation.map(message => ({role:message.role === 'assistant' ? 'model' : 'user',parts:[{text:message.content}]})),generationConfig:{...(maxTokens ? {maxOutputTokens:maxTokens} : {})}};
    } else throw Error('Unknown AI provider: ' + provider);
    const target = new URL(url);
    if (!['http:','https:'].includes(target.protocol) || target.username || target.password) throw Error('AI endpoint must be an HTTP(S) address without embedded credentials.');
    requestDeadline = deadline(args.timeoutMs ?? 0, args.signal);
    const signal = requestDeadline.signal;
    const response = await request(target.href, {method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal});
    const chunks = []; let bytes = 0;
    if (response.body) for await (const chunk of response.body) {
      bytes += chunk.length;
      chunks.push(Buffer.from(chunk));
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (!response.ok) throw Error('AI API Error (' + response.status + '): ' + text);
    let result; try {result=JSON.parse(text);} catch {throw Error('The AI provider returned invalid JSON.');}
    const generatedText = provider === 'google' ? (result.candidates?.[0]?.content?.parts || []).map(p=>p.text || '').join('')
      : provider === 'anthropic' ? (result.content || []).filter(p=>p.type === undefined || p.type === 'text').map(p=>p.text || '').join('')
      : result.choices?.[0]?.message?.content;
    const finishReason = provider === 'google' ? result.candidates?.[0]?.finishReason || result.promptFeedback?.blockReason : provider === 'anthropic' ? result.stop_reason : result.choices?.[0]?.finish_reason;
    const refusal = provider === 'google' ? result.promptFeedback?.blockReason : provider === 'anthropic' ? (finishReason === 'refusal' ? 'Provider refusal' : null) : result.choices?.[0]?.message?.refusal;
    const blocked = new Set(['content_filter','refusal','SAFETY','RECITATION','BLOCKLIST','PROHIBITED_CONTENT','SPII','IMAGE_SAFETY']);
    const complete = new Set(['stop','end_turn','stop_sequence','STOP']);
    const completionStatus = refusal || blocked.has(finishReason) ? 'BLOCKED' : complete.has(finishReason) ? 'COMPLETE' : finishReason ? 'INCOMPLETE' : 'UNKNOWN';
    if (completionStatus === 'BLOCKED' || completionStatus === 'INCOMPLETE') {
      const error = Error('AI response ' + completionStatus.toLowerCase() + ': ' + String(finishReason || 'refusal'));
      error.code = completionStatus === 'BLOCKED' ? 'AI_BLOCKED' : 'AI_INCOMPLETE';
      error.finishReason = String(finishReason || 'refusal');
      error.partialText = typeof generatedText === 'string' ? localRedact(generatedText) : '';
      throw error;
    }
    if (typeof generatedText !== 'string' || !generatedText.trim()) throw Error('The model returned no generated text.');
    const usage = Object.fromEntries(Object.entries(result.usage || result.usageMetadata || {}).filter(([key,value]) => /^[a-zA-Z_]{1,64}$/.test(key) && typeof value === 'number' && Number.isFinite(value) && value >= 0));
    return {success:true,generatedText:localRedact(generatedText),finishReason:typeof finishReason === 'string' ? localRedact(finishReason) : null,completionStatus,usage};
  } catch (error) {
    const safe = Error(localRedact(error.message));
    if (error.code) safe.code = error.code;
    if (error.finishReason) safe.finishReason = localRedact(String(error.finishReason));
    if (typeof error.partialText === 'string') safe.partialText = localRedact(error.partialText);
    if (error.name === 'AbortError') safe.name = 'AbortError';
    throw safe;
  } finally { requestDeadline?.dispose(); }
}

module.exports = {requestAI};
