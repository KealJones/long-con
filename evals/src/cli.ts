// `long-con eval <command>`: recall, estimate, run. See evals/README.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Bm25, buildPacket, contentWords, estimateTokens, PROFILES, profileByName, splitIntoSegments, type Profile, type Segment } from "@long-con/core";
import { ARMS, firstMessages, SEARCH_TOOL, searchHistory, SYSTEM, type ArmName } from "./arms.ts";
import { recallChart, type Series } from "./chart.ts";
import { EstimatingModel } from "./estimate.ts";
import { heldOutSplit, loadLongMemEval, stratifiedSlice, type Question } from "./longmemeval.ts";
import { AnthropicModel, PRICES } from "./model.ts";
import { packetRecall } from "./recall.ts";
import { bootstrap, runEval, summarize, summaryTable, writeSummary, type RunOptions } from "./run.ts";
import { SubagentModel } from "./subagent.ts";

const ROOT = new URL("../..", import.meta.url).pathname;
const DATA = join(ROOT, "evals/data/longmemeval/longmemeval_s_cleaned.json");
const SLICE = join(ROOT, "evals/slices/longmemeval-s-dev50.json");
const RESULTS = join(ROOT, "evals/results");
const PROFILE_NAMES = Object.values(PROFILES).map((p) => p.name);
const COST_CAVEATS = "Cost caveats: Haiku 5.5 bills prompts over 100K tokens at 5x, which every full-history call crosses; prompt caching isn't modeled, though in a long chat a cached history costs about a tenth; each question pays for its own compaction summaries, which a real chat spreads over many turns.";
const SWEEP = [1000, 1500, 2000, 2500, 3000, 4000, 6000, 8000];

const usage = `Usage: long-con eval <command> [options]

Commands:
  recall     Free check: is each question's evidence in the packet? No model calls.
  estimate   Dry run of the arms with a stand-in model, to price a real run.
  run        Answer and judge the dev slice. --backend subagent (default) runs on a Claude plan through
             subagents; --backend api uses ANTHROPIC_API_KEY and stops if the estimate passes --max-cost.

Options:
  --profile <name>     Model profile: ${PROFILE_NAMES.join(", ")} (recall runs all of them by default; others default to claude)
  --data <path>        LongMemEval_S file (default evals/data/longmemeval/longmemeval_s_cleaned.json)
  --arms <list>        Arms for estimate/run (default ${ARMS.join(",")})
  --reader <model>     Reader model (default claude-haiku-5-5)
  --judge <model>      Judge model (default claude-opus-5-5)
  --split <name>       dev (default, the 50 tuning questions) or held-out (the rest minus any that share evidence with dev: 437, for headline numbers)
  --limit <n>          A smaller stratified pick of the split
  --repeats <n>        Run every question n times; intervals then cover run-to-run noise (default 1)
  --backend <name>     subagent (default) or api
  --no-tools           No search tool for any arm (the subagent backend needs this)
  --out <dir>          Where a run writes its prompts, answers and summary
  --max-cost <usd>     Refuse an API run whose estimate is higher, and stop starting new answers once a run has spent it (default 5)`;

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      profile: { type: "string" },
      data: { type: "string", default: DATA },
      arms: { type: "string", default: ARMS.join(",") },
      reader: { type: "string", default: "claude-haiku-5-5" },
      judge: { type: "string", default: "claude-opus-5-5" },
      split: { type: "string", default: "dev" },
      limit: { type: "string" },
      repeats: { type: "string", default: "1" },
      backend: { type: "string", default: "subagent" },
      "no-tools": { type: "boolean", default: false },
      out: { type: "string" },
      "max-cost": { type: "string", default: "5" },
    },
  });
  const command = positionals[0];
  if (!command || !["recall", "estimate", "run"].includes(command)) {
    console.log(usage);
    return command ? 1 : 0;
  }
  const picked = values.profile ? profileByName(values.profile) : undefined;
  if (values.profile && !picked) {
    console.error(`No profile named ${values.profile}. Profiles: ${PROFILE_NAMES.join(", ")}`);
    return 1;
  }
  if (!existsSync(values.data)) {
    console.error(`No LongMemEval data at ${values.data}. Run evals/scripts/fetch-longmemeval.sh first.`);
    return 1;
  }

  console.error("Loading LongMemEval_S...");
  if (!["dev", "held-out"].includes(values.split)) {
    console.error(`Unknown split ${values.split}: use dev or held-out.`);
    return 1;
  }
  if (values.split === "held-out" && command === "recall") {
    console.error("Recall is a tuning check, so it runs on dev only.");
    return 1;
  }
  const all = loadLongMemEval(values.data);
  let dev = devSlice(all);
  if (values.split === "held-out") {
    // Held-out shares no evidence with dev (siblings and identical chats are grouped), so tuning on dev can't leak into it.
    const { heldOut, excluded } = heldOutSplit(all, dev);
    console.error(`Held-out: ${heldOut.length} questions; ${excluded} more share evidence with dev and are left out.`);
    dev = heldOut;
  }
  // A stratified pick, so a short run isn't all one easy question type.
  if (values.limit) {
    const limit = Number(values.limit);
    if (!Number.isInteger(limit) || limit < 1) {
      console.error("--limit must be a whole number of 1 or more.");
      return 1;
    }
    dev = stratifiedSlice(dev, limit, 1).dev;
  }

  if (command === "recall") {
    const profiles = picked ? [picked] : Object.values(PROFILES);
    const { report, chart } = recallReport(dev, profiles);
    // Only the full dev slice with every profile is the committed report; anything narrower just prints.
    if (!picked && !values.limit) {
      mkdirSync(RESULTS, { recursive: true });
      writeFileSync(join(RESULTS, "longmemeval-s-dev50-recall.md"), report);
      writeFileSync(join(RESULTS, "longmemeval-s-dev50-recall.svg"), chart);
    }
    console.log(report);
    return 0;
  }

  const chosen = picked ?? PROFILES.claude;
  // Every arm gets the same tools, so turning them off turns them off for all.
  const profile: Profile = values["no-tools"] ? { ...chosen, maxToolRounds: 0 } : chosen;
  const tools = profile.maxToolRounds ? `up to ${profile.maxToolRounds} searches per arm` : "no tools for any arm";
  const arms = values.arms.split(",") as ArmName[];
  const repeats = Number(values.repeats);
  const unknown = arms.filter((a) => !ARMS.includes(a));
  // An unpriced model would make every estimate $0 and slip past --max-cost, so it stops here.
  const unpriced = [values.reader, values.judge].filter((m) => !PRICES[m]);
  if (unpriced.length) {
    console.error(`No price for ${unpriced.join(" or ")}: add it to PRICES in evals/src/model.ts. Nothing was run.`);
    return 1;
  }
  if (unknown.length || !Number.isInteger(repeats) || repeats < 1) {
    console.error(unknown.length ? `Unknown arm ${unknown.join(", ")}: use ${ARMS.join(", ")}.` : `--repeats must be a whole number of 1 or more.`);
    return 1;
  }
  const base = { arms, reader: values.reader, judgeModel: values.judge, profile, concurrency: 4, repeats };
  const estimate = summarize(await runEval(dev, { ...base, model: new EstimatingModel(true) }), arms);
  const estimatedTotal = estimate.reduce((a, r) => a + r.totalCost, 0);
  const estimateErrors = estimate.reduce((a, r) => a + r.errors, 0);
  if (estimateErrors) {
    console.error(`The estimate failed on ${estimateErrors} answers, so its total can't be trusted. Nothing was run.`);
    return 1;
  }

  if (command === "estimate") {
    // The cap uses the ceiling. The no-search floor shows how much of the gap between arms is the ceiling's assumption.
    const floor = summarize(await runEval(dev, { ...base, model: new EstimatingModel(false) }), arms);
    const floorTotal = floor.reduce((a, r) => a + r.totalCost, 0);
    const report = [
      `# Cost estimate: ${dev.length} LongMemEval_S ${values.split} questions × ${repeats} run(s), ${profile.name} profile`,
      `Reader ${values.reader}, judge ${values.judge}. Token counts are estimates (about 3.5 characters per token). A real run lands between the two tables: readers search when they need to, not always or never. The --max-cost check uses the ceiling. ${COST_CAVEATS}`,
      `## Ceiling: every arm that can search uses every search it's allowed. Total **$${estimatedTotal.toFixed(2)}**`,
      summaryTable(estimate, false),
      `## Floor: no arm searches. Total **$${floorTotal.toFixed(2)}**`,
      summaryTable(floor, false),
    ].join("\n\n");
    // Only the full dev slice is the committed estimate; other splits and picks just print.
    if (values.split === "dev" && !values.limit && repeats === 1) writeFileSync(join(RESULTS, `longmemeval-s-dev50-estimate-${profile.name}.md`), `${report}\n`);
    console.log(report);
    return 0;
  }

  if (values.backend === "subagent") {
    if (profile.maxToolRounds > 0) {
      console.error("The subagent backend can't run the search tool. Add --no-tools. Nothing was run.");
      return 1;
    }
    const outDir = values.out ?? join(RESULTS, "smoke", profile.name);
    const model = new SubagentModel(outDir);
    const answers = await runEval(dev, { ...base, model, concurrency: 1 });
    const waiting = answers.filter((a) => a.error?.includes("Pending")).length;
    if (waiting) {
      console.log(`${waiting} answers wait on subagents. Answer each file in ${join(outDir, "pending")} into ${join(outDir, "answers")} under the same name, then run this again.`);
      return 2;
    }
    const rows = summarize(answers, arms);
    writeFileSync(join(outDir, "answers.jsonl"), answers.map((a) => JSON.stringify(a)).join("\n") + "\n");
    writeSummary(
      outDir,
      rows,
      `# Smoke run: ${dev.length} LongMemEval_S ${values.split} questions, ${profile.name} profile\n\nBackend: subagents on a Claude plan, reader ${values.reader}, judge ${values.judge}, ${tools}. Token counts are estimates of the prompt alone. Cost and latency are not comparable with API runs, and this sample is small.`,
      true,
      answers,
    );
    console.log(summaryTable(rows));
    return 0;
  }
  if (values.backend !== "api") {
    console.error(`Unknown backend ${values.backend}: use subagent or api.`);
    return 1;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY isn't set, so there's no real run. `long-con eval recall` and `estimate` work without it.");
    return 1;
  }
  const maxCost = Number(values["max-cost"]);
  if (!Number.isFinite(maxCost) || maxCost < 0) {
    console.error(`--max-cost must be a number of dollars, like 2. Got "${values["max-cost"]}". Nothing was run.`);
    return 1;
  }
  if (estimatedTotal > maxCost) {
    console.error(`Estimated $${estimatedTotal.toFixed(2)} is over --max-cost $${maxCost}. Nothing was run.`);
    return 1;
  }
  const outDir = values.out ?? join(ROOT, "evals/runs", new Date().toISOString().replace(/[:.]/g, "-"));
  const opts: RunOptions = { ...base, model: new AnthropicModel(), outDir, maxCost };
  const answers = await runEval(dev, opts);
  const rows = summarize(answers, arms);
  const planned = dev.length * arms.length * repeats;
  const stopped = answers.length < planned ? ` **Stopped at the --max-cost cap after ${answers.length} of ${planned} answers, so arms may cover different questions; trust only the paired tables.**` : "";
  if (stopped) console.error(stopped.replaceAll("**", "").trim());
  writeSummary(
    outDir,
    rows,
    `# LongMemEval_S ${values.split} run: ${dev.length} questions × ${values.repeats} run(s), ${profile.name} profile\n\nBackend: Anthropic API. Reader ${values.reader}, judge ${values.judge} reading LongMemEval's own judge prompts, ${tools}. ${COST_CAVEATS}${stopped}`,
    true,
    answers,
  );
  console.log(summaryTable(rows));
  console.error(`Answers and summary in ${outDir}`);
  return 0;
}

/** The fixed dev slice. Its question ids are committed, so it never moves even if the picking code changes. */
export function devSlice(all: Question[]): Question[] {
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

interface RecallRun {
  q: Question;
  tokens: number;
  sessionRecall: number;
  turnRecall: number;
  complete: boolean;
}

// Every LongMemEval_S history (about 140K tokens) is past both profiles' switch points, so the packet always runs.
function recallRuns(questions: Question[], profile: Profile): RecallRun[] {
  return questions.map((q) => {
    const packet = buildPacket({ history: q.sessions, message: q.question, profile });
    return { q, tokens: packet.tokens, ...packetRecall(q, packet, profile.segmentTokens) };
  });
}

/**
 * The plain-retrieval baseline: BM25 over all words, the same units, top hits until the same ceiling.
 * No user-word ranking, cutoff, dedupe, registers or notices. Tokens count the unit text alone, which flatters it slightly.
 */
function bm25Runs(questions: Question[], profile: Profile): RecallRun[] {
  return questions.map((q) => {
    const index = new Bm25<Segment>();
    for (const s of q.sessions) for (const seg of splitIntoSegments(s, profile.segmentTokens)) index.add(seg, contentWords(seg.turns.map((t) => t.content).join("\n")));
    const picked: Segment[] = [];
    const texts: string[] = [];
    let tokens = 0;
    for (const { item } of index.search(contentWords(q.question), 1000)) {
      const text = item.turns.map((t) => `${t.role}: ${t.content}`).join("\n");
      const cost = estimateTokens(text);
      if (tokens + cost > profile.packetTokens) continue;
      picked.push(item);
      texts.push(text);
      tokens += cost;
    }
    const segments = picked.map((s) => ({ ...s, confidence: 1, why: "bm25" }));
    return { q, tokens, ...packetRecall(q, { segments, text: texts.join("\n") }, profile.segmentTokens) };
  });
}

/** The reader's real input: system prompt, tool definition, packet and question, plus one search if it runs one. */
function readerInput(q: Question, profile: Profile): { first: number; withSearch: number } {
  const { messages } = firstMessages("packet", q, profile);
  const text = messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
  const tool = profile.maxToolRounds > 0 ? JSON.stringify(SEARCH_TOOL) : "";
  const first = estimateTokens(SYSTEM + tool + text);
  const search = profile.maxToolRounds > 0 ? estimateTokens(searchHistory(q.sessions, q.question, profile)) + 50 : 0;
  return { first, withSearch: first + search };
}

function recallReport(dev: Question[], profiles: Profile[]): { report: string; chart: string } {
  const answerable = dev.filter((q) => !q.abstention);
  const fullTokens = mean(dev.map((q) => estimateTokens(q.sessions.flatMap((s) => s.turns.map((t) => t.content)).join("\n"))));
  const main: string[] = [];
  const paired: string[] = [];
  const input: string[] = [];
  const sweeps: string[] = [];
  const byType: string[] = [];
  const series: Series[] = [];
  const seen = new Map<string, string>();

  for (const profile of profiles) {
    const runs = recallRuns(answerable, profile);
    const complete = mean(runs.map((r) => (r.complete ? 1 : 0)));
    const tokens = mean(runs.map((r) => r.tokens));
    main.push(
      `| ${profile.name} | ${fmt(profile.packetTokens)} | ${pct(mean(runs.map((r) => r.sessionRecall)))} | ${pct(mean(runs.map((r) => r.turnRecall)))} | ${pct(complete)} | ${interval(completes(runs))} | ${fmt(tokens)} | ${fmt(Math.max(...runs.map((r) => r.tokens)))} |`,
    );

    const base = bm25Runs(answerable, profile);
    const baseComplete = mean(base.map((r) => (r.complete ? 1 : 0)));
    const baseTokens = mean(base.map((r) => r.tokens));
    main.push(
      `| ${profile.name}: plain BM25 top-k | ${fmt(profile.packetTokens)} | ${pct(mean(base.map((r) => r.sessionRecall)))} | ${pct(mean(base.map((r) => r.turnRecall)))} | ${pct(baseComplete)} | ${interval(completes(base))} | ${fmt(baseTokens)} | ${fmt(Math.max(...base.map((r) => r.tokens)))} |`,
    );

    const ours = completes(runs);
    const theirs = completes(base);
    const diffs = new Map([...ours].map(([id, v]) => [id, v - theirs.get(id)!]));
    const [lo, hi] = bootstrap(diffs);
    paired.push(`| ${profile.name} | ${signed(complete - baseComplete)} | ${signed(lo)} to ${signed(hi)} | ${[...diffs.values()].filter((d) => d > 0).length} | ${[...diffs.values()].filter((d) => d < 0).length} |`);

    const inputs = dev.map((q) => readerInput(q, profile));
    const room = profile.contextWindow - profile.answerTokens;
    input.push(
      `| ${profile.name} | ${fmt(profile.contextWindow)} | ${fmt(mean(inputs.map((i) => i.first)))} | ${fmt(Math.max(...inputs.map((i) => i.first)))} | ${fmt(mean(inputs.map((i) => i.withSearch)))} | ${fmt(Math.max(...inputs.map((i) => i.withSearch)))} | ${inputs.filter((i) => i.withSearch <= room).length} of ${inputs.length} |`,
    );

    const types = [...new Set(runs.map((r) => r.q.type))].sort();
    byType.push(
      `### ${profile.name}`,
      "",
      "| Type | Questions | Evidence turns found | All evidence in packet | Mean packet tokens |",
      "| --- | --- | --- | --- | --- |",
      ...types.map((t) => {
        const r = runs.filter((x) => x.q.type === t);
        return `| ${t} | ${r.length} | ${pct(mean(r.map((x) => x.turnRecall)))} | ${pct(mean(r.map((x) => (x.complete ? 1 : 0))))} | ${fmt(mean(r.map((x) => x.tokens)))} |`;
      }),
      "",
    );

    // Fixed fills each budget; adaptive stops adding weak matches. Same ceilings, same segment cap.
    const points = { fixed: [] as Series["points"], adaptive: [] as Series["points"] };
    const rows: string[] = [];
    for (const budget of SWEEP) {
      const cells: string[] = [];
      for (const mode of ["fixed", "adaptive"] as const) {
        const p: Profile = { ...profile, packetTokens: budget, minConfidence: mode === "fixed" ? 0 : profile.minConfidence };
        const r = recallRuns(answerable, p);
        const c = mean(r.map((x) => (x.complete ? 1 : 0)));
        const t = mean(r.map((x) => x.tokens));
        points[mode].push({ x: t, y: c });
        cells.push(pct(c), fmt(t));
      }
      rows.push(`| ${fmt(budget)} | ${cells.join(" | ")} |`);
    }
    const key = rows.join("\n");
    const twin = seen.get(key);
    seen.set(key, twin ?? profile.name);
    if (twin) {
      for (const sr of series) if (sr.name.startsWith(`${twin} `)) sr.name = sr.name.replace(twin, "both profiles");
      sweeps.push(`### ${profile.name}`, "", `Same as ${twin}: the sweep only moves the ceiling, and both share segment cap ${fmt(profile.segmentTokens)} and cutoff ${profile.minConfidence}.`, "");
      continue;
    }
    const at8k = (mode: "fixed" | "adaptive") => points[mode].at(-1)!.y;
    const smallest = (mode: "fixed" | "adaptive") => SWEEP[points[mode].findIndex((p) => p.y >= at8k(mode) - 0.02)]!;
    sweeps.push(
      `### ${profile.name} (segment cap ${fmt(profile.segmentTokens)}, cutoff ${profile.minConfidence})`,
      "",
      "| Budget ceiling | Fixed: all evidence | Fixed: mean tokens | Adaptive: all evidence | Adaptive: mean tokens |",
      "| --- | --- | --- | --- | --- |",
      ...rows,
      "",
      `Smallest ceiling within 2 points of its own 8K score: fixed ${fmt(smallest("fixed"))}, adaptive ${fmt(smallest("adaptive"))}.`,
      "",
    );
    series.push({ name: `${profile.name} fixed`, points: points.fixed, dashed: true }, { name: `${profile.name} adaptive`, points: points.adaptive });
  }

  const report = [
    `# Packet recall: LongMemEval_S dev slice`,
    "",
    `${answerable.length} answerable questions of the ${dev.length}-question dev slice (${dev.length - answerable.length} abstention questions have no evidence to find). Full history averages ${fmt(fullTokens)} tokens per question. Builder: BM25 only (no embeddings yet), size-based segments. No model calls. "All evidence in packet" means every labeled evidence turn is in it.`,
    "",
    `These are tuning numbers, not results: the segment cap and the cutoff were picked on this same slice, so they flatter the builder. With ${answerable.length} questions, one question moves "All evidence in packet" by ${pct(1 / answerable.length)}. Intervals are 95% bootstraps over questions. Two limits: an evidence chat with no labeled turn isn't counted, and recall leaves out what a reader would find by searching.`,
    "",
    "## Each profile at its own settings",
    "",
    "| Profile | Budget ceiling | Evidence chats found | Evidence turns found | All evidence in packet | 95% interval | Mean packet tokens | Largest packet |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...main,
    "",
    "Packet against plain BM25 top-k on the same questions:",
    "",
    "| Profile | All-evidence difference | 95% interval | Questions only the packet gets whole | Questions only BM25 gets whole |",
    "| --- | --- | --- | --- | --- |",
    ...paired,
    "",
    "Plain BM25 top-k is the baseline: the same units ranked by BM25 over all words and filled to the same ceiling, with nothing else. It also shows what ranking by the user's words adds, which suits LongMemEval, where 95% of the dev slice's evidence turns are user turns, and may not carry over to real chats.",
    "",
    "## What the reader takes in per question",
    "",
    "System prompt, search tool definition, packet and question; then the same plus one search result. Room for the answer is kept out of the window.",
    "",
    "| Profile | Context window | First call, mean | First call, largest | With one search, mean | With one search, largest | Fits with room to answer |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...input,
    "",
    "## Recall against packet size",
    "",
    "![Recall against packet size](longmemeval-s-dev50-recall.svg)",
    "",
    ...sweeps,
    "## By question type",
    "",
    ...byType,
  ].join("\n");
  return { report, chart: recallChart(series) };
}

const completes = (runs: RecallRun[]) => new Map(runs.map((r) => [r.q.id, r.complete ? 1 : 0]));
const interval = (values: Map<string, number>) => bootstrap(values).map(pct).join(" to ");
const signed = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fmt = (x: number) => Math.round(x).toLocaleString("en-US");

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main(process.argv.slice(2));
}
