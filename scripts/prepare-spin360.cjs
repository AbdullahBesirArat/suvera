// npm run prepare:spin360 -- <extracted assets directory> <output directory>
// Reuses the Sharp installation owned by the canonical Panelya media workspace.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('../panelya/node_modules/sharp');
async function main() {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) throw new Error('Source assets and output directories required');
  if (path.resolve(source) === path.resolve(destination)) throw new Error('Keep original source separate');
  const frames = [];
  const checksums = new Set();
  let originalBytes = 0, optimizedBytes = 0;
  fs.mkdirSync(destination, { recursive: true });
  for (let angle = 0; angle < 360; angle += 30) {
    const stem = `frame-${String(angle).padStart(3, '0')}`;
    const input = fs.readFileSync(path.join(source, `${stem}.png`));
    const sourceHash = crypto.createHash('sha256').update(input).digest('hex');
    if (checksums.has(sourceHash)) throw new Error(`Duplicate source frame: ${stem}`);
    checksums.add(sourceHash);
    const metadata = await sharp(input).metadata();
    if (metadata.width !== 1087 || ![1446, 1447].includes(metadata.height)) throw new Error(`Unexpected dimensions: ${stem}`);
    const output = await sharp(input).resize(1087, 1447, { fit: 'contain', background: '#f5f1ed' })
      .toColourspace('srgb').webp({ quality: 88, effort: 6 }).toBuffer();
    const digest = crypto.createHash('sha256').update(output).digest('hex').slice(0, 12);
    const filename = `${stem}-${digest}.webp`;
    fs.writeFileSync(path.join(destination, filename), output);
    frames.push(filename);
    originalBytes += input.length;
    optimizedBytes += output.length;
  }
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify({ frameCount: 12, poster: frames[0], frames }, null, 2));
  console.log(JSON.stringify({ originalBytes, optimizedBytes, reductionPercent: 100 * (1 - optimizedBytes / originalBytes) }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
