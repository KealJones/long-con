// Grouped cross-validation of the embedding veto's floor (and the query-relative floor, profile.embedRatio). Dev slice
// only; labels are used here alone, never in the builder.
//
//   node --experimental-strip-types evals/loop/veto-cv.ts grid --profile claude [--floors 0,0.025,...] [--ratios 0,0.5,...]
//       runs the real builder at every floor × ratio and caches per-probe outcomes in evals/data/veto-cv/<profile>.json
//   node --experimental-strip-types evals/loop/veto-cv.ts cv --profile claude
//       5-fold and leave-one-question-out: pick a setting on the training questions, score the held-out ones

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildPacket, cosine, profileByName, type Profile } from "@long-con/core";
import { loadEmbedder } from "../src/embedder.ts";
import { packetRecall, readableRecall } from "../src/recall.ts";
import { load, probeQuestion } from "./embed-gate.ts";
import { isEvidenceUnit, runProbe, type Probe } from "./empty-rate.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../data/veto-cv");
const TIERS = ["tier1-off-history", "tier1t-time-phrases", "tier2-cross-history", "tier3-evidence-ablated"];
const range = (a: number, b: number, s: number) => Array.from({ length: Math.round((b - a) / s) + 1 }, (_, i) => +(a + i * s).toFixed(3));
const DEFAULT_FLOORS = range(0, 0.45, 0.025);
const DEFAULT_RATIOS = [0, 0.5, 0.6, 0.7, 0.8, 0.9];
/** The ratio rows only need floors up to just past the shipped ones. */
const RATIO_FLOORS = range(0, 0.3, 0.05);

/** One probe at one setting: answerable [whole, ptr-as-found, readable, turn recall, tokens]; other tiers [FI, retrieved tokens]. */
type Cell = number[];
interface Grid {
  profile: string;
  probes: { tier: string; q: string; type: string }[];
  settings: Record<string, Cell[]>;
  /** Answerable probes: the lowest best-turn cosine among the evidence units in the floor-0 packet (null: none in it). */
  margin: (number | null)[];
}

const key = (floor: number, ratio: number) => `${floor}/${ratio}`;

function grid(argv: string[]) {
  const { values } = parseArgs({ args: argv, options: { profile: { type: "string" }, floors: { type: "string" }, ratios: { type: "string" } } });
  const base = profileByName(values.profile ?? "claude")!;
  const embed = loadEmbedder(base.embedModel!);
  const { dev, probes, typeOf } = load();
  const floors = values.floors ? values.floors.split(",").map(Number) : DEFAULT_FLOORS;
  const ratios = values.ratios ? values.ratios.split(",").map(Number) : DEFAULT_RATIOS;
  const settings = ratios.flatMap((r) => (r === 0 ? floors : floors.filter((f) => RATIO_FLOORS.includes(f) || values.floors)).map((f) => [f, r] as const));
  const out: Grid = { profile: base.name, probes: probes.map((p) => ({ tier: p.tier, q: probeQuestion(p), type: typeOf.get(probeQuestion(p))! })), settings: {}, margin: [] };
  for (const [f, r] of settings) out.settings[key(f, r)] = [];
  probes.forEach((p: Probe, i) => {
    const q = p.tier === "answerable" ? dev.find((d) => d.id === p.id)! : undefined;
    for (const [f, r] of settings) {
      const profile: Profile = { ...base, embedFloor: f, embedRatio: r };
      let cell: Cell = [];
      const res = runProbe(p, profile, (pr) => {
        const packet = buildPacket({ history: pr.history, message: pr.message, profile, embed });
        if (q) {
          const rec = packetRecall(q, packet, base.segmentTokens);
          cell = [+rec.complete, +rec.completeWithPointers, base.pointerGate > 0 ? +readableRecall(q, packet, profile) : +rec.complete, rec.turnRecall, packet.tokens];
          if (f === 0 && r === 0) {
            // Whole turns, so a turn split into pieces reads a little differently than the builder's piece.
            const qv = embed(packet.resolution.query);
            const cos = [...packet.segments, ...packet.pointers]
              .filter((s) => isEvidenceUnit(s, p.evidence!))
              .map((s) => Math.max(...pr.history.find((h) => h.id === s.sessionId)!.turns.slice(s.start, s.end + 1).map((t) => cosine(qv, embed(t.content)))));
            out.margin[i] = cos.length ? Math.min(...cos) : null;
          }
        }
        return packet;
      });
      if (!q) cell = [res.units - res.evidenceUnits, res.retrievedTokens];
      out.settings[key(f, r)]!.push(cell);
    }
    if (i % 50 === 0) console.error(`${base.name}: probe ${i}/${probes.length}`);
  });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${base.name}.json`), JSON.stringify(out));
  console.error(`wrote ${join(OUT, `${base.name}.json`)}`);
}

/** Grouped k-fold by question id (as in embed-gate.ts). */
const foldOf = (id: string, k: number) => [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % k;

export interface Scores {
  recall: number[];
  fi: number[];
  retrieved: number[];
  tokens: number;
}

/** Recall rows (sums over answerable), FI and retrieved tokens per prompt per tier, mean answerable tokens, over the probes in `idx`. */
export function score(g: Grid, k: string, idx: number[]): Scores {
  const cells = g.settings[k]!;
  const ans = idx.filter((i) => g.probes[i]!.tier === "answerable");
  const tier = (t: string, c: number) => {
    const ix = idx.filter((i) => g.probes[i]!.tier === t);
    return ix.reduce((a, i) => a + cells[i]![c]!, 0) / (ix.length || 1);
  };
  return {
    recall: [0, 1, 2].map((c) => ans.reduce((a, i) => a + cells[i]![c]!, 0)),
    fi: TIERS.map((t) => tier(t, 0)),
    retrieved: TIERS.map((t) => tier(t, 1)),
    tokens: ans.reduce((a, i) => a + cells[i]![4]!, 0) / (ans.length || 1),
  };
}

/**
 * The setting picked on the training probes: among the candidates whose recall rows (whole, plus ptr-as-found and
 * readable where the profile points) all hold at floor 0's level, "edge" takes the highest floor with every lower one
 * also holding, "minfi" the lowest mean FI (ties to the higher floor, then ratio).
 */
export function pick(g: Grid, train: number[], candidates: string[], rows: number[], rule: "edge" | "minfi"): string {
  const baseRecall = score(g, key(0, 0), train).recall;
  const holds = (k: string) => rows.every((c) => score(g, k, train).recall[c]! >= baseRecall[c]!);
  if (rule === "edge") {
    let best = candidates[0]!;
    for (const k of candidates) {
      if (!holds(k)) break;
      best = k;
    }
    return best;
  }
  const mean = (k: string) => score(g, k, train).fi.reduce((a, x) => a + x, 0) / TIERS.length;
  const ok = candidates.filter(holds);
  return ok.reduce((best, k) => (mean(k) < mean(best) - 1e-9 || (Math.abs(mean(k) - mean(best)) <= 1e-9 && k.localeCompare(best, undefined, { numeric: true }) > 0) ? k : best), ok[0] ?? key(0, 0));
}

/** Each probe is scored once, at the setting picked without its question. */
export function crossValidate(g: Grid, folds: Map<string, number>, candidates: string[], rows: number[], rule: "edge" | "minfi") {
  const ids = [...new Set(folds.values())];
  const chosen: string[] = [];
  const cells: Cell[] = g.probes.map(() => []);
  for (const f of ids) {
    const train = g.probes.map((_, i) => i).filter((i) => folds.get(g.probes[i]!.q) !== f);
    const test = g.probes.map((_, i) => i).filter((i) => folds.get(g.probes[i]!.q) === f);
    if (!test.length) continue;
    const k = pick(g, train, candidates, rows, rule);
    chosen.push(k);
    for (const i of test) cells[i] = g.settings[k]![i]!;
  }
  const cv: Grid = { ...g, settings: { cv: cells } };
  return { chosen, scores: score(cv, "cv", g.probes.map((_, i) => i)) };
}

function cv(argv: string[]) {
  const { values } = parseArgs({ args: argv, options: { profile: { type: "string" } } });
  const base = profileByName(values.profile ?? "claude")!;
  const g: Grid = JSON.parse(readFileSync(join(OUT, `${base.name}.json`), "utf8"));
  const all = g.probes.map((_, i) => i);
  const nAns = all.filter((i) => g.probes[i]!.tier === "answerable").length;
  const rows = base.pointerGate > 0 ? [0, 1, 2] : [0];
  const qs = [...new Set(g.probes.map((p) => p.q))];
  const pct = (n: number) => ((100 * n) / nAns).toFixed(1);
  const line = (label: string, s: Scores) =>
    `| ${label} | ${s.recall.map(pct).join(" / ")} | ${Math.round(s.tokens)} | ${s.fi.map((x, i) => `${x.toFixed(2)} (${Math.round(s.retrieved[i]!)})`).join(" | ")} |`;
  const head = "| setting | whole / ptr / readable % | tokens | t1 FI (retr) | t1t | t2 | t3 |\n| --- | --- | ---: | ---: | ---: | ---: | ---: |";
  const floorKeys = Object.keys(g.settings).filter((k) => k.endsWith("/0")).sort((a, b) => parseFloat(a) - parseFloat(b));
  const allKeys = Object.keys(g.settings);

  console.log(`\n## ${base.name} (shipped floor ${base.embedFloor})\n\nIn-sample, ratio 0:\n\n${head}`);
  for (const k of floorKeys) console.log(line(k, score(g, k, all)));
  console.log(`\nIn-sample, ratio rows:\n\n${head}`);
  for (const k of allKeys.filter((k) => !k.endsWith("/0")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) console.log(line(k, score(g, k, all)));

  const schemes = { "5-fold": new Map(qs.map((q) => [q, foldOf(q, 5)])), LOQO: new Map(qs.map((q, i) => [q, i])) };
  console.log(`\nCross-validated (each question scored at the setting picked without it):\n\n${head.replace("setting", "scheme / rule")} chosen (min / median / max) |`);
  for (const [name, folds] of Object.entries(schemes))
    for (const [rule, cands] of [["edge", floorKeys], ["minfi", floorKeys], ["minfi", allKeys]] as const) {
      const { chosen, scores } = crossValidate(g, folds, [...cands], rows, rule);
      const fl = chosen.map((k) => k).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const label = `${name} ${rule}${cands === allKeys ? " floor×ratio" : " floor"}`;
      console.log(`${line(label, scores)} ${fl[0]} / ${fl[Math.floor(fl.length / 2)]} / ${fl.at(-1)} |`);
    }

  // Per-question edge: the lowest floor at which the question's whole row drops below its floor-0 value.
  const ans = all.filter((i) => g.probes[i]!.tier === "answerable");
  const margins = ans.map((i) => g.margin[i]).filter((m): m is number => m !== null).sort((a, b) => a - b);
  console.log(`\nMargin (lowest best-turn cosine among evidence units in the floor-0 packet), ${margins.length} of ${ans.length} answerable have one:\n${margins.map((m) => m.toFixed(3)).join(", ")}`);
  const breaks = ans
    .map((i) => floorKeys.find((k) => rows.some((c) => g.settings[k]![i]![c]! < g.settings[key(0, 0)]![i]![c]!)))
    .filter((k): k is string => !!k)
    .map((k) => parseFloat(k))
    .sort((a, b) => a - b);
  console.log(`Floors where a question first loses a recall row: ${breaks.join(", ") || "none"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "grid") grid(rest);
  else if (cmd === "cv") cv(rest);
  else console.error("Usage: veto-cv.ts grid|cv --profile claude|small-local");
}
