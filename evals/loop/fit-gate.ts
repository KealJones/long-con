// Fits the unit gate (backlog P03, packages/core/src/gate.ts) on the dev slice, offline, and scores it cross-validated.
// Features come from the history and the message only; labels (does the unit cover an evidence turn) are used here alone.
//
//   node --experimental-strip-types evals/loop/fit-gate.ts [--taus 0.005,0.01] [--minscores 0.17,0] [--profile claude] [--json out.json]
//
// Candidates: units the builder could include (relative confidence at or above the profile's 0.3 cutoff, first 40 in fused
// order) from the answerable dev questions (positives and negatives) and the should-be-empty tiers 1-3 (all negatives).
// Cross-validation is leave-one-question-type-out: each probe is scored by weights fitted without its question type.
// The tau sweep then runs the real builder with each probe's fold weights, so recall and false inclusions are CV numbers.

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildPacket, PROFILES, profileByName, searchUnits, UNIT_FEATURES, unitProbability, type Profile } from "@long-con/core";
import { loadLongMemEval, type Question } from "../src/longmemeval.ts";
import { packetRecall } from "../src/recall.ts";
import { buildProbes, DATA, devQuestions, isEvidenceUnit, loadTier1, runProbe, summarize, type Probe } from "./empty-rate.ts";

export interface Sample {
  x: number[];
  y: 0 | 1;
  w: number;
  group: string;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

/**
 * Weighted L2-regularized logistic regression by Newton's method on standardized features. Returns weights on the RAW
 * features (intercept first), so core needs no scaler.
 */
export function fitLogistic(samples: Sample[], lambda = 1e-2, iterations = 50): number[] {
  const d = samples[0]!.x.length;
  const wsum = samples.reduce((a, s) => a + s.w, 0);
  const mu = Array.from({ length: d }, (_, j) => samples.reduce((a, s) => a + s.w * s.x[j]!, 0) / wsum);
  const sd = Array.from({ length: d }, (_, j) => Math.sqrt(samples.reduce((a, s) => a + s.w * (s.x[j]! - mu[j]!) ** 2, 0) / wsum) || 1);
  const z = samples.map((s) => [1, ...s.x.map((v, j) => (v - mu[j]!) / sd[j]!)]);
  let beta = new Array(d + 1).fill(0);
  for (let it = 0; it < iterations; it++) {
    const grad = new Array(d + 1).fill(0);
    const hess = Array.from({ length: d + 1 }, () => new Array(d + 1).fill(0));
    samples.forEach((s, i) => {
      const xi = z[i]!;
      const p = sigmoid(xi.reduce((a, v, j) => a + v * beta[j]!, 0));
      const r = s.w * (p - s.y);
      const h = s.w * p * (1 - p);
      for (let a = 0; a <= d; a++) {
        grad[a] += r * xi[a]!;
        for (let b = 0; b <= d; b++) hess[a]![b] += h * xi[a]! * xi[b]!;
      }
    });
    // Ridge on the slopes, not the intercept; scaled by total weight so lambda means the same at any sample size.
    for (let a = 1; a <= d; a++) {
      grad[a] += lambda * wsum * beta[a]!;
      hess[a]![a] += lambda * wsum;
    }
    const raw = solve(hess, grad);
    // Damped: a full Newton step can overshoot on nearly separable data.
    const scale = Math.min(1, 2 / Math.max(...raw.map(Math.abs)));
    const step = raw.map((v) => v * scale);
    beta = beta.map((b, j) => b - step[j]!);
    if (Math.max(...step.map(Math.abs)) < 1e-9) break;
  }
  // Fold the scaler into the weights: w_j = beta_j / sd_j, intercept absorbs the means.
  const w = beta.slice(1).map((b, j) => b / sd[j]!);
  return [beta[0]! - w.reduce((a, wj, j) => a + wj * mu[j]!, 0), ...w];
}

/** Gaussian elimination with partial pivoting. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    [m[c], m[p]] = [m[p]!, m[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      for (let k = c; k <= n; k++) m[r]![k] -= f * m[c]![k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/** Weighted-free AUROC by ranks, ties counted half. */
export function auroc(scores: number[], labels: (0 | 1)[]): number {
  const idx = scores.map((s, i) => i).sort((a, b) => scores[a]! - scores[b]!);
  let rankSum = 0;
  let pos = 0;
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j < idx.length && scores[idx[j]!] === scores[idx[i]!]) j++;
    const avg = (i + j + 1) / 2;
    for (let k = i; k < j; k++) if (labels[idx[k]!]) {
      rankSum += avg;
      pos++;
    }
    i = j;
  }
  const neg = labels.length - pos;
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

const MAX_CANDIDATES = 40;

/** The question whose type a probe's fold follows: the asked question, or the history's for an off-history prompt. */
function probeQuestion(p: Probe): string {
  if (p.tier === "tier1-off-history") return p.id.slice(p.id.lastIndexOf("@") + 1);
  if (p.tier === "tier2-cross-history") return p.id.slice(0, p.id.lastIndexOf("@"));
  return p.id;
}

export function candidates(p: Probe, profile: Profile) {
  return searchUnits(p.history, p.message, profile.segmentTokens, undefined, 0, profile.stemmer, profile.gateKey)
    .hits.filter((c) => c.confidence >= profile.minConfidence)
    .slice(0, MAX_CANDIDATES);
}

function main(argv: string[]) {
  const { values } = parseArgs({ args: argv, options: { taus: { type: "string" }, profile: { type: "string" }, json: { type: "string" }, lambda: { type: "string" }, minscores: { type: "string" } } });
  const dev = devQuestions(loadLongMemEval(DATA));
  const typeOf = new Map(dev.map((q) => [q.id, q.type]));
  const probes = buildProbes(dev, loadTier1()).filter((p) => p.tier !== "tier4-abstention");
  // Tier 1 is 25 prompts on every history; weight it down so each tier counts about as much as the answerable set.
  const tierCount = (t: string) => probes.filter((p) => p.tier === t).length;
  const answerableN = tierCount("answerable");
  const weight = (t: string) => (t === "answerable" ? 1 : Math.min(1, answerableN / tierCount(t)));

  const samples: (Sample & { probe: number })[] = [];
  probes.forEach((p, pi) => {
    // One fit serves both profiles; it uses the claude profile's units and cutoff.
    for (const c of candidates(p, PROFILES.claude)) {
      const y = p.tier === "answerable" && isEvidenceUnit(c.hit.item, p.evidence!) ? 1 : 0;
      samples.push({ x: c.features, y, w: weight(p.tier), group: typeOf.get(probeQuestion(p))!, probe: pi });
    }
  });
  const groups = [...new Set(samples.map((s) => s.group))].sort();
  const lambda = Number(values.lambda ?? 1e-2);
  const folds = new Map(groups.map((g) => [g, fitLogistic(samples.filter((s) => s.group !== g), lambda)]));
  const full = fitLogistic(samples, lambda);
  const cv = samples.map((s) => unitProbability(s.x, folds.get(s.group)!));
  const inSample = samples.map((s) => unitProbability(s.x, full));
  const labels = samples.map((s) => s.y);
  const ans = samples.map((s, i) => i).filter((i) => probes[samples[i]!.probe]!.tier === "answerable");
  const pick = <T>(a: T[], idx: number[]) => idx.map((i) => a[i]!);
  const feat = (j: number) => samples.map((s) => s.x[j]!);
  console.log(`# Unit gate fit: ${samples.length} candidates (${labels.filter(Boolean).length} evidence) from ${probes.length} probes, lambda ${lambda}`);
  console.log(`groups (leave-one-type-out): ${groups.join(", ")}`);
  console.log(`AUROC all candidates: CV ${auroc(cv, labels).toFixed(3)}, in-sample ${auroc(inSample, labels).toFixed(3)}`);
  console.log(`AUROC answerable candidates only: CV ${auroc(pick(cv, ans), pick(labels, ans)).toFixed(3)}`);
  console.log(`Single-feature AUROC (all candidates): ${UNIT_FEATURES.map((n, j) => `${n} ${auroc(feat(j), labels).toFixed(3)}`).join(", ")}`);
  console.log(`Shipped weights (all dev, raw features, intercept first):\n[${full.map((w) => +w.toFixed(4)).join(", ")}]`);
  for (const g of groups) console.log(`fold without ${g}: [${folds.get(g)!.map((w) => +w.toFixed(3)).join(", ")}]`);

  const taus = (values.taus ?? "0,0.02,0.05,0.1,0.15,0.2,0.3").split(",").map(Number);
  const profiles = values.profile ? [profileByName(values.profile)!] : Object.values(PROFILES);
  const rows: object[] = [];
  for (const base of profiles as Profile[]) {
    console.log(`\n## ${base.name} (CV: every probe uses weights fitted without its question type)\n`);
    console.log("| tau | minScore | all-evidence | turns | mean tokens | t1 empty | t2 empty | t3 empty | t1 FI | t2 FI | t3 FI | t2 retr tok | t3 retr tok | precision |");
    console.log("| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const minScore of values.minscores ? values.minscores.split(",").map(Number) : [base.minScore, 0]) {
      for (const tau of taus) {
        if (minScore === 0 && tau === 0) continue;
        const profileFor = (p: Probe): Profile => ({ ...base, minScore, unitGate: tau, unitWeights: folds.get(typeOf.get(probeQuestion(p))!)! });
        const results = probes.map((p) => runProbe(p, profileFor(p), (q) => buildPacket({ history: q.history, message: q.message, profile: profileFor(q) })));
        const tiers = summarize(results);
        const answerable = probes.filter((p) => p.tier === "answerable");
        const recall = answerable.map((p) => {
          const q = dev.find((d) => d.id === p.id)! as Question;
          return packetRecall(q, buildPacket({ history: q.sessions, message: q.question, profile: profileFor(p) }), base.segmentTokens);
        });
        const t = (name: string) => tiers.find((r) => r.tier === name)!;
        const pct = (x: number) => (x * 100).toFixed(1);
        const mean = (f: (r: (typeof recall)[number]) => number) => recall.reduce((a, r) => a + f(r), 0) / recall.length;
        const row = {
          profile: base.name,
          tau,
          minScore,
          allEvidence: mean((r) => (r.complete ? 1 : 0)),
          turns: mean((r) => r.turnRecall),
          tokens: t("answerable").meanTokens,
          empty: [1, 2, 3].map((i) => t(["tier1-off-history", "tier2-cross-history", "tier3-evidence-ablated"][i - 1]!).emptyRate),
          fi: [1, 2, 3].map((i) => t(["tier1-off-history", "tier2-cross-history", "tier3-evidence-ablated"][i - 1]!).falseInclusions),
          retrieved: [t("tier2-cross-history").meanRetrievedTokens, t("tier3-evidence-ablated").meanRetrievedTokens],
          precision: t("answerable").precision,
        };
        rows.push(row);
        console.log(
          `| ${tau} | ${minScore} | ${pct(row.allEvidence)} | ${pct(row.turns)} | ${Math.round(row.tokens)} | ${row.empty.map(pct).join(" | ")} | ${row.fi.map((f) => f.toFixed(2)).join(" | ")} | ${row.retrieved.map(Math.round).join(" | ")} | ${row.precision === null ? "n/a" : pct(row.precision)} |`,
        );
      }
    }
  }
  if (values.json) writeFileSync(values.json, JSON.stringify({ full, folds: Object.fromEntries(folds), rows }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
