'use strict';

// Preserve the supplied artwork; only make the sizes required by Windows.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const sizes = [16, 24, 32, 48, 64, 128, 256];
const iconDirectory = path.resolve(__dirname, '../assets/icons');

async function build(source = path.join(iconDirectory, 'lvx-test-studio.png')) {
  const original = fs.readFileSync(source);
  const metadata = await sharp(original).metadata();
  if (metadata.format !== 'png' || !metadata.hasAlpha || metadata.width !== metadata.height) {
    throw new Error('The mascot must be a square PNG with an alpha channel.');
  }
  fs.mkdirSync(iconDirectory, {recursive: true});
  fs.writeFileSync(path.join(iconDirectory, 'lvx-test-studio.png'), original);
  const frames = [];
  for (const size of sizes) {
    const png = await sharp(original).resize(size, size).png().toBuffer();
    fs.writeFileSync(path.join(iconDirectory, `lvx-${size}.png`), png);
    frames.push({size, png});
  }
  const header = Buffer.alloc(6 + 16 * frames.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach(({size, png}, index) => {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  fs.writeFileSync(path.join(iconDirectory, 'lvx-test-studio.ico'), Buffer.concat([header, ...frames.map(frame => frame.png)]));
  console.log('LVX_MASCOT_ASSETS_BUILT');
}

module.exports = {build, sizes, iconDirectory};
if (require.main === module) build(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1; });
