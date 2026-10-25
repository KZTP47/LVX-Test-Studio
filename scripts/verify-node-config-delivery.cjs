'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { root, hash, sourceManifest } = require('./source-manifest.cjs');
const read = name => JSON.parse(fs.readFileSync(path.join(root, 'docs/verification', name), 'utf8'));
try {
  const source = sourceManifest(), packageProof = require('./package-manifest.cjs').verifyPackage();
  const reports = [];
  for (const packaged of [false, true]) {
    const file = 'node-config-style-' + (packaged ? 'packaged' : 'source') + '-results.json', report = read(file);
    assert.equal(report.status, 'SUCCESS'); assert.equal(report.sourceDigest, source.digest); assert.equal(report.packaged, packaged);
    assert.equal(report.testScriptSha256, hash(fs.readFileSync(path.join(root, 'scripts/node-config-style-e2e.cjs'))));
    assert.deepEqual(report.errors, []); assert.equal(report.observations.length, 28); assert.equal(new Set(report.observations.map(o => o.type)).size, 14);
    assert.ok(report.observations.every(o => o.background === o.expected && o.extras && o.headingSvg && o.withinViewport && o.focusInside && o.footerLast));
    assert.ok(report.checks.length >= 100); if (packaged) assert.deepEqual(report.packageProof, packageProof);
    for (const shot of report.screenshots) assert.equal(hash(fs.readFileSync(path.join(root, shot.file))), shot.sha256);
    reports.push({ file: 'docs/verification/' + file, sha256: hash(fs.readFileSync(path.join(root, 'docs/verification', file))), checks: report.checks.length });
  }
  const regression = read('regression-results.json'); assert.equal(regression.sourceDigest, source.digest);
  assert.equal(regression.tests, regression.pass); assert.equal(regression.fail, 0); assert.equal(regression.skipped, 0);
  for (const entry of regression.files) assert.equal(hash(fs.readFileSync(path.join(root, entry.file))), entry.sha256);
  const original = JSON.parse(fs.readFileSync(path.join(root, 'apps/lvx-machina/IMPORT-MANIFEST.json'), 'utf8'));
  for (const entry of original.files) assert.equal(hash(fs.readFileSync(path.join(root, 'apps/lvx-machina', entry.file))), entry.sha256);
  const result = { status: 'VERIFIED', recordedAt: new Date().toISOString(), version: require('../package.json').version, sourceDigest: source.digest, packageProof,
    executable: 'release/win-unpacked/LVX Test Studio.exe', reports, regression: { tests: regression.tests, pass: regression.pass, fail: regression.fail, skipped: regression.skipped },
    originalMachinaFilesVerified: original.files.length, limits: ['Unpacked Windows evaluation build; the earlier0.4.0 installer and AI review remain historical for their own source digest.', 'No live model, account login or deployment quality test was performed in this appearance-only follow-up.'] };
  fs.writeFileSync(path.join(root, 'docs/verification/node-config-delivery-results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('NODE_CONFIG_DELIVERY_VERIFIED');
} catch (error) { console.error(error); process.exitCode = 1; }
