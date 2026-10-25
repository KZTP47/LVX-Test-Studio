'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const {sizes, iconDirectory} = require('./mascot-assets.cjs');
const originalSha256 = '2ee9ff581febd0ebe5c56a0be8234ad0ba8b2024e40500348bf36f6200466508';
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

async function verify(directory = iconDirectory) {
  const master = fs.readFileSync(path.join(directory, 'lvx-test-studio.png'));
  assert.equal(sha256(master), originalSha256, 'The supplied mascot master must remain byte-for-byte unchanged.');
  const metadata = await sharp(master).metadata();
  assert.equal(metadata.width, 1254);
  assert.equal(metadata.height, 1254);
  assert.equal(metadata.hasAlpha, true);
  const ico = fs.readFileSync(path.join(directory, 'lvx-test-studio.ico'));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), sizes.length);
  let expectedOffset = 6 + sizes.length * 16;
  const hashes = {};
  for (const [index, size] of sizes.entries()) {
    const png = fs.readFileSync(path.join(directory, `lvx-${size}.png`));
    const expectedPng = await sharp(master).resize(size, size).png().toBuffer();
    // Compare decoded pixels as well as sizes: an unrelated image cannot pass.
    const actual = await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject: true});
    const expected = await sharp(expectedPng).ensureAlpha().raw().toBuffer();
    assert.equal(actual.info.width, size);
    assert.equal(actual.info.height, size);
    assert.deepEqual(actual.data, expected, `${size}px artwork differs from the supplied mascot.`);
    const alpha = (await sharp(png).stats()).channels[3];
    assert.equal(alpha.min, 0, `${size}px icon lost transparent background.`);
    assert.ok(alpha.max > 240, `${size}px icon lost opaque artwork.`);
    const entry = 6 + index * 16;
    assert.equal(ico[entry] || 256, size);
    assert.equal(ico[entry + 1] || 256, size);
    assert.equal(ico.readUInt16LE(entry + 4), 1);
    assert.equal(ico.readUInt16LE(entry + 6), 32);
    assert.equal(ico.readUInt32LE(entry + 8), png.length);
    assert.equal(ico.readUInt32LE(entry + 12), expectedOffset);
    assert.deepEqual(ico.subarray(expectedOffset, expectedOffset + png.length), png, `${size}px ICO entry does not contain the actual PNG.`);
    expectedOffset += png.length;
    hashes[size] = sha256(png);
  }
  assert.equal(ico.length, expectedOffset, 'Unexpected ICO trailing bytes or truncation.');
  return {masterSha256: originalSha256, width: 1254, height: 1254, sizes, pngSha256: hashes, icoSha256: sha256(ico)};
}

async function main() {
  const result = await verify();
  // Negative controls use a private temporary directory, never the real assets.
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-mascot-check-'));
  try {
    fs.cpSync(iconDirectory, temporary, {recursive: true});
    const icoPath = path.join(temporary, 'lvx-test-studio.ico');
    const validIco = fs.readFileSync(icoPath);
    const wrongEntry = Buffer.from(validIco);
    wrongEntry.writeUInt32LE(0, 6 + 12);
    fs.writeFileSync(icoPath, wrongEntry);
    await assert.rejects(() => verify(temporary), 'A corrupt ICO directory must fail.');
    fs.writeFileSync(icoPath, validIco);
    fs.writeFileSync(path.join(temporary, 'lvx-32.png'), await sharp({create: {width: 32, height: 32, channels: 4, background: '#00000000'}}).png().toBuffer());
    await assert.rejects(() => verify(temporary), 'An unrelated transparent PNG must fail.');
  } finally {
    const resolved = path.resolve(temporary);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('lvx-mascot-check-'));
    fs.rmSync(resolved, {recursive: true, force: true});
  }
  console.log(JSON.stringify({...result, negativeControls: ['corrupt ICO offset rejected', 'wrong artwork rejected']}, null, 2));
  console.log('LVX_MASCOT_VERIFIED');
}

module.exports = {verify, originalSha256};
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
