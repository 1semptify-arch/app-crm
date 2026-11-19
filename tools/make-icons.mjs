// Generates the PWA icons (PNG) in public/icons — no dependencies, just
// zlib + a tiny hand-rolled PNG encoder. Run: npm run icons
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const INDIGO = [79, 70, 229]; // indigo-600
const INDIGO_DARK = [55, 48, 163]; // indigo-800
const WHITE = [255, 255, 255];
const PALE = [199, 210, 254]; // indigo-200

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = ~0;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}
function chunk(type, data) {
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length, 0);
  b.write(type, 4, 'ascii');
  data.copy(b, 8);
  b.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return b;
}
function encodePng(size, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function draw(size, { maskable = false } = {}) {
  const px = new Uint8Array(size * size * 4);
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const alpha = a / 255;
    px[i] = Math.round(r * alpha + px[i] * (1 - alpha));
    px[i + 1] = Math.round(g * alpha + px[i + 1] * (1 - alpha));
    px[i + 2] = Math.round(b * alpha + px[i + 2] * (1 - alpha));
    px[i + 3] = Math.max(px[i + 3], a);
  };
  const rect = (x0, y0, w, h, color) => {
    for (let y = Math.floor(y0); y < y0 + h; y++)
      for (let x = Math.floor(x0); x < x0 + w; x++) set(x, y, color);
  };
  const rrect = (x0, y0, w, h, rad, color) => {
    for (let y = Math.floor(y0); y < y0 + h; y++) {
      for (let x = Math.floor(x0); x < x0 + w; x++) {
        const dx = Math.max(x0 + rad - x, 0, x - (x0 + w - rad - 1));
        const dy = Math.max(y0 + rad - y, 0, y - (y0 + h - rad - 1));
        if (dx * dx + dy * dy <= rad * rad) set(x, y, color);
      }
    }
  };
  const circle = (cx, cy, rad, color) => {
    for (let y = Math.floor(cy - rad); y <= cy + rad; y++)
      for (let x = Math.floor(cx - rad); x <= cx + rad; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) set(x, y, color);
  };

  if (maskable) {
    rect(0, 0, size, size, INDIGO);
  } else {
    rrect(0, 0, size, size, size * 0.22, INDIGO);
  }

  const m = size * (maskable ? 0.3 : 0.18);
  const gw = size - m * 2;
  const gy = size * (maskable ? 0.32 : 0.24);
  const gh = size - m * 2;
  const rad = gw * 0.1;

  rrect(gx(m), gy, gw, gh, rad, WHITE);
  rrect(gx(m), gy, gw, gh * 0.26, rad, INDIGO_DARK);
  rect(gx(m), gy + gh * 0.13, gw, gh * 0.13, INDIGO_DARK);

  const ringW = gw * 0.09;
  const ringH = gh * 0.14;
  rect(gx(m) + gw * 0.24 - ringW / 2, gy - ringH * 0.45, ringW, ringH, INDIGO_DARK);
  rect(gx(m) + gw * 0.76 - ringW / 2, gy - ringH * 0.45, ringW, ringH, INDIGO_DARK);

  const cell = gw * 0.14;
  const gapX = gw * 0.09;
  const gapY = gh * 0.1;
  const startX = gx(m) + gw * 0.14;
  const startY = gy + gh * 0.42;
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const color = r === 0 && c === 1 ? INDIGO : PALE;
      rect(startX + c * (cell + gapX), startY + r * (cell + gapY), cell, cell, color);
    }
  }
  return px;

  function gx(v) {
    return v;
  }
}

for (const [file, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
]) {
  writeFileSync(join(outDir, file), encodePng(size, draw(size, { maskable })));
  console.log(`wrote ${file}`);
}

writeFileSync(
  join(outDir, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#4f46e5"/>
  <rect x="92" y="122" width="328" height="328" rx="34" fill="#fff"/>
  <rect x="92" y="122" width="328" height="86" rx="34" fill="#3730a3"/>
  <rect x="92" y="164" width="328" height="44" fill="#3730a3"/>
  <rect x="156" y="92" width="30" height="62" fill="#3730a3"/>
  <rect x="326" y="92" width="30" height="62" fill="#3730a3"/>
  <rect x="138" y="258" width="46" height="46" fill="#c7d2fe"/>
  <rect x="233" y="258" width="46" height="46" fill="#4f46e5"/>
  <rect x="328" y="258" width="46" height="46" fill="#c7d2fe"/>
  <rect x="138" y="346" width="46" height="46" fill="#c7d2fe"/>
  <rect x="233" y="346" width="46" height="46" fill="#c7d2fe"/>
  <rect x="328" y="346" width="46" height="46" fill="#c7d2fe"/>
</svg>
`,
);
console.log('wrote icon.svg');
