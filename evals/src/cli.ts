// `long-con eval <command>`: recall, estimate, run. See evals/README.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { buildPacket, estimateTokens, PROFILES, type Profile } from "@long-con/core";
import { ARMS, type ArmName } from "./arms.ts";
import { EstimatingModel } from "./estimate.ts";
import { loadLongMemEval, stratifiedSlice, type Question } from "./longmemeval.ts";
import { AnthropicModel } from "./model.ts";
import { packetRecall } from "./recall.ts";
import { runEval, summarize, summaryTable, writeSummary, type RunOptions } from "./run.ts";

const ROOT = new URL("../..", import.meta.url).pathname;
const DATA = join(ROOT, "evals/data/longmemeval/longmemeval_s_cleaned.json");
const SLICE = join(ROOT, "evals/slices/longmemeval-s-dev50.json");
const RESULTS = join(ROOT, "evals/results");

const usage = `Usage: long-con eval <command> [options]

Commands:
  recall     Free check: is each question's evidence in the packet? No model calls.
  estimate   Dry run of all four arms with a stand-in model, to price a real run.
  run        Real run on the dev slice. Needs ANTHROPIC_API_KEY. Stops if the estimate passes --max-cost.

Options:
  --data <path>        LongMemEval_S file (default evals/data/longmemeval/longmemeval_s_cleaned.json)
  --budgets <list>     Packet budgets for recall, in tokens (default 2000,4000,8000,16000)
  --arms <list>        Arms for estimate/run (default full,compaction,packet,bare)
  --reader <model>     Reader model (default claude-haiku-5-5)
  --judge <model>      Judge model (default claude-opus-5-5)
  --limit <n>          Only the first n dev questions
  --max-cost <usd>     Refuse a run whose estimate is higher (default 5)`;

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      data: { type: "string", default: DATA },
      budgets: { type: "string", default: "2000,4000,8000,16000" },
      arms: { type: "string", default: ARMS.join(",") },
      reader: { type: "string", default: "claude-haiku-5-5" },
      judge: { type: "string", default: "claude-opus-5-5" },
      limit: { type: "string" },
      "max-cost": { type: "string", default: "5" },
    },
  });
  const command = positionals[0];
  if (!command || !["recall", "estimate", "run"].includes(command)) {
    console.log(usage);
    return command ? 1 : 0;
  }
  if (!existsSync(values.data)) {
    console.error(`No LongMemEval data at ${values.data}. Run evals/scripts/fetch-longmemeval.sh first.`);
    return 1;
  }

  console.error("Loading LongMemEval_S...");
  let dev = devSlice(loadLongMemEval(values.data));
  if (values.limit) dev = dev.slice(0, Number(values.limit));

  if (command === "recall") {
    const report = recallReport(dev, values.budgets.split(",").map(Number));
    mkdirSync(RESULTS, { recursive: true });
    writeFileSync(join(RESULTS, "longmemeval-s-dev50-recall.md"), report);
    console.log(report);
    return 0;
  }

  const arms = values.arms.split(",") as ArmName[];
  const base = { arms, reader: values.reader, judgeModel: values.judge, profile: PROFILES.claude, compactAt: 30_000, maxToolRounds: 3, concurrency: 4 };
  const estimate = summarize(await runEval(dev, { ...base, model: new EstimatingModel() }), arms);
  const estimatedTotal = estimate.reduce((a, r) => a + r.totalCost, 0);
  const estimateHeader = `# Cost estimate: ${dev.length} LongMemEval_S dev questions\n\nReader ${values.reader}, judge ${values.judge}. Token counts are estimates (about 3.5 characters per token), and every tool-enabled arm is assumed to search once. Estimated total: **$${estimatedTotal.toFixed(2)}**.`;

  if (command === "estimate") {
    writeFileSync(join(RESULTS, "longmemeval-s-dev50-estimate.md"), `${estimateHeader}\n\n${summaryTable(estimate, false)}\n`);
    console.log(`${estimateHeader}\n\n${summaryTable(estimate, false)}`);
    return 0;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY isn't set, so there's no real run. `long-con eval recall` and `estimate` work without it.");
    return 1;
  }
  const maxCost = Number(values["max-cost"]);
  if (estimatedTotal > maxCost) {
    console.error(`Estimated $${estimatedTotal.toFixed(2)} is over --max-cost $${maxCost}. Nothing was run.`);
    return 1;
  }
  const outDir = join(ROOT, "evals/runs", new Date().toISOString().replace(/[:.]/g, "-"));
  const opts: RunOptions = { ...base, model: new AnthropicModel(), outDir };
  const rows = summarize(await runEval(dev, opts), arms);
  writeSummary(outDir, rows, `# LongMemEval_S dev run: ${dev.length} questions\n\nReader ${values.reader}, judge ${values.judge} reading LongMemEval's own judge prompts.`);
  console.log(summaryTable(rows));
  console.error(`Answers and summary in ${outDir}`);
  return 0;
}

/** The fixed dev slice. Its question ids are committed, so it never moves even if the picking code changes. */
function devSlice(all: Question[]): Question[] {
  if (!existsSync(SLICE)) {
    const { dev } = stratifiedSlice(all, 50, 20261125);
    mkdirSync(join(ROOT, "evals/slices"), { recursive: true });
    const note = "50 LongMemEval_S questions, stratified by type with seed 20261125. Tune on these; everything else is held out.";
    writeFileSync(SLICE, JSON.stringify({ note, seed: 20261125, ids: dev.map((q) => q.id) }, null, 2) + "\n");
  }
  const ids: string[] = JSON.parse(readFileSync(SLICE, "utf8")).ids;
  const byId = new Map(all.map((q) => [q.id, q]));
  return ids.map((id) => byId.get(id)!).filter(Boolean);
}

function recallReport(dev: Question[], budgets: number[]): string {
  const answerable = dev.filter((q) => !q.abstention);
  const fullTokens = mean(dev.map((q) => estimateTokens(q.sessions.flatMap((s) => s.turns.map((t) => t.content)).join("\n"))));
  const rows: string[] = [];
  let byType = "";
  for (const budget of budgets) {
    const profile: Profile = { ...PROFILES.claude, packetTokens: budget };
    const results = answerable.map((q) => {
      const packet = buildPacket({ history: q.sessions, message: q.question, profile });
      return { q, packet, recall: packetRecall(q, packet) };
    });
    rows.push(
      `| ${budget.toLocaleString("en-US")} | ${pct(mean(results.map((r) => r.recall.sessionRecall)))} | ${pct(mean(results.map((r) => r.recall.turnRecall)))} | ${pct(mean(results.map((r) => (r.recall.complete ? 1 : 0))))} | ${Math.round(mean(results.map((r) => r.packet.tokens))).toLocaleString("en-US")} | ${pct(mean(results.map((r) => r.packet.tokens)) / fullTokens)} |`,
    );
    if (budget === PROFILES.claude.packetTokens) {
      const types = [...new Set(results.map((r) => r.q.type))].sort();
      byType = [
        `### By question type, at the Claude profile's ${budget.toLocaleString("en-US")}-token budget`,
        "",
        "| Type | Questions | Evidence chats found | Evidence turns found | All evidence in packet |",
        "| --- | --- | --- | --- | --- |",
        ...types.map((t) => {
          const r = results.filter((x) => x.q.type === t);
          return `| ${t} | ${r.length} | ${pct(mean(r.map((x) => x.recall.sessionRecall)))} | ${pct(mean(r.map((x) => x.recall.turnRecall)))} | ${pct(mean(r.map((x) => (x.recall.complete ? 1 : 0))))} |`;
        }),
      ].join("\n");
    }
  }
  return [
    `# Packet recall: LongMemEval_S dev slice`,
    "",
    `${answerable.length} answerable questions of the ${dev.length}-question dev slice (${dev.length - answerable.length} abstention questions have no evidence to find). Full history averages ${Math.round(fullTokens).toLocaleString("en-US")} tokens per question. Builder: BM25 only (no embeddings yet), size-based segments, Claude profile. No model calls.`,
    "",
    "| Packet budget | Evidence chats found | Evidence turns found | All evidence in packet | Mean packet tokens | Share of full history |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    byType,
    "",
  ].join("\n");
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main(process.argv.slice(2));
}
