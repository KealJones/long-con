// A pasted URL as a packet entry: the page's readable text, one block per line, and the line range that answers the
// message, or nothing. No DOM and no dependency: a tag scan finds landmarks the way a screen reader does (Squiggle's
// contentRoot and dropChrome), and section picking is BM25 over heading sections with the title and heading path as
// prefix, narrowed to a short window. It abstains on failure pages and whenever the best window misses the bar.

import { Bm25 } from "./bm25.ts";
import { contentWords, type Stemmer } from "./text.ts";

export interface PageLine {
  text: string;
  /** Heading level 1-6 for a real <h1>-<h6>, else 0. Text keeps the "#" prefix either way. */
  heading: number;
}

export interface ReadPage {
  title: string;
  lines: PageLine[];
  /** Why the page is not content (HTTP status, too little text, a script-only shell); absent for a readable page. */
  failure?: string;
}

export interface PageRange {
  /** 1-based, inclusive, into ReadPage.lines. */
  start: number;
  end: number;
  /** Heading path of the section the range sits in. */
  path: string[];
  /** Share of the message's word weight the range holds (0-1). */
  coverage: number;
}

export interface PickOptions {
  /** Lines in the sliding window (the survey's 8-20 band). */
  window?: number;
  /** Fewest lines a range is trimmed down to. */
  floor?: number;
  /** Least share of the message's IDF weight the window must hold. */
  bar?: number;
  stemmer?: Stemmer;
}

const NEVER_TEXT = /<!--[\s\S]*?-->|<(script|style|template|svg|noscript)\b[\s\S]*?<\/\1\s*>/gi;
const BLOCK =
  /<\/?(?:address|article|aside|blockquote|br|caption|dd|details|dialog|div|dl|dt|fieldset|figcaption|figure|footer|form|header|hr|li|main|nav|ol|p|pre|section|summary|table|tbody|thead|tfoot|title|tr|ul)\b[^>]*>/gi;
const BLOCK_NAMES = new RegExp(BLOCK.source, "i");
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", copy: "©", reg: "®", trade: "™", times: "×", middot: "·", laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", deg: "°" };
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
/** ARIA roles that are page chrome, not content (HTML-AAM maps nav, aside and top-level header/footer onto these). */
const CHROME_ROLES = new Set(["navigation", "banner", "contentinfo", "complementary", "search", "menu", "menubar", "dialog", "alertdialog", "tooltip"]);
/** A header or footer inside one of these is the section's own, not the page's banner or footer. */
const SECTIONING = new Set(["article", "aside", "main", "nav", "section"]);
/** Below this much readable text the page is an error or a stub, never content. */
const MIN_CHARS = 200;
/** A page that asks for JavaScript in <noscript> and shows less than this without it is a script-only shell. */
const SHELL_CHARS = 500;

const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });

/** HTML to lines: blocks break lines, headings get "#" per level, table cells " | ". */
export function htmlLines(html: string): PageLine[] {
  const text = html
    .replace(NEVER_TEXT, " ")
    .replace(/<h([1-6])\b[^>]*>/gi, (_, n: string) => `\n\u0001${n}${"#".repeat(Number(n))} `)
    .replace(/<\/h[1-6]\s*>/gi, "\n")
    .replace(/<t[dh]\b[^>]*>/gi, " | ")
    .replace(BLOCK, "\n")
    .replace(/<[^>]*>/g, "");
  const out: PageLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const heading = raw.startsWith("\u0001") ? Number(raw[1]) : 0;
    const line = decode(heading ? raw.slice(2) : raw).replace(/\s+/g, " ").trim();
    if (line && !/^#+$/.test(line)) out.push({ text: line, heading });
  }
  return out;
}

interface El {
  name: string;
  attrs: string;
  start: number;
  innerStart: number;
  innerEnd: number;
  end: number;
}

/** Every closed element, matched per tag name. Unclosed <p> and <li> just never match, which is fine for landmarks. */
function elements(html: string): El[] {
  const open = new Map<string, { name: string; attrs: string; start: number; innerStart: number }[]>();
  const out: El[] = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g)) {
    const name = m[2]!.toLowerCase();
    if (VOID.has(name) || m[3]!.endsWith("/")) continue;
    const stack = open.get(name) ?? open.set(name, []).get(name)!;
    if (!m[1]) stack.push({ name, attrs: m[3]!, start: m.index!, innerStart: m.index! + m[0].length });
    else {
      const o = stack.pop();
      if (o) out.push({ ...o, innerEnd: m.index!, end: m.index! + m[0].length });
    }
  }
  return out;
}

const attr = (attrs: string, name: string) => new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
const attrValue = (attrs: string, name: string) => {
  const m = attr(attrs, name);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "").toLowerCase() : undefined;
};
const textLength = (html: string) => decode(html.replace(NEVER_TEXT, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim().length;
const inside = (a: El, b: El) => a.start > b.start && a.end <= b.end;

function isHidden(e: El): boolean {
  if (/(?:^|\s)hidden(?:\s|=|$)/i.test(e.attrs)) return true;
  if (attrValue(e.attrs, "aria-hidden") === "true") return true;
  return /display\s*:\s*none|visibility\s*:\s*hidden/.test(attrValue(e.attrs, "style") ?? "");
}

/** A list of three or more items that are nothing but links: a menu or a table of contents, whatever its classes. */
function isLinkList(e: El, html: string): boolean {
  if (e.name !== "ul" && e.name !== "ol") return false;
  const inner = html.slice(e.innerStart, e.innerEnd);
  if ((inner.match(/<li\b/gi) ?? []).length < 3 || (inner.match(/<a\b/gi) ?? []).length < 3) return false;
  return textLength(inner.replace(/<a\b[\s\S]*?<\/a\s*>/gi, " ")) === 0;
}

/** The readable page: content landmark, minus chrome, hidden nodes and link-only lists; or why it isn't content. */
export function readPage(html: string, status = 200): ReadPage {
  const title = decode(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const clean = html.replace(NEVER_TEXT, (m) => " ".repeat(m.length)); // same offsets, so element positions stay valid
  const els = elements(clean);
  const body = els.find((e) => e.name === "body");
  const total = textLength(body ? clean.slice(body.innerStart, body.innerEnd) : clean) || 1;
  const main = els.find((e) => e.name === "main" || attrValue(e.attrs, "role") === "main");
  const articles = els.filter((e) => e.name === "article");
  let root: El | undefined;
  if (main && textLength(clean.slice(main.innerStart, main.innerEnd)) >= 0.2 * total) root = main;
  else if (articles.length === 1 && textLength(clean.slice(articles[0]!.innerStart, articles[0]!.innerEnd)) >= 0.3 * total) root = articles[0];
  else root = body;
  const [from, to] = root ? [root.innerStart, root.innerEnd] : [0, clean.length];

  const drop: [number, number, string][] = [];
  const headings = els.filter((e) => /^h[1-6]$/.test(e.name));
  for (const e of els) {
    if (e.start < from || e.end > to) continue;
    const role = attrValue(e.attrs, "role");
    const landmark =
      e.name === "nav" || e.name === "aside" || ((e.name === "header" || e.name === "footer") && !els.some((s) => SECTIONING.has(s.name) && inside(e, s) && s !== root));
    if (landmark || (role && CHROME_ROLES.has(role)) || isHidden(e)) drop.push([e.start, e.end, e.name]);
    else if (isLinkList(e, clean)) {
      // The list's own heading goes with it, when nothing but tags sit between them.
      const h = headings.filter((x) => x.end <= e.start && x.start >= from).at(-1);
      drop.push([h && textLength(clean.slice(h.end, e.start)) === 0 ? h.start : e.start, e.end, e.name]);
    }
  }
  drop.sort((a, b) => a[0] - b[0]);
  let kept = "";
  let at = from;
  for (const [a, b, name] of drop) {
    if (b <= at) continue;
    // A dropped block still ends a line; a dropped inline element (an icon, a tooltip) leaves its line whole.
    kept += clean.slice(at, Math.max(at, a)) + (BLOCK_NAMES.test(`<${name}>`) ? "\n" : " ");
    at = Math.max(at, b);
  }
  kept += clean.slice(at, to);
  const lines = htmlLines(kept);

  const chars = lines.reduce((n, l) => n + l.text.length, 0);
  const asksForScript = /<noscript\b[\s\S]*?\S[\s\S]*?<\/noscript\s*>/i.test(html.replace(/<!--[\s\S]*?-->/g, ""));
  const failure =
    status >= 400 ? `HTTP ${status}` : chars < MIN_CHARS ? "too little readable text" : asksForScript && chars < SHELL_CHARS ? "a script-only shell" : undefined;
  return { title, lines, ...(failure ? { failure } : {}) };
}

/**
 * The line range of a read page that answers the message, or null. Sections run heading to heading and are scored by
 * BM25 with the page title and their heading path as prefix. Inside the best section a window slides to the most
 * query weight (IDF over this page's lines; the heading path counts for every window) and must hold the section's
 * rarest query word, the anchor. Nothing comes back unless that weight reaches `bar` of the message's. The window is
 * then trimmed to the lines holding query words, kept at least `floor` lines.
 */
export function pickRange(page: ReadPage, message: string, { window = 16, floor = 8, bar = 0.35, stemmer = "suffix" }: PickOptions = {}): PageRange | null {
  if (page.failure || !page.lines.length) return null;
  const query = [...new Set(contentWords(message.replace(/\bhttps?:\/\/\S+/gi, " "), stemmer))];
  if (!query.length) return null;
  const words = page.lines.map((l) => contentWords(l.text, stemmer));

  const sections: { a: number; b: number; path: string[] }[] = [];
  const open: { level: number; text: string }[] = [];
  const pathNow = () => open.map((p) => p.text);
  let a = 0;
  page.lines.forEach((l, i) => {
    if (!l.heading) return;
    if (i > a) sections.push({ a, b: i - 1, path: pathNow() });
    a = i;
    while (open.length && open.at(-1)!.level >= l.heading) open.pop();
    open.push({ level: l.heading, text: l.text.replace(/^#+ /, "") });
  });
  sections.push({ a, b: page.lines.length - 1, path: pathNow() });

  const titleWords = contentWords(page.title, stemmer);
  const index = new Bm25<number>();
  sections.forEach((s, k) => index.add(k, [...titleWords, ...contentWords(s.path.join(" "), stemmer), ...words.slice(s.a, s.b + 1).flat()]));
  const best = index.search(query, 1)[0];
  if (!best) return null;
  const s = sections[best.item]!;

  // A word on few lines of this page weighs more.
  const lineIndex = new Bm25<number>();
  words.forEach((w, i) => lineIndex.add(i, w));
  const weight = (t: string) => lineIndex.idf(t);
  const totalWeight = query.reduce((n, t) => n + weight(t), 0);
  const headingWords = new Set(contentWords(s.path.join(" "), stemmer));
  const inSection = new Set(words.slice(s.a, s.b + 1).flat());
  const anchor = query.filter((t) => inSection.has(t)).sort((x, y) => weight(y) - weight(x))[0];
  if (!anchor) return null;

  const size = Math.min(window, s.b - s.a + 1);
  let pick = { start: s.a, coverage: -1 };
  for (let start = s.a; start + size - 1 <= s.b; start++) {
    const body = new Set(words.slice(start, start + size).flat());
    if (!body.has(anchor)) continue;
    const coverage = query.reduce((n, t) => n + (body.has(t) || headingWords.has(t) ? weight(t) : 0), 0) / totalWeight;
    if (coverage > pick.coverage) pick = { start, coverage };
  }
  if (pick.coverage < bar) return null;

  // Trim to the lines holding query words, then grow back to the floor inside the window.
  const matched: number[] = [];
  for (let i = pick.start; i < pick.start + size; i++) if (words[i]!.some((t) => query.includes(t))) matched.push(i);
  let lo = matched[0]!;
  let hi = matched.at(-1)!;
  const least = Math.min(floor, size);
  while (hi - lo + 1 < least) {
    if (lo > pick.start) lo--;
    if (hi - lo + 1 < least && hi < pick.start + size - 1) hi++;
  }
  return { start: lo + 1, end: hi + 1, path: s.path, coverage: pick.coverage };
}
