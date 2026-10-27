'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const load = () => import('../github-repo-editor.js');
const file = (path, content, originalContent = content, extra = {}) => ({ path, content, originalContent, sha: originalContent === null ? null : 'original-sha', mode: '100644', kind: 'test', ...extra });
test('publishing rebases only committed files and retains unstaged updates, additions and deletions', async () => {
  const { rebaseDrafts } = await load();
  const previous = { id: 'repo', example: true, files: [file('tests/published.ts', 'committed', 'old'), file('tests/draft.ts', 'draft', 'old'), file('tests/added.ts', 'new', null), file('tests/deleted.ts', 'old', 'old', { isDeleted: true })] };
  const snapshot = { ref: 'review', commit: 'newcommit', files: [file('tests/published.ts', 'committed', 'committed', { sha: 'newsha' }), file('tests/draft.ts', 'old'), file('tests/deleted.ts', 'old')] };
  const next = rebaseDrafts(previous, snapshot, [{ path: 'tests/published.ts', content: 'committed' }]);
  assert.equal(next.files.find(f => f.path === 'tests/published.ts').originalContent, 'committed');
  assert.equal(next.files.find(f => f.path === 'tests/draft.ts').content, 'draft');
  assert.equal(next.files.find(f => f.path === 'tests/added.ts').originalContent, null);
  assert.equal(next.files.find(f => f.path === 'tests/deleted.ts').isDeleted, true);
  assert.equal(next.example, true); assert.equal(next.id, 'repo'); assert.equal(previous.files[0].originalContent, 'old');
});
test('a recovered publication retains subsequent edits and flags independently changed remote baselines', async () => {
  const { rebaseDrafts } = await load();
  const previous = { files: [file('tests/a.ts', 'edited after interruption', 'old'), file('tests/b.ts', 'draft', 'old')] };
  const snapshot = { files: [file('tests/a.ts', 'published'), file('tests/b.ts', 'changed remotely')] };
  const result = rebaseDrafts(previous, snapshot, [{ path: 'tests/a.ts', content: 'published' }]);
  assert.equal(result.files[0].content, 'edited after interruption'); assert.equal(result.files[0].originalContent, 'published');
  assert.equal(result.files[1].content, 'draft'); assert.equal(result.files[1].originalContent, 'changed remotely'); assert.match(result.files[1].conflict, /remote baseline changed/);
});
