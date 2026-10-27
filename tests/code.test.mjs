// The code window's logic: which language a file is, the highlighter, and which lines of the file
// the agent's edits added.

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  addedRuns, baseName, changedLines, codeErrorKey, extensionOf, firstMarked, highlight, languageOf, splitLines, tokenize,
} = await import("../src/core/code.ts");

const classes = (src, path) => tokenize(src, languageOf(path)).filter(([c]) => c).map(([c, t]) => `${c}:${t}`);

test("the language comes from the extension, and unknown files stay plain", () => {
  assert.equal(languageOf("C:\\p\\src\\a.ts").id, "js");
  assert.equal(languageOf("/p/lib.rs").id, "rust");
  assert.equal(languageOf("/p/Makefile"), null);
  assert.equal(extensionOf("/p/a.test.TSX"), "tsx");
  assert.equal(extensionOf("/p/.gitignore"), "");
  assert.equal(baseName("C:\\p\\src\\a.ts"), "a.ts");
});

test("TypeScript: keywords, strings, numbers, comments, calls and types", () => {
  const got = classes("const TVA = 0.196; // tax\nexport function total(items: Item[]) { return 'x' }", "a.ts");
  assert.deepEqual(got, [
    "kw:const", "num:0.196", "com:// tax", "kw:export", "kw:function", "fn:total", "type:Item", "kw:return", "str:'x'",
  ]);
});

test("a template string and a block comment run over lines, and are cut per line", () => {
  const lines = highlight("a /* one\ntwo */ b\n`x\ny`", languageOf("a.js"));
  assert.equal(lines.length, 4);
  assert.deepEqual(lines[0].at(-1), ["com", "/* one"]);
  assert.deepEqual(lines[1][0], ["com", "two */"]);
  assert.deepEqual(lines[3][0], ["str", "y`"]);
});

test("Rust: a lifetime is not a character literal, a char is", () => {
  const got = classes("fn f<'a>(x: &'a str) -> char { 'z' }", "a.rs");
  assert.ok(got.includes("str:'z'"));
  assert.ok(!got.some((c) => c.startsWith("str:'a")));
  assert.ok(got.includes("kw:fn"));
});

test("Python and shell: # comments, triple quotes", () => {
  assert.deepEqual(classes('x = """a\nb"""  # c', "a.py"), ['str:"""a\nb"""', "com:# c"]);
  assert.deepEqual(classes("echo hi # note", "a.sh"), ["kw:echo", "com:# note"]);
});

test("JSON keys are not strings, HTML has tags and attributes, CSS has properties", () => {
  assert.deepEqual(classes('{"a": "b", "n": 1}', "a.json"), ["prop:\"a\"", 'str:"b"', 'prop:"n"', "num:1"]);
  assert.deepEqual(classes('<a href="x">hi</a>', "a.html"), ["tag:<a", "attr:href", 'str:"x"', "tag:>", "tag:</a", "tag:>"]);
  assert.deepEqual(classes("a { color: #fff; }", "a.css"), ["prop:color", "num:#fff"]);
});

test("Markdown: headings, list marks and code spans", () => {
  assert.deepEqual(classes("# T\n- use `x`", "a.md"), ["kw:# T\n", "num:- ", "str:`x`"]);
});

test("highlighting never loses a character", () => {
  const src = "let s = 'it\\'s'; // ü ✓\n\n\tif (a) {\n}\n";
  const lines = highlight(src, languageOf("a.ts"));
  assert.equal(lines.map((l) => l.map(([, t]) => t).join("")).join("\n"), src);
  const odd = "'unterminated\n\"also\n/* open";
  assert.equal(highlight(odd, languageOf("a.js")).map((l) => l.map(([, t]) => t).join("")).join("\n"), odd);
});

test("a final newline does not make a line", () => {
  assert.deepEqual(splitLines("a\nb\n"), ["a", "b"]);
  assert.deepEqual(splitLines("a\n\n"), ["a", ""]);
  assert.deepEqual(splitLines(""), [""]);
});

test("the lines an edit added are found in the file, newest edit first", () => {
  const text = ["import x", "", "const TVA = 0.196;", "export function total() {", "  return 1;", "}", ""].join("\n");
  const marked = changedLines(text, [["const TVA = 0.196;"], ["export function total() {", "  return 1;   "]]);
  assert.deepEqual([...marked].sort(), [3, 4, 5]);
  assert.equal(firstMarked(marked), 3);
  // Lines the file no longer holds mark nothing; blank runs say nothing.
  assert.equal(changedLines(text, [["gone"], ["", ""], []]).size, 0);
  assert.equal(firstMarked(new Set()), 0);
});

test("the runs of added lines come from the diff's hunks", () => {
  const runs = addedRuns([
    { lines: [{ kind: "context", text: "a" }, { kind: "added", text: "b" }, { kind: "added", text: "c" }, { kind: "removed", text: "d" }, { kind: "added", text: "e" }] },
    { lines: [{ kind: "added", text: "f" }] },
  ]);
  assert.deepEqual(runs, [["b", "c"], ["e"], ["f"]]);
});

test("what Rust refuses is a known code, anything else is a failed save", () => {
  assert.equal(codeErrorKey("secret"), "secret");
  assert.equal(codeErrorKey("conflict"), "conflict");
  assert.equal(codeErrorKey(new Error("x")), "write");
  assert.equal(codeErrorKey(undefined), "write");
});
