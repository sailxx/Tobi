// The code window's logic, apart from the page: which language a file is, a small highlighter, and
// which lines of the file the agent's edits added. No dependencies: a library for this would be
// bigger than everything else in the window.

export type TokClass = "kw" | "str" | "num" | "com" | "fn" | "type" | "prop" | "tag" | "attr" | "";
export type Tok = [TokClass, string];

export interface Lang {
  id: string;
  /** Line comment openers. */
  line: string[];
  block?: [string, string];
  /** Quote characters; the backtick and triple quotes run over lines. */
  quotes: string;
  kw: Set<string>;
  /** `Name` followed by nothing special is a type. */
  types?: boolean;
  /** `'` is a character literal (Rust, C, Java …), not a string: `'a` is a lifetime or a label. */
  charQuote?: boolean;
  /** A string followed by `:` is a key (JSON, YAML). */
  keys?: boolean;
  markup?: boolean;
  css?: boolean;
  md?: boolean;
}

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

const JS = words(
  "abstract as async await break case catch class const continue debugger declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface is keyof let namespace new null of override private protected public readonly return satisfies set static super switch this throw true try type typeof undefined var void while with yield",
);
const RUST = words(
  "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
);
const PY = words(
  "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield match case self",
);
const GO = words(
  "break case chan const continue default defer else fallthrough false for func go goto if import interface map nil package range return select struct switch true type var",
);
const JAVA = words(
  "abstract as assert boolean break byte case catch char class const continue data default do double else enum extends false final finally float for fun if implements import in instanceof int interface is long namespace native new null object override package private protected public return short static struct super switch synchronized this throw throws true try val var virtual void volatile when while using internal sealed readonly async await let guard func init self nil",
);
const C = words(
  "auto break case char const continue default do double else enum extern false float for goto if inline int long NULL nullptr register return short signed sizeof static struct switch template this true typedef typename union unsigned using virtual void volatile while class namespace new delete public private protected include define ifdef ifndef endif",
);
const SH = words(
  "if then else elif fi for while until do done case esac in function return exit export local readonly set unset echo cd true false",
);
const RUBY = words(
  "alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield",
);
const LITERALS = words("true false null yes no on off");

const SLASH: Pick<Lang, "line" | "block"> = { line: ["//"], block: ["/*", "*/"] };
const HASH: Pick<Lang, "line" | "block"> = { line: ["#"] };

const LANGS: Record<string, Lang> = {
  js: { id: "js", ...SLASH, quotes: "'\"`", kw: JS, types: true },
  rust: { id: "rust", ...SLASH, quotes: "\"'", kw: RUST, types: true, charQuote: true },
  py: { id: "py", ...HASH, quotes: "'\"", kw: PY, types: true },
  go: { id: "go", ...SLASH, quotes: "\"'`", kw: GO, types: true, charQuote: true },
  java: { id: "java", ...SLASH, quotes: "\"'", kw: JAVA, types: true, charQuote: true },
  c: { id: "c", ...SLASH, quotes: "\"'", kw: C, types: true, charQuote: true },
  sh: { id: "sh", ...HASH, quotes: "\"'", kw: SH },
  ruby: { id: "ruby", ...HASH, quotes: "\"'", kw: RUBY, types: true },
  yaml: { id: "yaml", ...HASH, quotes: "\"'", kw: LITERALS, keys: true },
  toml: { id: "toml", ...HASH, quotes: "\"'", kw: LITERALS },
  json: { id: "json", line: [], quotes: "\"", kw: LITERALS, keys: true },
  css: { id: "css", line: [], block: ["/*", "*/"], quotes: "\"'", kw: new Set(), css: true },
  html: { id: "html", line: [], quotes: "\"'", kw: new Set(), markup: true },
  md: { id: "md", line: [], quotes: "", kw: new Set(), md: true },
};

const BY_EXT: Record<string, keyof typeof LANGS> = {
  ts: "js", tsx: "js", js: "js", jsx: "js", mjs: "js", cjs: "js", mts: "js", cts: "js", svelte: "html",
  vue: "html", rs: "rust", py: "py", pyw: "py", go: "go", java: "java", kt: "java", kts: "java",
  cs: "java", swift: "java", dart: "java", scala: "java", php: "java", c: "c", h: "c", cc: "c",
  cpp: "c", cxx: "c", hpp: "c", m: "c", sh: "sh", bash: "sh", zsh: "sh", ps1: "sh", rb: "ruby",
  yml: "yaml", yaml: "yaml", toml: "toml", ini: "toml", cfg: "toml", json: "json", jsonc: "json",
  css: "css", scss: "css", less: "css", html: "html", htm: "html", xml: "html", svg: "html",
  md: "md", markdown: "md",
};

/** Text of an extension badge: `ts`, `rs`, `md` …, at most three letters. */
export function extensionOf(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase().slice(0, 4) : "";
}

export function baseName(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, "");
  return cleaned.slice(Math.max(cleaned.lastIndexOf("\\"), cleaned.lastIndexOf("/")) + 1);
}

export function languageOf(path: string): Lang | null {
  return LANGS[BY_EXT[extensionOf(path)] ?? ""] ?? null;
}

// ── Tokens ────────────────────────────────────────────────────────────────────

const NUMBER = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)[A-Za-z]*/;
const IDENT = /^[A-Za-z_$][\w$]*/;
const CHAR = /^'(?:\\.[^']*|[^'\\\n])'/;

/** Where a string that began at `i` ends (past its closing quote); `lines` lets it run on. */
function endOfString(text: string, i: number, quote: string, multi: boolean): number {
  let j = i + quote.length;
  while (j < text.length) {
    const c = text[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (text.startsWith(quote, j)) return j + quote.length;
    if (c === "\n" && !multi) return j;
    j++;
  }
  return text.length;
}

function push(out: Tok[], cls: TokClass, text: string) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last[0] === cls && cls === "") last[1] += text;
  else out.push([cls, text]);
}

function markup(text: string, lang: Lang): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      const stop = end < 0 ? text.length : end + 3;
      push(out, "com", text.slice(i, stop));
      i = stop;
      continue;
    }
    const open = /^<\/?[A-Za-z!?][\w:.-]*/.exec(text.slice(i, i + 80));
    if (!open) {
      const next = text.indexOf("<", i + 1);
      const stop = next < 0 ? text.length : next;
      push(out, "", text.slice(i, stop));
      i = stop;
      continue;
    }
    push(out, "tag", open[0]);
    i += open[0].length;
    // The attributes, up to the closing `>`.
    while (i < text.length && text[i] !== ">") {
      const c = text[i];
      if (lang.quotes.includes(c)) {
        const stop = endOfString(text, i, c, true);
        push(out, "str", text.slice(i, stop));
        i = stop;
        continue;
      }
      const attr = /^[A-Za-z_:@#.][\w:.@#-]*/.exec(text.slice(i, i + 80));
      if (attr) {
        push(out, "attr", attr[0]);
        i += attr[0].length;
        continue;
      }
      push(out, "", c);
      i++;
    }
    if (i < text.length) {
      push(out, "tag", ">");
      i++;
    }
  }
  return out;
}

function markdown(text: string): Tok[] {
  const out: Tok[] = [];
  const lines = text.split("\n");
  let fenced = false;
  lines.forEach((line, n) => {
    const nl = n < lines.length - 1 ? "\n" : "";
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      push(out, "com", line + nl);
    } else if (fenced) {
      push(out, "str", line + nl);
    } else if (/^#{1,6}\s/.test(line)) {
      push(out, "kw", line + nl);
    } else {
      const m = /^(\s*(?:[-*+]|\d+\.)\s)(.*)$/.exec(line);
      if (m) push(out, "num", m[1]);
      const rest = m ? m[2] : line;
      let last = 0;
      for (const span of rest.matchAll(/`[^`\n]+`/g)) {
        push(out, "", rest.slice(last, span.index));
        push(out, "str", span[0]);
        last = span.index! + span[0].length;
      }
      push(out, "", rest.slice(last) + nl);
    }
  });
  return out;
}

export function tokenize(text: string, lang: Lang | null): Tok[] {
  if (!lang) return [["", text]];
  if (lang.markup) return markup(text, lang);
  if (lang.md) return markdown(text);
  const out: Tok[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const rest = text.slice(i, i + 3);
    const c = text[i];
    const lineMark = lang.line.find((m) => text.startsWith(m, i));
    if (lineMark) {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? n : end;
      push(out, "com", text.slice(i, stop));
      i = stop;
      continue;
    }
    if (lang.block && text.startsWith(lang.block[0], i)) {
      const end = text.indexOf(lang.block[1], i + lang.block[0].length);
      const stop = end < 0 ? n : end + lang.block[1].length;
      push(out, "com", text.slice(i, stop));
      i = stop;
      continue;
    }
    if (lang.quotes.includes(c)) {
      const triple = lang.id === "py" && rest === c.repeat(3);
      const isChar = c === "'" && lang.charQuote;
      if (isChar) {
        const m = CHAR.exec(text.slice(i, i + 12));
        if (!m) {
          push(out, "", c);
          i++;
          continue;
        }
        push(out, "str", m[0]);
        i += m[0].length;
        continue;
      }
      const quote = triple ? c.repeat(3) : c;
      const stop = endOfString(text, i, quote, triple || c === "`");
      const body = text.slice(i, stop);
      const key = lang.keys && /^\s*:/.test(text.slice(stop, stop + 12));
      push(out, key ? "prop" : "str", body);
      i = stop;
      continue;
    }
    if (/\d/.test(c) || (c === "." && /\d/.test(text[i + 1] ?? ""))) {
      const m = NUMBER.exec(text.slice(i, i + 40));
      if (m) {
        push(out, "num", m[0]);
        i += m[0].length;
        continue;
      }
    }
    if (lang.css && (c === "#" || c === "@" || c === "-" || /[A-Za-z]/.test(c))) {
      const m = /^(?:#[\da-fA-F]{3,8}\b|@[\w-]+|-?-?[A-Za-z][\w-]*)/.exec(text.slice(i, i + 80));
      if (m) {
        const word = m[0];
        const after = /^\s*:/.test(text.slice(i + word.length, i + word.length + 6));
        const cls: TokClass = word[0] === "#" ? "num" : word[0] === "@" ? "kw" : after ? "prop" : "";
        push(out, cls, word);
        i += word.length;
        continue;
      }
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = IDENT.exec(text.slice(i, i + 80))!;
      const word = m[0];
      const after = text.slice(i + word.length, i + word.length + 40);
      let cls: TokClass = "";
      if (lang.kw.has(word)) cls = "kw";
      else if (lang.keys && /^\s*:/.test(after)) cls = "prop";
      else if (/^\s*[(!]/.test(after) && !(lang.id === "sh")) cls = "fn";
      else if (lang.types && /^[A-Z]/.test(word) && /[a-z]/.test(word)) cls = "type";
      push(out, cls, word);
      i += word.length;
      continue;
    }
    push(out, "", c);
    i++;
  }
  return out;
}

/** The tokens cut into lines: `result[n]` holds line n + 1. A token spanning lines is cut at each. */
export function highlight(text: string, lang: Lang | null): Tok[][] {
  const lines: Tok[][] = [[]];
  for (const [cls, body] of tokenize(text, lang)) {
    const parts = body.split("\n");
    parts.forEach((part, k) => {
      if (k > 0) lines.push([]);
      if (part) lines[lines.length - 1].push([cls, part]);
    });
  }
  return lines;
}

/** The lines of a text as the editor numbers them: a final newline does not start a line. */
export function splitLines(text: string): string[] {
  const parts = text.split("\n");
  if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

// ── Lines the agent changed ───────────────────────────────────────────────────

/**
 * The 1-based lines of `text` that hold the lines an agent's edits added. Each run is what one edit
 * added, as consecutive lines; it is looked for as a whole (ignoring trailing spaces), newest edit
 * first, and only where no newer edit has claimed the lines already. A run the file no longer
 * holds (the user, or a later edit, changed it) marks nothing.
 */
export function changedLines(text: string, runs: string[][]): Set<number> {
  const lines = splitLines(text).map((l) => l.trimEnd());
  const marked = new Set<number>();
  for (let r = runs.length - 1; r >= 0; r--) {
    const run = runs[r].map((l) => l.trimEnd());
    // A run of blank lines says nothing about where it was.
    if (run.length === 0 || run.every((l) => l === "")) continue;
    for (let i = 0; i + run.length <= lines.length; i++) {
      let same = true;
      for (let k = 0; k < run.length && same; k++) same = lines[i + k] === run[k];
      if (!same) continue;
      for (let k = 0; k < run.length; k++) marked.add(i + k + 1);
      break;
    }
  }
  return marked;
}

/** The first of the marked lines, to scroll to: the agent's latest edit is the one run found last. */
export function firstMarked(marked: Set<number>): number {
  let min = 0;
  for (const n of marked) if (min === 0 || n < min) min = n;
  return min;
}

/** The runs of added lines in a diff's hunks: what one edit put into the file. */
export function addedRuns(hunks: { lines: { kind: string; text: string }[] }[]): string[][] {
  const runs: string[][] = [];
  for (const hunk of hunks) {
    let run: string[] = [];
    for (const l of hunk.lines) {
      if (l.kind === "added") run.push(l.text);
      else if (run.length) {
        runs.push(run);
        run = [];
      }
    }
    if (run.length) runs.push(run);
  }
  return runs;
}

// ── The window's words for what Rust refused ──────────────────────────────────

export type CodeErrorKey = "outside" | "secret" | "missing" | "big" | "binary" | "conflict" | "mixed" | "readonly" | "write";

export function codeErrorKey(err: unknown): CodeErrorKey {
  const known: CodeErrorKey[] = ["outside", "secret", "missing", "big", "binary", "conflict", "mixed", "readonly", "write"];
  return known.find((k) => k === err) ?? "write";
}
