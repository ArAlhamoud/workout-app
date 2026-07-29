/**
 * gen-icons.js — dependency-free PNG icon generator.
 *
 * Renders the app icon (teal dumbbell on the app background) onto a raw RGBA
 * buffer and encodes it as a valid PNG by hand: signature + IHDR + IDAT
 * (zlib.deflateSync over filter-0 scanlines) + IEND, with a manual CRC32 table.
 *
 * Emits:
 *   public/icon-192.png        (192×192)
 *   public/icon-512.png        (512×512, maskable-safe: glyph inside inner 66%)
 *   public/apple-touch-icon.png (180×180)
 *
 * Usage: node scripts/gen-icons.js
 */

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ── Colors (design tokens) ─────────────────────────────────────
const BG = [0x0a, 0x0f, 0x1e, 0xff]; // --app-bg
const TEAL = [0x2d, 0xd4, 0xbf, 0xff]; // primary accent

// ── CRC32 (manual table, per PNG spec) ─────────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ── PNG encoding ───────────────────────────────────────────────
function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: truecolor with alpha
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Filter-0 (None) scanlines: 1 filter byte + row of RGBA pixels.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Rendering ──────────────────────────────────────────────────
function fillRect(rgba, size, x0, y0, w, h, color) {
  const x1 = Math.min(size, x0 + w);
  const y1 = Math.min(size, y0 + h);
  for (let y = Math.max(0, y0); y < y1; y++) {
    for (let x = Math.max(0, x0); x < x1; x++) {
      const i = (y * size + x) * 4;
      rgba[i] = color[0];
      rgba[i + 1] = color[1];
      rgba[i + 2] = color[2];
      rgba[i + 3] = color[3];
    }
  }
}

/**
 * Full-bleed background + dumbbell glyph: two thick vertical bars (plates)
 * joined by a horizontal bar (handle), centered, ~55% of canvas width —
 * safely inside the inner 66% maskable zone.
 */
function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  fillRect(rgba, size, 0, 0, size, size, BG);

  const glyphW = Math.round(size * 0.55);
  const plateW = Math.round(glyphW * 0.2);
  const plateH = Math.round(glyphW * 0.72);
  const handleH = Math.round(glyphW * 0.22);

  const x0 = Math.round((size - glyphW) / 2);
  const cy = Math.round(size / 2);

  // Left and right plates
  fillRect(rgba, size, x0, cy - Math.round(plateH / 2), plateW, plateH, TEAL);
  fillRect(rgba, size, x0 + glyphW - plateW, cy - Math.round(plateH / 2), plateW, plateH, TEAL);
  // Handle connecting the plates
  fillRect(rgba, size, x0 + plateW, cy - Math.round(handleH / 2), glyphW - 2 * plateW, handleH, TEAL);

  return rgba;
}

// ── Emit + verify ──────────────────────────────────────────────
function verifyPng(file, expectedSize) {
  const buf = fs.readFileSync(file);
  const sigOk = buf
    .subarray(0, 8)
    .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const iendOk = buf.subarray(buf.length - 8, buf.length - 4).toString('ascii') === 'IEND';
  if (!sigOk || width !== expectedSize || height !== expectedSize || !iendOk || buf.length === 0) {
    throw new Error(`Invalid PNG: ${file} (sig=${sigOk} ${width}x${height} iend=${iendOk})`);
  }
  console.log(`ok  ${file}  ${width}x${height}  ${buf.length} bytes`);
}

const outDir = path.join(__dirname, '..', 'public');
const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
];

for (const { file, size } of targets) {
  const out = path.join(outDir, file);
  fs.writeFileSync(out, encodePng(size, renderIcon(size)));
  verifyPng(out, size);
}
