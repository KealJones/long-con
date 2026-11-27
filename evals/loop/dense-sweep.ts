// P10/P11 sweep: the dense channel's cosine floor and RRF weight, per profile and static embedder, on the dev slice only.
// One pass over the probes builds every config's packet, so the embedding cache is shared. Prints recall, tiers 1-3 and
// precision per config, and writes per-probe rows (JSONL) for grouped cross-validation.
//
//   node --experimental-strip-types evals/loop/dense-sweep.ts --profile claude --model potion-retrieval-32M \
//     --unit message --floors 0.5,0.6 --weights 1,2 [--only-floors 0.8] [--out rows.jsonl]

import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { buildPacket, profileByName, type DenseSettings, type Profile } from "@long-con/core";
import { loadLongMemEval } from "../src/longmemeval.ts";
import { packetRecall, readableRecall } from "../src/recall.ts";
import { loadEmbedder } from "../src/embedders.ts";
import { buildProbes, DATA, devQuestions, loadTier1, runProbe, TIER1_TIME } from "./empty-rate.ts";

const { values } = parseArgs({
  options: {
    profile: { type: "string", default: "claude" },
    model: { type: "string", default: "potion-retrieval-32M" },
    unit: { type: "string", default: "message" },
    floors: { type: "string", default: "0.5" },
    weights: { type: "string", default: "1" },
    "only-floors": { type: "string", default: "" },
    vetoes: { type: "string" },
    tally: { type: "boolean", default: false },
    out: { type: "string" },
  },
});
const base = profileByName(values.profile!)!;
const list = (s: string) => s.split(",").filter(Boolean).map(Number);
const configs: { name: string; profile: Profile }[] = [{ name: "baseline", profile: base }];
for (const floor of list(values.floors!))
  for (const weight of list(values.weights!))
    for (const only of [undefined, ...list(values["only-floors"]!)])
      for (const veto of values.vetoes ? list(values.vetoes) : [undefined]) {
        const dense: DenseSettings = { floor, weight, unit: values.unit as DenseSettings["unit"], ...(only !== undefined ? { onlyFloor: only } : {}), ...(veto !== undefined ? { veto } : {}), ...(values.tally ? { tally: true } : {}) };
        configs.push({ name: `${values.unit} f${floor} w${weight}${only !== undefined ? ` only${only}` : ""}${veto !== undefined ? ` veto${veto}` : ""}${values.tally ? " +tally" : ""}`, profile: { ...base, dense } });
      }

const dev = devQuestions(loadLongMemEval(DATA));
const byId = new Map(dev.map((q) => [q.id, q]));
const probes = buildProbes(dev, loadTier1(), { timePrompts: loadTier1(TIER1_TIME) });
const t0 = performance.now();
const embed = loadEmbedder(values.model!);
const loadMs = performance.now() - t0;

type Row = { config: string; tier: string; id: string; group: string; units: number; evidenceUnits: number; tokens: number; retrievedTokens: number; type?: string; complete?: boolean; withPointers?: boolean; readable?: boolean; turnRecall?: number };
const rows: Row[] = [];
const group = (tier: string, id: string) => (tier.startsWith("tier1") ? id.split("@")[1]! : id.split("@")[0]!);
let embedMs = 0;
for (const probe of probes) {
  for (const { name, profile } of configs) {
    const before = embed.stats.ms;
    const packet = buildPacket({ history: probe.history, message: probe.message, profile, embed: profile.dense ? embed : undefined });
    embedMs += embed.stats.ms - before;
    const r = runProbe(probe, profile, () => packet);
    const row: Row = { config: name, tier: probe.tier, id: probe.id, group: group(probe.tier, probe.id), units: r.units, evidenceUnits: r.evidenceUnits, tokens: r.tokens, retrievedTokens: r.retrievedTokens };
    if (probe.tier === "answerable") {
      const q = byId.get(probe.id)!;
      const rec = packetRecall(q, packet, profile.segmentTokens);
      Object.assign(row, { type: q.type, complete: rec.complete, withPointers: rec.completeWithPointers, turnRecall: rec.turnRecall, readable: profile.pointerGate > 0 ? readableRecall(q, packet, profile) : rec.complete });
    }
    rows.push(row);
  }
}
if (values.out) writeFileSync(values.out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

const pct = (x: number) => `${(x * 100).toFixed(1)}`;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
console.log(`# Dense sweep: ${base.name}, ${values.model}, ${probes.length} probes; model load ${(loadMs / 1000).toFixed(1)} s`);
console.log(`Embedding: ${embed.stats.misses} distinct texts in ${(embed.stats.ms / 1000).toFixed(1)} s (${((embed.stats.ms / embed.stats.misses) * 1000).toFixed(0)} µs per text)`);
console.log("");
console.log("| config | all-ev | +ptr | readable | turns | tokens | multi | temporal | pref | ans-empty | prec | t1 FI (ret) | t1t FI (ret) | t2 FI (ret) | t3 FI (ret) | empty t1/t1t/t2/t3 |");
console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
for (const { name } of configs) {
  const mine = rows.filter((r) => r.config === name);
  const ans = mine.filter((r) => r.tier === "answerable");
  const type = (t: string) => pct(mean(ans.filter((r) => r.type === t).map((r) => (r.complete ? 1 : 0))));
  const tier = (t: string) => {
    const rs = mine.filter((r) => r.tier === t);
    return { fi: mean(rs.map((r) => r.units - r.evidenceUnits)), ret: mean(rs.map((r) => r.retrievedTokens)), empty: rs.filter((r) => r.units === 0).length / rs.length };
  };
  const ts = ["tier1-off-history", "tier1t-time-phrases", "tier2-cross-history", "tier3-evidence-ablated"].map(tier);
  const units = ans.reduce((a, r) => a + r.units, 0);
  console.log(
    `| ${name} | ${pct(mean(ans.map((r) => (r.complete ? 1 : 0))))} | ${pct(mean(ans.map((r) => (r.withPointers ? 1 : 0))))} | ${pct(mean(ans.map((r) => (r.readable ? 1 : 0))))} | ${pct(mean(ans.map((r) => r.turnRecall!)))} | ${Math.round(mean(ans.map((r) => r.tokens)))} | ${type("multi-session")} | ${type("temporal-reasoning")} | ${type("single-session-preference")} | ${pct(ans.filter((r) => r.units === 0).length / ans.length)} | ${pct(ans.reduce((a, r) => a + r.evidenceUnits, 0) / units)} | ${ts.map((t) => `${t.fi.toFixed(2)} (${Math.round(t.ret)})`).join(" | ")} | ${ts.map((t) => pct(t.empty)).join("/")} |`,
  );
}
