'use strict';
// Tree-sitter parses Python/C# locally from text; no project runtimes or modules load.
const crypto = require('node:crypto');
const Parser = require('web-tree-sitter');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const r = (start, end) => ({ start, end });
const diag = (code, message, severity = 'warning') => ({ code, message, severity });
const fail = (code, message) => { const e = Error(message); e.code = code; throw e; };
let initialized;
const languages = new Map();
async function parserFor(language) {
  await (initialized ||= Parser.init());
  let grammar = languages.get(language);
  if (!grammar) { grammar = await Parser.Language.load(require.resolve('tree-sitter-wasms/out/tree-sitter-' + language + '.wasm')); languages.set(language, grammar); }
  const parser = new Parser(); parser.setLanguage(grammar); parser.setTimeoutMicros(0); return parser;
}
const field = (node, name) => node.childForFieldName(name);
const nodes = (node, type, out = []) => { const stack=[node];while(stack.length){const current=stack.pop();if(current.type===type)out.push(current);const children=current.namedChildren;for(let i=children.length-1;i>=0;i--)stack.push(children[i]);}return out; };
const startLine = (source, offset) => source.lastIndexOf('\n', offset - 1) + 1;
const endLine = (source, offset) => { const n = source.indexOf('\n', offset); return n < 0 ? source.length : n + 1; };
const indentAt = (source, offset) => /^[ \t]*/.exec(source.slice(startLine(source, offset)))[0];
function dedent(text) { const lines = text.replace(/\r?\n$/, '').split(/\r?\n/), amounts = lines.filter(l => l.trim()).map(l => /^[ \t]*/.exec(l)[0].length), min = amounts.length ? amounts.reduce((a,b)=>Math.min(a,b),Infinity) : 0; return lines.map(l => l.slice(min)).join('\n'); }
function baseCase(path, source, node, title, kind, framework, parentId, fingerprint) {
  const name = field(node, 'name'), body = field(node, 'body'), block = body?.type === 'block' || body?.type === 'declaration_list', python = /\.py$/i.test(path);
  const bodyRange = block ? python ? r(startLine(source, body.startIndex), body.endIndex) : r(body.startIndex + 1, body.endIndex - 1) : null;
  return { id: hash(path + fingerprint + node.startIndex + ':' + node.endIndex).slice(0, 24), kind, framework, title, name: title, titleExpression: null, parentId, range: r(node.startIndex, node.endIndex), titleRange: name ? r(name.startIndex, name.endIndex) : null,
    statementRange: r(node.startIndex, node.endIndex), bodyRange, bodySource: bodyRange ? dedent(source.slice(bodyRange.start, bodyRange.end).replace(/^\r?\n/, '')) : '',
    tags: [], ownTags: [], modifiers: [], assertions: [], routes: [], steps: [], parameterized: false, dynamic: false,
    capabilities: { rename: !!name, editBody: kind === 'case' && !!block, editTags: false, delete: true, addChild: kind === 'suite' && !!block }, diagnostics: [], _bodyIndent: body ? indentAt(source, body.startIndex) : '', _nodeType: node.type };
}
async function astDiscover({ path, source, frameworkHint }) {
  const python = /\.py$/i.test(path), parser = await parserFor(python ? 'python' : 'c_sharp'); let tree;
  try {
    tree = parser.parse(source); if (!tree) return { cases: [], framework: null, parser: 'tree-sitter', diagnostics: [diag('PARSER_TIMEOUT', 'Source parsing exceeded its time budget.', 'error')] };
    const cases = [], diagnostics = [], fingerprint = hash(source);
    if (tree.rootNode.hasError()) diagnostics.push(diag('INVALID_SOURCE', 'The source has syntax errors or syntax unsupported by the pinned grammar; edit source to resolve them.', 'error'));
    if (python && ['function_definition', 'class_definition'].flatMap(type => nodes(tree.rootNode, type)).some(n => !field(n, 'body')?.namedChildren.some(child => child.type !== 'comment'))) diagnostics.push(diag('INVALID_SOURCE', 'Python classes and functions require a nonempty body.', 'error'));
    const visit = (node, parentId = null, inherited = []) => {
      if (python && node.type === 'decorated_definition') {
        const definition = field(node, 'definition'); if (definition) { visitDefinition(definition, parentId, inherited, node); return; }
      }
      if (python && ['function_definition', 'class_definition'].includes(node.type) || !python && ['method_declaration', 'class_declaration'].includes(node.type)) { visitDefinition(node, parentId, inherited); return; }
      for (const c of node.namedChildren) visit(c, parentId, inherited);
    };
    const visitDefinition = (node, parentId, inherited, wrapper = node) => {
      const name = field(node, 'name')?.text || '', suite = /class_/.test(node.type), attrs = python ? wrapper.namedChildren.filter(c => c.type === 'decorator') : node.namedChildren.filter(c => c.type === 'attribute_list');
      const attrText = attrs.map(a => a.text).join('\n');
      const attributeNames = nodes(node, 'attribute').map(a => (field(a, 'name')?.text || '').split('.').at(-1).replace(/Attribute$/, ''));
      const testAttributes = ['Test', 'TestCase', 'TestCaseSource', 'Fact', 'Theory', 'TestMethod', 'DataTestMethod'];
      const recognized = python ? suite ? /^Test/.test(name) || /\b(?:unittest\.)?TestCase\b/.test(node.text.slice(0, node.text.indexOf(':'))) : /^test/.test(name) : suite ? attributeNames.some(a => ['TestFixture', 'TestClass', ...testAttributes].includes(a)) : attributeNames.some(a => testAttributes.includes(a));
      if (!recognized) { if (suite && !python) for (const child of field(node, 'body')?.namedChildren || []) visit(child, parentId, inherited); return; }
      const framework = python ? /\b(?:unittest\.)?TestCase\b/.test(field(node, 'superclasses')?.text || '') || cases.find(c => c.id === parentId)?.framework === 'unittest' || frameworkHint === 'unittest' ? 'unittest' : 'pytest' : attributeNames.some(a => ['Fact', 'Theory'].includes(a)) ? 'xunit' : attributeNames.some(a => ['TestMethod', 'DataTestMethod', 'TestClass'].includes(a)) ? 'mstest' : frameworkHint || 'nunit';
      const item = baseCase(path, source, node, name, suite ? 'suite' : 'case', framework, parentId, fingerprint);
      if (!python && suite) { item.capabilities.rename = false; item.diagnostics.push(diag('CLASS_RENAME_REQUIRES_SYMBOLS', 'Rename C# classes with your project symbol tools, including constructors and references. Exact source editing remains available.')); }
      item.statementRange = r(wrapper.startIndex, wrapper.endIndex);
      // Include indentation when deleting decorated/class members so no orphan attributes remain.
      if (!source.slice(startLine(source, wrapper.startIndex), wrapper.startIndex).trim()) item.statementRange.start = startLine(source, wrapper.startIndex);
      item._declarationStart = wrapper.startIndex;
      item.parameterized = /\b(?:parametrize|TestCase|TestCaseSource|Theory|DataTestMethod|DataRow)\b/.test(attrText);
      const tags = python ? attrs.flatMap(a => [...a.text.matchAll(/\b(?:pytest\.)?mark\.([A-Za-z_]\w*)/g)].map(m => m[1]).filter(t => t !== 'parametrize')) : [...attrText.matchAll(/(?:Category|TestCategory)\s*\(\s*"([^"]+)"|Trait\s*\(\s*"Category"\s*,\s*"([^"]+)"/g)].map(m => m[1] || m[2]);
      item.ownTags = tags; item.tags = [...new Set([...inherited, ...tags])];
      item.capabilities.editTags = python ? framework !== 'unittest' : !suite && ['nunit', 'mstest', 'xunit'].includes(framework);
      item._tagRanges = attrs.filter(a => python ? /^@(?:pytest\.)?mark\.(?!parametrize\b)[A-Za-z_]\w*\s*$/.test(a.text) : /^\[(?:(?:Category|TestCategory)\s*\(\s*"[^"]*"\s*\)|Trait\s*\(\s*"Category"\s*,\s*"[^"]*"\s*\))\]$/.test(a.text)).map(a => r(startLine(source, a.startIndex), endLine(source, a.endIndex)));
      // A range that shares a physical line with other syntax/comments is not owned
      // by the tag and must never be removed by a whole-line splice.
      const simpleTagNodes = attrs.filter(a => item._tagRanges.some(span => span.start <= a.startIndex && span.end >= a.endIndex));
      if (simpleTagNodes.some(a => source.slice(startLine(source, a.startIndex), a.startIndex).trim() || source.slice(a.endIndex, endLine(source, a.endIndex)).trim())) item.capabilities.editTags = false;
      // Never silently erase combined attributes or complex decorator expressions.
      if (tags.length !== item._tagRanges.length) item.capabilities.editTags = false;
      const body = field(node, 'body');
      if (python && body && startLine(source, body.startIndex) === startLine(source, node.startIndex)) { item.capabilities.editBody = false; item.capabilities.addChild = false; item.diagnostics.push(diag('INLINE_PYTHON_BODY', 'Inline Python suites must be edited as source.')); }
      if (body && !suite) {
        item.steps = body.namedChildren.map(s => ({ source: s.text, range: r(s.startIndex, s.endIndex) }));
        const inspect = child => {
          if (child !== body && /(?:function_definition|class_definition|method_declaration|lambda_expression)/.test(child.type)) return;
          if (python && (child.type === 'assert_statement' || child.type === 'call' && /^self\.assert\w*\(/.test(child.text)) || !python && child.type === 'invocation_expression' && /^(?:Assert|CollectionAssert|StringAssert)\./.test(child.text)) item.assertions.push({ kind: python ? 'assert' : child.text.split('(')[0], source: child.text, range: r(child.startIndex, child.endIndex) });
          if ((python && child.type === 'call' || !python && child.type === 'invocation_expression') && /\.(?:goto|route|GotoAsync|RouteAsync|GetAsync|PostAsync)\s*\(/.test(child.text)) { const match = /\(\s*(['"])(.*?)\1/.exec(child.text); item.routes.push({ kind: /[Rr]oute/.test(child.text) ? 'intercept' : 'navigation', value: match?.[2] ?? null, expression: child.text, range: r(child.startIndex, child.endIndex) }); }
          for (const c of child.namedChildren) inspect(c);
        }; inspect(body);
      }
      cases.push(item);
      if (suite) for (const child of body?.namedChildren || []) visit(child, item.id, item.tags);
    };
    visit(tree.rootNode);
    if (!cases.length) diagnostics.push(diag('NO_STATIC_TESTS', 'No supported statically named test declarations found. Source editing remains available.'));
    return { cases, framework: cases.find(c => c.kind === 'case')?.framework || frameworkHint || (python ? 'pytest' : 'nunit'), parser: 'tree-sitter-' + (python ? 'python' : 'csharp'), diagnostics };
  } finally { tree?.delete(); parser.delete(); }
}
function robotDiscover({ path, source }) {
  // Bounded Robot table parser: recognized sections and cells, not a claimed general AST.
  const lines = []; let offset = 0; for (const text of source.split(/(?<=\n)/)) { lines.push({ text, offset, end: offset + text.length }); offset += text.length; }
  const cases = [], diagnostics = [], fingerprint = hash(source); let section = '', current = null;
  const cells = text => { text = text.replace(/\r?\n$/, ''); return text.trimStart().startsWith('|') ? text.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()) : text.split(/\t| {2,}/).map(c => c.trim()); };
  const finish = end => { if (!current) return; end = Math.min(end, current._lastContentEnd); current.range.end = end; current.statementRange.end = end; current.bodyRange.end = end; current.bodySource = dedent(source.slice(current.bodyRange.start, end)); current.capabilities.editBody = current._supported; if (!current._supported) current.diagnostics.push(diag('UNSUPPORTED_ROBOT_BLOCK', 'Pipe tables, continuations and control-flow blocks can be inspected; edit their exact source.')); delete current._supported; delete current._lastContentEnd; cases.push(current); current = null; };
  for (const line of lines) {
    const trimmed = line.text.trim();
    if (/^\*{3}/.test(trimmed)) { finish(line.offset); const m = /^\*{3}\s*(.*?)\s*\*{3}$/.exec(trimmed); if (!m) { diagnostics.push(diag('INVALID_SOURCE', 'Malformed Robot section header.', 'error')); section = ''; } else section = m[1].toLowerCase(); continue; }
    if (!['test cases', 'tasks'].includes(section) || !trimmed || trimmed.startsWith('#')) continue;
    const pipe = trimmed.startsWith('|'), row = cells(line.text), isName = pipe ? !!row[0] : !/^[ \t]/.test(line.text);
    if (isName) {
      finish(line.offset); const title = row[0]; if (!title) continue; const nameStart = line.offset + line.text.indexOf(title), id = hash(path + fingerprint + line.offset).slice(0, 24);
      current = { id, kind: 'case', framework: 'robot', title, name: title, titleExpression: null, parentId: null, range: r(line.offset, line.end), titleRange: r(nameStart, nameStart + title.length), statementRange: r(line.offset, line.end), bodyRange: r(line.end, line.end), bodySource: '', tags: [], ownTags: [], modifiers: [], assertions: [], routes: [], steps: [], parameterized: false, dynamic: /\$\{|@\{/.test(title), capabilities: { rename: true, editBody: !pipe, editTags: !pipe, delete: true, addChild: false }, diagnostics: [], _supported: !pipe, _pipe: pipe, _tagRanges: [], _lastContentEnd: line.end };
    } else if (current) {
      current._lastContentEnd = line.end;
      const first = row.find(Boolean) || '';
      if (pipe || first === '...' || /^(?:FOR|WHILE|IF|TRY|END|ELSE|EXCEPT|FINALLY)\b/.test(first)) current._supported = false;
      if (first.toLowerCase() === '[tags]') { const tags = row.slice(row.indexOf(first) + 1).filter(Boolean); current.ownTags.push(...tags); current.tags.push(...tags); current._tagRanges.push(r(line.offset, line.end)); }
      else if (!first.startsWith('[')) { const step = { source: line.text.replace(/\r?\n$/, ''), range: r(line.offset, line.end - (/\r\n$/.test(line.text) ? 2 : /\n$/.test(line.text) ? 1 : 0)) }; current.steps.push(step); if (/^(?:Should |Page Should |Element Should |Wait Until Element)/.test(first)) current.assertions.push({ ...step, kind: first }); const url = row.find(c => /^https?:\/\//.test(c)); if (url) current.routes.push({ ...step, kind: 'navigation', value: url, expression: url }); }
    }
  }
  finish(source.length);
  for (const item of cases) if (item.diagnostics.length) item.capabilities.editTags = false;
  diagnostics.push(diag('BOUNDED_ROBOT_TABLES', 'Structured edits support simple space/tab-separated Robot test tables; advanced tables remain editable as exact source.'));
  return { cases, framework: 'robot', parser: 'robot-table-blocks', diagnostics };
}
async function discover(options) { return /\.robot$/i.test(options.path) ? robotDiscover(options) : astDiscover(options); }
function rename(language, title) {
  const keywords = language === 'python' ? 'class def if else elif for while try except finally with as import from async await return yield lambda pass break continue raise assert del global nonlocal in is not and or True False None' : 'class if else for while try catch finally as async await return yield break continue throw in is public private protected internal static void int string namespace using new this base switch case default null true false';
  if (language !== 'robot' && (!/^[A-Za-z_]\w*$/.test(title) || new Set(keywords.split(' ')).has(title))) fail('INVALID_TITLE', 'Python and C# test names must be nonreserved identifiers.');
  if (language === 'robot' && (!title.trim() || /[\r\n\t\0]| {2}|\||^\s|^#|^\*{3}|^\.\.\.(?:\s|$)/.test(title))) fail('INVALID_TITLE', 'Use a Robot test name without indentation, comments, section headers, continuations or table separators.');
  return title;
}
function bodyReplacement(source, c, text) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  if (c.framework === 'robot') { if (text.split(/\r?\n/).some(l => /^\s*(?:\*{3}|\||\.\.\.|(?:FOR|WHILE|IF|TRY|END|ELSE|EXCEPT|FINALLY)(?:\s|$))/.test(l))) fail('UNSUPPORTED_CONSTRUCT', 'Use the exact source editor for advanced Robot tables or control flow.'); return text.split(/\r?\n/).map(l => l ? '    ' + l.replace(/^ {4}/, '') : '').join(eol) + eol; }
  const indent = c._bodyIndent || indentAt(source, c.range.start) + '    ';
  return (text.trim() ? text : 'pass').split(/\r?\n/).map(l => l ? indent + l : '').join(eol);
}
function tags({ source, c, tags, language }) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n', clean = tags.map(t => t.replace(/^@/, ''));
  let target = c._tagRanges[0];
  if (language === 'robot') { target ||= r(c.bodyRange.start, c.bodyRange.start); return { edits: [{ range: target, text: clean.length ? '    [Tags]    ' + clean.join('    ') + eol : '' }, ...c._tagRanges.slice(1).map(range => ({ range, text: '' }))] }; }
  const indent = indentAt(source, c.range.start), position = language === 'python' ? c._declarationStart : c.range.start;
  target ||= r(startLine(source, position), startLine(source, position));
  if (language === 'python') for (const tag of clean) rename('python', tag);
  const text = language === 'python' ? clean.map(t => indent + '@pytest.mark.' + t).join(eol) : clean.map(t => indent + '[' + (c.framework === 'xunit' ? 'Trait("Category", ' : (c.framework === 'mstest' ? 'TestCategory' : 'Category') + '(') + JSON.stringify(t) + ')]').join(eol);
  if (language === 'python' && !/^import pytest\s*(?:#.*)?$/m.test(source)) fail('BINDING_REQUIRED', 'Add an explicit import pytest before using visual marks.');
  return { edits: [{ range: target, text: text ? text + eol : '' }, ...c._tagRanges.slice(1).map(range => ({ range, text: '' }))] };
}
function add({ source, parent, operation: op, discovery }) {
  const framework = op.framework || discovery.framework, eol = source.includes('\r\n') ? '\r\n' : '\n', language = discovery.language, title = rename(language, op.title || 'test_new_case');
  if (language === 'python') {
    if (!['pytest', 'python', 'unittest'].includes(framework) || framework === 'unittest' && parent && parent.framework !== 'unittest') fail('INVALID_FRAMEWORK', 'Choose the Python framework used by this file and suite.');
    if (!title.startsWith('test')) fail('INVALID_TITLE', 'Python test names must begin with test.');
    if (framework === 'unittest' && !parent) fail('SUITE_REQUIRED', 'Choose a unittest TestCase class for the new method.');
    const indent = parent ? parent._bodyIndent || '    ' : '', pos = parent ? parent.bodyRange.end : source.length, text = `${eol}${eol}${indent}def ${title}(${parent ? 'self' : ''}):${eol}${(op.bodySource || (framework === 'unittest' ? 'self.assertTrue(True)' : 'assert True')).split(/\r?\n/).map(l => indent + '    ' + l).join(eol)}${eol}`;
    return { range: r(pos, pos), text };
  }
  if (language === 'csharp') {
    if (!['nunit', 'xunit', 'mstest', 'csharp'].includes(framework) || parent && framework !== 'csharp' && parent.framework !== framework) fail('INVALID_FRAMEWORK', 'Choose the framework used by the C# test class.');
    if (!parent) fail('SUITE_REQUIRED', 'Choose a C# test class for the new method.');
    const indent = indentAt(source, parent.range.start) + '    ', attribute = framework === 'xunit' ? 'Fact' : framework === 'mstest' ? 'TestMethod' : 'Test';
    const text = `${eol}${indent}[${attribute}]${eol}${indent}public void ${title}()${eol}${indent}{${eol}${(op.bodySource || (framework === 'xunit' ? 'Assert.True(true);' : framework === 'mstest' ? 'Assert.IsTrue(true);' : 'Assert.That(true, Is.True);')).split(/\r?\n/).map(l => indent + '    ' + l).join(eol)}${eol}${indent}}${eol}`;
    return { range: r(parent.bodyRange.end, parent.bodyRange.end), text };
  }
  if (language === 'robot') {
    if (framework !== 'robot') fail('INVALID_FRAMEWORK', 'Choose Robot Framework for this table file.');
    let sectionEnd = null, offset = 0;
    for (const line of source.split(/(?<=\n)/)) { if (/^\s*\*{3}\s*(?:Test Cases|Tasks)\s*\*{3}[ \t]*\r?\n?$/i.test(line)) sectionEnd = offset + line.length; offset += line.length; }
    if (sectionEnd === null) fail('SUITE_REQUIRED', 'Add a Test Cases section first.');
    const last = discovery.cases.at(-1), pos = last ? last.range.end : sectionEnd;
    return { range: r(pos, pos), text: `${eol}${title}${eol}${bodyReplacement(source, { framework: 'robot' }, op.bodySource || 'Should Be Equal    1    1')}` };
  }
  fail('UNSUPPORTED_CONSTRUCT', 'Create this test in source.');
}
function scaffold({ path, framework, title, bodySource, tags = [] }) {
  if (['pytest', 'python', 'unittest'].includes(framework)) { if (!/\.py$/i.test(path)) fail('INVALID_FRAMEWORK', 'Use .py for Python tests.'); title = rename('python', title === 'New test' ? 'test_new_case' : title); if (!title.startsWith('test')) fail('INVALID_TITLE', 'Python test names must begin with test.'); for (const tag of tags) rename('python', tag.replace(/^@/, '')); if (framework === 'unittest') { if (tags.length) fail('UNSUPPORTED_CONSTRUCT', 'unittest has no built-in test tags.'); return `import unittest\n\nclass ImportedTests(unittest.TestCase):\n    def ${title}(self):\n${(bodySource || 'self.assertTrue(True)').split(/\r?\n/).map(l => '        ' + l).join('\n')}\n`; } return (tags.length ? 'import pytest\n\n' + tags.map(t => '@pytest.mark.' + t.replace(/^@/, '')).join('\n') + '\n' : '') + `def ${title}():\n${(bodySource || 'assert True').split(/\r?\n/).map(l => '    ' + l).join('\n')}\n`; }
  if (framework === 'robot') { if (!/\.robot$/i.test(path)) fail('INVALID_FRAMEWORK', 'Use .robot for Robot tests.'); rename('robot', title); return `*** Test Cases ***\n${title}\n${tags.length ? '    [Tags]    ' + tags.join('    ') + '\n' : ''}${bodyReplacement('', { framework: 'robot' }, bodySource || 'Should Be Equal    1    1')}`; }
  if (['nunit', 'xunit', 'mstest', 'csharp'].includes(framework)) {
    if (!/\.cs$/i.test(path)) fail('INVALID_FRAMEWORK', 'Use .cs for C# tests.');
    title = rename('csharp', title === 'New test' ? 'NewTest' : title);
    const lib = framework === 'xunit' ? 'Xunit' : framework === 'mstest' ? 'Microsoft.VisualStudio.TestTools.UnitTesting' : 'NUnit.Framework', attr = framework === 'xunit' ? 'Fact' : framework === 'mstest' ? 'TestMethod' : 'Test';
    const tagAttributes = tags.map(t => '    [' + (framework === 'xunit' ? 'Trait("Category", ' : (framework === 'mstest' ? 'TestCategory' : 'Category') + '(') + JSON.stringify(t.replace(/^@/, '')) + ')]\n').join('');
    return `using ${lib};\n\n${framework === 'mstest' ? '[TestClass]\n' : ''}public class ImportedTests\n{\n    [${attr}]\n${tagAttributes}    public void ${title}()\n    {\n${(bodySource || (framework === 'xunit' ? 'Assert.True(true);' : framework === 'mstest' ? 'Assert.IsTrue(true);' : 'Assert.That(true, Is.True);')).split(/\r?\n/).map(l => '        ' + l).join('\n')}\n    }\n}\n`;
  }
  fail('INVALID_FRAMEWORK', 'Choose a supported test framework.');
}
module.exports = { discover, rename, bodyReplacement, tags, add, scaffold };
