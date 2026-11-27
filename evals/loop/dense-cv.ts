// Grouped cross-validation of the dense-sweep pick (dense-sweep.ts --out rows.jsonl). Folds group probes by dev question
// (tier 1 by history), so a question never sits on both sides. Each fold picks, on its training folds, the config with
// the most all-evidence among those adding no false inclusions on tiers 1, 1t, 2 and 3 over the baseline (ties: fewer
// tokens), then scores it on the held fold. Prints the pooled held-fold numbers next to the baseline.
//
//   node --experimental-strip-types evals/loop/dense-cv.ts rows.jsonl [--folds 5]

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

type Row = { config: string; tier: string; group: string; units: number; evidenceUnits: number; tokens: number; complete?: boolean };
const { values, positionals } = parseArgs({ allowPositionals: true, options: { folds: { type: "string", default: "5" } } });
const rows: Row[] = readFileSync(positionals[0]!, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const k = Number(values.folds);
const groups = [...new Set(rows.map((r) => r.group))].sort();
const foldOf = new Map(groups.map((g, i) => [g, i % k]));
const configs = [...new Set(rows.map((r) => r.config))];
const TIERS = ["tier1-off-history", "tier1t-time-phrases", "tier2-cross-history", "tier3-evidence-ablated"];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

function score(rs: Row[]) {
  const ans = rs.filter((r) => r.tier === "answerable");
  return {
    allEv: mean(ans.map((r) => (r.complete ? 1 : 0))),
    tokens: mean(ans.map((r) => r.tokens)),
    fi: TIERS.map((t) => mean(rs.filter((r) => r.tier === t).map((r) => r.units - r.evidenceUnits))),
  };
}

const held: Row[] = [];
const picks: string[] = [];
for (let f = 0; f < k; f++) {
  const train = rows.filter((r) => foldOf.get(r.group) !== f);
  const base = score(train.filter((r) => r.config === "baseline"));
  const ok = configs
    .map((c) => ({ c, s: score(train.filter((r) => r.config === c)) }))
    .filter(({ s }) => s.fi.every((x, i) => x <= base.fi[i]! + 1e-9))
    .sort((a, b) => b.s.allEv - a.s.allEv || a.s.tokens - b.s.tokens);
  const pick = ok[0]!.c;
  picks.push(pick);
  held.push(...rows.filter((r) => foldOf.get(r.group) === f && r.config === pick));
}
const fmt = (s: ReturnType<typeof score>) => `all-evidence ${(s.allEv * 100).toFixed(1)}%, tokens ${Math.round(s.tokens)}, FI t1/t1t/t2/t3 ${s.fi.map((x) => x.toFixed(2)).join("/")}`;
console.log(`Picks per fold: ${picks.join(" | ")}`);
console.log(`Cross-validated: ${fmt(score(held))}`);
console.log(`Baseline:        ${fmt(score(rows.filter((r) => r.config === "baseline")))}`);
