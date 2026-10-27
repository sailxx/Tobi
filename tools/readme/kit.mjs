// Общий стиль плашек README в духе Okto Calc: чёрный фон, мягкие свечения цвета проекта,
// градиентные акценты, шрифты Golos Text и JetBrains Mono (урезаются под каждый язык).
// Ширина текста меряется по самому шрифту, поэтому переносы работают на любом языке.
import fs from 'node:fs';
import path from 'node:path';
import subsetFont from 'subset-font';
import * as fontkit from 'fontkit';

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const plain = (s) => String(s).replace(/\*/g, '');

/**
 * accent: { hi — основной цвет, grad — [от, до] для акцентного текста, on — текст на акцентной заливке,
 *           glow — цвет большого свечения, glow2 — второго, btn — [верх, низ] основной кнопки }
 */
export function createKit({ golos, mono, accent }) {
  const A = accent;
  const fontG = fontkit.openSync(golos), fontM = fontkit.openSync(mono);
  const inst = new Map();
  const face = (mono, wght) => {
    const k = (mono ? 'm' : 'g') + wght;
    if (!inst.has(k)) inst.set(k, (mono ? fontM : fontG).getVariation({ wght }));
    return inst.get(k);
  };
  let allText = '';
  const T = (s) => { allText += s; return esc(s); };

  const P = { ink: '#FFFFFF', muted: '#A3A3A3', dim: '#6E6E6E', stroke: '#2A2A2A' };

  /** Ширина строки в px. */
  function width(s, size, weight = 400, { mono = false, ls = 0 } = {}) {
    const f = face(mono, weight);
    const str = plain(s);
    return f.layout(str).advanceWidth / f.unitsPerEm * size + Math.max(0, [...str].length - 1) * ls;
  }

  /** Перенос по словам с учётом *акцента*: строки — массивы [текст, акцент?]. \n — принудительный перенос. */
  function wrap(s, maxW, size, weight = 400, opts = {}) {
    const lines = [];
    let hi = false;
    for (const para of String(s).split('\n')) {
      let cur = [];
      const start = lines.length;
      const flat = (arr) => arr.map((w) => w.text).join(' ');
      for (const raw of para.split(' ').filter(Boolean)) {
        // разбить слово на куски по звёздочкам
        const parts = [];
        let buf = '';
        for (const ch of raw) {
          if (ch === '*') { if (buf) parts.push([buf, hi]); buf = ''; hi = !hi; } else buf += ch;
        }
        if (buf) parts.push([buf, hi]);
        const word = { text: parts.map((p) => p[0]).join(''), parts };
        if (cur.length && width(flat([...cur, word]), size, weight, opts) > maxW) { lines.push(cur); cur = [word]; } else cur.push(word);
      }
      if (cur.length) lines.push(cur);
      // не оставлять короткое слово («7», «и») одно на последней строке
      const n = lines.length;
      if (n - 1 > start && lines[n - 1].length === 1 && [...lines[n - 1][0].text].length <= 3 && lines[n - 2].length > 2) lines[n - 1].unshift(lines[n - 2].pop());
    }
    // склеить слова строки в куски [текст, акцент]
    return lines.map((words) => {
      const out = [];
      words.forEach((w, i) => w.parts.forEach(([t, h], k) => {
        const piece = (i && k === 0 ? ' ' : '') + t;
        const last = out[out.length - 1];
        if (last && last[1] === h) last[0] += piece; else out.push([piece, h]);
      }));
      return out;
    });
  }
  const lineW = (line, size, weight, opts) => width(line.map((p) => p[0]).join(''), size, weight, opts);

  const spans = (line, hiFill = 'url(#tg)') => line.map(([s, hi]) => `<tspan${hi ? ` fill="${hiFill}"` : ''}>${T(s)}</tspan>`).join('');

  /** Блок текста: строки из wrap(). */
  function lines(x, y, ls, { size, weight = 500, lh = size * 1.4, fill = P.ink, mono = false, spacing, anchor, hiFill } = {}) {
    return ls.map((l, i) => `<text${mono ? ' class="m"' : ''} x="${x}" y="${(y + i * lh).toFixed(1)}" font-size="${size}" font-weight="${weight}"${spacing ? ` letter-spacing="${spacing}"` : ''}${anchor ? ` text-anchor="${anchor}"` : ''} fill="${fill}">${spans(l, hiFill)}</text>`).join('\n');
  }
  /** Одна строка, ужатая до maxW: если не влезает — уменьшается кегль. */
  function fitText(x, y, s, maxW, { size, weight = 500, fill = P.ink, mono = false, spacing = 0, anchor, cls } = {}) {
    let sz = size;
    while (sz > size * 0.6 && width(s, sz, weight, { mono, ls: spacing }) > maxW) sz -= 0.5;
    const c = [mono ? 'm' : '', cls || ''].filter(Boolean).join(' ');
    return `<text${c ? ` class="${c}"` : ''} x="${x}" y="${y}" font-size="${sz}" font-weight="${weight}"${spacing ? ` letter-spacing="${spacing}"` : ''}${anchor ? ` text-anchor="${anchor}"` : ''} fill="${fill}">${spans(wrapOne(s))}</text>`;
  }
  const wrapOne = (s) => wrap(s, 1e9, 10)[0] || [];
  /** Общий кегль для нескольких строк, чтобы каждая влезла в maxW. */
  function fitSize(strs, maxW, size, weight = 500, opts = {}) {
    let sz = size;
    while (sz > size * 0.6 && strs.some((s) => width(s, sz, weight, opts) > maxW)) sz -= 0.5;
    return sz;
  }
  /** Одна строка как [[текст, акцент]] — для lines(). */
  const one = (s) => wrapOne(s);

  const fontCss = (fg, fm) => `@font-face{font-family:"G";src:url(data:font/woff2;base64,${fg}) format("woff2");font-weight:100 900}
@font-face{font-family:"M";src:url(data:font/woff2;base64,${fm}) format("woff2");font-weight:100 900}
svg{fill:#fff}
text{font-family:"G","Segoe UI",system-ui,sans-serif}
.m{font-family:"M",ui-monospace,Consolas,monospace}`;

  const style = (fg, fm) => `<style>
${fontCss(fg, fm)}
.r{animation:rise .8s cubic-bezier(.2,.8,.2,1) backwards}
.glow{animation:drift 14s ease-in-out infinite}
.glow2{animation:drift 18s ease-in-out -6s infinite reverse}
.blink{animation:blink 1.1s steps(1) infinite}
.pulse{animation:pulse 2.6s ease-in-out infinite}
.sweep{animation:sweep 6s ease-in-out infinite}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes drift{0%,100%{transform:translate(0,0)}50%{transform:translate(36px,22px)}}
@keyframes blink{50%{opacity:0}}
@keyframes pulse{0%,100%{opacity:0}50%{opacity:.22}}
@keyframes sweep{0%{transform:translateX(-120%)}60%,100%{transform:translateX(220%)}}
@media (prefers-reduced-motion:reduce){.r,.glow,.glow2,.blink,.pulse,.sweep{animation:none}}
</style>`;

  const defs = (w, h) => `<defs>
<radialGradient id="g1" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${A.glow}" stop-opacity="${A.glowOpacity ?? 0.2}"/><stop offset="1" stop-color="${A.glow}" stop-opacity="0"/></radialGradient>
<radialGradient id="g2" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${A.glow2}" stop-opacity=".14"/><stop offset="1" stop-color="${A.glow2}" stop-opacity="0"/></radialGradient>
<linearGradient id="cg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1c1c1c"/><stop offset="1" stop-color="#0a0a0a"/></linearGradient>
<linearGradient id="hl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="tg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${A.grad[0]}"/><stop offset="1" stop-color="${A.grad[1]}"/></linearGradient>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d0d0d"/><stop offset="1" stop-color="#000"/></linearGradient>
<linearGradient id="sw" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".07"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<clipPath id="clip"><rect width="${w}" height="${h}" rx="24"/></clipPath>
</defs>`;

  const frame = (w, h) => `<g clip-path="url(#clip)"><rect width="${w}" height="${h}" fill="url(#bg)"/>
<circle class="glow" cx="${w * 0.82}" cy="${Math.min(h * 0.2, 120)}" r="${Math.min(h * 0.7, 340)}" fill="url(#g1)"/>
<circle class="glow2" cx="${w * 0.1}" cy="${h * 0.95}" r="${Math.min(h * 0.6, 300)}" fill="url(#g2)"/>
<rect class="sweep" x="0" y="0" width="${w * 0.35}" height="${h}" fill="url(#sw)"/></g>
<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="24" fill="none" stroke="#242424"/>`;

  /** Плашка: возвращает функцию (fg, fm) → SVG. extraDefs — свои градиенты и клипы. */
  const svg = (w, h, label, body, extraDefs = '') => (fg, fm) =>
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(plain(label))}">\n${style(fg, fm)}\n${defs(w, h)}${extraDefs ? `\n<defs>${extraDefs}</defs>` : ''}\n${frame(w, h)}\n${body}\n</svg>\n`;

  const delay = (i) => `style="animation-delay:${(i * 0.09).toFixed(2)}s"`;

  const card = (x, y, w, h, rx = 18) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="url(#cg)" stroke="${P.stroke}"/><rect x="${x + rx}" y="${y + .5}" width="${Math.max(0, w - rx * 2)}" height="1" fill="url(#hl)"/>`;

  /** Метка-чип: моно, заглавные. check — галочка цвета акцента. */
  function chip(x, y, text, { check = false, upper = true } = {}) {
    const label = upper ? text.toUpperCase() : text;
    const w = Math.round(width(label, 12, 600, { mono: true, ls: 1 }) + (check ? 46 : 28));
    let s = `<rect x="${x}" y="${y}" width="${w}" height="30" rx="8" fill="#141414" stroke="#333"/>`;
    let tx = x + 14;
    if (check) {
      s += `<path d="M${x + 13} ${y + 15.5}l4 4 8-8.5" fill="none" stroke="${A.hi}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
      tx = x + 32;
    }
    s += `<text class="m" x="${tx}" y="${y + 20}" font-size="12" font-weight="600" letter-spacing="1" fill="#fff">${T(label)}</text>`;
    return { s, w };
  }

  /** Заголовок раздела: чип + крупная строка (переносится). Возвращает разметку и y, с которого можно продолжать. */
  function sectionHead(label, title, { x = 40, maxW = 800, size = 32 } = {}) {
    const c = chip(x, 34, label, { check: true });
    const ls = wrap(title, maxW, size, 800);
    const lh = size * 1.2;
    const s = `<g class="r">${c.s}</g>
<g class="r" ${delay(1)}>${lines(x, 104, ls, { size, weight: 800, lh, spacing: '-.6' })}</g>`;
    return { s, y: 104 + (ls.length - 1) * lh + 28 };
  }

  /** Номер в круге акцента. */
  const badge = (cx, cy, n, r = 16) =>
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${A.hi}"/><text class="m" x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="15" font-weight="700" fill="${A.on}">${T(String(n))}</text>`;

  /** Иконка в квадратике с подсветкой акцента; paths — внутренности 24×24 (stroke). */
  const iconBox = (x, y, paths, size = 40) =>
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="11" fill="${A.hi}" fill-opacity=".12" stroke="${A.hi}" stroke-opacity=".28"/>` +
    `<g transform="translate(${x + (size - 24) / 2} ${y + (size - 24) / 2})" fill="none" stroke="${A.hi}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`;

  /** Кнопка 52 px: основная — заливка акцентом, вторая — тёмная. icon(color) → разметка в квадрате 24×24 со сдвигом 18,14. */
  function button(label, icon, primary) {
    return (fg) => {
      const w = Math.round(50 + width(label, 15, 700) + 24);
      const ink = primary ? A.on : '#FFFFFF';
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="52" viewBox="0 0 ${w} 52" role="img" aria-label="${esc(label)}">
<style>@font-face{font-family:"G";src:url(data:font/woff2;base64,${fg}) format("woff2");font-weight:100 900}text{font-family:"G","Segoe UI",system-ui,sans-serif}</style>
<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${primary ? A.btn[0] : '#202020'}"/><stop offset="1" stop-color="${primary ? A.btn[1] : '#101010'}"/></linearGradient></defs>
<rect x=".5" y=".5" width="${w - 1}" height="51" rx="14" fill="url(#b)" stroke="${primary ? A.btn[0] : '#333'}"/>
<g transform="translate(18 14)" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</g>
<text x="50" y="32" font-size="15" font-weight="700" fill="${ink}">${T(label)}</text>
</svg>
`;
    };
  }

  /** Сборка: langs = { ru: () => ({ 'hero-ru.svg': render, ... }) }. Шрифты урезаются под каждый язык. */
  async function build(outDir, langs, extraChars = '') {
    fs.mkdirSync(outDir, { recursive: true });
    const srcG = fs.readFileSync(golos), srcM = fs.readFileSync(mono);
    for (const [lang, make] of Object.entries(langs)) {
      allText = '';
      const files = make(); // плашки собираются здесь, чтобы весь их текст попал в шрифт
      for (const f of Object.values(files)) f('', '');
      const chars = [...new Set(allText + '0123456789 ' + extraChars)].join('');
      const sub = async (src) => (await subsetFont(src, chars, { targetFormat: 'woff2' })).toString('base64');
      const [fg, fm] = [await sub(srcG), await sub(srcM)];
      let size = 0;
      for (const [name, render] of Object.entries(files)) {
        const out = render(fg, fm);
        fs.writeFileSync(path.join(outDir, name), out);
        size += out.length;
      }
      console.log(lang, (size / 1024).toFixed(0) + ' KB,', 'glyphs:', chars.length);
    }
  }

  return { A, P, T, esc, plain, width, wrap, lineW, spans, lines, fitText, fitSize, one, svg, delay, card, chip, sectionHead, badge, iconBox, button, build, fontCss };
}

// Иконки 24×24 (stroke)
export const ICONS = {
  android: '<path d="M7 10.5a5 5 0 0 1 10 0v.5H7z"/><path d="M8.6 6.6 7.4 4.8M15.4 6.6l1.2-1.8"/><rect x="7" y="12.5" width="10" height="7" rx="1.6"/>',
  spark: '<path d="M12 4l1.8 4.6L18.5 10l-4.7 1.4L12 16l-1.8-4.6L5.5 10l4.7-1.4z"/>',
  download: '<path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/>',
  web: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5s1.2-6.1 3.8-8.5z"/>',
  send: '<path d="M20.5 4 3.5 11l6.5 2.5L12.5 20z"/><path d="M10 13.5 20.5 4"/>',
  windows: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  linux: '<path d="M12 3.5c-2.2 0-3.5 2-3.5 4.5 0 1.5-.8 2.6-1.8 4C5.6 13.6 5 15.5 6 17c.6.9 1.6 1.2 2.5 1.2L12 20l3.5-1.8c.9 0 1.9-.3 2.5-1.2 1-1.5.4-3.4-.7-5-1-1.4-1.8-2.5-1.8-4 0-2.5-1.3-4.5-3.5-4.5z"/><circle cx="10.3" cy="8" r=".6"/><circle cx="13.7" cy="8" r=".6"/>',
  macos: '<rect x="3.5" y="5" width="17" height="11" rx="2"/><path d="M8.5 20h7M12 16v4"/>',
  shield: '<path d="M12 3l7.5 3v5.3c0 4.6-3.2 8.2-7.5 9.7-4.3-1.5-7.5-5.1-7.5-9.7V6z"/><path d="M8.8 12.2l2.2 2.2 4.3-4.3"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2.5"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/><circle cx="12" cy="15" r="1.3"/>',
  sync: '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
};
