// Scores identifier-exact symbol lookup on evals/sets/code-pathline: this repo's own source at a pinned commit,
// read straight from git so later edits don't move the labels. Free: no model calls.
// Run: node --experimental-strip-types evals/loop/code-pathline.ts [--split dev|held-out|all] [--verbose]

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { PROFILES } from "../../packages/core/src/profiles.ts";
import { lookupSymbols, languageOf, SymbolIndex, type SymbolBudget, type SourceFile } from "../../packages/core/src/symbols.ts";

interface LabeledPrompt {
  id: string;
  subset: "exact" | "hard";
  prompt: string;
  expect: "block" | "pointers" | "empty";
  /** path:line-endLine, the declaration's span at the pinned commit. */
  at: string[];
}

interface Gold {
  path: string;
  line: number;
  endLine: number;
}

const ROOT = new URL("../..", import.meta.url).pathname;
const SET = JSON.parse(readFileSync(new URL("../sets/code-pathline/prompts.json", import.meta.url), "utf8")) as { commit: string; prompts: LabeledPrompt[] };

// Packet ceilings come from the real profiles. Block caps aren't a profile field yet: claude gets 1500 tokens,
// small-local reuses its unit cap (segmentTokens), since a block is one unit.
const BUDGETS: Record<string, SymbolBudget> = {
  claude: { blockTokens: 1500, packetTokens: PROFILES.claude.packetTokens },
  "small-local": { blockTokens: PROFILES.smallLocal.segmentTokens, packetTokens: PROFILES.smallLocal.packetTokens },
};

/** FNV-1a, so the split is fixed by each prompt's id. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}
export const splitOf = (id: string) => (fnv1a(id) % 3 === 0 ? "held-out" : "dev");

function parseGold(at: string): Gold {
  const m = at.match(/^(.*):(\d+)-(\d+)$/);
  if (!m) throw new Error(`bad label ${at}`);
  return { path: m[1]!, line: Number(m[2]), endLine: Number(m[3]) };
}

/** Line overlap of two inclusive spans, over their union. */
const iou = (a: [number, number], b: [number, number]) =>
  Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]) + 1) / (Math.max(a[1], b[1]) - Math.min(a[0], b[0]) + 1);

function sourcesAt(commit: string): SourceFile[] {
  const git = (...args: string[]) => execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", maxBuffer: 64 << 20 });
  return git("ls-tree", "-r", "--name-only", commit)
    .split("\n")
    .filter((p) => p && languageOf(p) && !p.includes("node_modules/"))
    .map((path) => ({ path, text: git("show", `${commit}:${path}`) }));
}

interface Score {
  prompts: number;
  blockGold: number;
  blockHits: number;
  /** Sum of line IoU between each hit block as quoted (comments above included) and the gold span. */
  blockIou: number;
  pointerOnlyHits: number;
  /** Gold locations (block and pointer prompts) whose file shows up in the packet at all. */
  positiveGold: number;
  fileHits: number;
  quoted: number;
  wrongQuoted: number;
  emptyPrompts: number;
  emptyRight: number;
  pointerPrompts: number;
  pointerExact: number;
  falseInclusions: number;
  tokens: number;
  nonEmpty: number;
}

function score(prompts: LabeledPrompt[], index: SymbolIndex, budget: SymbolBudget, verbose: boolean): Score {
  const s: Score = {
    prompts: 0, blockGold: 0, blockHits: 0, blockIou: 0, pointerOnlyHits: 0, positiveGold: 0, fileHits: 0, quoted: 0, wrongQuoted: 0,
    emptyPrompts: 0, emptyRight: 0, pointerPrompts: 0, pointerExact: 0, falseInclusions: 0, tokens: 0, nonEmpty: 0,
  };
  for (const p of prompts) {
    const out = lookupSymbols(p.prompt, index, budget);
    const golds = p.at.map(parseGold);
    const gold = new Set(golds.map((g) => `${g.path}:${g.line}`));
    const got = out.items.map((i) => ({
      at: `${i.def.path}:${i.def.line}`,
      path: i.def.path,
      body: i.block !== undefined,
      span: [i.def.startLine, i.def.endLine] as [number, number],
    }));
    s.prompts++;
    s.tokens += out.tokens;
    if (got.length) s.nonEmpty++;
    s.falseInclusions += got.filter((g) => !gold.has(g.at)).length;
    for (const g of golds) {
      s.positiveGold++;
      if (got.some((x) => x.path === g.path)) s.fileHits++;
    }
    for (const g of got.filter((g) => g.body)) {
      s.quoted++;
      if (!gold.has(g.at)) s.wrongQuoted++;
    }
    if (p.expect === "block") {
      for (const g of golds) {
        s.blockGold++;
        const hit = got.find((x) => x.at === `${g.path}:${g.line}`);
        if (hit?.body) {
          s.blockHits++;
          s.blockIou += iou(hit.span, [g.line, g.endLine]);
        } else if (hit) s.pointerOnlyHits++;
      }
    } else if (p.expect === "pointers") {
      s.pointerPrompts++;
      if (got.length === gold.size && got.every((g) => gold.has(g.at) && !g.body)) s.pointerExact++;
    } else {
      s.emptyPrompts++;
      if (got.length === 0) s.emptyRight++;
    }
    const ok = p.expect === "empty" ? got.length === 0 : [...gold].every((at) => got.some((g) => g.at === at)) && got.every((g) => gold.has(g.at));
    if (verbose && !ok) console.log(`  MISS ${p.id} (${p.expect}): got ${got.map((g) => `${g.at}${g.body ? "+block" : ""}`).join(", ") || "nothing"}`);
  }
  return s;
}

const rate = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}% (${a}/${b})` : "n/a");

const HEADER = [
  "| profile / split | prompts | block hit | mean block IoU | pointer only (over cap) | file recall | wrong-line | empty right | pointer sets exact | false incl./prompt | mean tokens, non-empty (n) | mean tokens, all |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
].join("\n");

function report(name: string, s: Score): string {
  const meanIou = s.blockHits ? (s.blockIou / s.blockHits).toFixed(3) : "n/a";
  const nonEmpty = s.nonEmpty ? `${Math.round(s.tokens / s.nonEmpty)} (${s.nonEmpty})` : "0 (0)";
  return `| ${name} | ${s.prompts} | ${rate(s.blockHits, s.blockGold)} | ${meanIou} | ${rate(s.pointerOnlyHits, s.blockGold)} | ${rate(s.fileHits, s.positiveGold)} | ${rate(s.wrongQuoted, s.quoted)} | ${rate(s.emptyRight, s.emptyPrompts)} | ${rate(s.pointerExact, s.pointerPrompts)} | ${(s.falseInclusions / s.prompts).toFixed(3)} | ${nonEmpty} | ${Math.round(s.tokens / s.prompts)} |`;
}

function main(): void {
  const { values } = parseArgs({ options: { split: { type: "string", default: "all" }, verbose: { type: "boolean", default: false } } });
  const t0 = performance.now();
  const index = new SymbolIndex(sourcesAt(SET.commit));
  const ms = Math.round(performance.now() - t0);
  const splits = values.split === "all" ? ["dev", "held-out"] : [values.split!];
  console.log(`code-pathline at ${SET.commit.slice(0, 7)}: ${index.size} definitions indexed in ${ms} ms`);
  for (const subset of ["exact", "hard"] as const) {
    console.log(`\n${subset === "exact" ? "Exact-name prompts (checks the spec is implemented)" : "Harder prompts (written before any run)"}:\n`);
    console.log(HEADER);
    for (const [profile, budget] of Object.entries(BUDGETS)) {
      for (const split of splits) {
        const prompts = SET.prompts.filter((p) => p.subset === subset && splitOf(p.id) === split);
        if (values.verbose) console.log(`${profile} / ${split}:`);
        console.log(report(`${profile} / ${split}`, score(prompts, index, budget, values.verbose!)));
      }
    }
  }
}

main();
