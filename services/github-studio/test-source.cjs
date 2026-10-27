'use strict';
// Repository source is data: parsing and preview never load user modules or execute tests.
const crypto = require('node:crypto');
const ts = require('typescript');
const { parseDocument } = require('yaml');
const native = require('./test-parsers/structured.cjs');
const MAX_BYTES = 0; // No application byte ceiling.
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const range = (start, end) => ({ start, end });
const fail = (code, message) => { const error = Error(message); error.code = code; throw error; };
const diagnostic = (code, message, severity = 'warning') => ({ code, message, severity });
function check(path, source) {
  if (typeof path !== 'string' || !path || path.includes('\\') || path.startsWith('/') || path.split('/').some(p => !p || p === '..' || p === '.' || p.toLowerCase() === '.git') || /[\x00-\x1f\x7f:]/.test(path)) fail('INVALID_PATH', 'Use a relative repository file path.');
  if (typeof source !== 'string') fail('LIMIT', 'Test source must be UTF-8 text.');
}
function languageOf(path) { return /\.[cm]?[jt]sx?$/i.test(path) ? 'javascript' : /\.py$/i.test(path) ? 'python' : /\.cs$/i.test(path) ? 'csharp' : /\.robot$/i.test(path) ? 'robot' : 'unknown'; }
const literal = node => node && (ts.isStringLiteralLike(node) ? node.text : null);
function parsed(path, source) {
  const kind = /\.tsx$/i.test(path) ? ts.ScriptKind.TSX : /\.jsx$/i.test(path) ? ts.ScriptKind.JSX : /\.[cm]?ts$/i.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
}
function chain(node) {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) { const left = chain(node.expression); return left && [...left, node.name.text]; }
  if (ts.isCallExpression(node) || ts.isTaggedTemplateExpression(node)) return chain(ts.isCallExpression(node) ? node.expression : node.tag);
  return null;
}
function bindingTable(sf, frameworkHint, source) {
  const bindings = new Map(), roots = new Map();
  const add = (name, framework, role, declaration, scope = sf) => { bindings.set(name, { framework, role, declaration, scope }); };
  const known = name => name === '@playwright/test' ? 'playwright' : name === 'vitest' ? 'vitest' : name === '@jest/globals' ? 'jest' : null;
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) {
      const framework = known(literal(statement.moduleSpecifier)) || (/playwright/.test(frameworkHint || '') ? 'playwright' : null);
      if (!framework || statement.importClause?.isTypeOnly) continue;
      const clause = statement.importClause?.namedBindings;
      if (clause && ts.isNamedImports(clause)) for (const element of clause.elements) { const name = element.propertyName?.text || element.name.text; if (['test', 'it', 'describe', 'suite', 'expect'].includes(name) && !element.isTypeOnly) add(element.name.text, framework, name, element); }
      if (clause && ts.isNamespaceImport(clause)) add(clause.name.text, framework, 'namespace', clause);
    }
    if (ts.isVariableStatement(statement)) for (const dec of statement.declarationList.declarations) {
      if (!dec.initializer || !ts.isCallExpression(dec.initializer)) continue;
      const c = dec.initializer, framework = ts.isIdentifier(c.expression) && c.expression.text === 'require' ? known(literal(c.arguments[0])) : null;
      if (framework && ts.isObjectBindingPattern(dec.name)) for (const item of dec.name.elements) if (ts.isIdentifier(item.name)) add(item.name.text, framework, item.propertyName?.getText(sf) || item.name.text, item);
      const base = chain(c.expression), parent = base && bindings.get(base[0]);
      if (ts.isIdentifier(dec.name) && parent && base.includes('extend')) add(dec.name.text, parent.framework, 'test', dec);
    }
  }
  const inferred = frameworkHint || (/from\s*['"]vitest['"]|require\(['"]vitest/.test(source) ? 'vitest' : null);
  if (['jest', 'vitest'].includes(inferred)) for (const role of ['test', 'it', 'describe', 'suite', 'expect', 'fit', 'fdescribe', 'xit', 'xdescribe', 'xtest']) if (!bindings.has(role)) add(role, inferred, role, null);
  function names(node, out = []) { if (ts.isIdentifier(node)) out.push(node.text); else if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) for (const e of node.elements) if (ts.isBindingElement(e)) names(e.name, out); return out; }
  function scopeOf(node) { const hoisted = ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent) && !(node.parent.flags & ts.NodeFlags.BlockScoped); for (let p = node.parent; p; p = p.parent) if ((!hoisted && ts.isBlock(p)) || ts.isSourceFile(p) || ts.isFunctionLike(p)) return p; return sf; }
  function scan(node) {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node) || ts.isCatchClause(node)) {
      const nm = ts.isCatchClause(node) ? node.variableDeclaration?.name : node.name;
      if (nm) for (const name of names(nm)) { const list = roots.get(name) || []; list.push({ node, scope: ts.isParameter(node) ? node.parent : ts.isFunctionExpression(node) ? node : scopeOf(node) }); roots.set(name, list); }
    }
    ts.forEachChild(node, scan);
  }
  scan(sf);
  const ancestor = (node, target) => { for (let p = node; p; p = p.parent) if (p === target) return true; return false; };
  return { bindings, resolve(name, call) {
    const found = bindings.get(name); if (!found) return null;
    for (const local of roots.get(name) || []) {
      if (local.node === found.declaration || found.declaration?.parent === local.node || found.declaration?.parent?.parent === local.node) continue;
      if (ancestor(call, local.scope)) return null;
    }
    return found;
  } };
}
function dedent(text) {
  const lines = text.replace(/^\r?\n/, '').replace(/\r?\n[ \t]*$/, '').split(/\r?\n/), lengths = lines.filter(l => l.trim()).map(l => /^[ \t]*/.exec(l)[0].length);
  const min = lengths.length ? lengths.reduce((a,b)=>Math.min(a,b),Infinity) : 0; return lines.map(l => l.slice(Math.min(min, /^[ \t]*/.exec(l)[0].length))).join('\n');
}
function jsDiscover({ path, source, frameworkHint }) {
  const sf = parsed(path, source), table = bindingTable(sf, frameworkHint, source), fingerprint = hash(source), cases = [], diagnostics = sf.parseDiagnostics.map(d => diagnostic('INVALID_SOURCE', ts.flattenDiagnosticMessageText(d.messageText, '\n'), 'error'));
  const visit = (node, parentId = null, inheritedTags = []) => {
    if (ts.isCallExpression(node)) {
      const parts = chain(node.expression), bind = parts && table.resolve(parts[0], node);
      if (bind) {
        const names = [bind.role === 'namespace' ? parts[1] : bind.role, ...parts.slice(bind.role === 'namespace' ? 2 : 1)], role = names[0];
        const suite = ['describe', 'suite', 'fdescribe', 'xdescribe'].includes(role) || role === 'test' && names.includes('describe');
        const allowedModifiers = ['only', 'skip', 'fixme', 'fail', 'todo', 'concurrent', 'sequential', 'fails', 'failing', 'each', 'for', 'runIf', 'skipIf'];
        const candidate = suite ? names.every(n => ['test', 'describe', 'suite', 'fdescribe', 'xdescribe', 'serial', 'parallel', ...allowedModifiers].includes(n)) : ['test', 'it', 'fit', 'xit', 'xtest'].includes(role) && names.slice(1).every(n => allowedModifiers.includes(n));
        const callback = [...node.arguments].reverse().find(a => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
        const titleNode = node.arguments[0], title = literal(titleNode), todo = names.includes('todo') && node.arguments.length === 1;
        if (candidate && (callback || todo) && (!callback || callback !== titleNode || suite)) {
          // Only the outer parameterized call declares the case; .each(table) itself does not.
          const parameterized = ts.isCallExpression(node.expression) || ts.isTaggedTemplateExpression(node.expression);
          const details = node.arguments.find(a => ts.isObjectLiteralExpression(a));
          const tagProperty = details?.properties.find(p => ts.isPropertyAssignment(p) && ['tag', 'tags'].includes(p.name.getText(sf).replace(/['"]/g, '')));
          const ownTags = tagProperty ? (ts.isArrayLiteralExpression(tagProperty.initializer) ? tagProperty.initializer.elements : [tagProperty.initializer]).map(literal).filter(v => v !== null) : [];
          const titleTags = bind.framework === 'playwright' && title ? title.match(/@[\w-]+/g) || [] : [];
          const start = node.getStart(sf), end = node.getEnd(), id = hash(path + fingerprint + start + ':' + end).slice(0, 24);
          const body = callback?.body && ts.isBlock(callback.body) ? callback.body : null;
          const statement = ts.isExpressionStatement(node.parent) ? node.parent : null;
          const item = { id, kind: suite ? 'suite' : 'case', framework: bind.framework, title, name: title || '(dynamic title)', titleExpression: title === null && titleNode && titleNode !== callback ? titleNode.getText(sf) : null,
            parentId, modifiers: names.slice(1), range: range(start, end), titleRange: title !== null ? range(titleNode.getStart(sf), titleNode.getEnd()) : null,
            bodyRange: body ? range(body.getStart(sf) + 1, body.getEnd() - 1) : null, statementRange: statement ? range(statement.getStart(sf), statement.getEnd()) : range(start, end),
            bodySource: body ? dedent(source.slice(body.getStart(sf) + 1, body.getEnd() - 1)) : '', tags: [...new Set([...inheritedTags, ...ownTags, ...titleTags])], ownTags: [...new Set([...ownTags, ...titleTags])],
            assertions: [], routes: [], steps: [], parameterized, dynamic: title === null && !!titleNode && titleNode !== callback, binding: parts[0],
            capabilities: { rename: title !== null, editBody: !!body, editTags: bind.framework === 'playwright' && title !== null && (!tagProperty || literal(tagProperty.initializer) !== null || ts.isArrayLiteralExpression(tagProperty.initializer) && tagProperty.initializer.elements.every(e => literal(e) !== null)), delete: !!statement, addChild: suite && !!body }, diagnostics: [],
            _tagRange: tagProperty ? range(tagProperty.initializer.getStart(sf), tagProperty.initializer.getEnd()) : null, _detailsEnd: details ? details.getEnd() - 1 : null, _detailsHasProperties: !!details?.properties.length, _detailsTrailingComma: !!details?.properties.hasTrailingComma, _titleEnd: titleNode?.getEnd(), _titleTags: titleTags, _callbackParams: callback?.parameters.map(p => p.name.getText(sf)) || [] };
          if (body) {
            item.steps = body.statements.map(s => ({ source: s.getText(sf), range: range(s.getStart(sf), s.getEnd()) }));
            const fixtures = new Map();
            for (const parameter of callback.parameters) if (ts.isObjectBindingPattern(parameter.name)) for (const element of parameter.name.elements) if (ts.isIdentifier(element.name)) fixtures.set(element.name.text, element.propertyName?.getText(sf) || element.name.text);
            const inspect = child => {
              if (child !== body && ts.isFunctionLike(child)) return;
              if (ts.isCallExpression(child)) {
                const c = chain(child.expression), root = c && table.resolve(c[0], child);
                if (root?.role === 'expect' && c.length > 1 && !['soft', 'poll', 'extend', 'assertions', 'hasAssertions'].includes(c[c.length - 1])) item.assertions.push({ kind: c[c.length - 1], source: child.getText(sf), range: range(child.getStart(sf), child.getEnd()) });
                const fixture = c && fixtures.get(c[0]), verb = c?.at(-1), routeCall = c && ((['page', 'context'].includes(fixture) && ['goto', 'route'].includes(verb)) || (fixture === 'request' || ['page', 'context'].includes(fixture) && c.includes('request')) && ['get', 'post', 'put', 'delete', 'patch'].includes(verb));
                if (routeCall && child.arguments[0]) item.routes.push({ kind: verb === 'goto' ? 'navigation' : verb === 'route' ? 'intercept' : 'request', value: literal(child.arguments[0]), expression: child.arguments[0].getText(sf), range: range(child.getStart(sf), child.getEnd()) });
              }
              ts.forEachChild(child, inspect);
            }; inspect(body);
          }
          if (!statement) item.diagnostics.push(diagnostic('NESTED_EXPRESSION', 'This declaration is embedded in another expression; delete it in source.'));
          if (item.dynamic) item.diagnostics.push(diagnostic('DYNAMIC_TITLE', 'Title is an expression; inspect or edit its source.'));
          cases.push(item);
          if (body && suite) for (const child of body.statements) visit(child, id, item.tags);
          return;
        }
      }
    }
    ts.forEachChild(node, child => visit(child, parentId, inheritedTags));
  }; visit(sf);
  if (!cases.length) diagnostics.push(diagnostic('NO_STATIC_TESTS', 'No supported test declarations found. Choose a framework for global or custom fixture bindings, or edit source.'));
  const candidateBinding = [...table.bindings].find(([, b]) => ['test', 'it'].includes(b.role)), namespaceBinding = [...table.bindings].find(([, b]) => b.role === 'namespace');
  const testBindings = {};
  for (const [name, b] of table.bindings) if (['test', 'it'].includes(b.role) && !testBindings[b.framework]) testBindings[b.framework] = name;
  for (const [name, b] of table.bindings) if (b.role === 'namespace' && !testBindings[b.framework]) testBindings[b.framework] = name + '.test';
  return { cases, diagnostics, framework: cases[0]?.framework || candidateBinding?.[1].framework || namespaceBinding?.[1].framework || frameworkHint || null, testBinding: candidateBinding?.[0] || (namespaceBinding ? namespaceBinding[0] + '.test' : null), testBindings, parser: 'typescript-ast' };
}
async function discover(options) {
  const { path, source } = options; check(path, source); const language = languageOf(path), fingerprint = hash(source);
  const result = language === 'javascript' ? jsDiscover(options) : language === 'unknown' ? { cases: [], diagnostics: [diagnostic('UNSUPPORTED_LANGUAGE', 'Structured editing is unavailable for this extension; use source editing.')], framework: null, parser: null } : await native.discover(options);
  const invalid = result.diagnostics.some(d => d.severity === 'error');
  if (invalid) for (const c of result.cases) for (const key of Object.keys(c.capabilities)) c.capabilities[key] = false;
  return { schemaVersion: 1, path, language, fingerprint, sourceHash: fingerprint, coordinateSystem: 'utf16', sourceBytes: Buffer.byteLength(source), capabilities: { structured: !invalid && result.parser !== null, source: true }, ...result };
}
function quoted(value, original = "'") {
  const q = original[0] === '"' ? '"' : "'";
  return q + String(value).replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), '\\' + q).replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + q;
}
function bodyReplacement(source, c, text, language) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n', startLine = source.lastIndexOf('\n', c.range.start - 1) + 1, outer = /^[ \t]*/.exec(source.slice(startLine))[0], indent = outer + (source.includes('\t') ? '\t' : '  ');
  if (language === 'python') return native.bodyReplacement(source, c, text);
  if (language === 'robot') return native.bodyReplacement(source, c, text);
  return eol + text.replace(/\r\n/g, '\n').split('\n').map(l => l ? indent + l : '').join(eol) + eol + outer;
}
async function mutate({ path, source, caseId, expectedFingerprint, operation, ...rest }) {
  const before = await discover({ path, source, frameworkHint: rest.frameworkHint, projectHints: rest.projectHints });
  if (expectedFingerprint !== undefined && expectedFingerprint !== before.fingerprint) fail('STALE_SOURCE', 'The file changed. Reopen the test before editing.');
  const op = typeof operation === 'string' ? { type: operation, ...rest } : operation;
  if (!op || typeof op.type !== 'string') fail('INVALID_OPERATION', 'Choose a test editing operation.');
  if (before.diagnostics.some(d => d.severity === 'error')) fail('INVALID_SOURCE', 'Fix source syntax before using structured editing.');
  caseId = caseId || op.caseId;
  const c = before.cases.find(item => item.id === caseId), edits = [];
  const edit = (r, newText) => edits.push({ ...r, oldText: source.slice(r.start, r.end), newText });
  if (op.type === 'add') {
    const parent = op.parentId ? before.cases.find(item => item.id === op.parentId) : null;
    if (op.parentId && (!parent || !parent.capabilities.addChild)) fail('UNSUPPORTED_CONSTRUCT', 'Choose a supported suite for the new test.');
    if (before.language !== 'javascript') {
      const addition = native.add({ path, source, parent, operation: op, discovery: before }); edit(addition.range, addition.text);
    } else {
      const framework = op.framework || before.framework;
      if (!['playwright', 'jest', 'vitest'].includes(framework)) fail('FRAMEWORK_REQUIRED', 'Choose Playwright, Vitest or Jest.');
      const binding = before.testBindings[framework];
      if (!binding) fail('BINDING_REQUIRED', 'Create a new scaffold file or select the framework before adding to this source.');
      const title = quoted(op.title ?? 'New test'), body = op.bodySource ?? '', tags = validTags(op.tags || []), details = framework === 'playwright' && tags.length ? ', { tag: ' + JSON.stringify(tags) + ' }' : '';
      const eol = source.includes('\r\n') ? '\r\n' : '\n', pos = parent ? parent.bodyRange.end : source.length, base = parent ? /^[ \t]*/.exec(source.slice(source.lastIndexOf('\n', parent.range.start - 1) + 1))[0] + '  ' : '';
      const text = `${eol}${base}${binding}(${title}${details}, ${framework === 'playwright' ? 'async ({ page })' : 'async ()'} => {${eol}${body.split(/\r?\n/).map(l => base + '  ' + l).join(eol)}${eol}${base}});${eol}`;
      edit(range(pos, pos), text);
    }
  } else {
    if (!c) fail('STALE_CASE', 'This test changed or no longer exists. Reopen the file.');
    if (op.type === 'rename') {
      if (!c.capabilities.rename) fail('UNSUPPORTED_CONSTRUCT', 'This title must be changed in source.');
      if (typeof op.title !== 'string' || !op.title.trim()) fail('INVALID_TITLE', 'Use a nonempty test title.');
      if (before.language === 'javascript') edit(c.titleRange, quoted(op.title, source.slice(c.titleRange.start, c.titleRange.end)));
      else {
        if (before.language === 'python' && c.kind === 'case' && !op.title.startsWith('test')) fail('INVALID_TITLE', 'Python test names must keep their test prefix to remain discoverable.');
        if (before.language === 'python' && c.kind === 'suite' && c.framework !== 'unittest' && !op.title.startsWith('Test')) fail('INVALID_TITLE', 'pytest classes must keep their Test prefix to remain collectable.');
        edit(c.titleRange, native.rename(before.language, op.title));
      }
    } else if (op.type === 'body') {
      if (!c.capabilities.editBody || typeof op.bodySource !== 'string') fail('UNSUPPORTED_CONSTRUCT', 'This test body must be changed in source.');
      edit(c.bodyRange, bodyReplacement(source, c, op.bodySource, before.language));
    } else if (op.type === 'delete') {
      if (!c.capabilities.delete) fail('UNSUPPORTED_CONSTRUCT', 'This declaration must be deleted in source.');
      let replacement = '';
      if (before.language === 'python' && c.parentId) {
        const parent = before.cases.find(item => item.id === c.parentId);
        if (parent?.bodyRange) {
          const remaining = source.slice(parent.bodyRange.start, c.statementRange.start) + source.slice(c.statementRange.end, parent.bodyRange.end);
          if (!remaining.split(/\r?\n/).some(line => line.trim() && !line.trim().startsWith('#'))) replacement = /^[ \t]*/.exec(source.slice(source.lastIndexOf('\n', c.range.start - 1) + 1))[0] + 'pass';
        }
      }
      edit(c.statementRange, replacement);
    } else if (op.type === 'tags') {
      if (!c.capabilities.editTags) fail('UNSUPPORTED_CONSTRUCT', 'These tags must be changed in source.');
      const tags = validTags(op.tags).map(t => before.language === 'javascript' && !t.startsWith('@') ? '@' + t : t);
      if (before.language !== 'javascript') { const tagEdit = native.tags({ source, c, tags, language: before.language }); for (const part of tagEdit.edits || [tagEdit]) edit(part.range, part.text); }
      else {
        if (c._titleTags.length) edit(c.titleRange, quoted(c.title.replace(/@[\w-]+/g, '').replace(/\s+$/g, ''), source.slice(c.titleRange.start, c.titleRange.end)));
        if (c._tagRange) edit(c._tagRange, JSON.stringify(tags));
        else if (c._detailsEnd !== null) edit(range(c._detailsEnd, c._detailsEnd), (c._detailsHasProperties && !c._detailsTrailingComma ? ', ' : ' ') + 'tag: ' + JSON.stringify(tags));
        else edit(range(c._titleEnd, c._titleEnd), ', { tag: ' + JSON.stringify(tags) + ' }');
      }
    } else if (op.type === 'step' || op.type === 'assertion') {
      const list = op.type === 'step' ? c.steps : c.assertions, selected = list[op.index];
      if (!selected || typeof op.source !== 'string') fail('INVALID_OPERATION', 'Choose a current step or assertion.');
      edit(selected.range, op.source);
    } else fail('INVALID_OPERATION', 'Unknown test editing operation.');
  }
  let changed = source; for (const e of [...edits].sort((a, b) => b.start - a.start)) changed = changed.slice(0, e.start) + e.newText + changed.slice(e.end);
  const after = await discover({ path, source: changed, frameworkHint: rest.frameworkHint || before.framework, projectHints: rest.projectHints });
  if (after.diagnostics.some(d => d.severity === 'error')) fail('INVALID_SOURCE', 'The proposed edit produces invalid source: ' + after.diagnostics.filter(d => d.severity === 'error').map(d => d.message).join(' '));
  return { source: changed, content: changed, fingerprint: after.fingerprint, sourceHash: after.fingerprint, edits, discovery: after, unchangedOutsideEdits: true };
}
function validTags(tags) { if (!Array.isArray(tags) || tags.some(t => typeof t !== 'string' || !/^@?[A-Za-z0-9_-]+$/.test(t))) fail('INVALID_TAGS', 'Use simple test tags.'); return [...new Set(tags)]; }
function scaffold({ path, framework = 'playwright', title = 'New test', bodySource, tags = [] }) {
  check(path, ''); validTags(tags);
  if (typeof title !== 'string' || !title.trim()) fail('INVALID_TITLE', 'Use a nonempty test title.');
  if (!['playwright', 'vitest', 'jest'].includes(framework)) return native.scaffold({ path, framework, title, bodySource, tags });
  if (languageOf(path) !== 'javascript') fail('INVALID_FRAMEWORK', 'Choose a JavaScript or TypeScript file for this framework.');
  const module = framework === 'playwright' ? '@playwright/test' : framework === 'jest' ? '@jest/globals' : 'vitest';
  const details = framework === 'playwright' && tags.length ? ', { tag: ' + JSON.stringify(tags.map(t => t.startsWith('@') ? t : '@' + t)) + ' }' : '';
  const imports = /\.cjs$/i.test(path) ? `const { test, expect } = require('${module}');` : `import { test, expect } from '${module}';`;
  return `${imports}\n\ntest(${quoted(title)}${details}, ${framework === 'playwright' ? 'async ({ page })' : 'async ()'} => {\n${(bodySource ?? (framework === 'playwright' ? "await page.goto('/');\nawait expect(page).toHaveTitle(/.+/);" : 'expect(1 + 1).toBe(2);')).split(/\r?\n/).map(l => '  ' + l).join('\n')}\n});\n`;
}
function tokens(command) {
  // Shell grammar beyond this explicit safe subset remains unresolved, never evaluated.
  if (/[`$<>|;\r\n]/.test(command) || command.includes('&&') || command.includes('||')) return null;
  const out = []; let current = '', quote = '', has = false;
  for (let i = 0; i < command.length; i++) { const c = command[i]; if (quote) { if (c === quote) quote = ''; else current += c; has = true; } else if (c === '"' || c === "'") { quote = c; has = true; } else if (/\s/.test(c)) { if (has) out.push(current); current = ''; has = false; } else { current += c; has = true; } }
  if (quote) return null; if (has) out.push(current); return out;
}
function simpleChain(command) {
  let quote = '', start = 0; const parts = [];
  for (let i = 0; i < command.length; i++) { const c = command[i]; if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c; else if (c === '&') { if (command[i + 1] !== '&') return null; parts.push(command.slice(start, i).trim()); start = i + 2; i++; } }
  if (quote) return null; parts.push(command.slice(start).trim()); return parts.every(Boolean) ? parts : null;
}
async function inferLinks({ workflows = [], files = [], packageSources = [], configSources = [] }) {
  const links = [], orphans = [], unresolvedSteps = [], diagnostics = [], packages = new Map(), fileFrameworks = new Map();
  for (const file of packageSources) { try { packages.set(file.path.replace(/(^|\/)package\.json$/, ''), JSON.parse(file.source ?? file.content)); } catch { diagnostics.push(diagnostic('INVALID_PACKAGE', 'Cannot read package scripts in ' + file.path)); } }
  for (const file of files) fileFrameworks.set(file.path, file.framework || (await discover({ path: file.path, source: file.source ?? file.content, frameworkHint: file.frameworkHint })).framework);
  const expand = (initial, initialDirectory) => {
    const results = [], pending = [{ command: initial, cwd: initialDirectory, seen: new Set(), conditional: false }];
    while (pending.length) {
      const { command, cwd, seen, conditional } = pending.pop(), parts = simpleChain(command);
      if (!parts) { results.push({ unknown: 'Complex shell or dynamic expression', command, cwd }); continue; }
      if (parts.length > 1) {
        const tasks = []; let currentDirectory = cwd;
        for (const part of parts) {
          const args = tokens(part);
          if (args?.[0] === 'cd' && args.length === 2 && !/^[\\/]|^[A-Za-z]:|[\\$]/.test(args[1])) {
            const next = require('node:path').posix.normalize([currentDirectory, args[1]].filter(Boolean).join('/'));
            if (next === '..' || next.startsWith('../')) results.push({ unknown: 'Working directory escapes snapshot', command: part, cwd });
            else currentDirectory = next === '.' ? '' : next;
          } else tasks.push({ command: part, cwd: currentDirectory, seen: new Set(seen), conditional: true });
        }
        for (let i = tasks.length - 1; i >= 0; i--) pending.push(tasks[i]);
        continue;
      }
      const args = tokens(command); if (!args) { results.push({ unknown: 'Complex shell or dynamic expression', command, cwd }); continue; }
      let script = null;
      if (['npm', 'pnpm', 'yarn'].includes(args[0])) script = ['run', 'run-script'].includes(args[1]) ? args[2] : ['test', 't', 'start'].includes(args[1]) ? (args[1] === 't' ? 'test' : args[1]) : args[0] !== 'npm' && args[1] && !args[1].startsWith('-') ? args[1] : null;
      const scripts = packages.get(cwd)?.scripts;
      if (script && typeof scripts?.[script] === 'string') {
        const key = cwd + ':' + script;
        if (seen.has(key)) { results.push({ unknown: 'Package script cycle', command, cwd }); continue; }
        seen.add(key); const skip = ['run', 'run-script'].includes(args[1]) ? 3 : 2, suffix = args.slice(skip).filter(a => a !== '--');
        pending.push({ command: scripts[script] + (suffix.length ? ' ' + suffix.map(a => JSON.stringify(a)).join(' ') : ''), cwd, seen, conditional });
        continue;
      }
    let runner = [...args];
    if (runner[0] === 'npx') runner.shift();
    else if (['pnpm', 'yarn', 'npm'].includes(runner[0]) && ['exec', 'dlx'].includes(runner[1])) runner.splice(0, 2);
    else if (/^python(?:3(?:\.\d+)?)?$/.test(runner[0]) && runner[1] === '-m') runner.splice(0, 2);
    const name = runner[0], framework = name === 'playwright' && runner[1] === 'test' ? 'playwright' : name === 'vitest' ? 'vitest' : name === 'jest' ? 'jest' : name === 'pytest' ? 'pytest' : name === 'unittest' ? 'unittest' : name === 'dotnet' && runner[1] === 'test' ? 'csharp' : ['robot', 'pabot'].includes(name) ? 'robot' : null;
    const runnerArgs = runner.slice(['playwright', 'dotnet'].includes(name) ? 2 : 1).filter((a, i) => !(name === 'vitest' && i === 0 && ['run', 'watch'].includes(a)));
    results.push({ command, args: runnerArgs, framework, cwd, conditional, unknown: framework ? null : script ? 'Package script is unavailable in this snapshot' : 'Unrecognized runner command' });
    }
    return results;
  };
  for (const wf of workflows) {
    let doc; try { const d = parseDocument(wf.source ?? wf.content, { uniqueKeys: true }); if (d.errors.length) throw Error('Invalid YAML'); doc = d.toJS({ maxAliasCount: -1 }); } catch { diagnostics.push(diagnostic('INVALID_WORKFLOW', 'Cannot map tests for ' + wf.path)); continue; }
    for (const [jobId, job] of Object.entries(doc?.jobs || {})) for (const [stepIndex, step] of (Array.isArray(job?.steps) ? job.steps : []).entries()) {
      if (typeof step?.run !== 'string') continue;
      const rawCwd = step['working-directory'] ?? job.defaults?.run?.['working-directory'] ?? doc.defaults?.run?.['working-directory'] ?? '', cwd = rawCwd.replace(/^\.\//, '').replace(/\/$/, '');
      const base = { workflowPath: wf.path, jobId, stepIndex, workingDirectory: cwd };
      if (/[${}]/.test(cwd) || cwd.split('/').includes('..')) { unresolvedSteps.push({ ...base, reason: 'Dynamic or unsupported working directory' }); continue; }
      const commands = step.run.trim().split(/\r?\n/);
      for (const command of commands) {
        if (!command.trim() || command.trim().startsWith('#')) continue;
        for (const resolved of expand(command.trim(), cwd)) {
        if (resolved.unknown) { unresolvedSteps.push({ ...base, command, reason: resolved.unknown }); continue; }
        const args = resolved.args, filters = [], positional = [];
        const valueOptions = new Set(['-g', '--grep', '--grep-invert', '--testNamePattern', '--testPathPattern', '--testPathIgnorePatterns', '--project', '--filter', '--include', '--exclude', '-k', '-m', '--test', '--suite', '--select', '--ignore', '--config', '-c', '--reporter', '--output', '--workers', '--timeout', '--retries']);
        for (let i = 0; i < args.length; i++) { if (valueOptions.has(args[i])) { filters.push(args[i] + ' ' + (args[i + 1] || '')); i++; } else if (args[i].startsWith('-')) filters.push(args[i]); else positional.push(args[i]); }
        const explicitFiles = positional.filter(a => /\.(?:[cm]?[jt]sx?|py|robot|csproj|sln)(?::\d+)?$/.test(a)).map(a => a.replace(/\\([.*+?^${}()|[\]\\])/g, '$1'));
        for (const file of files) {
          const path = file.path, workingDirectory = resolved.cwd, relative = workingDirectory ? path.startsWith(workingDirectory + '/') ? path.slice(workingDirectory.length + 1) : null : path;
          if (relative === null) continue;
          const framework = fileFrameworks.get(path);
          if (!(framework === resolved.framework || resolved.framework === 'pytest' && ['python', 'unittest'].includes(framework) || resolved.framework === 'csharp' && ['nunit', 'xunit', 'mstest', 'csharp'].includes(framework))) continue;
          if (explicitFiles.length && !explicitFiles.some(f => f.replace(/:\d+$/, '') === relative || f.replace(/:\d+$/, '') === './' + relative || resolved.framework === 'csharp')) continue;
          const restricted = filters.length || configSources.length || !explicitFiles.length || resolved.conditional;
          links.push({ ...base, workingDirectory, filePath: path, framework, confidence: restricted ? 'inferred' : 'explicit', reasons: [filters.length ? 'Runner filters need configuration/runtime review' : resolved.conditional ? 'Conditional shell chain statically contains this runner' : explicitFiles.length ? 'Command names this file' : 'Compatible runner in this directory; configuration may exclude files'], command: resolved.command, filters });
        }
        }
      }
    }
  }
  for (const file of files) if (!links.some(l => l.filePath === file.path)) orphans.push({ path: file.path, reason: unresolvedSteps.length ? 'No static mapping found; unresolved CI commands may run this file' : 'No compatible static CI command found' });
  return { links, orphans, unresolvedSteps, diagnostics };
}
module.exports = { discover, mutate, inferLinks, scaffold, languageOf, MAX_BYTES };
