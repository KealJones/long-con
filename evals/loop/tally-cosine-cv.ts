// Grouped 5-fold CV over tally-cosine.ts --json lines: each fold picks the setting with the most training questions found
// whole, ties to the fewest false inclusions per should-be-empty prompt, then to the baseline (first line), and scores
// it on the held-out questions and the prompts built on their histories.
//
//   node --experimental-strip-types evals/loop/tally-cosine-cv.ts claude.jsonl

import { readFileSync } from "node:fs";

interface Line {
  tallyMix?: number;
  tallyFloor?: number;
  tallyBar?: number;
  questions: { id: string; complete: boolean; tokens: number }[];
  prompts: { tier: string; id: string; fi: number }[];
}
const lines: Line[] = readFileSync(process.argv[2]!, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const name = (l: Line) => `mix ${l.tallyMix ?? 0} floor ${l.tallyFloor ?? "off"} bar ${l.tallyBar ?? "off"}`;
// A prompt belongs to the dev question whose history it runs on (after the @), or its own id on tier 3.
const group = (id: string) => id.split("@").at(-1)!;
const ids = lines[0]!.questions.map((q) => q.id);
const fold = (id: string) => ids.indexOf(id) % 5;
const score = (l: Line, inFold: (id: string) => boolean) => {
  const qs = l.questions.filter((q) => inFold(q.id));
  const ps = l.prompts.filter((p) => inFold(group(p.id)));
  return { found: qs.filter((q) => q.complete).length, n: qs.length, fi: ps.reduce((a, p) => a + p.fi, 0) / (ps.length || 1), tokens: qs.reduce((a, q) => a + q.tokens, 0) };
};
let found = 0, n = 0, fiSum = 0, tokens = 0;
const base = { found: 0, fi: 0, tokens: 0 };
for (let k = 0; k < 5; k++) {
  // Prompts on abstention-question histories have no answerable id; they fold by their own place.
  const inTest = (id: string) => (ids.includes(id) ? fold(id) === k : [...id].reduce((a, c) => a + c.charCodeAt(0), 0) % 5 === k);
  const train = lines.map((l, i) => ({ l, i, s: score(l, (id) => !inTest(id)) }));
  train.sort((a, b) => b.s.found - a.s.found || a.s.fi - b.s.fi || a.i - b.i);
  const pick = train[0]!.l;
  const t = score(pick, inTest);
  const b = score(lines[0]!, inTest);
  found += t.found; n += t.n; fiSum += t.fi / 5; tokens += t.tokens;
  base.found += b.found; base.fi += b.fi / 5; base.tokens += b.tokens;
  console.log(`fold ${k}: picked ${name(pick)} | held-out found ${t.found}/${t.n} (baseline ${b.found}) | FI ${t.fi.toFixed(2)} (baseline ${b.fi.toFixed(2)})`);
}
console.log(`CV: all-evidence ${((found / n) * 100).toFixed(1)}% (baseline ${((base.found / n) * 100).toFixed(1)}%) | FI per prompt ${fiSum.toFixed(2)} (baseline ${base.fi.toFixed(2)}) | tokens ${(tokens / n).toFixed(0)} (baseline ${(base.tokens / n).toFixed(0)})`);
