'use strict';
const crypto = require('node:crypto');
const YAML = require('yaml');
const SwaggerParser = require('@apidevtools/swagger-parser');
const ts = require('typescript');
const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
const identity = (...parts) => crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const pathOnly = value => { try { return new URL(value).pathname; } catch { return String(value).split('?')[0]; } };
const pathMatches = (template, actual) => {
  const parts = value => pathOnly(value).replace(/\/$/, '').split('/').map(part => { try { return decodeURIComponent(part); } catch { return part; } });
  const left = parts(template), right = parts(actual);
  return left.length === right.length && left.every((part, index) => /^(?:\{[^}]+\}|:[\w]+)$/.test(part) ? !!right[index] : part === right[index]);
};
function candidatePath(path) {
  return !/(^|\/)(?:node_modules|vendor|dist|build|\.git|\.env|secrets|credentials)(\/|$)/i.test(path) &&
    (/(?:openapi|swagger|postman|pact)[^/]*\.(?:json|ya?ml)$|(?:^|\/)pacts?\/.*\.json$|\.postman_collection\.json$/i.test(path) || /\.(?:[cm]?[jt]sx?|py|cs|java|kt|go|rb|ya?ml|json)$/i.test(path));
}
function parse(source, path) {
  if (/\.json$/i.test(path)) return JSON.parse(source);
  const doc = YAML.parseDocument(source, { uniqueKeys: true });
  if (doc.errors.length) throw Error(doc.errors.map(error => error.message).join('; '));
  return doc.toJS({ maxAliasCount: 50 });
}
// Swagger Parser resolves references only from this immutable repository's
// in-memory files. Neither local disk nor arbitrary remote URLs are resolvers.
async function bundle(file, files) {
  const prefix = 'https://lvx.invalid/';
  return SwaggerParser.bundle(prefix + file.path.split('/').map(encodeURIComponent).join('/'), {
    resolve: { file: false, http: false, repository: {
      order: 1,
      canRead: input => input.url.startsWith(prefix),
      read: input => {
        const path = decodeURIComponent(new URL(input.url).pathname.slice(1));
        const found = files.find(item => item.path === path && !item.isDeleted);
        if (!found) throw Error('Referenced source is missing from this snapshot: ' + path);
        return found.content;
      }
    } }
  });
}
function contractSchema(schema, document) {
  const defs = {}, pending = new Set();
  function copy(value) {
    if (Array.isArray(value)) return value.map(copy);
    if (!object(value)) return value;
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref') {
        if (typeof child !== 'string' || !child.startsWith('#/')) throw Error('External schema reference is unresolved.');
        const name = 'ref_' + identity(child); result.$ref = '#/$defs/' + name;
        if (!pending.has(child)) {
          pending.add(child);
          let target = document;
          for (const part of child.slice(2).split('/')) { const decoded = part.replace(/~1/g, '/').replace(/~0/g, '~'); if (!Object.hasOwn(target || {}, decoded)) throw Error('Missing schema reference: ' + child); target = target[decoded]; }
          defs[name] = copy(target);
        }
      } else if (key === 'nullable') continue;
      else result[key] = copy(child);
    }
    if (value.nullable && result.type) result.type = [...new Set([].concat(result.type, 'null'))];
    return result;
  }
  const result = copy(schema);
  return object(result) && Object.keys(defs).length ? { ...result, $defs: { ...result.$defs, ...defs } } : result;
}
// Bundle deliberately retains JSON pointers. Resolve description objects without
// dereferencing recursive schemas (which must stay serializable).
function resolveNode(value, document) {
  const seen = new Set();
  while (object(value) && Object.hasOwn(value, '$ref')) {
    const ref = value.$ref;
    if (typeof ref !== 'string' || !ref.startsWith('#/') || seen.has(ref)) throw Error('Unresolved or circular description reference: ' + ref);
    seen.add(ref);
    let target = document;
    for (const part of ref.slice(2).split('/')) {
      const key = decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~');
      if (!Object.hasOwn(target || {}, key)) throw Error('Missing description reference: ' + ref);
      target = target[key];
    }
    value = target;
  }
  return value;
}
function sourceFacts(source, filePath) {
  const routes = [], calls = [];
  if (/\.[cm]?[jt]sx?$/i.test(filePath)) {
    const tree = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, /x$/i.test(filePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const literal = node => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
    function visit(node) {
      if (ts.isCallExpression(node)) {
        const name = node.expression.getText(tree), argument = node.arguments[0];
        const url = literal(argument) ?? (argument && ts.isTemplateExpression(argument) ? argument.getText(tree).slice(1, -1) : null);
        const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
        // Exported URL configuration is dependency evidence, not proof of an
        // executed request. Keep the default and runtime-override caveat explicit.
        if (name === 'util.format' && typeof url === 'string' && /^https?:\/\//.test(url)) {
          const property = node.parent;
          if (ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(property.parent) && ts.isBinaryExpression(property.parent.parent) && property.parent.parent.left.getText(tree) === 'module.exports') {
            const defaults = new Map();
            function initializers(item) { if (ts.isVariableDeclaration(item) && ts.isIdentifier(item.name) && literal(item.initializer) !== null) defaults.set(item.name.text, literal(item.initializer)); ts.forEachChild(item, initializers); }
            initializers(tree);
            const args = node.arguments.slice(1), values = args.map(arg => literal(arg) ?? (ts.isIdentifier(arg) ? defaults.get(arg.text) : undefined));
            if (values.every(value => typeof value === 'string') && (url.match(/%s/g) || []).length === values.length && !/%[^s]/.test(url)) {
              let at = 0; const configured = url.replace(/%s/g, () => values[at++]);
              calls.push({ url: configured, method: 'CONFIG', line, kind: 'Configured URL', defaultOnly: true });
            }
          }
        }
        const route = /^(?:app|router|server|route)\.(get|post|put|patch|delete|head|options)$/.exec(name);
        if (route && literal(argument) !== null) routes.push({ method: route[1], path: literal(argument), line });
        if (url !== null && /^(?:fetch|axios\.(?:get|post|put|patch|delete|head|options)|requests\.(?:get|post|put|patch|delete|head|options)|(?:http|client)\.(?:get|post|put|patch|delete|head|options))$/.test(name)) {
          let method = name.split('.')[1]?.toUpperCase() || 'GET';
          if (name === 'fetch' && node.arguments[1]) {
            const options = node.arguments[1];
            if (!ts.isObjectLiteralExpression(options)) method = 'UNKNOWN';
            else {
              for (const property of options.properties) {
                if (ts.isSpreadAssignment(property) || ts.isComputedPropertyName(property.name || {})) method = 'UNKNOWN';
                else if (property.name?.getText(tree).replace(/^['"]|['"]$/g, '') === 'method') method = ts.isPropertyAssignment(property) ? (literal(property.initializer)?.toUpperCase() || 'UNKNOWN') : 'UNKNOWN';
              }
            }
          }
          calls.push({ url, method, line });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  } else {
    if (/\.py$/i.test(filePath)) {
      const flask = /^[ \t]*@(?:app|blueprint|bp)\.route\(\s*(['"])([^'"\n]+)\1((?:[^()]|\([^()]*\))*)\)/gm;
      for (const match of source.matchAll(flask)) {
        const declared = /methods\s*=\s*[\[(]([^\])]+)[\])]/.exec(match[3]);
        if (/methods\s*=/.test(match[3]) && !declared) continue;
        const verbs = declared ? [...declared[1].matchAll(/['"](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)['"]/gi)].map(value => value[1]) : ['GET'];
        for (const method of verbs) routes.push({ method, path: match[2], line: source.slice(0, match.index).split('\n').length });
      }
    }
    const route = /(?:\b(?:app|router|server|route)\.(get|post|put|patch|delete|head|options)\s*\(\s*|@(?:app|router)\.(get|post|put|patch|delete|head|options)\s*\(\s*)['"]([^'"\n]+)['"]/gi;
    for (const match of source.matchAll(route)) routes.push({ method: match[1] || match[2], path: match[3], line: source.slice(0, match.index).split('\n').length });
    const call = /\b((?:axios|requests|http|client)\.(get|post|put|patch|delete|head|options))\s*\(\s*['"]([^'"\n]+)['"]/gi;
    for (const match of source.matchAll(call)) calls.push({ method: match[2].toUpperCase(), url: match[3], line: source.slice(0, match.index).split('\n').length });
    if (/\.java$/i.test(filePath) && /\b(?:RestAssured|io\.restassured)\b/.test(source)) {
      const javaSource = source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, token => token.startsWith('/') ? token.replace(/[^\n]/g, ' ') : token);
      const bases = [...javaSource.matchAll(/(?:\bbaseURI\s*=\s*|\bbaseUri\s*\(\s*)"(https?:\/\/[^"\n]+)"/g)].map(match => match[1]);
      for (const match of javaSource.matchAll(/\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*"([^"\n]+)"/gi)) {
        const value = match[2];
        if (/^https?:\/\//.test(value) || value.startsWith('/') && new Set(bases).size === 1) {
          calls.push({ method: match[1].toUpperCase(), url: /^https?:\/\//.test(value) ? value : bases[0].replace(/\/$/, '') + value, line: source.slice(0, match.index).split('\n').length });
        }
      }
    }
  }
  return { routes, calls };
}
function postmanUrl(value, expand) {
  if (typeof value === 'string') return expand(value);
  if (!object(value)) throw Error('Postman request URL is missing.');
  if (value.variable !== undefined && !Array.isArray(value.variable)) throw Error('Postman URL variables must be a list.');
  const variables = new Map((value.variable || []).filter(entry => !entry.disabled).map(entry => [entry.key, entry.value]));
  const substitute = url => url.replace(/\/:(\w+)(?=\/|\?|#|$)/g, (all, key) => variables.has(key) && variables.get(key) != null ? '/' + encodeURIComponent(expand(variables.get(key))) : all);
  if (typeof value.raw === 'string' && value.raw) return substitute(expand(value.raw));
  const join = (input, separator) => Array.isArray(input) ? input.join(separator) : String(input || '');
  const host = expand(join(value.host, '.')), protocol = expand(value.protocol || 'https');
  const segments = Array.isArray(value.path) ? value.path.map(part => {
    if (typeof part === 'string') return part;
    if (object(part) && part.type === 'variable' && typeof part.value === 'string') return ':' + part.value;
    throw Error('Unsupported Postman URL path segment.');
  }) : value.path;
  const path = expand(join(segments, '/')).replace(/^\//, '');
  let url = protocol + '://' + host + (value.port ? ':' + expand(value.port) : '') + '/' + path;
  if (value.query !== undefined && !Array.isArray(value.query)) throw Error('Postman URL query must be a list.');
  const query = new URLSearchParams();
  for (const entry of value.query || []) if (!entry.disabled) query.append(expand(entry.key), expand(entry.value ?? ''));
  if (query.size) url += '?' + query;
  if (value.hash) url += '#' + expand(value.hash);
  return substitute(url);
}
async function discover(repositories) {
  if (!Array.isArray(repositories)) throw Error('Choose repository snapshots to scan.');
  const services = [], apiServices = [], endpoints = [], connections = [], candidates = [], diagnostics = [], calls = [], pacts = [];
  for (const repo of repositories) {
    if (!repo.id || !repo.fullName || !Array.isArray(repo.files)) throw Error('Repository source is incomplete.');
    const service = { id: repo.id, name: repo.fullName, title: repo.fullName.split('/').at(-1), commit: repo.commit, workflow: repo.selected || '', example: !!repo.example, scannedFiles: 0, scanStatus: repo.scanStatus || 'scanned', inspectedPaths: repo.files.filter(file => candidatePath(file.path)).map(file => file.path) };
    services.push(service);
    for (const skipped of repo.skipped || []) diagnostics.push({ serviceId: repo.id, path: skipped.path || '', message: 'Source not scanned: ' + (skipped.reason || 'source unavailable') });
    const files = repo.files.filter(file => !file.isDeleted && typeof file.content === 'string' && candidatePath(file.path));
    const addEndpoint = (method, path, evidence, extra = {}) => {
      method = String(method).toUpperCase();
      let id = identity(repo.id, method, path);
      let endpoint = endpoints.find(item => item.id === id);
      if (endpoint?.apiServiceId && extra.apiServiceId && endpoint.apiServiceId !== extra.apiServiceId) {
        id = identity(repo.id, method, path, extra.apiServiceId);
        endpoint = endpoints.find(item => item.id === id);
      }
      if (!endpoint) { endpoint = { id, serviceId: repo.id, method, path, name: extra.summary || method + ' ' + path, evidence: [], ...extra }; endpoints.push(endpoint); }
      else if (extra.schema !== undefined) Object.assign(endpoint, extra);
      endpoint.evidence.push(evidence); return endpoint;
    };
    for (const file of files) {
      service.scannedFiles++;
      const evidence = { path: file.path, commit: repo.commit, kind: 'source', line: 1, draft: Object.hasOwn(file, 'originalContent') && file.content !== file.originalContent };
      if (/\.(?:json|ya?ml)$/i.test(file.path)) {
        let data;
        try { data = parse(file.content, file.path); }
        catch (error) { diagnostics.push({ serviceId: repo.id, path: file.path, message: error.message }); continue; }
        try {
        if (data?.openapi || data?.swagger) {
          let doc;
          try { doc = await bundle(file, files); }
          catch (error) { diagnostics.push({ serviceId: repo.id, path: file.path, message: 'Cannot resolve this API description: ' + error.message }); continue; }
          service.title = doc.info?.title || service.title;
          const apiServiceId = identity(repo.id, file.path, 'api-service');
          apiServices.push({ id: apiServiceId, repositoryId: repo.id, title: doc.info?.title || file.path, name: file.path, type: 'api-service', evidence: { ...evidence, kind: 'OpenAPI' } });
          for (const [path, pathItem] of Object.entries(doc.paths || {})) {
            const item = resolveNode(pathItem, doc);
            if (item?.trace) diagnostics.push({ serviceId: repo.id, path: file.path, message: 'TRACE ' + path + ' is declared but cannot be executed by this HTTP test runner.' });
            for (const method of methods) if (item?.[method]) {
            const operation = resolveNode(item[method], doc), responses = operation.responses || {}, status = Object.keys(responses).find(key => /^2\d\d$/.test(key)) || '200';
            const response = resolveNode(responses[status], doc), media = response?.content?.['application/json'] || Object.entries(response?.content || {}).find(([type]) => /json/.test(type))?.[1];
            let schema = media?.schema ?? response?.schema, schemaIssue;
            try { if (schema !== undefined) schema = contractSchema(schema, doc); } catch (error) { schema = undefined; schemaIssue = error.message; }
            let baseUrl = operation.servers?.[0]?.url || item.servers?.[0]?.url || doc.servers?.[0]?.url || (doc.host ? (doc.schemes?.[0] || 'https') + '://' + doc.host + (doc.basePath || '') : '');
            const server = operation.servers?.[0] || item.servers?.[0] || doc.servers?.[0];
            baseUrl = baseUrl.replace(/\{([^}]+)\}/g, (all, name) => server?.variables?.[name]?.default ?? all);
            addEndpoint(method, path, { ...evidence, kind: 'OpenAPI', pointer: '#/paths/' + path.replace(/~/g, '~0').replace(/\//g, '~1') + '/' + method }, {
              apiServiceId, summary: operation.summary, operationId: operation.operationId, description: operation.description || '', baseUrl, expectedStatus: Number(status), schema, schemaIssue,
              dialect: String(doc.openapi || '').startsWith('3.1') ? '2020-12' : 'draft-07', parameters: [...(item.parameters || []), ...(operation.parameters || [])].map(value => resolveNode(value, doc)),
              requestBody: resolveNode(operation.requestBody, doc), security: operation.security ?? doc.security ?? []
            });
            }
          }
        }
        if (typeof data?.info?.schema === 'string' && /(?:getpostman|postman)\.com/.test(data.info.schema) || data?.info?._postman_id) {
          if (data.variable !== undefined && !Array.isArray(data.variable)) throw Error('Postman collection variables must be a list.');
          const variables = new Map((data.variable || []).filter(v => !v.disabled).map(v => { if (!object(v) || typeof v.key !== 'string') throw Error('Invalid Postman variable.'); return [v.key, v.value]; }));
          const expand = value => String(value).replace(/\{\{([^}]+)\}\}/g, (all, key) => variables.get(key) ?? all);
          const events = item => {
            if (item.event !== undefined && !Array.isArray(item.event)) throw Error('Postman events must be a list.');
            return (item.event || []).filter(event => !event.disabled).flatMap(event => event.script?.exec || (event.script?.src ? '[external script]' : [])).join('\n');
          };
          const walk = (items, inheritedAuth, inheritedScripts) => { if (!Array.isArray(items)) throw Error('Postman items must be a list.'); for (const item of items) {
            if (!object(item)) throw Error('Invalid Postman item.');
            const scripts = [inheritedScripts, events(item)].filter(Boolean).join('\n'), auth = item.auth ?? inheritedAuth;
            if (item.item) walk(item.item, auth, scripts); if (!item.request) continue;
            const request = typeof item.request === 'string' ? { url: item.request } : item.request;
            const url = postmanUrl(request.url, expand), method = String(request.method || 'GET').toUpperCase();
            const status = /pm\.response\.to\.have\.status\(\s*(\d{3})/.exec(scripts)?.[1];
            if (request.header !== undefined && !Array.isArray(request.header)) throw Error('Postman request headers must be a list.');
            const header = Object.fromEntries((request.header || []).filter(h => !h.disabled).map(h => [h.key, expand(h.value)]));
            const effectiveAuth = request.auth ?? auth;
            const reasons = [];
            if (request.body && request.body.mode !== 'raw') reasons.push('This Postman body mode needs conversion to a raw request.');
            if (effectiveAuth && effectiveAuth.type !== 'noauth') reasons.push('Postman authentication must be configured as protected request headers before execution.');
            if (request.certificate || request.proxy) reasons.push('Postman certificate/proxy settings require Postman runtime execution.');
            if (scripts.trim()) reasons.push('Postman scripts and inherited setup/assertions require Postman runtime execution; imported requests remain evidence only.');
            if (/\{\{|\$\{/.test(url + Object.values(header).join('') + expand(request.body?.raw || ''))) reasons.push('Resolve all Postman variables before executing this request.');
            if (/\/:[\w]+(?=\/|\?|#|$)/.test(url)) reasons.push('Resolve all Postman URL path variables before executing this request.');
            candidates.push({ id: identity(repo.id, file.path, item.name, url), serviceId: repo.id, name: item.name || method + ' ' + url, kind: 'api', method, url, expectedStatus: Number(status || 200), headers: header, body: request.body?.mode === 'raw' ? expand(request.body.raw || '') : '', evidence: { ...evidence, kind: 'Postman' },
              review: 'Imported request template. Review variables, authentication and expectations. Postman scripts are source evidence and are never executed.', blocked: reasons.join(' ') });
          } }; walk(data.item, data.auth, events(data));
        }
        if (data?.consumer?.name && data?.provider?.name && Array.isArray(data.interactions)) {
          if (typeof data.consumer.name !== 'string' || typeof data.provider.name !== 'string') throw Error('Pact consumer and provider names must be text.');
          pacts.push({ repo, data, evidence: { ...evidence, kind: 'Pact' } });
        }
        } catch (error) { diagnostics.push({ serviceId: repo.id, path: file.path, message: error.message }); }
        continue;
      }
      // Literal routes and HTTP calls are static evidence. Dynamic expressions,
      // router prefixes and runtime service discovery remain explicitly unknown.
      const facts = sourceFacts(file.content, file.path);
      for (const route of facts.routes) addEndpoint(route.method, route.path, { ...evidence, kind: 'Literal route', line: route.line }, { confidence: 'Static route; verify mounted prefixes', baseUrl: repo.apiBaseUrl || '', baseUrlSource: repo.apiBaseUrl ? 'Project connection setting; verify deployment' : undefined, expectedStatus: 200 });
      for (const call of facts.calls) calls.push({ ...call, serviceId: repo.id, evidence: { ...evidence, kind: call.kind || 'HTTP call', line: call.line } });
    }
  }
  for (const call of calls) {
    if (call.kind === 'Configured URL') {
      const matches = services.filter(service => service.id !== call.serviceId && endpoints.some(endpoint => {
        if (endpoint.serviceId !== service.id || !endpoint.baseUrl) return false;
        try { return new URL(endpoint.baseUrl).origin === new URL(call.url).origin; } catch { return false; }
      }));
      const provider = matches.length === 1 ? matches[0] : null;
      connections.push({ id: identity(call.serviceId, call.url, call.evidence.path, call.evidence.line, 'configured'), source: call.serviceId, target: provider?.id || null, endpointId: null, method: 'CONFIG', url: call.url, confidence: 'Configured default destination; runtime override possible', evidence: call.evidence, defaultOnly: true });
      continue;
    }
    let target;
    const matches = endpoints.filter(endpoint => {
      if (endpoint.method !== call.method) return false;
      if (!/^https?:/.test(call.url) || !endpoint.baseUrl || !/^https?:/.test(endpoint.baseUrl)) return false;
      try { const url = new URL(endpoint.baseUrl.replace(/\/$/, '') + endpoint.path); return url.origin === new URL(call.url).origin && pathMatches(url.pathname, call.url); } catch { return false; }
    });
    if (matches.length === 1 && !/[{$]/.test(call.url)) target = matches[0];
    connections.push({ id: identity(call.serviceId, call.url, call.method, call.evidence.path, call.evidence.line), source: call.serviceId, target: target?.serviceId || null, targetApiServiceId: target?.apiServiceId || null, endpointId: target?.id || null, method: call.method, url: call.url, confidence: target ? 'Static URL match' : 'Unresolved target', evidence: call.evidence });
  }
  // A collection may live in the consumer repository. Associate its request
  // with the uniquely matching provider rather than assuming file ownership.
  for (const candidate of candidates.filter(item => item.evidence.kind === 'Postman')) {
    const matches = endpoints.filter(endpoint => {
      if (endpoint.method !== candidate.method || !endpoint.baseUrl) return false;
      try {
        const provider = new URL(endpoint.baseUrl.replace(/\/$/, '') + endpoint.path), request = new URL(candidate.url);
        return provider.origin === request.origin && pathMatches(provider.pathname, request.pathname);
      } catch { return false; }
    });
    if (matches.length === 1) { candidate.endpointId = matches[0].id; candidate.serviceId = matches[0].serviceId; }
  }
  for (const { repo, data, evidence } of pacts) {
    const find = name => services.filter(s => s.title.toLowerCase() === name.toLowerCase() || s.name.split('/').at(-1).toLowerCase() === name.toLowerCase());
    const providers = find(data.provider.name), consumers = find(data.consumer.name), provider = providers.length === 1 ? providers[0] : null, consumer = consumers.length === 1 ? consumers[0] : null;
    for (const interaction of data.interactions) {
      if (!interaction?.request || !interaction?.response) { diagnostics.push({ serviceId: repo.id, path: evidence.path, message: 'Pact message/plugin interaction requires the native Pact verifier.' }); continue; }
      try {
      const method = String(interaction.request.method || 'GET').toUpperCase(), path = interaction.request.path;
      if (typeof path !== 'string') continue;
      const matching = endpoints.filter(e => e.serviceId === provider?.id && e.method === method && (pathMatches(e.path, path) || pathMatches(e.baseUrl.replace(/\/$/, '') + e.path, path)));
      const endpoint = matching.length === 1 ? matching[0] : null;
      const reasons = [];
      if (interaction.providerStates?.length || interaction.providerState || interaction.response.matchingRules || interaction.request.matchingRules || interaction.request.generators || interaction.response.generators || interaction.matchingRules || interaction.generators) reasons.push('Provider states, matching rules or generators require native Pact verification.');
      if (interaction.type || data.metadata?.plugins?.length || data.metadata?.pactSpecification?.version?.startsWith('4.')) reasons.push('Pact V4/plugin interactions require the native Pact verifier.');
      if (!Object.hasOwn(interaction.response, 'body') || !object(interaction.response.body) && !Array.isArray(interaction.response.body) && interaction.response.body !== null && !['number', 'boolean'].includes(typeof interaction.response.body)) reasons.push('This replay supports JSON response bodies only; use the native Pact verifier for empty, text or binary bodies.');
      const headers = interaction.request.headers || {}, expectedHeaders = interaction.response.headers || {};
      if (!object(headers) || !object(expectedHeaders) || Object.values(headers).some(v => typeof v !== 'string') || Object.values(expectedHeaders).some(v => typeof v !== 'string')) reasons.push('Non-string Pact headers require native Pact verification.');
      let url;
      try { url = endpoint?.baseUrl ? new URL(path, endpoint.baseUrl).href : path; } catch { url = path; }
      const query = interaction.request.query;
      if (query !== undefined) {
        let encoded;
        if (typeof query === 'string') encoded = query.replace(/^\?/, '');
        else if (object(query)) {
          const search = new URLSearchParams();
          for (const [key, values] of Object.entries(query)) for (const value of [].concat(values)) {
            if (!['string', 'number', 'boolean'].includes(typeof value)) throw Error('Pact query values require native Pact verification.');
            search.append(key, String(value));
          }
          encoded = search.toString();
        } else throw Error('Pact query must be a string or object.');
        if (encoded) url += (url.includes('?') ? '&' : '?') + encoded;
      }
      const requestBody = interaction.request.body;
      const contentType = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1] || '';
      const body = requestBody === undefined ? '' : typeof requestBody === 'string' && !/json/i.test(contentType) ? requestBody : JSON.stringify(requestBody);
      candidates.push({ id: identity(repo.id, evidence.path, interaction.description, path, method, query), serviceId: provider?.id || repo.id, endpointId: endpoint?.id, name: interaction.description || 'Pact interaction', kind: 'contract', method, url, expectedStatus: Number(interaction.response.status), expectedBody: interaction.response.body, expectedHeaders, headers, body, evidence,
        blocked: reasons.join(' '), review: 'Exact HTTP interaction replay. This does not publish Pact verification or replace consumer/provider verification.' });
      connections.push({ id: identity(repo.id, evidence.path, interaction.description, path, method, query, 'pact'), source: consumer?.id || repo.id, target: provider?.id || null, endpointId: endpoint?.id || null, method, url: path, confidence: 'Pact declaration', evidence });
      } catch (error) { diagnostics.push({ serviceId: repo.id, path: evidence.path, message: error.message }); }
    }
  }
  const externalNodes = [];
  for (const connection of connections.filter(item => !item.target)) {
    try {
      const url = new URL(connection.url);
      if (!['http:', 'https:'].includes(url.protocol) || /[{$]/.test(url.origin)) continue;
      const id = identity('external', url.origin);
      if (!externalNodes.some(node => node.id === id)) externalNodes.push({ id, title: url.host, name: url.origin, type: 'external' });
      connection.externalId = id;
      connection.destinationKind = 'Literal HTTP destination; provider not verified';
    } catch { /* Relative and dynamic destinations remain unresolved. */ }
  }
  return { version: 1, scannedAt: new Date().toISOString(), services, apiServices, externalNodes, endpoints, connections, candidates, diagnostics, coverage: 'Static OpenAPI, literal Node/Python routes, HTTP calls including Java RestAssured, Postman and HTTP Pact interactions. External nodes identify literal destinations, not verified providers. Dynamic routes, gateways and runtime traffic may be missing. A missing edge does not prove no connection.' };
}
module.exports = { discover, candidatePath, contractSchema, identity };
