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
  prompt: string;
  expect: "block" | "pointers" | "empty";
  at: string[];
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
  pointerOnlyHits: number;
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
  const s: Score = { prompts: 0, blockGold: 0, blockHits: 0, pointerOnlyHits: 0, quoted: 0, wrongQuoted: 0, emptyPrompts: 0, emptyRight: 0, pointerPrompts: 0, pointerExact: 0, falseInclusions: 0, tokens: 0, nonEmpty: 0 };
  for (const p of prompts) {
    const out = lookupSymbols(p.prompt, index, budget);
    const gold = new Set(p.at);
    const got = out.items.map((i) => ({ at: `${i.def.path}:${i.def.line}`, body: i.block !== undefined }));
    s.prompts++;
    s.tokens += out.tokens;
    if (got.length) s.nonEmpty++;
    s.falseInclusions += got.filter((g) => !gold.has(g.at)).length;
    for (const g of got.filter((g) => g.body)) {
      s.quoted++;
      if (!gold.has(g.at)) s.wrongQuoted++;
    }
    if (p.expect === "block") {
      for (const at of p.at) {
        s.blockGold++;
        const hit = got.find((g) => g.at === at);
        if (hit?.body) s.blockHits++;
        else if (hit) s.pointerOnlyHits++;
      }
    } else if (p.expect === "pointers") {
      s.pointerPrompts++;
      if (got.length === gold.size && got.every((g) => gold.has(g.at) && !g.body)) s.pointerExact++;
    } else {
      s.emptyPrompts++;
      if (got.length === 0) s.emptyRight++;
    }
    const ok = p.expect === "empty" ? got.length === 0 : p.at.every((at) => got.some((g) => g.at === at)) && got.every((g) => gold.has(g.at));
    if (verbose && !ok) console.log(`  MISS ${p.id} (${p.expect}): got ${got.map((g) => `${g.at}${g.body ? "+block" : ""}`).join(", ") || "nothing"}`);
  }
  return s;
}

const rate = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}% (${a}/${b})` : "n/a");

function report(name: string, s: Score): string {
  return [
    `| ${name} | ${s.prompts} | ${rate(s.blockHits, s.blockGold)} | ${rate(s.pointerOnlyHits, s.blockGold)} | ${rate(s.wrongQuoted, s.quoted)} | ${rate(s.emptyRight, s.emptyPrompts)} | ${rate(s.pointerExact, s.pointerPrompts)} | ${(s.falseInclusions / s.prompts).toFixed(3)} | ${Math.round(s.tokens / s.prompts)} | ${s.nonEmpty ? Math.round(s.tokens / s.nonEmpty) : 0} |`,
  ].join("\n");
}

function main(): void {
  const { values } = parseArgs({ options: { split: { type: "string", default: "all" }, verbose: { type: "boolean", default: false } } });
  const t0 = performance.now();
  const index = new SymbolIndex(sourcesAt(SET.commit));
  const ms = Math.round(performance.now() - t0);
  const splits = values.split === "all" ? ["dev", "held-out"] : [values.split!];
  console.log(`code-pathline at ${SET.commit.slice(0, 7)}: ${index.size} definitions indexed in ${ms} ms`);
  console.log("| profile / split | prompts | block hit | pointer only (over cap) | wrong-line | empty right | pointer sets exact | false incl./prompt | mean tokens | mean tokens (non-empty) |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const [profile, budget] of Object.entries(BUDGETS)) {
    for (const split of splits) {
      const prompts = SET.prompts.filter((p) => splitOf(p.id) === split);
      if (values.verbose) console.log(`${profile} / ${split}:`);
      const s = score(prompts, index, budget, values.verbose!);
      console.log(report(`${profile} / ${split}`, s));
    }
  }
}

main();
