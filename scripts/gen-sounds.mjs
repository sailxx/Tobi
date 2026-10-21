// Tobi's sounds, synthesised here: no samples, no dependencies. Writes the 29
// WAVs the island plays (src/core/sound.ts, SOUND_NAMES) into sounds/.
//
//   node scripts/gen-sounds.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "sounds");
const RATE = 44100;

// ── Building blocks ───────────────────────────────────────────────────────────

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI note → Hz
const WAVES = {
  sine: (p) => Math.sin(2 * Math.PI * p),
  tri: (p) => 1 - 4 * Math.abs(Math.round(p - 0.25) - (p - 0.25)),
  // A soft square: a few odd harmonics only, so it never buzzes.
  soft: (p) => Math.sin(2 * Math.PI * p) + Math.sin(6 * Math.PI * p) / 6 + Math.sin(10 * Math.PI * p) / 14,
};

/**
 * One voice. `freq` is Hz or a function of t∈[0,1] → Hz. The envelope is a
 * quick attack and an exponential release; `vib` adds a vibrato [depth Hz, rate Hz].
 */
function tone({ freq, dur, wave = "sine", gain = 1, attack = 0.006, decay = 4, vib = null, at = 0 }) {
  const n = Math.round(dur * RATE);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const s = i / RATE;
    let f = typeof freq === "function" ? freq(t) : freq;
    if (vib) f += vib[0] * Math.sin(2 * Math.PI * vib[1] * s);
    phase += f / RATE;
    const env = Math.min(1, s / attack) * Math.exp(-decay * t) * Math.min(1, (n - i) / (RATE * 0.004));
    out[i] = WAVES[wave](phase % 1) * env * gain;
  }
  return { at, data: out };
}

/** Filtered noise (one-pole low-pass), for slaps, whooshes and clicks. */
function noise({ dur, gain = 1, cutoff = 0.2, decay = 8, at = 0, sweep = null }) {
  const n = Math.round(dur * RATE);
  const out = new Float32Array(n);
  let y = 0;
  let seed = 1234567;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const white = (seed / 0x7fffffff) * 2 - 1;
    const k = sweep ? sweep(t) : cutoff;
    y += k * (white - y);
    const env = Math.min(1, i / (RATE * 0.002)) * Math.exp(-decay * t);
    out[i] = y * env * gain;
  }
  return { at, data: out };
}

/** Mixes voices placed at their `at` (seconds) and normalises to `peak`. */
function mix(voices, peak = 0.85) {
  const len = Math.max(...voices.map((v) => Math.round(v.at * RATE) + v.data.length));
  const out = new Float32Array(len);
  for (const v of voices) {
    const o = Math.round(v.at * RATE);
    for (let i = 0; i < v.data.length; i++) out[o + i] += v.data[i];
  }
  let max = 0;
  for (const s of out) max = Math.max(max, Math.abs(s));
  if (max > 0) for (let i = 0; i < len; i++) out[i] *= peak / max;
  return out;
}

/** Notes one after another: [[midi, seconds], …] with a soft voice. */
function melody(notes, { wave = "tri", gap = 0, decay = 3, gain = 1, start = 0, vib = null } = {}) {
  const voices = [];
  let at = start;
  for (const [midi, dur] of notes) {
    if (midi !== null) voices.push(tone({ freq: NOTE(midi), dur: dur * 1.6, wave, decay, gain, at, vib }));
    at += dur + gap;
  }
  return voices;
}

const glide = (a, b, curve = 1) => (t) => a + (b - a) * Math.pow(t, curve);

// ── The sounds ────────────────────────────────────────────────────────────────

const SOUNDS = {
  peek: () => mix([tone({ freq: glide(620, 980, 0.6), dur: 0.11, wave: "tri", decay: 3 })], 0.6),
  open: () => mix(melody([[79, 0.06], [86, 0.09]], { decay: 4 }), 0.65),
  close: () => mix(melody([[86, 0.06], [79, 0.09]], { decay: 4 }), 0.6),
  hover: () => mix([tone({ freq: 2200, dur: 0.03, decay: 6 })], 0.35),
  blip: () => mix([tone({ freq: 1250, dur: 0.06, wave: "tri", decay: 5 })], 0.55),
  slap: () => mix([
    noise({ dur: 0.12, cutoff: 0.55, decay: 14, gain: 1 }),
    tone({ freq: glide(220, 90), dur: 0.14, decay: 6, gain: 0.9 }),
  ]),
  annoyed: () => mix([tone({ freq: glide(420, 240, 1.4), dur: 0.36, wave: "soft", decay: 2.5, vib: [18, 22] })], 0.7),
  dizzy: () => mix([tone({ freq: (t) => 700 + 260 * Math.sin(t * Math.PI * 7) - 200 * t, dur: 0.9, wave: "tri", decay: 1.8 })], 0.7),
  greet: () => mix(melody([[76, 0.08], [81, 0.08], [88, 0.16]], { decay: 3 }), 0.75),
  work: () => mix([
    noise({ dur: 0.03, cutoff: 0.6, decay: 20, gain: 0.6 }),
    tone({ freq: 1500, dur: 0.04, decay: 8, gain: 0.5 }),
    noise({ dur: 0.03, cutoff: 0.6, decay: 20, gain: 0.5, at: 0.09 }),
    tone({ freq: 1800, dur: 0.04, decay: 8, gain: 0.45, at: 0.09 }),
  ], 0.5),
  finish: () => mix([
    ...melody([[72, 0.07], [76, 0.07], [79, 0.07], [84, 0.22]], { decay: 2.5 }),
    tone({ freq: NOTE(96), dur: 0.3, decay: 5, gain: 0.25, at: 0.24 }),
  ]),
  error: () => mix(melody([[64, 0.13], [58, 0.26]], { wave: "soft", decay: 2.5 }), 0.7),
  approval: () => mix([
    tone({ freq: NOTE(88), dur: 0.35, decay: 5, gain: 0.9 }),
    tone({ freq: NOTE(88) * 2.01, dur: 0.25, decay: 7, gain: 0.25 }),
    tone({ freq: NOTE(88), dur: 0.45, decay: 4, gain: 0.9, at: 0.16 }),
    tone({ freq: NOTE(88) * 2.01, dur: 0.3, decay: 6, gain: 0.25, at: 0.16 }),
  ]),
  question: () => mix([tone({ freq: glide(480, 860, 2.2), dur: 0.32, wave: "tri", decay: 2 })], 0.7),
  approve: () => mix([
    ...melody([[79, 0.06], [84, 0.18]], { decay: 3 }),
    tone({ freq: NOTE(88), dur: 0.3, decay: 3, gain: 0.5, at: 0.06 }),
  ]),
  gulp: () => mix([
    tone({ freq: glide(320, 110, 0.7), dur: 0.2, wave: "sine", decay: 3 }),
    tone({ freq: glide(500, 900), dur: 0.05, decay: 4, gain: 0.5, at: 0.21 }),
  ]),
  tick: () => mix([tone({ freq: 3000, dur: 0.015, decay: 6 })], 0.4),
  send: () => mix([
    noise({ dur: 0.32, decay: 3, gain: 0.6, sweep: (t) => 0.03 + 0.4 * t }),
    tone({ freq: glide(500, 1500, 0.8), dur: 0.28, wave: "tri", decay: 3, gain: 0.6 }),
  ], 0.65),
  love: () => mix(melody([[84, 0.14], [88, 0.3]], { wave: "sine", decay: 2, vib: [6, 7] }), 0.7),
  pop: () => mix([tone({ freq: glide(950, 280, 0.5), dur: 0.05, decay: 4 })], 0.65),
  proud: () => mix(melody([[72, 0.09], [79, 0.09], [84, 0.09], [88, 0.3]], { wave: "soft", decay: 2.2 })),
  wink: () => mix([
    tone({ freq: glide(900, 1300), dur: 0.06, wave: "tri", decay: 4 }),
    tone({ freq: 1700, dur: 0.08, decay: 6, gain: 0.6, at: 0.07 }),
  ], 0.6),
  yawn: () => mix([tone({ freq: glide(540, 230, 0.8), dur: 0.8, wave: "soft", decay: 1.6, vib: [10, 5], attack: 0.08 })], 0.6),
  attach: () => mix([
    noise({ dur: 0.03, cutoff: 0.7, decay: 18, gain: 0.7 }),
    ...melody([[74, 0.07], [81, 0.14]], { decay: 3, start: 0.04 }),
  ], 0.7),
  think: () => mix([tone({ freq: 230, dur: 0.45, wave: "soft", decay: 1.5, vib: [8, 6], attack: 0.05 })], 0.55),
  search: () => mix([
    tone({ freq: 1400, dur: 0.5, decay: 6 }),
    tone({ freq: 1400, dur: 0.4, decay: 8, gain: 0.3, at: 0.18 }),
  ], 0.6),
  rate: () => mix(melody([[76, 0.12], [72, 0.12], [67, 0.28]], { wave: "soft", decay: 2.2 }), 0.7),
  sleep: () => mix(melody([[67, 0.25], [60, 0.45]], { wave: "sine", decay: 1.6, vib: [3, 4] }), 0.5),
  greeting: () => mix([
    ...melody([[72, 0.12], [76, 0.12], [79, 0.12], [84, 0.24], [null, 0.08], [81, 0.12], [84, 0.42]], { decay: 2.4 }),
    ...melody([[48, 0.48], [53, 0.4], [55, 0.62]], { wave: "sine", decay: 1.5, gain: 0.35 }),
    tone({ freq: NOTE(96), dur: 0.5, decay: 4, gain: 0.2, at: 1.1 }),
  ]),
};

// ── WAV ───────────────────────────────────────────────────────────────────────

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, make] of Object.entries(SOUNDS)) {
  const file = wav(make());
  writeFileSync(join(OUT, `${name}.wav`), file);
  console.log(`${name}.wav — ${file.length} bytes`);
}
