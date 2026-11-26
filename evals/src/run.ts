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
  pass: boolean;
  judgeReply: string;
  error?: string;
}

export interface RunOptions extends ArmConfig {
  arms: ArmName[];
  judgeModel: string;
  outDir?: string;
  concurrency: number;
}

export async function runEval(questions: Question[], opts: RunOptions): Promise<Answer[]> {
  if (opts.outDir) mkdirSync(opts.outDir, { recursive: true });
  const jobs = questions.flatMap((q) => opts.arms.map((arm) => ({ q, arm })));
  const answers: Answer[] = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { q, arm } = jobs[next++]!;
      const answer = await answerOne(q, arm, opts);
      answers.push(answer);
      if (opts.outDir) appendFileSync(join(opts.outDir, "answers.jsonl"), JSON.stringify(answer) + "\n");
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency }, worker));
  return answers;
}

async function answerOne(q: Question, arm: ArmName, opts: RunOptions): Promise<Answer> {
  const base = { questionId: q.id, type: q.abstention ? "abstention" : q.type, arm };
  try {
    const result = await runArm(arm, q, opts);
    const verdict = await judge(opts.model, opts.judgeModel, q, result.answer);
    result.calls.push({ purpose: "judge", model: opts.judgeModel, ...verdict.usage, cost: costOf(opts.judgeModel, verdict.usage), latencyMs: verdict.latencyMs });
    return { ...base, ...result, pass: verdict.pass, judgeReply: verdict.reply };
  } catch (err) {
    // A failed call counts as a wrong answer, and the error is kept so it can be looked at.
    return { ...base, answer: "", calls: [], contextTokens: 0, toolCalls: 0, pass: false, judgeReply: "", error: String(err) };
  }
}

export interface ArmSummary {
  arm: ArmName;
  questions: number;
  accuracy: number;
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
  const cols = ["Arm", ...(withAccuracy ? ["Accuracy"] : []), "Context tokens", "Reader input tokens", "Tool calls", "Cost / question", "Total cost"];
  const lines = rows.map((r) => {
    const cells = [
      r.arm,
      ...(withAccuracy ? [`${(r.accuracy * 100).toFixed(1)}%`] : []),
      Math.round(r.contextTokens).toLocaleString("en-US"),
      Math.round(r.readerInputTokens).toLocaleString("en-US"),
      r.toolCallsPerQuestion.toFixed(1),
      `$${r.costPerQuestion.toFixed(4)}`,
      `$${r.totalCost.toFixed(2)}`,
    ];
    return `| ${cells.join(" | ")} |`;
  });
  return [`| ${cols.join(" | ")} |`, `| ${cols.map(() => "---").join(" | ")} |`, ...lines].join("\n");
}

export function writeSummary(dir: string, rows: ArmSummary[], header: string, withAccuracy = true): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "summary.json"), JSON.stringify(rows, null, 2));
  writeFileSync(join(dir, "summary.md"), `${header}\n\n${summaryTable(rows, withAccuracy)}\n`);
}
