// Sweeps the tally gate (packages/core/src/tally.ts) on the dev slice, offline: the shipped rule (a piece needs a segment
// holding its turn to pass the unit gate) at several bars, other one-feature rules, and a logistic over all piece features.
// Tally pieces used to skip the unit gate (P03) and became most of claude's false inclusions on counting questions.
//
//   node --experimental-strip-types evals/loop/fit-tally-gate.ts [--profile claude] [--json out.json]
//
// Candidates: every tally piece (above tally.ts's share cut) for every dev probe whose message is a counting question and
// whose history passes claude's absolute bar, tiers 1-3 (all negatives) and answerable (a piece is a positive when it
// covers an evidence turn). Cross-validation is grouped by question: a fold holds out one question with every probe built
// from it (X, X_abs, its tier-2 copies on other histories, its tier-3 ablation; tier 1 groups by the history's question).
// The rule rows marked CV refit the unit gate (fit-gate.ts samples) per fold too, since the shipped unit weights saw every
// dev label. The sweep runs the real builder with each probe's fold weights, so those rows are CV numbers.

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildPacket, isTallyQuestion, PROFILES, profileByName, searchUnits, TALLY_FEATURES, tallySearch, unitProbability, type Packet, type Profile } from "@long-con/core";
import { loadLongMemEval, type Question } from "../src/longmemeval.ts";
import { packetRecall } from "../src/recall.ts";
import { buildProbes, DATA, devQuestions, isEvidenceUnit, loadTier1, runProbe, summarize, type Probe } from "./empty-rate.ts";
import { auroc, candidates, fitLogistic, type Sample } from "./fit-gate.ts";

/** The question a probe was built from, `_abs` twins joined, so a fold holds out a question with all its copies. */
export function probeGroup(p: Probe): string {
  const id = p.tier === "tier1-off-history" ? p.id.slice(p.id.lastIndexOf("@") + 1) : p.tier === "tier2-cross-history" ? p.id.slice(0, p.id.lastIndexOf("@")) : p.id;
  return id.replace(/_abs$/, "");
}

// segGate (last feature) uses the shipped unit weights, which saw every dev label, so the logistic leaves it out to keep CV honest.
const FIT_FEATURES = TALLY_FEATURES.length - 1;
const fit = (samples: Sample[]) => [...fitLogistic(samples.map((s) => ({ ...s, x: s.x.slice(0, FIT_FEATURES) }))), 0];

/** Weights that make the logistic a hard rule: probability >= 0.5 exactly when feature j >= at. */
const rule = (j: number, at: number) => {
  const w = new Array(TALLY_FEATURES.length + 1).fill(0);
  w[0] = -1000 * at;
  w[j + 1] = 1000;
  return w;
};

function main(argv: string[]) {
  const { values } = parseArgs({ args: argv, options: { profile: { type: "string" }, json: { type: "string" } } });
  const dev = devQuestions(loadLongMemEval(DATA));
  const byId = new Map(dev.map((q) => [q.id, q]));
  const probes = buildProbes(dev, loadTier1()).filter((p) => p.tier !== "tier4-abstention");
  const tierCount = (t: string) => probes.filter((p) => p.tier === t).length;
  const answerableN = tierCount("answerable");
  const weight = (t: string) => (t === "answerable" ? 1 : Math.min(1, answerableN / tierCount(t)));

  const tallyProbes = probes.filter((p) => isTallyQuestion(p.message));
  const samples: (Sample & { probe: Probe })[] = [];
  for (const p of tallyProbes) {
    const { hits } = searchUnits(p.history, p.message, PROFILES.claude.segmentTokens, undefined, 0, PROFILES.claude.stemmer, PROFILES.claude.gateKey);
    if (!hits.some((h) => h.score >= PROFILES.claude.minScore)) continue;
    for (const c of tallySearch(p.history, p.message, undefined, 0, hits)) {
      const y = p.tier === "answerable" && isEvidenceUnit(c.hit.item, p.evidence!) ? 1 : 0;
      samples.push({ x: c.features, y, w: weight(p.tier), group: probeGroup(p), probe: p });
    }
  }
  const groups = [...new Set(samples.map((s) => s.group))].sort();
  const folds = new Map(groups.map((g) => [g, fit(samples.filter((s) => s.group !== g))]));
  const full = fit(samples);
  const labels = samples.map((s) => s.y);
  const cv = samples.map((s) => unitProbability(s.x, folds.get(s.group)!));
  const ans = samples.flatMap((s, i) => (s.probe.tier === "answerable" ? [i] : []));
  const pick = <T>(a: T[]) => ans.map((i) => a[i]!);
  const tiers = ["tier1-off-history", "tier2-cross-history", "tier3-evidence-ablated", "answerable"];
  console.log(`# Tally gate fit: ${samples.length} pieces (${labels.filter(Boolean).length} evidence) from ${tallyProbes.length} counting probes (${tiers.map((t) => `${t} ${tallyProbes.filter((p) => p.tier === t).length}`).join(", ")}), ${groups.length} question groups`);
  console.log(`AUROC all pieces: CV ${auroc(cv, labels).toFixed(3)}, in-sample ${auroc(samples.map((s) => unitProbability(s.x, full)), labels).toFixed(3)}; answerable pieces only: CV ${auroc(pick(cv), pick(labels)).toFixed(3)}`);
  console.log(`Single-feature AUROC: ${TALLY_FEATURES.map((n, j) => `${n} ${auroc(samples.map((s) => s.x[j]!), labels).toFixed(3)}`).join(", ")}`);
  console.log(`Shipped weights (all dev, raw features, intercept first):\n[${full.map((w) => +w.toFixed(4)).join(", ")}]`);

  // Unit gate refit without each counting question's group, on the same samples fit-gate.ts uses.
  const unitSamples: Sample[] = probes.flatMap((p) => candidates(p, PROFILES.claude).map((c) => ({ x: c.features, y: (p.tier === "answerable" && isEvidenceUnit(c.hit.item, p.evidence!) ? 1 : 0) as 0 | 1, w: weight(p.tier), group: probeGroup(p) })));
  const unitFolds = new Map([...new Set(tallyProbes.map(probeGroup))].map((g) => [g, fitLogistic(unitSamples.filter((s) => s.group !== g))]));

  const f = (name: (typeof TALLY_FEATURES)[number]) => TALLY_FEATURES.indexOf(name);
  type Config = { name: string; set: (base: Profile, p: Probe) => Partial<Profile> };
  const on = { tallyPieces: Infinity };
  const main = (b: Profile) => ({ tallyGate: 0, tallyPieces: b.name === "claude" ? Infinity : 0 });
  const configs: Config[] = [
    { name: "main (claude tally ungated, small-local tally off)", set: main },
    { name: "tally off", set: () => ({ tallyPieces: 0 }) },
    { name: "tally ungated", set: () => ({ ...on, tallyGate: 0 }) },
    { name: "shipped (segGate >= profile unitGate, shipped unit weights)", set: () => ({}) },
    ...[0, 0.005, 0.01, 0.02, 0.05].map((g) => ({
      name: `segGate >= ${g || "profile unitGate"}, CV unit weights`,
      set: (b: Profile, p: Probe) => ({ ...on, tallyGate: g || b.unitGate, unitWeights: unitFolds.get(probeGroup(p)) }),
    })),
    ...[0.2, 0.25, 0.3].map((c) => ({ name: `segAbsolute >= ${c}`, set: () => ({ ...on, tallyGate: 0.5, tallyWeights: rule(f("segAbsolute"), c) }) })),
    ...[0.2, 0.3].map((c) => ({ name: `absolute >= ${c}`, set: () => ({ ...on, tallyGate: 0.5, tallyWeights: rule(f("absolute"), c) }) })),
    ...[0.5, 0.75].map((m) => ({ name: `matchedShare >= ${m}`, set: () => ({ ...on, tallyGate: 0.5, tallyWeights: rule(f("matchedShare"), m) }) })),
    ...[0.01, 0.02, 0.05, 0.1, 0.2, 0.3].map((tau) => ({ name: `logistic CV tau ${tau}`, set: (_: Profile, p: Probe) => ({ ...on, tallyGate: tau, tallyWeights: folds.get(probeGroup(p)) ?? full }) })),
  ];

  const profiles = (values.profile ? [profileByName(values.profile)!] : Object.values(PROFILES)) as Profile[];
  const rows: object[] = [];
  const pct = (x: number) => (x * 100).toFixed(1);
  for (const base of profiles) {
    // Only counting probes change with the tally settings, so everything else is built once.
    const build = (p: Probe, profile: Profile): Packet => buildPacket({ history: p.history, message: p.message, profile });
    const fixed = new Map(probes.filter((p) => !isTallyQuestion(p.message)).map((p) => [p, build(p, base)]));
    console.log(`\n## ${base.name} (counting probes rebuilt per row; logistic rows use each probe's held-out-question fold)\n`);
    console.log("| config | all-evidence | turns | mean tokens | multi-session all-ev | temporal all-ev | preference all-ev | t1 empty | t2 empty | t3 empty | t1 FI | t2 FI | t3 FI | t1 retr | t2 retr | t3 retr | precision |");
    console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const c of configs) {
      const profileFor = (p: Probe): Profile => ({ ...base, ...c.set(base, p) });
      const packets = new Map(probes.map((p) => [p, fixed.get(p) ?? build(p, profileFor(p))]));
      const tierRows = summarize(probes.map((p) => runProbe(p, base, () => packets.get(p)!)));
      const answerable = probes.filter((p) => p.tier === "answerable");
      const recall = answerable.map((p) => ({ type: byId.get(p.id)!.type, ...packetRecall(byId.get(p.id)! as Question, packets.get(p)!, base.segmentTokens) }));
      const mean = (rs: typeof recall, g: (r: (typeof recall)[number]) => number) => rs.reduce((a, r) => a + g(r), 0) / (rs.length || 1);
      const typeAll = (t: string) => pct(mean(recall.filter((r) => r.type === t), (r) => +r.complete));
      const t = (name: string) => tierRows.find((r) => r.tier === name)!;
      const should = tiers.slice(0, 3).map(t);
      const row = {
        profile: base.name,
        config: c.name,
        allEvidence: mean(recall, (r) => +r.complete),
        turns: mean(recall, (r) => r.turnRecall),
        tokens: t("answerable").meanTokens,
        empty: should.map((r) => r.emptyRate),
        fi: should.map((r) => r.falseInclusions),
        retrieved: should.map((r) => r.meanRetrievedTokens),
        precision: t("answerable").precision,
      };
      rows.push(row);
      console.log(
        `| ${c.name} | ${pct(row.allEvidence)} | ${pct(row.turns)} | ${Math.round(row.tokens)} | ${typeAll("multi-session")} | ${typeAll("temporal-reasoning")} | ${typeAll("single-session-preference")} | ${row.empty.map(pct).join(" | ")} | ${row.fi.map((x) => x.toFixed(2)).join(" | ")} | ${row.retrieved.map(Math.round).join(" | ")} | ${row.precision === null ? "n/a" : pct(row.precision)} |`,
      );
    }
  }
  if (values.json) writeFileSync(values.json, JSON.stringify({ full, folds: Object.fromEntries(folds), rows }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
