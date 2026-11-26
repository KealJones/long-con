// Empty-rate scorer (backlog P01): how often the packet stays empty when nothing in history should be retrieved,
// and how much junk gets in when it doesn't. No model, no judge, free. Goal: an empty packet beats a wrong one.
//
//   node --experimental-strip-types evals/loop/empty-rate.ts [--profile claude] [--data path] [--json]
//   node --experimental-strip-types evals/loop/empty-rate.ts --fixture      # smoke test on a tiny synthetic haystack
//
// Tiers, all on the dev slice only:
//   1  hand-written off-history prompts (evals/sets/should-be-empty/tier1.json, dev ids) on each dev history
//   2  cross-history: dev question A asked against dev question B's history, B holding none of A's evidence
//   3  evidence-ablated: each answerable dev question on its own history with its evidence chats removed
//   4  LongMemEval `_abs` (false-premise) dev questions on their own histories
// Plus the answerable dev questions on their own histories, for packet precision.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildPacket, estimateTokens, PROFILES, profileByName, type Packet, type PacketSegment, type Profile, type Session } from "../../packages/core/src/index.ts";
import { loadLongMemEval, type Question } from "../src/longmemeval.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const DATA = join(ROOT, "evals/data/longmemeval/longmemeval_s_cleaned.json");
export const SLICE = join(ROOT, "evals/slices/longmemeval-s-dev50.json");
export const TIER1 = join(ROOT, "evals/sets/should-be-empty/tier1.json");
export const FIXTURE = join(ROOT, "evals/sets/should-be-empty/fixture-haystack.json");
const RETRIEVED = "Retrieved history, oldest first:";

export type TierName = "tier1-off-history" | "tier2-cross-history" | "tier3-evidence-ablated" | "tier4-abstention" | "answerable";

export interface Tier1Prompt {
  id: string;
  kind: string;
  prompt: string;
  why: string;
}

/** One packet to build: a message on a history, with evidence only where some unit could rightly be included. */
export interface Probe {
  tier: TierName;
  id: string;
  message: string;
  history: Session[];
  /** Absent for tiers 1-3: there every included unit is a false inclusion. */
  evidence?: Question["evidence"];
}

export interface TierReport {
  tier: TierName;
  prompts: number;
  /** Share of prompts whose packet retrieved no unit at all. */
  emptyRate: number;
  /** Included units that aren't evidence, averaged over prompts. */
  falseInclusions: number;
  /** Whole packet, notices included. */
  meanTokens: number;
  /** The retrieved section alone: the part a gate can save. */
  meanRetrievedTokens: number;
  /** Evidence units over all included units, pooled over prompts. Only for tiers with evidence; null when nothing was included. */
  precision: number | null;
}

/** The tier 1 prompts of one split, in file order. */
export function loadTier1(path = TIER1, split: "dev" | "heldOut" = "dev"): Tier1Prompt[] {
  const file = JSON.parse(readFileSync(path, "utf8")) as { split: Record<"dev" | "heldOut", string[]>; prompts: Tier1Prompt[] };
  const ids = new Set(file.split[split]);
  return file.prompts.filter((p) => ids.has(p.id));
}

/** The dev questions named by the slice file, and nothing else, so held-out questions are never touched. */
export function devQuestions(all: Question[], slicePath = SLICE): Question[] {
  const ids: string[] = JSON.parse(readFileSync(slicePath, "utf8")).ids;
  const byId = new Map(all.map((q) => [q.id, q]));
  return ids.map((id) => byId.get(id)).filter((q): q is Question => !!q);
}

/**
 * A unit is evidence when it covers a labeled evidence turn. A question with no turn labels at all
 * falls back to its evidence chats, so any unit from one of them counts.
 */
export function isEvidenceUnit(seg: Pick<PacketSegment, "sessionId" | "start" | "end">, evidence: Question["evidence"]): boolean {
  if (!evidence.turns.length) return evidence.sessions.includes(seg.sessionId);
  return evidence.turns.some((key) => {
    const at = key.lastIndexOf("#");
    const turn = Number(key.slice(at + 1));
    return key.slice(0, at) === seg.sessionId && turn >= seg.start && turn <= seg.end;
  });
}

/** The text that answers a question: its evidence turns, or every turn of its evidence chats when turns aren't labeled. */
function evidenceTexts(q: Question): Set<string> {
  const out = new Set<string>();
  const turnKeys = new Set(q.evidence.turns);
  for (const s of q.sessions) {
    if (!q.evidence.sessions.includes(s.id) && !q.evidence.turns.some((k) => k.startsWith(`${s.id}#`))) continue;
    s.turns.forEach((t, i) => {
      if (!turnKeys.size || turnKeys.has(`${s.id}#${i}`)) out.add(t.content);
    });
  }
  return out;
}

const holdsAny = (session: Session, texts: Set<string>) => session.turns.some((t) => texts.has(t.content));
const baseId = (id: string) => id.replace(/_abs$/, "");

/**
 * Pairs each question with the next history in the list that holds none of its evidence word for word and isn't its
 * `_abs` twin. LongMemEval reuses chats as filler across histories, so a plain rotation could hand B the answer.
 */
export function crossPairs(questions: Question[]): { a: Question; b: Question }[] {
  const pairs: { a: Question; b: Question }[] = [];
  questions.forEach((a, i) => {
    const texts = evidenceTexts(a);
    for (let k = 1; k < questions.length; k++) {
      const b = questions[(i + k) % questions.length]!;
      if (baseId(b.id) === baseId(a.id)) continue;
      if (b.sessions.some((s) => holdsAny(s, texts))) continue;
      pairs.push({ a, b });
      return;
    }
  });
  return pairs;
}

/** The question's own history minus its evidence chats and any other chat that repeats an evidence turn word for word. */
export function ablate(q: Question): Session[] {
  const texts = evidenceTexts(q);
  return q.sessions.filter((s) => !q.evidence.sessions.includes(s.id) && !holdsAny(s, texts));
}

export interface ProbeOptions {
  /** Cap on how many dev histories tier 1 runs on (tier 1 is prompts × histories). Default: all. */
  tier1Histories?: number;
}

export function buildProbes(dev: Question[], tier1: Tier1Prompt[], opts: ProbeOptions = {}): Probe[] {
  const answerable = dev.filter((q) => !q.abstention);
  const probes: Probe[] = [];
  for (const q of dev.slice(0, opts.tier1Histories ?? dev.length)) {
    for (const p of tier1) probes.push({ tier: "tier1-off-history", id: `${p.id}@${q.id}`, message: p.prompt, history: q.sessions });
  }
  for (const { a, b } of crossPairs(dev)) probes.push({ tier: "tier2-cross-history", id: `${a.id}@${b.id}`, message: a.question, history: b.sessions });
  for (const q of answerable) probes.push({ tier: "tier3-evidence-ablated", id: q.id, message: q.question, history: ablate(q) });
  for (const q of dev.filter((d) => d.abstention)) probes.push({ tier: "tier4-abstention", id: q.id, message: q.question, history: q.sessions, evidence: q.evidence });
  for (const q of answerable) probes.push({ tier: "answerable", id: q.id, message: q.question, history: q.sessions, evidence: q.evidence });
  return probes;
}

export interface ProbeResult {
  probe: Probe;
  units: number;
  evidenceUnits: number;
  tokens: number;
  retrievedTokens: number;
}

export function runProbe(probe: Probe, profile: Profile, build: (p: Probe) => Pick<Packet, "segments" | "text" | "tokens"> = defaultBuild(profile)): ProbeResult {
  const packet = build(probe);
  const evidenceUnits = probe.evidence ? packet.segments.filter((s) => isEvidenceUnit(s, probe.evidence!)).length : 0;
  const at = packet.text.indexOf(RETRIEVED);
  return { probe, units: packet.segments.length, evidenceUnits, tokens: packet.tokens, retrievedTokens: at < 0 ? 0 : estimateTokens(packet.text.slice(at)) };
}

// Same call as `eval recall`: no current session, so nothing rides along raw. The switch point isn't applied, since
// the point is what the packet would hold; every LongMemEval_S history is past both profiles' switch points anyway.
const defaultBuild = (profile: Profile) => (p: Probe) => buildPacket({ history: p.history, message: p.message, profile });

export const TIER_ORDER: TierName[] = ["tier1-off-history", "tier2-cross-history", "tier3-evidence-ablated", "tier4-abstention", "answerable"];

export function summarize(results: ProbeResult[]): TierReport[] {
  return TIER_ORDER.flatMap((tier) => {
    const rs = results.filter((r) => r.probe.tier === tier);
    if (!rs.length) return [];
    const n = rs.length;
    const mean = (f: (r: ProbeResult) => number) => rs.reduce((a, r) => a + f(r), 0) / n;
    const hasEvidence = rs.some((r) => r.probe.evidence);
    const units = rs.reduce((a, r) => a + r.units, 0);
    return [
      {
        tier,
        prompts: n,
        emptyRate: rs.filter((r) => r.units === 0).length / n,
        falseInclusions: mean((r) => r.units - r.evidenceUnits),
        meanTokens: mean((r) => r.tokens),
        meanRetrievedTokens: mean((r) => r.retrievedTokens),
        precision: hasEvidence && units ? rs.reduce((a, r) => a + r.evidenceUnits, 0) / units : null,
      },
    ];
  });
}

export function scoreProfile(probes: Probe[], profile: Profile): TierReport[] {
  return summarize(probes.map((p) => runProbe(p, profile)));
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const num = (x: number) => x.toFixed(2);

export function formatReport(byProfile: { profile: string; tiers: TierReport[] }[], title: string): string {
  const lines = [`# ${title}`, ""];
  for (const { profile, tiers } of byProfile) {
    lines.push(`## ${profile}`, "", "| Tier | Prompts | Empty rate | False inclusions / prompt | Mean packet tokens | Mean retrieved tokens | Precision |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const t of tiers) {
      lines.push(`| ${t.tier} | ${t.prompts} | ${pct(t.emptyRate)} | ${num(t.falseInclusions)} | ${Math.round(t.meanTokens)} | ${Math.round(t.meanRetrievedTokens)} | ${t.precision === null ? "n/a" : pct(t.precision)} |`);
    }
    lines.push("");
  }
  lines.push(
    "Tiers 1-3 should be empty, so every included unit there is a false inclusion. Tier 4 and answerable count units that cover no evidence turn.",
    "Precision is evidence units over all included units, pooled. Empty rate on answerable questions is a miss, not a win.",
  );
  return lines.join("\n");
}

const USAGE = `Usage: node --experimental-strip-types evals/loop/empty-rate.ts [options]
  --profile <name>       claude or small-local (default: both)
  --data <path>          LongMemEval_S file (default evals/data/longmemeval/longmemeval_s_cleaned.json)
  --fixture              run on the tiny synthetic fixture instead: a smoke test, not a benchmark
  --tier1-histories <n>  run tier 1 on only the first n dev histories (tier 1 is prompts x histories)
  --json                 print JSON instead of markdown`;

export function main(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      profile: { type: "string" },
      data: { type: "string" },
      fixture: { type: "boolean", default: false },
      "tier1-histories": { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const profiles = values.profile ? [profileByName(values.profile)] : Object.values(PROFILES);
  if (profiles.some((p) => !p)) {
    console.error(`No profile named ${values.profile}. Profiles: ${Object.values(PROFILES).map((p) => p.name).join(", ")}`);
    return 1;
  }
  const dataPath = values.fixture ? FIXTURE : (values.data ?? DATA);
  if (!existsSync(dataPath)) {
    console.error(
      `No LongMemEval data at ${dataPath}. Run evals/scripts/fetch-longmemeval.sh to download LongMemEval_S, ` +
        `or pass --fixture for a smoke test on the synthetic fixture (not a benchmark result).`,
    );
    return 1;
  }
  const all = loadLongMemEval(dataPath);
  // The fixture is all dev; real data goes through the slice file, so held-out questions are never loaded into a probe.
  const dev = values.fixture ? all : devQuestions(all);
  if (!dev.length) {
    console.error(`None of the dev slice ids in ${SLICE} are in ${dataPath}. Is it LongMemEval_S (cleaned)?`);
    return 1;
  }
  const limit = values["tier1-histories"] ? Number(values["tier1-histories"]) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    console.error("--tier1-histories must be a whole number of 1 or more.");
    return 1;
  }
  const probes = buildProbes(dev, loadTier1(), { tier1Histories: limit });
  const byProfile = (profiles as Profile[]).map((profile) => ({ profile: profile.name, tiers: scoreProfile(probes, profile) }));
  const title = values.fixture
    ? "Empty rate: FIXTURE SMOKE TEST (synthetic 4-question haystack, not a benchmark result)"
    : `Empty rate on the LongMemEval_S dev slice (${dev.length} questions)`;
  console.log(values.json ? JSON.stringify({ title, fixture: values.fixture, results: byProfile }, null, 2) : formatReport(byProfile, title));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
