// Runs arms over questions, judges each answer, and writes one JSON line per answer plus a summary.

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runArm, type ArmConfig, type ArmName, type ArmResult } from "./arms.ts";
import { judge } from "./judge.ts";
import type { Question } from "./longmemeval.ts";
import { costOf } from "./model.ts";

export interface Answer extends ArmResult {
  questionId: string;
  type: string;
  arm: ArmName;
  repeat: number;
  pass: boolean;
  judgeReply: string;
  error?: string;
}

export interface RunOptions extends ArmConfig {
  arms: ArmName[];
  judgeModel: string;
  outDir?: string;
  concurrency: number;
  /** Runs of every question on every arm. Above 1, the summary's intervals cover run-to-run noise too. */
  repeats?: number;
}

export async function runEval(questions: Question[], opts: RunOptions): Promise<Answer[]> {
  if (opts.outDir) mkdirSync(opts.outDir, { recursive: true });
  const repeats = Array.from({ length: opts.repeats ?? 1 }, (_, r) => r);
  const jobs = repeats.flatMap((repeat) => questions.flatMap((q) => opts.arms.map((arm) => ({ q, arm, repeat }))));
  const answers: Answer[] = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { q, arm, repeat } = jobs[next++]!;
      const answer = await answerOne(q, arm, repeat, opts);
      answers.push(answer);
      if (opts.outDir) appendFileSync(join(opts.outDir, "answers.jsonl"), JSON.stringify(answer) + "\n");
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency }, worker));
  return answers;
}

async function answerOne(q: Question, arm: ArmName, repeat: number, opts: RunOptions): Promise<Answer> {
  const base = { questionId: q.id, type: q.abstention ? "abstention" : q.type, arm, repeat };
  try {
    const result = await runArm(arm, q, { ...opts, seed: repeat });
    const verdict = await judge(opts.model, opts.judgeModel, q, result.answer);
    result.calls.push({ purpose: "judge", model: opts.judgeModel, ...verdict.usage, cost: costOf(opts.judgeModel, verdict.usage), latencyMs: verdict.latencyMs });
    return { ...base, ...result, pass: verdict.pass, judgeReply: verdict.reply };
  } catch (err) {
    // A failed call counts as a wrong answer, and the error is kept so it can be looked at.
    // Calls made before the failure keep their cost and tokens.
    const calls = (err as { calls?: Answer["calls"] }).calls ?? [];
    return { ...base, answer: "", calls, contextTokens: 0, toolCalls: 0, pass: false, judgeReply: "", error: String(err) };
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
  contextTokens: number;
  costPerQuestion: number;
  totalCost: number;
  readerLatencyMs: number;
  toolCallsPerQuestion: number;
  errors: number;
}

export function summarize(answers: Answer[], arms: ArmName[]): ArmSummary[] {
  return arms.map((arm) => {
    const mine = answers.filter((a) => a.arm === arm);
    const n = mine.length || 1;
    const sum = (f: (a: Answer) => number) => mine.reduce((acc, a) => acc + f(a), 0);
    const reader = (a: Answer) => a.calls.filter((c) => c.purpose === "reader");
    const byType: ArmSummary["byType"] = {};
    for (const a of mine) {
      const t = (byType[a.type] ??= { n: 0, accuracy: 0 });
      t.n++;
      t.accuracy += a.pass ? 1 : 0;
    }
    for (const t of Object.values(byType)) t.accuracy /= t.n;
    const totalCost = sum((a) => a.calls.reduce((c, x) => c + x.cost, 0));
    return {
      arm,
      questions: mine.length,
      accuracy: sum((a) => (a.pass ? 1 : 0)) / n,
      ci: bootstrap(perQuestion(mine)),
      byType,
      readerInputTokens: sum((a) => reader(a).reduce((c, x) => c + x.input, 0)) / n,
      contextTokens: sum((a) => a.contextTokens) / n,
      costPerQuestion: totalCost / n,
      totalCost,
      readerLatencyMs: sum((a) => reader(a).reduce((c, x) => c + x.latencyMs, 0)) / n,
      toolCallsPerQuestion: sum((a) => a.toolCalls) / n,
      errors: mine.filter((a) => a.error).length,
    };
  });
}

export function summaryTable(rows: ArmSummary[], withAccuracy = true): string {
  // Reader input (every reader call, tool results included) is the headline token number; the packet or
  // summary alone understates what the reader takes in once it searches.
  const cols = ["Arm", ...(withAccuracy ? ["Accuracy", "95% interval", "Errors"] : []), "Reader input tokens", "Packet or context tokens", "Searches", "Cost / question", "Total cost"];
  const lines = rows.map((r) => {
    const cells = [
      r.arm,
      ...(withAccuracy ? [pct(r.accuracy), `${pct(r.ci[0])} to ${pct(r.ci[1])}`, String(r.errors)] : []),
      Math.round(r.readerInputTokens).toLocaleString("en-US"),
      Math.round(r.contextTokens).toLocaleString("en-US"),
      r.toolCallsPerQuestion.toFixed(1),
      `$${r.costPerQuestion.toFixed(4)}`,
      `$${r.totalCost.toFixed(2)}`,
    ];
    return `| ${cells.join(" | ")} |`;
  });
  return [`| ${cols.join(" | ")} |`, `| ${cols.map(() => "---").join(" | ")} |`, ...lines].join("\n");
}

export function writeSummary(dir: string, rows: ArmSummary[], header: string, withAccuracy = true, answers: Answer[] = []): void {
  mkdirSync(dir, { recursive: true });
  const paired = withAccuracy ? pairedTable(answers, rows.map((r) => r.arm)) : "";
  writeFileSync(join(dir, "summary.json"), JSON.stringify(rows, null, 2));
  writeFileSync(join(dir, "summary.md"), `${header}\n\n${summaryTable(rows, withAccuracy)}\n${paired ? `\n${paired}\n` : ""}`);
}

/**
 * Each arm against `bare` (no packet, same tools) on the same questions: the clean "what does the context add".
 * The interval resamples questions, so an interval that spans 0 is no evidence of a difference.
 */
export function pairedTable(answers: Answer[], arms: ArmName[], against: ArmName = "bare"): string {
  if (!arms.includes(against)) return "";
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
