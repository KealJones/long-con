// Static-embedder cosine as an abstention signal for the unit gate (P04's "probability as an abstention floor", done with
// model2vec instead of a cross-encoder). Dev slice only. Labels are used here alone, never in the builder.
//
//   node --experimental-strip-types evals/loop/embed-gate.ts screen [--json out.json]
//       one pass over the candidates of both profiles: the cosine's AUROC, the refit gate's cross-validated AUROC
//       (arm a), and a quick veto simulation (arm b) on the units the shipped gate keeps
//   node --experimental-strip-types evals/loop/embed-gate.ts run --model potion-retrieval-32M --sim maxsim --profile claude
//       [--floors 0,0.1,0.2] [--taus 0.002,0.004] [--refit]
//       the real builder at each setting: recall rows and tiers 1/1t/2/3. --refit uses the 11-feature gate with
//       leave-one-type-out fold weights (so its numbers are cross-validated) and sweeps --taus; otherwise --floors sweeps
//       the veto on the shipped gate.

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildPacket, PROFILES, profileByName, unitProbability, unitSimilarity, type Embed, type Profile } from "@long-con/core";
import { loadEmbedder } from "../src/embedder.ts";
import { loadLongMemEval, type Question } from "../src/longmemeval.ts";
import { packetRecall, readableRecall } from "../src/recall.ts";
import { buildProbes, DATA, devQuestions, isEvidenceUnit, loadTier1, runProbe, summarize, TIER1_TIME, type Probe, type TierName } from "./empty-rate.ts";
import { auroc, candidates, fitLogistic, type Sample } from "./fit-gate.ts";

const MODELS = ["potion-base-8M", "potion-retrieval-32M"];
const SIMS = ["segment", "maxsim"] as const;
const SHOULD_BE_EMPTY: TierName[] = ["tier1-off-history", "tier1t-time-phrases", "tier2-cross-history", "tier3-evidence-ablated"];

/** The question a probe's fold follows (as in fit-gate.ts): the asked question, or the history's for an off-history prompt. */
export function probeQuestion(p: Probe): string {
  if (p.tier === "tier1-off-history" || p.tier === "tier1t-time-phrases") return p.id.slice(p.id.lastIndexOf("@") + 1);
  if (p.tier === "tier2-cross-history") return p.id.slice(0, p.id.lastIndexOf("@"));
  return p.id;
}

export function load() {
  const dev = devQuestions(loadLongMemEval(DATA));
  const probes = buildProbes(dev, loadTier1(), { timePrompts: loadTier1(TIER1_TIME) }).filter((p) => p.tier !== "tier4-abstention");
  return { dev, probes, typeOf: new Map(dev.map((q) => [q.id, q.type])) };
}

const tierWeight = (probes: Probe[]) => {
  const answerableN = probes.filter((p) => p.tier === "answerable").length;
  const count = new Map<string, number>();
  for (const p of probes) count.set(p.tier, (count.get(p.tier) ?? 0) + 1);
  return (t: string) => (t === "answerable" ? 1 : Math.min(1, answerableN / count.get(t)!));
};

/** Grouped k-fold: every candidate of one question lands in the same fold. */
const foldOf = (id: string, k: number) => [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % k;

function screen(json?: string) {
  const { probes, typeOf } = load();
  const embedders = Object.fromEntries(MODELS.map((m) => [m, loadEmbedder(m)])) as Record<string, Embed>;
  const weight = tierWeight(probes);
  const out: Record<string, unknown> = {};
  for (const profile of [PROFILES.claude, PROFILES.smallLocal] as Profile[]) {
    type Row = { x: number[]; y: 0 | 1; w: number; tier: string; type: string; q: string; probe: number; kept: boolean; cos: Record<string, number> };
    const rows: Row[] = [];
    probes.forEach((p, pi) => {
      const cands = candidates(p, profile);
      const found = cands.some((c) => c.score >= profile.minScore);
      const sims = Object.fromEntries(MODELS.flatMap((m) => SIMS.map((s) => [`${m}/${s}`, unitSimilarity(embedders[m]!, p.message, s)])));
      for (const c of cands) {
        const y = p.tier === "answerable" && isEvidenceUnit(c.hit.item, p.evidence!) ? 1 : 0;
        const kept = found && unitProbability(c.features, profile.unitWeights) >= profile.unitGate;
        const cos = Object.fromEntries(Object.entries(sims).map(([k, f]) => [k, f(c.hit.item)]));
        rows.push({ x: c.features, y, w: weight(p.tier), tier: p.tier, type: typeOf.get(probeQuestion(p))!, q: probeQuestion(p), probe: pi, kept, cos });
      }
    });
    console.log(`\n## ${profile.name}: ${rows.length} candidates, ${rows.filter((r) => r.y).length} evidence; ${rows.filter((r) => r.kept).length} kept by the shipped gate`);
    const labels = rows.map((r) => r.y);
    const ans = rows.filter((r) => r.tier === "answerable");
    const kept = rows.filter((r) => r.kept);
    const keptAns = kept.filter((r) => r.tier === "answerable");
    const gateP = (r: Row) => unitProbability(r.x, profile.unitWeights);
    console.log(`shipped gate AUROC: all ${auroc(rows.map(gateP), labels).toFixed(3)}, answerable ${auroc(ans.map(gateP), ans.map((r) => r.y)).toFixed(3)}, among kept ${auroc(kept.map(gateP), kept.map((r) => r.y)).toFixed(3)}`);
    console.log("| cosine | AUROC all | AUROC answerable | AUROC among kept | among kept, answerable only |");
    console.log("| --- | ---: | ---: | ---: | ---: |");
    for (const k of Object.keys(rows[0]!.cos)) {
      const a = (rs: Row[]) => auroc(rs.map((r) => r.cos[k]!), rs.map((r) => r.y)).toFixed(3);
      console.log(`| ${k} | ${a(rows)} | ${a(ans)} | ${a(kept)} | ${a(keptAns)} |`);
    }

    // Arm a: the gate refit with the cosine as an 11th feature, cross-validated two ways (claude's fit serves both, as shipped).
    if (profile === PROFILES.claude) {
      console.log("\nArm a, refit gate, CV AUROC (all candidates / answerable only):");
      console.log("| features | leave-one-type-out | grouped-by-question 5-fold |");
      console.log("| --- | ---: | ---: |");
      for (const k of [null, ...Object.keys(rows[0]!.cos)]) {
        const samples: (Sample & { q: string })[] = rows.map((r) => ({ x: k ? [...r.x, r.cos[k]!] : r.x, y: r.y, w: r.w, group: r.type, q: r.q }));
        const cv = (groupOf: (s: (typeof samples)[number]) => string) => {
          const groups = [...new Set(samples.map(groupOf))];
          const folds = new Map(groups.map((g) => [g, fitLogistic(samples.filter((s) => groupOf(s) !== g))]));
          const scores = samples.map((s) => unitProbability(s.x, folds.get(groupOf(s))!));
          const ai = samples.map((_, i) => i).filter((i) => rows[i]!.tier === "answerable");
          return `${auroc(scores, labels).toFixed(3)} / ${auroc(ai.map((i) => scores[i]!), ai.map((i) => labels[i]!)).toFixed(3)}`;
        };
        console.log(`| base${k ? ` + ${k}` : ""} | ${cv((s) => s.group)} | ${cv((s) => String(foldOf(s.q, 5)))} |`);
        if (k) out[`weights/${k}`] = fitLogistic(samples);
      }
    }

    // Arm b, simulated: drop kept units under the floor. Counts are per prompt on the should-be-empty tiers; evidence
    // units lost and questions whose last kept evidence unit drops are on the answerable set. Ignores budget and pointers.
    console.log("\nArm b, veto simulation on kept units (FI per prompt t1/t1t/t2/t3; answerable evidence units lost; questions losing all kept evidence):");
    const prompts = (t: string) => probes.filter((p) => p.tier === t).length;
    for (const k of Object.keys(rows[0]!.cos)) {
      const line: string[] = [];
      for (const floor of [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3]) {
        const left = kept.filter((r) => r.cos[k]! >= floor);
        const fi = SHOULD_BE_EMPTY.map((t) => (left.filter((r) => r.tier === t).length / prompts(t)).toFixed(2));
        const evLost = keptAns.filter((r) => r.y && r.cos[k]! < floor).length;
        const qs = new Set(keptAns.filter((r) => r.y).map((r) => r.probe));
        const qLost = [...qs].filter((pi) => !keptAns.some((r) => r.probe === pi && r.y && r.cos[k]! >= floor)).length;
        line.push(`| ${k} | ${floor} | ${fi.join(" | ")} | ${evLost} | ${qLost} |`);
      }
      console.log("| cosine | floor | t1 | t1t | t2 | t3 | ev units lost | q lost |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n" + line.join("\n"));
    }
  }
  if (json) writeFileSync(json, JSON.stringify(out));
}

function run(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: { model: { type: "string" }, sim: { type: "string" }, profile: { type: "string" }, floors: { type: "string" }, taus: { type: "string" }, refit: { type: "boolean", default: false } },
  });
  const { dev, probes, typeOf } = load();
  const base = profileByName(values.profile ?? "claude")!;
  const embed = values.model ? loadEmbedder(values.model) : undefined;
  const embedSim = values.sim as "segment" | "maxsim" | undefined;
  let folds: Map<string, number[]> | undefined;
  if (values.refit) {
    // Leave-one-type-out fold weights for the 11-feature gate, fitted on claude candidates as fit-gate.ts does.
    const weight = tierWeight(probes);
    const samples: Sample[] = [];
    for (const p of probes.filter((p) => p.tier !== "tier1t-time-phrases")) {
      const sim = unitSimilarity(embed!, p.message, embedSim!);
      for (const c of candidates(p, PROFILES.claude)) {
        const y = p.tier === "answerable" && isEvidenceUnit(c.hit.item, p.evidence!) ? 1 : 0;
        samples.push({ x: [...c.features, sim(c.hit.item)], y, w: weight(p.tier), group: typeOf.get(probeQuestion(p))! });
      }
    }
    const groups = [...new Set(samples.map((s) => s.group))];
    folds = new Map(groups.map((g) => [g, fitLogistic(samples.filter((s) => s.group !== g))]));
    console.log(`full-dev weights: [${fitLogistic(samples).map((w) => +w.toFixed(4)).join(", ")}]`);
  }
  const settings = values.refit ? (values.taus ?? String(base.unitGate)).split(",").map((t) => ({ tau: Number(t), floor: 0 })) : (values.floors ?? "0").split(",").map((f) => ({ tau: base.unitGate, floor: Number(f) }));
  console.log(`\n## ${base.name}, ${values.model ?? "no embedder"} ${embedSim ?? ""} ${values.refit ? "refit gate (CV folds)" : "veto on shipped gate"}\n`);
  console.log("| tau | floor | whole | ptr-as-found | readable | turns | tokens | multi | temporal | pref | t1 FI (retr) | t1t FI (retr) | t2 FI (retr) | t3 FI (retr) | empty t1/t1t/t2/t3 | ans empty | precision |");
  console.log("| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |");
  const pct = (x: number) => (x * 100).toFixed(1);
  for (const { tau, floor } of settings) {
    const profileFor = (p: Probe): Profile => ({
      ...base,
      unitGate: tau,
      embedSim,
      embedFloor: floor,
      ...(folds ? { unitWeights: folds.get(typeOf.get(probeQuestion(p))!)! } : {}),
    });
    const recall: { q: Question; r: ReturnType<typeof packetRecall>; readable: boolean }[] = [];
    const results = probes.map((p) =>
      runProbe(p, profileFor(p), (pr) => {
        const packet = buildPacket({ history: pr.history, message: pr.message, profile: profileFor(pr), embed });
        if (pr.tier === "answerable") {
          const q = dev.find((d) => d.id === pr.id)!;
          recall.push({ q, r: packetRecall(q, packet, base.segmentTokens), readable: base.pointerGate > 0 ? readableRecall(q, packet, profileFor(pr)) : packetRecall(q, packet, base.segmentTokens).complete });
        }
        return packet;
      }),
    );
    const tiers = summarize(results);
    const t = (n: string) => tiers.find((r) => r.tier === n)!;
    const mean = (rs: typeof recall, f: (x: (typeof recall)[number]) => number) => rs.reduce((a, x) => a + f(x), 0) / (rs.length || 1);
    const byType = (ty: string) => pct(mean(recall.filter((x) => x.q.type === ty), (x) => +x.r.complete));
    console.log(
      `| ${tau} | ${floor} | ${pct(mean(recall, (x) => +x.r.complete))} | ${pct(mean(recall, (x) => +x.r.completeWithPointers))} | ${pct(mean(recall, (x) => +x.readable))} | ${pct(mean(recall, (x) => x.r.turnRecall))} | ${Math.round(t("answerable").meanTokens)} | ${byType("multi-session")} | ${byType("temporal-reasoning")} | ${byType("single-session-preference")} | ` +
        SHOULD_BE_EMPTY.map((n) => `${t(n).falseInclusions.toFixed(2)} (${Math.round(t(n).meanRetrievedTokens)})`).join(" | ") +
        ` | ${SHOULD_BE_EMPTY.map((n) => pct(t(n).emptyRate)).join("/")} | ${pct(t("answerable").emptyRate)} | ${t("answerable").precision === null ? "n/a" : pct(t("answerable").precision!)} |`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "screen") screen(parseArgs({ args: rest, options: { json: { type: "string" } } }).values.json);
  else if (cmd === "run") run(rest);
  else console.error("Usage: embed-gate.ts screen | run --model <name> --sim segment|maxsim --profile <name> [--floors ...] [--taus ...] [--refit]");
}
