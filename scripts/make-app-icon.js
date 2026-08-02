// Generates the Workout app icon at 1024x1024, no dependencies.
// Aurora theme: deep-space gradient ground, violet + teal aurora blooms,
// glowing teal "H" mark. Writes an opaque RGB PNG (no alpha — iOS wants that).

const fs = require('fs');
const zlib = require('zlib');

// Usage: node scripts/make-app-icon.js <out.png> [size]
// Everything below is in normalised coords, so any size renders identically.
// The mark sits within radius 0.26 of centre, inside the 0.4 maskable safe
// zone the web manifest requires for icon-512.png.
const S = Number(process.argv[3]) || 1024;

// ── palette (from globals.css tokens) ─────────────────────────────
const BG_LO = [0x05, 0x06, 0x0f]; // --app-bg
const BG_HI = [0x0b, 0x0e, 0x26]; // --app-bg-hi
const TEAL = [0x2d, 0xd4, 0xbf]; // --app-primary
const VIOLET = [0x7c, 0x5c, 0xff]; // aurora bloom, richer than --acc-violet
const TEAL_GLOW = [0x5e, 0xea, 0xd4];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

/** Additive-ish screen blend so blooms read as light, not paint. */
function screen(dst, src, amt) {
  for (let i = 0; i < 3; i++) {
    const s = src[i] * amt;
    dst[i] = 255 - ((255 - dst[i]) * (255 - s)) / 255;
  }
}

/** Radial falloff in normalized coords. */
function bloom(nx, ny, cx, cy, r) {
  const d = Math.hypot(nx - cx, ny - cy) / r;
  return d >= 1 ? 0 : Math.pow(1 - d, 2.2);
}

// ── the H mark, as three rects in normalized coords ───────────────
const BAR = 0.086;
const X0 = 0.300;
const X1 = 0.700;
const Y0 = 0.330;
const Y1 = 0.670;
const rects = [
  [X0, Y0, X0 + BAR, Y1], // left post
  [X1 - BAR, Y0, X1, Y1], // right post
  [X0, 0.5 - BAR / 2, X1, 0.5 + BAR / 2], // crossbar
];

/** Distance from a point to the H (0 inside). */
function distToMark(nx, ny) {
  let best = Infinity;
  for (const [ax, ay, bx, by] of rects) {
    const dx = Math.max(ax - nx, 0, nx - bx);
    const dy = Math.max(ay - ny, 0, ny - by);
    const d = Math.hypot(dx, dy);
    if (d < best) best = d;
  }
  return best;
}

const px = Buffer.alloc(S * S * 3);
const AA = 1 / S; // one-pixel feather for edges

for (let y = 0; y < S; y++) {
  const ny = (y + 0.5) / S;
  for (let x = 0; x < S; x++) {
    const nx = (x + 0.5) / S;

    // ground: diagonal deep-space gradient
    const g = smooth(clamp01((nx + ny) / 2));
    const c = [lerp(BG_LO[0], BG_HI[0], g), lerp(BG_LO[1], BG_HI[1], g), lerp(BG_LO[2], BG_HI[2], g)];

    // aurora blooms
    screen(c, VIOLET, bloom(nx, ny, 0.16, 0.10, 0.92) * 0.34);
    screen(c, TEAL, bloom(nx, ny, 0.88, 0.92, 0.88) * 0.26);
    screen(c, VIOLET, bloom(nx, ny, 0.95, 0.05, 0.55) * 0.16);

    // mark glow, then the mark itself
    const d = distToMark(nx, ny);
    if (d > 0) screen(c, TEAL_GLOW, Math.exp(-d / 0.038) * 0.38);

    const cover = 1 - smooth(clamp01(d / AA));
    if (cover > 0) {
      for (let i = 0; i < 3; i++) c[i] = lerp(c[i], TEAL[i], cover);
    }

    const o = (y * S + x) * 3;
    px[o] = Math.round(clamp01(c[0] / 255) * 255);
    px[o + 1] = Math.round(clamp01(c[1] / 255) * 255);
    px[o + 2] = Math.round(clamp01(c[2] / 255) * 255);
  }
}

// ── PNG encode (color type 2, 8-bit, filter 0) ────────────────────
const raw = Buffer.alloc(S * (S * 3 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 3 + 1)] = 0;
  px.copy(raw, y * (S * 3 + 1) + 1, y * S * 3, (y + 1) * S * 3);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) >>> 0 : crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Fallback CRC32 for Node versions without zlib.crc32.
let table = null;
function crc32(buf) {
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;
ihdr[9] = 2;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.writeFileSync(process.argv[2], png);
console.log('wrote', process.argv[2], png.length, 'bytes');
