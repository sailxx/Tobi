// Draws Tobi into the PNG/ICO set Tauri needs. No dependencies: the icons are
// rasterised here and encoded with node:zlib, so the app icon stays "drawn in
// code" like the character itself.
//
//   node scripts/gen-icons.mjs

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");

// ── Tobi ──────────────────────────────────────────────────────────────────────
// Same look as src/tobi/look.ts: a honey bean, a dark visor, glowing eyes and an
// antenna with an orange light.

const BODY_TOP = [255, 231, 163]; // #FFE7A3
const BODY_BOTTOM = [242, 184, 75]; // #F2B84B
const VISOR_TOP = [38, 42, 54]; // #262A36
const VISOR_BOTTOM = [14, 16, 22]; // #0E1016
const EYE = [236, 248, 255]; // #ECF8FF
const EYE_HALO = [140, 217, 255];
const STALK = [201, 138, 40]; // #C98A28
const LIGHT = [255, 122, 61]; // #FF7A3D
const RIM = [0, 0, 0];

const SS = 4; // supersampling factor
const EXP = 2.2;

function insideBody(x, y, rx, ry) {
  return Math.pow(Math.abs(x / rx), EXP) + Math.pow(Math.abs(y / ry), EXP) <= 1;
}

function insidePill(x, y, w, h) {
  const hw = w / 2;
  const hh = h / 2;
  const r = Math.min(hw, hh);
  const cx = Math.max(-hw + r, Math.min(hw - r, x));
  const cy = Math.max(-hh + r, Math.min(hh - r, y));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function renderTobi(size) {
  const px = new Uint8Array(size * size * 4);
  const R = size * 0.31;
  const rx = R * 1.0;
  const ry = R * 0.96;
  const cx = size / 2;
  const cy = size / 2 + R * 0.2;
  const rim = Math.max(0.6, R * 0.055); // dark outline so the tray icon reads on light themes

  const eyeX = Math.sin(0.37) * Math.cos(0.12) * rx;
  const eyeY = Math.sin(0.12) * ry;
  const ew = R * 0.25 * Math.cos(0.37);
  const eh = R * 0.27 * Math.cos(0.12);
  const vw = 2 * Math.sin(0.37) * rx + R * 0.72;
  const vh = R * 0.58 * Math.cos(0.12);

  const stalkW = Math.max(1, R * 0.09);
  const baseY = -ry * 0.8;
  const tipY = -ry - R * 0.42;
  const tipR = Math.max(1.2, R * 0.14);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const X = x + (sx + 0.5) / SS - cx;
          const Y = y + (sy + 0.5) / SS - cy;
          let col = null;
          let al = 1;
          const dTip = Math.hypot(X, Y - tipY);
          if (dTip < tipR * 2.4) { col = LIGHT; al = 0.45 * (1 - dTip / (tipR * 2.4)) ** 2; }
          if (Math.abs(X) <= stalkW / 2 && Y <= baseY + R * 0.2 && Y >= tipY) { col = STALK; al = 1; }
          if (dTip <= tipR) {
            col = Math.hypot(X - tipR * 0.3, Y - tipY + tipR * 0.3) < tipR * 0.3 ? mix(LIGHT, [255, 255, 255], 0.6) : LIGHT;
            al = 1;
          }
          if (insideBody(X, Y, rx + rim, ry + rim)) { col = RIM; al = 1; }
          if (insideBody(X, Y, rx, ry)) {
            const t = Math.min(1, Math.max(0, (X * -0.6 + Y * 0.8) / (2 * ry) + 0.5));
            col = mix(BODY_TOP, BODY_BOTTOM, t);
            const vy = Y - eyeY;
            if (insidePill(X, vy, vw, vh)) {
              col = mix(VISOR_TOP, VISOR_BOTTOM, Math.min(1, Math.max(0, vy / vh + 0.5)));
              for (const sd of [-1, 1]) {
                const d = Math.hypot((X - sd * eyeX) / ew, vy / eh);
                if (d < 1.3) col = mix(col, EYE_HALO, 0.35 * (1 - d / 1.3));
                if (insidePill(X - sd * eyeX, vy, ew, eh)) col = EYE;
              }
            }
          }
          if (!col) continue;
          r += col[0] * al; g += col[1] * al; b += col[2] * al; a += al;
        }
      }
      if (a === 0) continue;
      const o = (y * size + x) * 4;
      px[o] = Math.round(r / a);
      px[o + 1] = Math.round(g / a);
      px[o + 2] = Math.round(b / a);
      px[o + 3] = Math.round(Math.min(1, a / (SS * SS)) * 255);
    }
  }
  return px;
}

// ── PNG ───────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── ICO (PNG-in-ICO, Vista and later) ─────────────────────────────────────────

function encodeICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.size >= 256 ? 0 : e.size;
    dir[o + 1] = e.size >= 256 ? 0 : e.size;
    dir[o + 2] = 0;
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(e.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

// ── Go ────────────────────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true });

const png = (size) => encodePNG(size, renderTobi(size));

const files = {
  "32x32.png": png(32),
  "128x128.png": png(128),
  "128x128@2x.png": png(256),
  "icon.png": png(512),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(OUT, name), data);
  console.log(`${name} — ${data.length} bytes`);
}

const ico = encodeICO([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: png(size) })));
writeFileSync(join(OUT, "icon.ico"), ico);
console.log(`icon.ico — ${ico.length} bytes`);
