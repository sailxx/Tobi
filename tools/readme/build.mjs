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

// Акцент — синий наушников Tobi (src/tobi/look.ts)
const HONEY = '#2E9BFF', HONEY_HI = '#7CC4FF', HONEY_LO = '#1478F0', LIGHT = '#5AB8FF';
const ICON_PNG = fs.readFileSync(path.join(REPO, 'src-tauri/icons/128x128.png')).toString('base64');
const K = createKit({
  golos: path.join(HERE, '.font/golos.ttf'),
  mono: path.join(HERE, '.font/jbmono.ttf'),
  accent: { hi: HONEY, grad: [HONEY_HI, HONEY_LO], on: '#021226', glow: HONEY_LO, glow2: LIGHT, glowOpacity: 0.22, btn: ['#6CBBFF', '#1F7BF0'] },
});
const { P, T, card, chip, sectionHead, badge, lines, wrap, one, fitSize, fitText, delay, svg } = K;

// ---------- Tobi: тот же рисунок, что в движке (белое тело, глаза с бликом, улыбка, наушники) ----------
const STATE = { idle: null, thinking: '#8B5CF6', working: '#3B9EFF', approval: '#F5A524', finished: '#34D399', sleeping: '#94A2B8' };
const TOBI_DEFS = `<linearGradient id="tb" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#CDD5F6"/></linearGradient>
<linearGradient id="tp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2EA8FF"/><stop offset="1" stop-color="#085CE8"/></linearGradient>
<radialGradient id="tsh" cx=".5" cy=".5" r=".5"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".16"/></radialGradient>
<radialGradient id="thl" cx=".67" cy=".27" r=".25"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
${Object.entries(STATE).filter(([, c]) => c).map(([k, c]) => `<linearGradient id="tt-${k}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${c}" stop-opacity=".5"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient>`).join('\n')}`;

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
  const phone = col || 'url(#tp)';
  const f = (n) => n.toFixed(2);
  // дужка наушников — за телом
  const bx = look * R * 0.1, bw = R * 1.1, bh = ry * 1.12, by = -ry * 0.06;
  const pt = (a) => [bx + bw * Math.cos(a), by + bh * Math.sin(a)];
  const [x0, y0] = pt(Math.PI * 1.1), [x1, y1] = pt(Math.PI * 1.9);
  let s = `<path d="M${f(x0)} ${f(y0)}A${f(bw)} ${f(bh)} 0 0 1 ${f(x1)} ${f(y1)}" fill="none" stroke="${phone}" stroke-width="${f(R * 0.17)}" stroke-linecap="round"/>`;
  const body = bodyPath(R);
  s += `<path d="${body}" fill="url(#tb)"/>`;
  if (col) s += `<path d="${body}" fill="url(#tt-${state})"/>`;
  s += `<path d="${body}" fill="url(#tsh)"/><path d="${body}" fill="url(#thl)"/>`;
  // глаза и улыбка
  const vy = ry * 0.06, ex = R * 0.37 + look * R * 0.08;
  const ew = R * 0.125, eh = R * 0.15, ink = '#120E18';
  for (const sd of [-1, 1]) {
    const x = sd * R * 0.37 + (ex - R * 0.37);
    if (eye === 'happy') s += `<path d="M${f(x - ew * 1.3)} ${f(vy + eh * 0.2)}Q${f(x)} ${f(vy - eh * 1.3)} ${f(x + ew * 1.3)} ${f(vy + eh * 0.2)}" fill="none" stroke="${ink}" stroke-width="${f(ew * 0.8)}" stroke-linecap="round"/>`;
    else if (eye === 'closed') s += `<path d="M${f(x - ew * 1.2)} ${f(vy - eh * 0.1)}Q${f(x)} ${f(vy + eh * 0.9)} ${f(x + ew * 1.2)} ${f(vy - eh * 0.1)}" fill="none" stroke="${ink}" stroke-width="${f(ew * 0.6)}" stroke-linecap="round"/>`;
    else s += `<ellipse cx="${f(x)}" cy="${f(vy)}" rx="${f(ew)}" ry="${f(eh)}" fill="${ink}"/><circle cx="${f(x + ew * 0.3)}" cy="${f(vy - eh * 0.3)}" r="${f(ew * 0.34)}" fill="#fff"/>`;
  }
  if (eye === 'pill') {
    const mx = look * R * 0.1, my = ry * 0.34, mw = R * 0.2, mh = R * 0.15;
    s += `<path d="M${f(mx - mw)} ${f(my - mh * 0.25)}Q${f(mx)} ${f(my - mh * 0.55)} ${f(mx + mw)} ${f(my - mh * 0.3)}Q${f(mx + mw * 0.55)} ${f(my + mh * 1.25)} ${f(mx - mw * 0.2)} ${f(my + mh * 0.85)}Q${f(mx - mw * 0.85)} ${f(my + mh * 0.45)} ${f(mx - mw)} ${f(my - mh * 0.25)}Z" fill="#300C18"/>`;
  }
  // ушки наушников — перед телом
  for (const sd of [-1, 1]) s += `<rect x="${f(sd * R * 0.98 - R * 0.15)}" y="${f(ry * 0.1 - R * 0.3)}" width="${f(R * 0.3)}" height="${f(R * 0.6)}" rx="${f(R * 0.15)}" fill="${phone}"/>`;
  // значок состояния
  if (bd) {
    const bx = -R * 0.74, by = -R * 0.72, br = R * 0.24;
    s += `<circle cx="${bx}" cy="${by}" r="${(br * 1.25).toFixed(2)}" fill="#000"/><circle cx="${bx}" cy="${by}" r="${br.toFixed(2)}" fill="${col}"/>`;
    if (bd === 'dots') for (const i of [-1, 0, 1]) s += `<circle cx="${(bx + i * br * 0.5).toFixed(2)}" cy="${by}" r="${(br * 0.16).toFixed(2)}" fill="#fff"/>`;
    else if (bd === 'bang') s += `<text x="${bx}" y="${(by + br * 0.42).toFixed(2)}" text-anchor="middle" font-size="${(br * 1.3).toFixed(1)}" font-weight="900" fill="#fff">!</text>`;
  }
  return `<g transform="translate(${cx} ${cy})">${s}</g>`;
}

// ---------- логотип: иконка приложения ----------
const logo = (x, y, s) => `<image x="${x}" y="${y}" width="${s}" height="${s}" href="data:image/png;base64,${ICON_PNG}"/>`;

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
  s += fitText(32 + bw * 1.5, 209, sc.allow, bw - 16, { size: 13, weight: 700, anchor: 'middle', fill: '#021226' });
  return `<g transform="translate(${x} ${y})">${s}</g>`;
}
const HERO_DEFS = `${TOBI_DEFS}
<linearGradient id="btnh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6CBBFF"/><stop offset="1" stop-color="#1F7BF0"/></linearGradient>`;

// ---------- HERO ----------
function hero(t) {
  const W = 880, H = 480;
  let b = `<g class="r">${chip(40, 39, 'v' + VERSION).s}</g>`;
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

// ---------- ДОРОЖНАЯ КАРТА ----------
function roadmap(t) {
  const W = 880, r = t.roadmap;
  const head = sectionHead(r.chip, r.title);
  let b = head.s;
  const top = head.y, RH = 50, n = r.done.length;
  const LH = 56 + n * RH + 6;
  const lx = 40, lw = 500;
  // левая колонка: выпущенное
  b += `<g class="r" ${delay(2)}>${card(lx, top, lw, LH, 20)}
<text class="m" x="${lx + 24}" y="${top + 34}" font-size="12" font-weight="600" letter-spacing="1" fill="${HONEY}">${T(r.doneHead.toUpperCase())}</text></g>`;
  const x0 = lx + 34, y0 = top + 74;
  b += `<line x1="${x0}" y1="${y0}" x2="${x0}" y2="${y0 + (n - 1) * RH}" stroke="${HONEY}" stroke-opacity=".35" stroke-width="2"/>`;
  r.done.forEach(([ver, date, title, desc], i) => {
    const y = y0 + i * RH, last = i === n - 1;
    b += `<g class="r" ${delay(3 + i)}>`;
    if (last) b += `<circle cx="${x0}" cy="${y}" r="11" fill="${HONEY}" fill-opacity=".18"/>`;
    b += `<circle cx="${x0}" cy="${y}" r="5" fill="${HONEY}"/>`;
    b += `<text class="m" x="${x0 + 22}" y="${y + 4}" font-size="13" font-weight="700" fill="${last ? HONEY_HI : P.ink}">${T(ver)}</text>`;
    b += fitText(x0 + 82, y + 1, title, 230, { size: 15, weight: 700 });
    b += fitText(x0 + 82, y + 20, desc, 330, { size: 12.5, weight: 500, fill: P.muted });
    b += `<text class="m" x="${lx + lw - 24}" y="${y + 4}" text-anchor="end" font-size="12" fill="${P.dim}">${T(date)}</text></g>`;
  });
  // правая колонка: дальше
  const rx = lx + lw + 16, rw = 800 - lw - 16;
  const colItems = (items) => items.map(([a, d]) => ({ a, d, ls: wrap(d, rw - 56, 12.5, 500) }));
  const block = (head, items, y, h, kind, di) => {
    let s = `<g class="r" ${delay(di)}>${card(rx, y, rw, h, 20)}
<text class="m" x="${rx + 24}" y="${y + 34}" font-size="12" font-weight="600" letter-spacing="1" fill="${kind === 'next' ? HONEY : P.muted}">${T(head.toUpperCase())}</text>`;
    let yy = y + 66;
    for (const it of colItems(items)) {
      const dot = kind === 'next'
        ? `<circle cx="${rx + 30}" cy="${yy - 5}" r="4.5" fill="none" stroke="${HONEY}" stroke-width="2"/>`
        : `<circle cx="${rx + 30}" cy="${yy - 5}" r="4.5" fill="none" stroke="${P.dim}" stroke-width="2" stroke-dasharray="2.4 2.4"/>`;
      s += dot + fitText(rx + 46, yy, it.a, rw - 70, { size: 14, weight: 700 });
      s += lines(rx + 46, yy + 19, it.ls, { size: 12.5, weight: 500, lh: 17, fill: P.muted });
      yy += 19 + it.ls.length * 17 + 18;
    }
    return s + '</g>';
  };
  const hOf = (items) => 66 + colItems(items).reduce((a, it) => a + 19 + it.ls.length * 17 + 18, 0) - 4;
  const nh = hOf(r.next);
  b += block(r.nextHead, r.next, top, nh, 'next', 3);
  b += block(r.gapsHead, r.gaps, top + nh + 16, LH - nh - 16, 'gaps', 4);
  return svg(W, top + LH + 34, r.alt, b);
}

// ---------- сборка ----------
const langs = {};
for (const [lang, t] of Object.entries(STR)) {
  langs[lang] = () => ({
    [`hero-${lang}.svg`]: hero(t),
    [`btn-windows-${lang}.svg`]: K.button(t.buttons.windows, ICONS.windows, true),
    [`btn-linux-${lang}.svg`]: K.button(t.buttons.linux, ICONS.linux, true),
    [`btn-macos-${lang}.svg`]: K.button(t.buttons.macos, ICONS.macos, true),
    [`btn-new-${lang}.svg`]: K.button(t.buttons.whatsNew, ICONS.spark, false),
    [`features-${lang}.svg`]: features(t),
    [`keys-${lang}.svg`]: keys(t),
    [`states-${lang}.svg`]: states(t),
    [`numbers-${lang}.svg`]: numbers(t),
    [`roadmap-${lang}.svg`]: roadmap(t),
  });
}
await K.build(OUT, langs, 'vTobi.!+−→');
