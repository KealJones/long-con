// P07 sweep: the time-range boost at several strengths, with the time phrase's words stripped from the query or kept.
// Free and dev-only: recall on the answerable dev questions, and tiers 1t, 2 and 3 of the empty-rate scorer. Tier 1
// is left out because no tier 1 prompt names a time, so the boost can't change it (the script checks).
//
//   node --experimental-strip-types --no-warnings evals/loop/time-boost.ts > evals/results/p07-time-boost-sweep.md

import { buildPacket, PROFILES, type Profile } from "@long-con/core";
import { dayOf, timeRanges } from "../../packages/core/src/dates.ts";
import { loadLongMemEval } from "../src/longmemeval.ts";
import { packetRecall } from "../src/recall.ts";
import { buildProbes, DATA, devQuestions, loadTier1, runProbe, summarize, TIER1_TIME } from "./empty-rate.ts";

const dev = devQuestions(loadLongMemEval(DATA));
const named = (text: string, date: string) => timeRanges(text, dayOf(date)!).length > 0;
const tier1Named = loadTier1().filter((p) => dev.some((q) => named(p.prompt, q.date)));
if (tier1Named.length) throw new Error(`tier 1 prompts name a time, so tier 1 must be scored too: ${tier1Named.map((p) => p.id)}`);
const probes = buildProbes(dev, [], { timePrompts: loadTier1(TIER1_TIME) }).filter((p) => p.tier !== "tier4-abstention");
const answerable = dev.filter((q) => !q.abstention);
const pct = (x: number) => (x * 100).toFixed(1);

const ARMS: { label: string; boost: number; keepWords?: boolean; stripOnly?: boolean }[] = [
  { label: "off (main)", boost: 0 },
  { label: "stripping only, no boost", boost: 0, stripOnly: true },
  ...[0.25, 0.5, 0.75, 1, 2].map((boost) => ({ label: `${boost}, stripped`, boost })),
  ...[1, 2].map((boost) => ({ label: `${boost}, words kept`, boost, keepWords: true })),
];

console.log(`# P07 time-range boost sweep (LongMemEval_S dev slice, ${dev.length} questions)\n`);
console.log(`Questions naming a time: ${answerable.filter((q) => named(q.question, q.date)).length} of ${answerable.length} answerable. Tier 1t: ${loadTier1(TIER1_TIME).length} prompts on each dev history.\n`);
for (const base of [PROFILES.claude, PROFILES.smallLocal] as Profile[]) {
  console.log(`## ${base.name}\n`);
  console.log("| Boost | All-evidence | Turns | Mean tokens | Temporal all-evidence | t1t empty | t1t FI (retr tok) | t2 empty | t2 FI (retr tok) | t3 empty | t3 FI (retr tok) | Precision |");
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const arm of ARMS) {
    const profile = { ...base, timeBoost: arm.boost, timeKeepWords: arm.keepWords, timeStripOnly: arm.stripOnly };
    const runs = answerable.map((q) => {
      const p = buildPacket({ history: q.sessions, message: q.question, profile, now: q.date });
      return { q, tokens: p.tokens, ...packetRecall(q, p, profile.segmentTokens) };
    });
    const share = (rs: typeof runs) => pct(rs.filter((r) => r.complete).length / rs.length);
    const mean = (f: (r: (typeof runs)[number]) => number) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
    const tiers = summarize(probes.map((p) => runProbe(p, profile)));
    const t = (name: string) => tiers.find((x) => x.tier === name)!;
    const tier = (name: string) => `${pct(t(name).emptyRate)}% | ${t(name).falseInclusions.toFixed(2)} (${Math.round(t(name).meanRetrievedTokens)})`;
    console.log(
      `| ${arm.label} | ${share(runs)}% | ${pct(mean((r) => r.turnRecall))}% | ${Math.round(mean((r) => r.tokens))} | ${share(runs.filter((r) => r.q.type === "temporal-reasoning"))}% | ` +
        `${tier("tier1t-time-phrases")} | ${tier("tier2-cross-history")} | ${tier("tier3-evidence-ablated")} | ${pct(t("answerable").precision ?? 0)}% |`,
    );
  }
  console.log("");
}
console.log("FI is false inclusions per prompt; retr tok is mean retrieved tokens. Stripped: the time phrase leaves the keyword query (shipped). Words kept and stripping only: control arms. The boost lifts confidence and rank only; the absolute bar and the unit gate see unboosted scores. Rows from the earlier boost, which also lifted those, are in this file at commit a19371c.");
