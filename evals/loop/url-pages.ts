// Scores a URL extractor on evals/sets/url-pages: real saved pages, prompts a user who pasted the URL would send, and
// gold line ranges in each page's frozen canonical rendering (canonical-text.ts). Measurement only; free, no model calls.
// A candidate is (pageHtml, prompt) -> {lineStart, lineEnd} in the canonical rendering, or null to abstain.
// Two baselines show the set's difficulty: the whole page, and BM25 over fixed 15-line windows with a coverage bar.
// Run: node --experimental-strip-types --no-warnings evals/loop/url-pages.ts [--split dev|held-out|all] [--verbose]

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Bm25, contentWords, estimateTokens } from "@long-con/core";
import { canonicalLines } from "./canonical-text.ts";
import { fnv1a } from "./split.ts";

export type Range = { lineStart: number; lineEnd: number };
export type Candidate = (pageHtml: string, prompt: string) => Range | null;
type Span = [number, number];

export interface Page {
  id: string;
  url: string;
  failure: boolean;
}
export interface Prompt {
  id: string;
  page: string;
  kind: "answer" | "abstain-topic" | "abstain-off" | "abstain-failure";
  prompt: string;
  gold: { lines: Span; section: Span } | null;
  sharesRareWord: boolean;
}

const SET = fileURLToPath(new URL("../sets/url-pages/", import.meta.url));
export const loadPages = (): Page[] => JSON.parse(readFileSync(SET + "manifest.json", "utf8")).pages;
export const loadPrompts = (): Prompt[] => JSON.parse(readFileSync(SET + "prompts.json", "utf8")).prompts;
export const pageHtml = (id: string) => readFileSync(`${SET}pages/${id}.html`, "utf8");
export const pageRendering = (id: string) => readFileSync(`${SET}pages/${id}.txt`, "utf8");

/**
 * Split by page, never by prompt. Plain splitOf left 11 of 18 pages held out with 1 failure page, so this stratifies:
 * within failure and content pages, order by FNV-1a of the id and hold out every third, starting with the first.
 */
export function pageSplits(pages: Page[]): Map<string, "dev" | "held-out"> {
  const out = new Map<string, "dev" | "held-out">();
  for (const failure of [false, true]) {
    const group = pages.filter((p) => p.failure === failure).sort((a, b) => fnv1a(a.id) - fnv1a(b.id));
    group.forEach((p, i) => out.set(p.id, i % 3 === 0 ? "held-out" : "dev"));
  }
  return out;
}

/** A word "rare" on this page (in at most 3 canonical lines) that the prompt shares with its gold lines: an easy lexical hit. */
export function sharesRareWord(prompt: string, lines: string[], gold: Span): boolean {
  const asked = new Set(contentWords(prompt));
  const lineWords = lines.map((l) => new Set(contentWords(l)));
  const df = (w: string) => lineWords.reduce((n, s) => n + (s.has(w) ? 1 : 0), 0);
  for (let i = gold[0] - 1; i < gold[1]; i++) for (const w of lineWords[i]!) if (asked.has(w) && df(w) <= 3) return true;
  return false;
}

const overlap = (a: Span, b: Span) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]) + 1);
const iou = (a: Span, b: Span) => overlap(a, b) / (Math.max(a[1], b[1]) - Math.min(a[0], b[0]) + 1);

export interface Score {
  answerable: number;
  /** Candidate's middle line falls in the gold section. */
  sectionHits: number;
  iouSum: number;
  /** Candidate contains every gold line. */
  covered: number;
  answerableEmpty: number;
  hard: number;
  hardHits: number;
  hardIouSum: number;
  abstain: Record<"abstain-topic" | "abstain-off" | "abstain-failure", { n: number; right: number }>;
  returned: number;
  tokens: number;
  prompts: number;
}

export function score(candidate: Candidate, prompts: Prompt[], verbose = false): Score {
  const s: Score = { answerable: 0, sectionHits: 0, iouSum: 0, covered: 0, answerableEmpty: 0, hard: 0, hardHits: 0, hardIouSum: 0, abstain: { "abstain-topic": { n: 0, right: 0 }, "abstain-off": { n: 0, right: 0 }, "abstain-failure": { n: 0, right: 0 } }, returned: 0, tokens: 0, prompts: prompts.length };
  const html = new Map<string, string>();
  for (const p of prompts) {
    if (!html.has(p.page)) html.set(p.page, pageHtml(p.page));
    const lines = pageRendering(p.page).split("\n").slice(0, -1);
    const got = candidate(html.get(p.page)!, p.prompt);
    let span: Span | null = null;
    if (got) {
      span = [Math.max(1, got.lineStart), Math.min(lines.length, got.lineEnd)];
      s.returned++;
      s.tokens += estimateTokens(lines.slice(span[0] - 1, span[1]).join("\n"));
    }
    if (!p.gold) {
      s.abstain[p.kind as keyof Score["abstain"]].n++;
      if (!span) s.abstain[p.kind as keyof Score["abstain"]].right++;
    } else {
      s.answerable++;
      if (!p.sharesRareWord) s.hard++;
      if (!span) s.answerableEmpty++;
      else {
        const mid = Math.floor((span[0] + span[1]) / 2);
        const hit = mid >= p.gold.section[0] && mid <= p.gold.section[1];
        const u = iou(span, p.gold.lines);
        s.sectionHits += +hit;
        s.iouSum += u;
        s.covered += +(overlap(span, p.gold.lines) === p.gold.lines[1] - p.gold.lines[0] + 1);
        if (!p.sharesRareWord) (s.hardHits += +hit), (s.hardIouSum += u);
      }
    }
    if (verbose) console.log(`  ${p.id}: ${span ? `${span[0]}-${span[1]}` : "abstain"} gold ${p.gold ? p.gold.lines.join("-") : "abstain"}`);
  }
  return s;
}

/** Baseline: the whole canonical page, every time. */
export const wholePage: Candidate = (html) => ({ lineStart: 1, lineEnd: canonicalLines(html).length });

/** Baseline: BM25 over fixed 15-line windows; abstain unless the best window holds half the prompt's distinct words. */
export function bm25Windows(size = 15, bar = 0.5): Candidate {
  return (html, prompt) => {
    const lines = canonicalLines(html);
    const index = new Bm25<number>();
    for (let start = 0; start < lines.length; start += size) index.add(start, contentWords(lines.slice(start, start + size).join("\n")));
    const query = contentWords(prompt);
    const best = index.search(query, 1)[0];
    if (!best || best.matched.length / new Set(query).size < bar) return null;
    return { lineStart: best.item + 1, lineEnd: Math.min(lines.length, best.item + size) };
  };
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : "-");
export function report(name: string, s: Score): string {
  const ab = Object.values(s.abstain).reduce((t, x) => ({ n: t.n + x.n, right: t.right + x.right }), { n: 0, right: 0 });
  const kind = (k: keyof Score["abstain"]) => `${s.abstain[k].right}/${s.abstain[k].n}`;
  return [
    `| ${name}`,
    pct(s.sectionHits, s.answerable),
    (s.iouSum / (s.answerable || 1)).toFixed(2),
    pct(s.covered, s.answerable),
    pct(s.answerableEmpty, s.answerable),
    `${pct(s.hardHits, s.hard)} / ${(s.hardIouSum / (s.hard || 1)).toFixed(2)} (n=${s.hard})`,
    `${pct(ab.right, ab.n)} (topic ${kind("abstain-topic")}, off ${kind("abstain-off")}, failure ${kind("abstain-failure")})`,
    s.returned ? Math.round(s.tokens / s.returned).toLocaleString("en-US") : "-",
    `${Math.round(s.tokens / (s.prompts || 1)).toLocaleString("en-US")} |`,
  ].join(" | ");
}

export function main(argv: string[]): number {
  const { values } = parseArgs({ args: argv, options: { split: { type: "string", default: "dev" }, verbose: { type: "boolean", default: false } } });
  const splits = pageSplits(loadPages());
  const prompts = loadPrompts().filter((p) => values.split === "all" || splits.get(p.page) === values.split);
  const pages = new Set(prompts.map((p) => p.page));
  console.log(`url-pages / ${values.split}: ${pages.size} pages, ${prompts.length} prompts (${prompts.filter((p) => p.gold).length} answerable)\n`);
  console.log("| candidate | section hit@1 | line IoU | gold covered | answerable empty | hard: hit / IoU | abstain right | tokens per non-empty | tokens per prompt |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const [name, c] of [["whole canonical page", wholePage], ["BM25 15-line windows, bar 0.5", bm25Windows()]] as const) {
    if (values.verbose) console.log(`${name}:`);
    console.log(report(name, score(c, prompts, values.verbose)));
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
