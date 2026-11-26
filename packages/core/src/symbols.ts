// Identifier-exact symbol lookup. A regex per language lists every definition with its file and line span;
// a message that names one of them exactly gets a proven path:line. One definition brings its whole block,
// two or three bring pointers only, and more than that, or none, bring nothing. No fuzzy matching: a
// misspelled name gets nothing rather than a near miss.
// shortcut: regexes, not tree-sitter tags. Good enough for formatted TS/JS, Python and Go; swap for tag
// queries once a grammar is worth shipping.

import { estimateTokens } from "./text.ts";

export type SymbolKind = "function" | "method" | "class" | "interface" | "type" | "enum" | "const";

export interface SymbolDef {
  name: string;
  kind: SymbolKind;
  path: string;
  /** 1-based line of the definition itself. */
  line: number;
  /** 1-based last line of the definition's block. */
  endLine: number;
  /** 1-based first line of the comments or decorators sitting right above it. */
  startLine: number;
  /** The class or receiver type a method belongs to. */
  container?: string;
}

export interface SourceFile {
  path: string;
  text: string;
}

export interface SymbolBudget {
  /** A block longer than this goes in as a pointer only. */
  blockTokens: number;
  /** Ceiling on the whole symbol section. */
  packetTokens: number;
  /** What one definition brings: its whole block (default), or its signature alone, for the packet's short Code section. */
  shape?: "block" | "signature";
}

export interface SymbolItem {
  def: SymbolDef;
  /** The whole block, when one definition matched and it fit. Absent for a pointer. */
  block?: string;
  /** The signature lines, when one definition matched in signature shape. */
  signature?: string;
}

export interface SymbolLookup {
  items: SymbolItem[];
  /** What goes in the packet; "" when nothing matched cleanly. */
  text: string;
  tokens: number;
}

/** Most definitions one name may have before it counts as too common to point at. */
const MAX_POINTERS = 3;
/** Most distinct names one message resolves. */
const MAX_NAMES = 3;
/** A signature longer than this is cut; the path:line still says where the rest is. */
const SIGNATURE_LINES = 4;
/** A block scan gives up after this many lines and takes the definition line alone. */
const MAX_BLOCK_LINES = 600;

export class SymbolIndex {
  private byName = new Map<string, SymbolDef[]>();
  private lines = new Map<string, string[]>();

  constructor(files: SourceFile[]) {
    for (const f of files) this.add(f);
  }

  add(file: SourceFile): void {
    const lines = file.text.split("\n");
    this.lines.set(file.path, lines);
    for (const def of indexSource(file.path, file.text)) {
      const list = this.byName.get(def.name) ?? [];
      list.push(def);
      this.byName.set(def.name, list);
    }
  }

  /** Exact, case-sensitive. */
  lookup(name: string): SymbolDef[] {
    return this.byName.get(name) ?? [];
  }

  /** The definition's lines, comments above it included. */
  block(def: SymbolDef): string {
    return (this.lines.get(def.path) ?? []).slice(def.startLine - 1, def.endLine).join("\n");
  }

  /** The definition's own opening lines, up to where its body starts or its statement ends. */
  signature(def: SymbolDef): string {
    const lines = this.lines.get(def.path) ?? [];
    const out: string[] = [];
    for (let i = def.line - 1; i < def.endLine && out.length < SIGNATURE_LINES; i++) {
      out.push(lines[i]!);
      if (/(?:[{:;]|=>)\s*$/.test(lines[i]!.replace(/\s\/\/.*$/, ""))) break;
    }
    return out.join("\n");
  }

  get size(): number {
    let n = 0;
    for (const list of this.byName.values()) n += list.length;
    return n;
  }
}

// ---------- indexing ----------

const LANGS: Record<string, "ts" | "py" | "go"> = {
  ts: "ts", tsx: "ts", mts: "ts", cts: "ts", js: "ts", jsx: "ts", mjs: "ts", cjs: "ts",
  py: "py",
  go: "go",
};

export function languageOf(path: string): "ts" | "py" | "go" | undefined {
  return LANGS[path.slice(path.lastIndexOf(".") + 1).toLowerCase()];
}

export function indexSource(path: string, text: string): SymbolDef[] {
  const lang = languageOf(path);
  if (!lang) return [];
  const lines = text.split("\n");
  const defs = lang === "py" ? indexPython(path, lines) : indexBraced(path, lines, lang);
  for (const d of defs) d.startLine = leadingComments(lines, d.line - 1, lang) + 1;
  return defs;
}

const TS_DECL: [RegExp, SymbolKind][] = [
  [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, "function"],
  [/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, "class"],
  [/^\s*(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/, "interface"],
  [/^\s*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*>)?\s*=/, "type"],
  [/^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, "enum"],
];
const TS_TOP_VAR = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=(.*)$/;
const TS_ARROW = /^\s*(?:async\s+)?(?:function\b|\([^]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>|<)/;
const TS_MEMBER = /^(\s+)(?:(?:public|private|protected|static|async|readonly|override|abstract|get|set)\s+)*\*?(#?[A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*(\(|=\s*(?:async\s+)?\()/;
const NOT_MEMBERS = new Set(["if", "for", "while", "switch", "catch", "return", "function", "new", "super", "await", "typeof", "do", "else", "try", "throw", "yield", "delete", "void"]);
const GO_DECL: [RegExp, SymbolKind][] = [
  [/^func\s+\(\s*\w*\s*\*?\s*([A-Za-z_]\w*)[^)]*\)\s*([A-Za-z_]\w*)/, "method"],
  [/^func\s+([A-Za-z_]\w*)/, "function"],
  [/^type\s+([A-Za-z_]\w*)\s+interface\b/, "interface"],
  [/^type\s+([A-Za-z_]\w*)\s/, "type"],
  [/^(?:var|const)\s+([A-Za-z_]\w*)\s/, "const"],
];

function indexBraced(path: string, lines: string[], lang: "ts" | "go"): SymbolDef[] {
  const defs: SymbolDef[] = [];
  const def = (name: string, kind: SymbolKind, i: number, container?: string): SymbolDef => {
    const d: SymbolDef = { name, kind, path, line: i + 1, endLine: blockEnd(lines, i, lang) + 1, startLine: i + 1 };
    if (container) d.container = container;
    defs.push(d);
    return d;
  };
  let comment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (lang === "go") {
      for (const [re, kind] of GO_DECL) {
        const m = line.match(re);
        if (!m) continue;
        if (kind === "method") def(m[2]!, kind, i, m[1]);
        else def(m[1]!, kind, i);
        break;
      }
      continue;
    }
    // Only a top-level statement defines anything here (class members come from classMembers). Each statement's own
    // lines are skipped, so a function inside a function body, or code inside a template string, is no definition.
    if (comment) {
      if (line.includes("*/")) comment = false;
      continue;
    }
    const t = line.trim();
    if (!t || t.startsWith("//")) continue;
    if (t.startsWith("/*")) {
      comment = !t.includes("*/", 2);
      continue;
    }
    let end: number | undefined;
    for (const [re, kind] of TS_DECL) {
      const m = line.match(re);
      if (!m) continue;
      const d = def(m[1]!, kind, i);
      if (kind === "class") defs.push(...classMembers(path, lines, d, lang));
      end = d.endLine - 1;
      break;
    }
    const v = end === undefined ? line.match(TS_TOP_VAR) : null;
    // `const scan = require("./scan")` binds a name defined elsewhere.
    if (v && !/^\s*require\s*\(/.test(v[2]!)) end = def(v[1]!, TS_ARROW.test(v[2]!) ? "function" : "const", i).endLine - 1;
    i = Math.max(i, end ?? blockEnd(lines, i, lang));
  }
  return defs;
}

/** Methods sit at the indent of the class body's first member line; anything deeper is inside a method. */
function classMembers(path: string, lines: string[], cls: SymbolDef, lang: "ts" | "go"): SymbolDef[] {
  const out: SymbolDef[] = [];
  let indent: number | undefined;
  for (let i = cls.line; i < cls.endLine - 1; i++) {
    const line = lines[i]!;
    if (!line.trim() || /^\s*(\/\/|\/\*|\*)/.test(line)) continue;
    const here = line.length - line.trimStart().length;
    indent ??= here;
    if (here !== indent) continue;
    const m = line.match(TS_MEMBER);
    if (!m || NOT_MEMBERS.has(m[2]!)) continue;
    out.push({ name: m[2]!, kind: "method", path, line: i + 1, endLine: blockEnd(lines, i, lang) + 1, startLine: i + 1, container: cls.name });
  }
  return out;
}

const PY_DEF = /^(\s*)(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/;

function indexPython(path: string, lines: string[]): SymbolDef[] {
  const defs: SymbolDef[] = [];
  const classes: { name: string; indent: number; end: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(PY_DEF);
    if (!m) continue;
    const indent = m[1]!.length;
    const end = pythonEnd(lines, i, indent);
    const owner = [...classes].reverse().find((c) => c.indent < indent && i <= c.end);
    const kind: SymbolKind = m[2] === "class" ? "class" : owner ? "method" : "function";
    const d: SymbolDef = { name: m[3]!, kind, path, line: i + 1, endLine: end + 1, startLine: i + 1 };
    if (kind === "method") d.container = owner!.name;
    defs.push(d);
    if (kind === "class") classes.push({ name: d.name, indent, end });
  }
  return defs;
}

/** The signature may span lines; after it, the body is every line indented deeper than the def. */
function pythonEnd(lines: string[], start: number, indent: number): number {
  let i = start;
  let depth = 0;
  for (; i < lines.length && i < start + MAX_BLOCK_LINES; i++) {
    for (const ch of lines[i]!.replace(/#.*$/, "")) {
      if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) depth--;
    }
    if (depth <= 0 && /:\s*(#.*)?$/.test(lines[i]!)) break;
  }
  let end = i;
  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j]!;
    if (!line.trim()) continue;
    if (line.length - line.trimStart().length <= indent) break;
    end = j;
  }
  return end;
}

const CONTINUES_AFTER = /(?:[=,(\[{<|&+\-*/?:.]|=>|\bextends|\bimplements)\s*$/;
const CONTINUES_BEFORE = /^\s*(?:[.?:|&{]|=>|extends\b|implements\b)/;

/**
 * Last line (0-based) of the statement starting at `start`: where brackets balance after a closing brace,
 * at a semicolon outside brackets, or at a line end that doesn't continue. Strings, comments, template
 * literals and regex literals are skipped so their brackets don't count.
 */
function blockEnd(lines: string[], start: number, lang: "ts" | "go"): number {
  let depth = 0;
  let mode: "code" | "block" | "sq" | "dq" | "tpl" | "re" | "reClass" = "code";
  const templates: number[] = [];
  let prev = ""; // last significant code character
  let word = ""; // last word in code, for `return /re/`
  let gap = false; // whitespace since `prev`
  for (let i = start; i < lines.length && i < start + MAX_BLOCK_LINES; i++) {
    const line = lines[i]!;
    let closedToZero = false;
    for (let c = 0; c < line.length; c++) {
      const ch = line[c]!;
      const next = line[c + 1];
      if (mode === "block") {
        if (ch === "*" && next === "/") { mode = "code"; c++; }
        continue;
      }
      if (mode === "sq" || mode === "dq") {
        if (ch === "\\") c++;
        else if ((ch === "'" && mode === "sq") || (ch === '"' && mode === "dq")) { mode = "code"; prev = ch; }
        continue;
      }
      if (mode === "tpl") {
        if (ch === "\\") c++;
        else if (ch === "`") { mode = "code"; prev = ch; }
        else if (ch === "$" && next === "{" && lang === "ts") { templates.push(depth); depth++; c++; mode = "code"; prev = "{"; }
        continue;
      }
      if (mode === "re" || mode === "reClass") {
        if (ch === "\\") c++;
        else if (mode === "re" && ch === "[") mode = "reClass";
        else if (mode === "reClass" && ch === "]") mode = "re";
        else if (mode === "re" && ch === "/") { mode = "code"; prev = "/"; word = ""; }
        continue;
      }
      if (ch === "/" && next === "/") break;
      if (ch === "/" && next === "*") { mode = "block"; c++; continue; }
      if (ch === "'") { mode = "sq"; continue; }
      if (ch === '"') { mode = "dq"; continue; }
      if (ch === "`") { mode = "tpl"; continue; }
      if (ch === "/" && lang === "ts" && regexAllowed(prev, word)) { mode = "re"; continue; }
      if (/\s/.test(ch)) { gap = true; continue; }
      if (/[\w$]/.test(ch)) {
        word = /[\w$]/.test(prev) && !gap ? word + ch : ch;
        prev = ch;
        gap = false;
        continue;
      }
      word = "";
      prev = ch;
      gap = false;
      if (ch === "{" || ch === "(" || ch === "[") depth++;
      else if (ch === "}" || ch === ")" || ch === "]") {
        depth--;
        if (ch === "}" && templates.length && depth === templates[templates.length - 1]) {
          templates.pop();
          mode = "tpl";
          continue;
        }
        if (ch === "}" && depth <= 0) closedToZero = true;
      } else if (ch === ";" && depth <= 0) return i;
    }
    gap = true;
    if (mode === "code" && depth <= 0) {
      const nextLine = lines.slice(i + 1).find((l) => l.trim());
      if (closedToZero && !(nextLine && CONTINUES_BEFORE.test(nextLine) && !/^\s*\{/.test(nextLine))) return i;
      const code = line.replace(/\/\/.*$/, "");
      if (!closedToZero && !CONTINUES_AFTER.test(code) && !(nextLine && CONTINUES_BEFORE.test(nextLine))) return i;
    }
  }
  return start;
}

function regexAllowed(prev: string, word: string): boolean {
  if (/[\w$]/.test(prev)) return /^(?:return|typeof|case|in|of|delete|void|throw|new|yield|await)$/.test(word);
  return prev === "" || "(,=:[!&|?{};+-*%<>~^".includes(prev);
}

/** Index of the first line of the comment or decorator run directly above line `i`. */
function leadingComments(lines: string[], i: number, lang: "ts" | "py" | "go"): number {
  const comment = lang === "py" ? /^\s*(#|@)/ : /^\s*(\/\/|\/\*|\*|@)/;
  let j = i;
  while (j > 0 && comment.test(lines[j - 1]!)) j--;
  return j;
}

// ---------- reading identifiers out of a message ----------

export interface NamedIdentifier {
  name: string;
  /** For `Bm25.search`, "Bm25". */
  qualifier?: string;
  /** The first segment of a dotted name, tried when the qualified lookup finds nothing. */
  head?: string;
  /** A kind word right next to it: "the Profile interface". */
  kind?: SymbolKind[];
  /** Let in only by call parens ("add()"): a bare call can't name a method, which is called on something. */
  bareCall?: boolean;
}

const KIND_WORDS: Record<string, SymbolKind[]> = {
  function: ["function", "method"], func: ["function", "method"], def: ["function", "method"],
  method: ["method", "function"], class: ["class"], interface: ["interface"], type: ["type", "interface", "enum"],
  enum: ["enum"], const: ["const"], constant: ["const"], struct: ["type"],
};

// Words that name code but are ordinary English too; a kind word next to them is not enough.
const SKIP = new Set(
  `a an the and or but if then so of to in on at by for with from up down out over under about into onto is are was were be been
  being am do does did have has had can could should would will shall may might must i me my you your we us our he him his she her
  it its they them their this that these those there here what which who whom whose when where why how all any both each few more
  most other some such no nor not only own same than too very just also as new old one two this that same main data value thing
  stuff code file line function class interface type method const constant enum struct def func`
    .split(/\s+/)
    .filter(Boolean),
);

const FILE_EXT = /\.(?:[cm]?[jt]sx?|json|md|py|go|rs|html?|css|txt|sh|ya?ml|toml|lock|svg|png|com|org|net|io|ai|dev|app)$/i;
const IDENT = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
const TOKEN = /(?<![\w$./\\-])[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?![\w$/\\-])(\s*\()?/g;

/** Looks like code, not a word: camelCase, snake_case, PascalCase with two humps, or a $ in it. */
export function identifierShaped(token: string): boolean {
  if (token.length < 3) return false;
  return /[a-z0-9][A-Z]/.test(token) || /[A-Za-z0-9]_[A-Za-z0-9]/.test(token) || /\$/.test(token) || /^_+[A-Za-z]/.test(token);
}

export function identifiersIn(message: string): NamedIdentifier[] {
  const out: NamedIdentifier[] = [];
  const seen = new Set<string>();
  const push = (raw: string, kind?: SymbolKind[], bareCall = false) => {
    const parts = raw.split(".");
    const id: NamedIdentifier = { name: parts[parts.length - 1]! };
    if (parts.length > 1) {
      id.qualifier = parts[parts.length - 2];
      id.head = parts[0];
    }
    if (kind) id.kind = kind;
    if (bareCall) id.bareCall = true;
    if (seen.has(raw)) return;
    seen.add(raw);
    out.push(id);
  };

  // Backticks are the user saying "this is code", so any identifier inside counts.
  const rest = message.replace(/`([^`\n]+)`/g, (_, inner: string) => {
    const t = inner.trim().replace(/\(.*\)$/, "").replace(/^(?:function|class|interface|type|const|def|func)\s+/, "");
    if (IDENT.test(t) && !FILE_EXT.test(t) && !SKIP.has(t)) push(t);
    return " ";
  });

  const words = [...rest.matchAll(TOKEN)];
  for (let w = 0; w < words.length; w++) {
    const m = words[w]!;
    const token = m[0].replace(/\s*\($/, "");
    if (FILE_EXT.test(token)) continue;
    const call = Boolean(m[1]);
    const parts = token.split(".");
    const prevWord = words[w - 1]?.[0].toLowerCase();
    const nextWord = words[w + 1]?.[0].toLowerCase();
    const before = words[w - 1];
    const after = words[w + 1];
    const kind =
      (prevWord && before && adjacent(rest, before, m) ? KIND_WORDS[prevWord] : undefined) ??
      (nextWord && after && adjacent(rest, m, after) ? KIND_WORDS[nextWord] : undefined);
    if (parts.length > 1) {
      // Dotted: accepted when a part looks like code, or the head is SHOUTED like a constant.
      if (parts.some(identifierShaped) || /^[A-Z][A-Z0-9_]{2,}$/.test(parts[0]!) || /^[A-Z]\w*[a-z]\w*$/.test(parts[0]!)) push(token);
      continue;
    }
    if (SKIP.has(token.toLowerCase())) continue;
    const shaped = identifierShaped(token) || /^[A-Za-z]{2,}\d/.test(token);
    if (shaped || (call && token.length >= 3)) push(token, kind, !shaped && !kind);
    else if (kind && token.length >= 3) push(token, kind);
  }
  return out;
}

/** True when only spaces separate the two tokens, so "the Profile interface" counts and "Profile. Interface" doesn't. */
function adjacent(text: string, a: RegExpMatchArray, b: RegExpMatchArray): boolean {
  return /^\s+$/.test(text.slice(a.index! + a[0].length, b.index!));
}

// ---------- resolving ----------

/** The definitions one named identifier points at, narrowed by a qualifier, a kind word or a file the message names. */
export function definitionsFor(id: NamedIdentifier, index: SymbolIndex, message = ""): SymbolDef[] {
  let defs = index.lookup(id.name);
  if (id.qualifier) {
    const qualified = defs.filter((d) => d.container === id.qualifier);
    if (qualified.length) defs = qualified;
    else defs = id.head ? index.lookup(id.head).filter((d) => d.kind === "const" || d.kind === "class" || d.kind === "enum") : [];
  }
  if (id.bareCall) defs = defs.filter((d) => d.kind !== "method");
  // "the question type" names a type; a question() function is not it.
  if (id.kind) defs = defs.filter((d) => id.kind!.includes(d.kind));
  if (defs.length > 1) {
    const named = defs.filter((d) => mentionsFile(message, d.path));
    if (named.length) defs = named;
  }
  return defs;
}

function mentionsFile(message: string, path: string): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return new RegExp(`(?<![\\w.-])(?:[\\w./-]*/)?${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(message);
}

/**
 * The symbol section for one message. Per named identifier: one definition brings `path:line` and its whole
 * block (a pointer alone when the block is over budget), two or three bring pointers, more bring nothing.
 */
export function lookupSymbols(message: string, index: SymbolIndex, budget: SymbolBudget): SymbolLookup {
  const items: SymbolItem[] = [];
  const parts: string[] = [];
  let tokens = 0;
  let names = 0;
  const taken = new Set<string>();
  for (const id of identifiersIn(message)) {
    if (names >= MAX_NAMES) break;
    const defs = definitionsFor(id, index, message).filter((d) => !taken.has(where(d)));
    if (defs.length === 0 || defs.length > MAX_POINTERS) continue;
    names++;
    if (defs.length === 1 && budget.shape === "signature") {
      const def = defs[0]!;
      const signature = index.signature(def);
      const rendered = renderSignature(def, signature);
      const cost = estimateTokens(rendered);
      if (tokens + cost > budget.packetTokens) continue;
      items.push({ def, signature });
      parts.push(rendered);
      tokens += cost;
      taken.add(where(def));
      continue;
    }
    if (defs.length === 1) {
      const def = defs[0]!;
      const block = index.block(def);
      const rendered = renderBlock(def, block);
      const cost = estimateTokens(rendered);
      if (estimateTokens(block) <= budget.blockTokens && tokens + cost <= budget.packetTokens) {
        items.push({ def, block });
        parts.push(rendered);
        tokens += cost;
        taken.add(where(def));
        continue;
      }
    }
    const rendered = renderPointers(id.name, defs);
    const cost = estimateTokens(rendered);
    if (tokens + cost > budget.packetTokens) continue;
    for (const def of defs) {
      items.push({ def });
      taken.add(where(def));
    }
    parts.push(rendered);
    tokens += cost;
  }
  const text = parts.join("\n\n");
  return { items, text, tokens: text ? estimateTokens(text) : 0 };
}

const where = (d: SymbolDef) => `${d.path}:${d.line}`;
const label = (d: SymbolDef) => `${d.container ? `${d.container}.` : ""}${d.name}`;

function renderBlock(def: SymbolDef, block: string): string {
  const lang = languageOf(def.path) === "ts" ? "ts" : (languageOf(def.path) ?? "");
  return `${where(def)} (${def.kind} ${label(def)}, lines ${def.startLine}-${def.endLine}):\n\`\`\`${lang}\n${block}\n\`\`\``;
}

function renderSignature(def: SymbolDef, signature: string): string {
  const lang = languageOf(def.path) === "ts" ? "ts" : (languageOf(def.path) ?? "");
  return `${where(def)} (${def.kind} ${label(def)}, lines ${def.line}-${def.endLine}):\n\`\`\`${lang}\n${signature}\n\`\`\``;
}

function renderPointers(name: string, defs: SymbolDef[]): string {
  if (defs.length === 1) return `\`${name}\` is defined at ${where(defs[0]!)} (${defs[0]!.kind} ${label(defs[0]!)}, lines ${defs[0]!.line}-${defs[0]!.endLine}); too long to include.`;
  return `\`${name}\` has ${defs.length} definitions; read the one you need:\n${defs.map((d) => `- ${where(d)} (${d.kind} ${label(d)})`).join("\n")}`;
}
