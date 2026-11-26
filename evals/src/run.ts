// Runs arms over questions, judges each answer, and writes one JSON line per answer plus a summary.

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runArm, type ArmConfig, type ArmName, type ArmResult } from "./arms.ts";
import { judge } from "./judge.ts";
import type { Question } from "./longmemeval.ts";
import { BilledError, costOf, isOutage } from "./model.ts";

export interface Answer extends ArmResult {
  questionId: string;
  type: string;
  arm: ArmName;
  repeat: number;
  pass: boolean;
  judgeReply: string;
  error?: string;
  /** The API failed (rate limit, overload, server error, lost connection): left out of accuracy, counted apart. */
  outage?: boolean;
}

export interface RunOptions extends ArmConfig {
  arms: ArmName[];
  judgeModel: string;
  outDir?: string;
  concurrency: number;
  /** Runs of every question on every arm. Above 1, the summary's intervals cover run-to-run noise too. */
  repeats?: number;
  /** Stop starting new answers once this many dollars are spent. Answers already running finish, so it can go over by a few. */
  maxCost?: number;
}

export async function runEval(questions: Question[], opts: RunOptions): Promise<Answer[]> {
  if (opts.outDir) mkdirSync(opts.outDir, { recursive: true });
  const repeats = Array.from({ length: opts.repeats ?? 1 }, (_, r) => r);
  const jobs = repeats.flatMap((repeat) => questions.flatMap((q) => opts.arms.map((arm) => ({ q, arm, repeat }))));
  const answers: Answer[] = [];
  const shared = { ...opts, summaries: opts.summaries ?? new Map() };
  let next = 0;
  let spent = 0;
  const worker = async () => {
    while (next < jobs.length && !(opts.maxCost !== undefined && spent >= opts.maxCost)) {
      const { q, arm, repeat } = jobs[next++]!;
      const answer = await answerOne(q, arm, repeat, shared);
      spent += answer.calls.reduce((c, x) => c + (x.reused ? 0 : x.cost), 0);
      answers.push(answer);
      if (opts.outDir) appendFileSync(join(opts.outDir, "answers.jsonl"), JSON.stringify(answer) + "\n");
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency }, worker));
  return answers;
}

async function answerOne(q: Question, arm: ArmName, repeat: number, opts: RunOptions): Promise<Answer> {
  const base = { questionId: q.id, type: q.abstention ? "abstention" : q.type, arm, repeat };
  let result: ArmResult | undefined;
  try {
    result = await runArm(arm, q, { ...opts, seed: repeat });
    if (!result.answer.trim()) return { ...base, ...result, pass: false, judgeReply: "", error: "Empty answer: the reader returned no text." };
    const verdict = await judge(opts.model, opts.judgeModel, q, result.answer);
    result.calls.push({ purpose: "judge", model: opts.judgeModel, ...verdict.usage, cost: costOf(opts.judgeModel, verdict.usage), latencyMs: verdict.latencyMs });
    return { ...base, ...result, pass: verdict.pass, judgeReply: verdict.reply };
  } catch (err) {
    // A failed call counts as a wrong answer, unless the API itself failed (an outage), which is left out of
    // accuracy instead, since outages hit the arms with the biggest prompts hardest. The error is kept either way.
    // Calls made before the failure, and a billed call that failed, keep their cost and tokens.
    if (result) {
      if (err instanceof BilledError) result.calls.push({ purpose: "judge", model: opts.judgeModel, ...err.usage, cost: costOf(opts.judgeModel, err.usage), latencyMs: err.latencyMs });
      return { ...base, ...result, pass: false, judgeReply: "", error: String(err), ...(isOutage(err) ? { outage: true } : {}) };
    }
    const calls = (err as { calls?: Answer["calls"] }).calls ?? [];
    return { ...base, answer: "", calls, contextTokens: 0, toolCalls: 0, pass: false, judgeReply: "", error: String(err), ...(isOutage(err) ? { outage: true } : {}) };
  }
}

export interface ArmSummary {
  arm: ArmName;
  questions: number;
  accuracy: number;
  /** 95% bootstrap interval on accuracy, resampling questions. */
  ci: [number, number];
  byType: Record<string, { n: number; accuracy: number }>;
  /** Reader input tokens per question, all reader calls included. */
  readerInputTokens: number;
  /** Summarizer input tokens per question: what compaction reads to write its summaries. */
  summarizerInputTokens: number;
  /** Packet or context tokens per answer, over answers that didn't fail (a failed answer has none to count). */
  contextTokens: number;
  /** What the arm itself spends per question: reader and summarizer, not grading. */
  costPerQuestion: number;
  /** The judge's cost per question, the same job for every arm, so it's kept out of the arm's own cost. */
  judgeCostPerQuestion: number;
  /** What this arm adds to the run's bill, judge included. A summary another arm already paid for isn't counted again. */
  totalCost: number;
  readerLatencyMs: number;
  toolCallsPerQuestion: number;
  /** Failed answers scored as wrong. */
  errors: number;
  /** Answers lost to an API outage, left out of accuracy and the paired tables. */
  outages: number;
}

export function summarize(answers: Answer[], arms: ArmName[]): ArmSummary[] {
  return arms.map((arm) => {
    const mine = answers.filter((a) => a.arm === arm);
    const n = mine.length || 1;
    const sum = (f: (a: Answer) => number) => mine.reduce((acc, a) => acc + f(a), 0);
    const reader = (a: Answer) => a.calls.filter((c) => c.purpose === "reader");
    const byType: ArmSummary["byType"] = {};
    const scored = mine.filter((a) => !a.outage);
    for (const a of scored) {
      const t = (byType[a.type] ??= { n: 0, accuracy: 0 });
      t.n++;
      t.accuracy += a.pass ? 1 : 0;
    }
    for (const t of Object.values(byType)) t.accuracy /= t.n;
    const ownCost = sum((a) => a.calls.reduce((c, x) => c + x.cost, 0));
    const totalCost = sum((a) => a.calls.reduce((c, x) => c + (x.reused ? 0 : x.cost), 0));
    const judgeCost = sum((a) => a.calls.filter((c) => c.purpose === "judge").reduce((c, x) => c + x.cost, 0));
    const ok = mine.filter((a) => !a.error);
    return {
      arm,
      questions: mine.length,
      accuracy: scored.filter((a) => a.pass).length / (scored.length || 1),
      ci: bootstrap(perQuestion(scored)),
      byType,
      readerInputTokens: sum((a) => reader(a).reduce((c, x) => c + x.input, 0)) / n,
      summarizerInputTokens: sum((a) => a.calls.filter((c) => c.purpose === "summarizer").reduce((c, x) => c + x.input, 0)) / n,
      contextTokens: ok.reduce((acc, a) => acc + a.contextTokens, 0) / (ok.length || 1),
      costPerQuestion: (ownCost - judgeCost) / n,
      judgeCostPerQuestion: judgeCost / n,
      totalCost,
      readerLatencyMs: sum((a) => reader(a).reduce((c, x) => c + x.latencyMs, 0)) / n,
      toolCallsPerQuestion: sum((a) => a.toolCalls) / n,
      errors: mine.filter((a) => a.error && !a.outage).length,
      outages: mine.length - scored.length,
    };
  });
}

export function summaryTable(rows: ArmSummary[], withAccuracy = true): string {
  // Reader input (every reader call, tool results included) is the headline token number; the packet or
  // summary alone understates what the reader takes in once it searches.
  const cols = ["Arm", ...(withAccuracy ? ["Accuracy", "95% interval", "Errors", "Outages, left out"] : []), "Reader input tokens", "Summarizer input tokens", "Packet or context tokens", "Searches", "Arm cost / question", "Judge cost / question", "Total cost, judge included"];
  const lines = rows.map((r) => {
    const cells = [
      r.arm,
      ...(withAccuracy ? [pct(r.accuracy), `${pct(r.ci[0])} to ${pct(r.ci[1])}`, String(r.errors), String(r.outages)] : []),
      Math.round(r.readerInputTokens).toLocaleString("en-US"),
      Math.round(r.summarizerInputTokens).toLocaleString("en-US"),
      Math.round(r.contextTokens).toLocaleString("en-US"),
      r.toolCallsPerQuestion.toFixed(1),
      `$${r.costPerQuestion.toFixed(4)}`,
      `$${r.judgeCostPerQuestion.toFixed(4)}`,
      `$${r.totalCost.toFixed(2)}`,
    ];
    return `| ${cells.join(" | ")} |`;
  });
  return [`| ${cols.join(" | ")} |`, `| ${cols.map(() => "---").join(" | ")} |`, ...lines].join("\n");
}

export function writeSummary(dir: string, rows: ArmSummary[], header: string, withAccuracy = true, answers: Answer[] = []): void {
  mkdirSync(dir, { recursive: true });
  // Against bare: what any context adds. Against packet: the comparison the project is about.
  const arms = rows.map((r) => r.arm);
  const paired = withAccuracy ? [pairedTable(answers, arms, "bare"), pairedTable(answers, arms, "packet")].filter(Boolean).join("\n\n") : "";
  writeFileSync(join(dir, "summary.json"), JSON.stringify(rows, null, 2));
  writeFileSync(join(dir, "summary.md"), `${header}\n\n${summaryTable(rows, withAccuracy)}\n${paired ? `\n${paired}\n` : ""}`);
}

/**
 * Each arm against another on the same questions. Against `bare` (no packet, same tools) it is the clean "what does the
 * context add"; against `packet` it is how each other way of giving history compares with the packet.
 * The interval resamples questions, so an interval that spans 0 is no evidence of a difference.
 */
export function pairedTable(answers: Answer[], arms: ArmName[], against: ArmName = "bare"): string {
  if (!arms.includes(against)) return "";
  answers = answers.filter((a) => !a.outage);
  const base = perQuestion(answers.filter((a) => a.arm === against));
  const rows = arms
    .filter((arm) => arm !== against)
    .map((arm) => {
      const mine = perQuestion(answers.filter((a) => a.arm === arm));
      const ids = [...mine.keys()].filter((id) => base.has(id));
      const diffs = new Map(ids.map((id) => [id, mine.get(id)! - base.get(id)!]));
      const mean = ids.reduce((a, id) => a + diffs.get(id)!, 0) / (ids.length || 1);
      const [lo, hi] = bootstrap(diffs);
      return `| ${arm} | ${ids.length} | ${signed(mean)} | ${signed(lo)} to ${signed(hi)} |`;
    });
  return [`Paired against ${against}, same questions:`, "", "| Arm | Questions | Accuracy difference | 95% interval |", "| --- | --- | --- | --- |", ...rows].join("\n");
}

/** Each question's pass rate across repeats, so repeats of one question aren't counted as separate questions. */
function perQuestion(answers: Answer[]): Map<string, number> {
  const tally = new Map<string, { pass: number; n: number }>();
  for (const a of answers) {
    const t = tally.get(a.questionId) ?? { pass: 0, n: 0 };
    t.pass += a.pass ? 1 : 0;
    t.n++;
    tally.set(a.questionId, t);
  }
  return new Map([...tally].map(([id, t]) => [id, t.pass / t.n]));
}

/** Percentile bootstrap of the mean over questions, seeded so the same answers give the same interval. */
export function bootstrap(values: Map<string, number>, draws = 2000): [number, number] {
  const xs = [...values.values()];
  if (!xs.length) return [0, 0];
  let a = 20261126;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const means = Array.from({ length: draws }, () => {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += xs[Math.floor(rand() * xs.length)]!;
    return s / xs.length;
  }).sort((x, y) => x - y);
  return [means[Math.floor(draws * 0.025)]!, means[Math.ceil(draws * 0.975) - 1]!];
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const signed = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}`;
