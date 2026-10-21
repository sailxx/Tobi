// Генерирует SVG-плашки README в стиле Okto Calc: чёрный фон, свечения и медовый акцент Tobi.
// Шрифты Golos Text и JetBrains Mono встраиваются урезанными под каждый язык (тексты — strings.json).
// Запуск: cd tools/readme && npm install && node build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKit, ICONS } from './kit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const OUT = path.join(REPO, 'assets/readme');
const VERSION = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
const STR = JSON.parse(fs.readFileSync(path.join(HERE, 'strings.json'), 'utf8'));

// Те же цвета, что в src/tobi/look.ts
const HONEY = '#F5B83D', HONEY_HI = '#FFE7A3', HONEY_LO = '#F2B84B', LIGHT = '#FF7A3D', STALK = '#C98A28';
const K = createKit({
  golos: path.join(HERE, '.font/golos.ttf'),
  mono: path.join(HERE, '.font/jbmono.ttf'),
  accent: { hi: HONEY, grad: [HONEY_HI, '#F2A33A'], on: '#2A1A00', glow: HONEY_LO, glow2: LIGHT, glowOpacity: 0.22, btn: ['#FFD27A', '#F2A93B'] },
});
const { P, T, card, chip, sectionHead, badge, lines, wrap, one, fitSize, fitText, delay, svg } = K;

// ---------- Tobi: тот же рисунок, что в движке (тело-суперэллипс, визор, глаза, антенна) ----------
const STATE = { idle: null, thinking: '#8B5CF6', working: '#3B9EFF', approval: '#F5A524', finished: '#34D399', sleeping: '#94A2B8' };
const TOBI_DEFS = `<linearGradient id="tb" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${HONEY_HI}"/><stop offset="1" stop-color="${HONEY_LO}"/></linearGradient>
<linearGradient id="tv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#262A36"/><stop offset="1" stop-color="#0E1016"/></linearGradient>
<radialGradient id="tsh" cx=".5" cy=".5" r=".5"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".2"/></radialGradient>
<radialGradient id="thl" cx=".67" cy=".27" r=".25"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
${Object.entries(STATE).filter(([, c]) => c).map(([k, c]) => `<linearGradient id="tt-${k}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${c}" stop-opacity=".62"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient>`).join('\n')}
<filter id="glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="glowL" x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;

function bodyPath(R) {
  const rx = R, ry = R * 0.96, e = 2 / 2.2;
  let d = '';
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const x = rx * Math.sign(c) * Math.abs(c) ** e, y = ry * Math.sign(s) * Math.abs(s) ** e;
    d += `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d + 'Z';
}

/** Tobi с центром тела в (cx, cy), радиус R. state — ключ STATE, eye — 'pill' | 'happy' | 'closed'. */
function tobi(cx, cy, R, { state = 'idle', eye = 'pill', badge: bd = null, look = 0 } = {}) {
  const ry = R * 0.96, col = STATE[state];
  const light = col || LIGHT;
  const tipY = -ry - R * 0.42, tipX = look * R * 0.18;
  let s = `<path d="M0 ${(-ry * 0.8).toFixed(2)}Q0 ${(-ry - R * 0.1).toFixed(2)} ${tipX.toFixed(2)} ${tipY.toFixed(2)}" fill="none" stroke="${STALK}" stroke-width="${(R * 0.08).toFixed(2)}" stroke-linecap="round"/>`;
  s += `<circle cx="${tipX.toFixed(2)}" cy="${tipY.toFixed(2)}" r="${(R * 0.13).toFixed(2)}" fill="${light}" filter="url(#glowL)"/>`;
  const body = bodyPath(R);
  s += `<path d="${body}" fill="url(#tb)"/>`;
  if (col) s += `<path d="${body}" fill="url(#tt-${state})"/>`;
  s += `<path d="${body}" fill="url(#tsh)"/><path d="${body}" fill="url(#thl)"/>`;
  // визор и глаза
  const vy = ry * 0.12, vw = R * 1.44, vh = R * 0.57, ex = R * 0.358 + look * R * 0.08;
  s += `<rect x="${(-vw / 2 + look * R * 0.12).toFixed(2)}" y="${(vy - vh / 2).toFixed(2)}" width="${vw.toFixed(2)}" height="${vh.toFixed(2)}" rx="${(vh / 2).toFixed(2)}" fill="url(#tv)"/>`;
  const ew = R * 0.23, eh = R * 0.27;
  for (const sd of [-1, 1]) {
    const x = sd * R * 0.358 + (ex - R * 0.358);
    if (eye === 'happy') s += `<path d="M${(x - ew * 0.7).toFixed(2)} ${(vy + eh * 0.15).toFixed(2)}Q${x.toFixed(2)} ${(vy - eh * 0.75).toFixed(2)} ${(x + ew * 0.7).toFixed(2)} ${(vy + eh * 0.15).toFixed(2)}" fill="none" stroke="#ECF8FF" stroke-width="${(ew * 0.45).toFixed(2)}" stroke-linecap="round" filter="url(#glow)"/>`;
    else if (eye === 'closed') s += `<path d="M${(x - ew * 0.65).toFixed(2)} ${(vy - eh * 0.05).toFixed(2)}Q${x.toFixed(2)} ${(vy + eh * 0.55).toFixed(2)} ${(x + ew * 0.65).toFixed(2)} ${(vy - eh * 0.05).toFixed(2)}" fill="none" stroke="#ECF8FF" stroke-width="${(ew * 0.35).toFixed(2)}" stroke-linecap="round" filter="url(#glow)"/>`;
    else s += `<rect x="${(x - ew / 2).toFixed(2)}" y="${(vy - eh / 2).toFixed(2)}" width="${ew.toFixed(2)}" height="${eh.toFixed(2)}" rx="${(ew / 2).toFixed(2)}" fill="#ECF8FF" filter="url(#glow)"/>`;
  }
  // значок состояния
  if (bd) {
    const bx = -R * 0.74, by = -R * 0.72, br = R * 0.24;
    s += `<circle cx="${bx}" cy="${by}" r="${(br * 1.25).toFixed(2)}" fill="#000"/><circle cx="${bx}" cy="${by}" r="${br.toFixed(2)}" fill="${col}"/>`;
    if (bd === 'dots') for (const i of [-1, 0, 1]) s += `<circle cx="${(bx + i * br * 0.5).toFixed(2)}" cy="${by}" r="${(br * 0.16).toFixed(2)}" fill="#fff"/>`;
    else if (bd === 'bang') s += `<text x="${bx}" y="${(by + br * 0.42).toFixed(2)}" text-anchor="middle" font-size="${(br * 1.3).toFixed(1)}" font-weight="900" fill="#fff">!</text>`;
  }
  return `<g transform="translate(${cx} ${cy})">${s}</g>`;
}

// ---------- логотип: Tobi на чёрной плитке ----------
const logo = (x, y, s) => `<g transform="translate(${x} ${y})"><rect width="${s}" height="${s}" rx="${s * 0.26}" fill="#000" stroke="#2a2418"/>${tobi(s / 2, s * 0.58, s * 0.3)}</g>`;

// ---------- клавиша ----------
function keycap(x, y, label, h = 30) {
  const w = Math.max(h, Math.round(K.width(label, 13, 600, { mono: true }) + 22));
  return { w, s: `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#161616" stroke="#3a3a3a"/><rect x="${x + 1}" y="${y + h - 4}" width="${w - 2}" height="3" rx="1.5" fill="#000" fill-opacity=".6"/>
<text class="m" x="${x + w / 2}" y="${y + h / 2 + 4.5}" text-anchor="middle" font-size="13" font-weight="600" fill="#fff">${T(label)}</text>` };
}
function combo(x, y, keys) {
  let s = '', cx = x;
  keys.forEach((k, i) => {
    if (i) { s += `<text class="m" x="${cx + 7}" y="${y + 20}" text-anchor="middle" font-size="13" fill="${P.dim}">+</text>`; cx += 14; }
    const c = keycap(cx, y, k);
    s += c.s; cx += c.w;
  });
  return { s, w: cx - x };
}

// ---------- окошко Tobi у верхнего края экрана ----------
function island(x, y, t) {
  const sc = t.hero.island, W = 336;
  let s = `<rect x="0" y="0" width="${W}" height="236" rx="24" fill="#000" stroke="#2a2418"/>`;
  s += tobi(38, 40, 15, { state: 'thinking', badge: 'dots' });
  s += fitText(68, 38, sc.agent, 150, { size: 14, weight: 700 });
  s += `<rect x="68" y="45" width="${Math.round(K.width(sc.status, 11, 600) + 26)}" height="18" rx="9" fill="${STATE.thinking}" fill-opacity=".18"/>`;
  s += `<circle cx="78" cy="54" r="3" fill="${STATE.thinking}"/><circle class="pulse" cx="78" cy="54" r="7" fill="${STATE.thinking}"/>`;
  s += `<text x="87" y="58" font-size="11" font-weight="600" fill="#C4B5FD">${T(sc.status)}</text>`;
  sc.steps.forEach(([tool, file, diff], i) => {
    const ry = 88 + i * 22;
    s += `<text class="m" x="20" y="${ry}" font-size="11" font-weight="600" fill="${HONEY}">${T(tool)}</text>`;
    s += `<text class="m" x="64" y="${ry}" font-size="11" fill="#D4D4D4">${T(file)}</text>`;
    if (diff) {
      const [plus, minus] = diff.split(' ');
      s += `<text class="m" x="${W - 20}" y="${ry}" text-anchor="end" font-size="11" font-weight="600"><tspan fill="#34D399">${T(plus)}</tspan> <tspan fill="#F87171">${T(minus)}</tspan></text>`;
    }
  });
  s += `<line x1="20" y1="148" x2="${W - 20}" y2="148" stroke="#1f1f1f"/>`;
  s += fitText(20, 174, sc.ask, W - 40, { size: 14, weight: 600 });
  const bw = (W - 52) / 2;
  s += `<rect x="20" y="188" width="${bw}" height="32" rx="10" fill="#1a1a1a" stroke="#333"/>`;
  s += fitText(20 + bw / 2, 209, sc.deny, bw - 16, { size: 13, weight: 700, anchor: 'middle' });
  s += `<rect x="${32 + bw}" y="188" width="${bw}" height="32" rx="10" fill="url(#btnh)"/>`;
  s += fitText(32 + bw * 1.5, 209, sc.allow, bw - 16, { size: 13, weight: 700, anchor: 'middle', fill: '#2A1A00' });
  return `<g transform="translate(${x} ${y})">${s}</g>`;
}
const HERO_DEFS = `${TOBI_DEFS}
<linearGradient id="btnh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFD27A"/><stop offset="1" stop-color="#F2A93B"/></linearGradient>`;

// ---------- HERO ----------
function hero(t) {
  const W = 880, H = 480;
  let b = `<g class="r">${logo(40, 30, 44)}<text x="96" y="62" font-size="22" font-weight="800" letter-spacing="-.3">${T('Tobi')}</text></g>`;
  b += `<g class="r" ${delay(1)}>${chip(164, 39, 'v' + VERSION).s}</g>`;
  const ts = fitSize(t.hero.title, 450, 44, 800);
  b += `<g class="r" ${delay(2)}>${lines(40, 146, t.hero.title.map(one), { size: ts, weight: 800, lh: 50, spacing: '-1' })}</g>`;
  const ss = fitSize(t.hero.sub, 450, 16, 500);
  b += `<g class="r" ${delay(3)}>${lines(40, 236, t.hero.sub.map(one), { size: ss, weight: 500, lh: 24, fill: P.muted })}</g>`;
  t.hero.cards.forEach(([a, d], i) => {
    const x = 40 + (i % 2) * 230, y = 290 + Math.floor(i / 2) * 86;
    b += `<g class="r" ${delay(4 + i)}>${card(x, y, 218, 74)}
<circle cx="${x + 22}" cy="${y + 27}" r="4" fill="${HONEY}"/>
${fitText(x + 34, y + 32, a, 170, { size: 16, weight: 700 })}
${fitText(x + 20, y + 54, d, 184, { size: 13, weight: 500, fill: P.muted })}</g>`;
  });
  // верхний край экрана и окошко под ним
  b += `<g class="r" ${delay(3)}><ellipse cx="680" cy="230" rx="190" ry="200" fill="url(#g1)"/>
<rect x="500" y="72" width="360" height="2" rx="1" fill="#2a2a2a"/>
${island(512, 74, t)}
<g transform="translate(${680 - combo(0, 0, ['Ctrl', 'Alt', 'N']).w / 2} 352)">${combo(0, 0, ['Ctrl', 'Alt', 'N']).s}</g></g>`;
  return svg(W, H, t.hero.alt, b, HERO_DEFS);
}

// ---------- ВОЗМОЖНОСТИ ----------
function features(t) {
  const W = 880;
  const head = sectionHead(t.features.chip, t.features.title);
  let b = head.s;
  const items = t.features.items.map(([title, ls]) => [title, ls.flatMap((l) => wrap(l, 344, 15, 500))]);
  const ch = 92 + Math.max(...items.map(([, ls]) => ls.length)) * 22 - 4;
  const rows = Math.ceil(items.length / 2);
  items.forEach(([title, ls], i) => {
    const x = 40 + (i % 2) * 408, y = head.y + Math.floor(i / 2) * (ch + 16);
    b += `<g class="r" ${delay(2 + i)}>${card(x, y, 392, ch, 20)}${badge(x + 40, y + 42, i + 1)}
${fitText(x + 68, y + 48, title, 300, { size: 20, weight: 700 })}
${lines(x + 24, y + 92, ls, { size: 15, weight: 500, lh: 22, fill: P.muted })}</g>`;
  });
  return svg(W, head.y + rows * ch + (rows - 1) * 16 + 36, t.features.alt, b);
}

// ---------- СОЧЕТАНИЯ КЛАВИШ ----------
function keys(t) {
  const W = 880;
  const head = sectionHead(t.keys.chip, t.keys.title);
  let b = head.s;
  t.keys.items.forEach(([ks, label], i) => {
    const x = 40 + (i % 2) * 408, y = head.y + Math.floor(i / 2) * 70;
    const c = combo(x + 20, y + 16, ks);
    b += `<g class="r" ${delay(2 + i)}>${card(x, y, 392, 62, 16)}${c.s}
${fitText(x + 32 + c.w, y + 36, label, 392 - c.w - 50, { size: 15, weight: 600, fill: i === 0 ? HONEY : P.ink })}</g>`;
  });
  const ny = head.y + 3 * 70 + 14;
  b += `<g class="r" ${delay(8)}>${fitText(40, ny, t.keys.note, 800, { size: 14, weight: 500, fill: P.muted })}</g>`;
  return svg(W, ny + 34, t.keys.alt, b);
}

// ---------- СОСТОЯНИЯ ----------
function states(t) {
  const W = 880;
  const head = sectionHead(t.states.chip, t.states.title);
  let b = head.s;
  const spec = [
    { state: 'idle' }, { state: 'thinking', badge: 'dots', look: 0.6 }, { state: 'working', badge: 'dots', look: -0.4 },
    { state: 'approval', badge: 'bang' }, { state: 'finished', eye: 'happy' }, { state: 'sleeping', eye: 'closed' },
  ];
  const w = (800 - 5 * 12) / 6;
  t.states.items.forEach((label, i) => {
    const x = 40 + i * (w + 12), y = head.y;
    const col = STATE[spec[i].state] || LIGHT;
    b += `<g class="r" ${delay(2 + i)}>${card(x, y, w, 170, 18)}${tobi(x + w / 2, y + 78, 30, spec[i])}
<circle cx="${x + 18}" cy="${y + 147}" r="4" fill="${col}"/>
${fitText(x + 28, y + 152, label, w - 36, { size: 14, weight: 700 })}</g>`;
  });
  return svg(W, head.y + 170 + 34, t.states.alt, b, TOBI_DEFS);
}

// ---------- В ЦИФРАХ ----------
function numbers(t) {
  const W = 880;
  const head = sectionHead(t.numbers.chip, t.numbers.title);
  let b = head.s;
  const w = (800 - 4 * 12) / 5;
  t.numbers.items.forEach(([n, unit, ls], i) => {
    const x = 40 + i * (w + 12), y = head.y;
    b += `<g class="r" ${delay(2 + i)}>${card(x, y, w, 124, 18)}
<text class="m" x="${x + 20}" y="${y + 56}" font-size="38" font-weight="700" letter-spacing="-1" fill="url(#tg)">${T(n)}<tspan font-size="16" fill="${P.muted}">${T(unit)}</tspan></text>
${ls.map((l, k) => fitText(x + 20, y + 86 + k * 18, l, w - 30, { size: 13, weight: 500, fill: P.muted })).join('\n')}</g>`;
  });
  return svg(W, head.y + 124 + 34, t.numbers.alt, b);
}

// ---------- сборка ----------
const langs = {};
for (const [lang, t] of Object.entries(STR)) {
  langs[lang] = () => ({
    [`hero-${lang}.svg`]: hero(t),
    [`btn-windows-${lang}.svg`]: K.button(t.buttons.windows, ICONS.windows, true),
    [`btn-new-${lang}.svg`]: K.button(t.buttons.whatsNew, ICONS.spark, false),
    [`features-${lang}.svg`]: features(t),
    [`keys-${lang}.svg`]: keys(t),
    [`states-${lang}.svg`]: states(t),
    [`numbers-${lang}.svg`]: numbers(t),
  });
}
await K.build(OUT, langs, 'vTobi.!+−→');
