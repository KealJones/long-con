// The whole harness with a stand-in model: what each arm's reader actually gets to see decides its score.
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, PROFILES, type Session } from "@long-con/core";
import type { Question } from "../src/longmemeval.ts";
import { AnthropicModel, BilledError, type ModelClient, type ModelRequest, type ModelResponse } from "../src/model.ts";
import { MAX_OUTPUT } from "../src/arms.ts";
import { bootstrap, pairedTable, runEval, summarize, type Answer } from "../src/run.ts";

const filler = (i: number): Session => ({
  id: `f${i}`,
  date: `2023/04/${String(i + 1).padStart(2, "0")} (Sat) 10:00`,
  turns: [
    { role: "user", content: `can you help me plan a garden bed, number ${i}? thinking tomatoes and basil` },
    { role: "assistant", content: `Sure. Bed ${i}: tomatoes need six hours of sun, basil likes the same spot. ${"Water deeply twice a week. ".repeat(20)}` },
  ],
});

const question: Question = {
  id: "q1",
  type: "single-session-user",
  question: "Where is my sister moving?",
  date: "2023/05/30 (Tue) 23:40",
  answer: "Denver",
  abstention: false,
  sessions: [
    ...Array.from({ length: 10 }, (_, i) => filler(i)),
    { id: "answer_9c1e_1", date: "2023/04/20 (Thu) 09:00", turns: [{ role: "user", content: "my sister is moving to Denver next month" }, { role: "assistant", content: "Exciting news for her!" }] },
    ...Array.from({ length: 10 }, (_, i) => filler(i + 10)),
  ],
  evidence: { sessions: ["answer_9c1e_1"], turns: ["answer_9c1e_1#0"] },
};

const allText = (req: ModelRequest) => JSON.stringify(req.messages);

/** A reader that knows only what is in front of it, and searches when it can and doesn't know. */
class StandIn implements ModelClient {
  calls: ModelRequest[] = [];
  failReader: boolean;
  failJudge: boolean;
  cutOff: boolean;
  constructor(failReader = false, { failJudge = false, cutOff = false } = {}) {
    this.failReader = failReader;
    this.failJudge = failJudge;
    this.cutOff = cutOff;
  }
  async complete(req: ModelRequest): Promise<ModelResponse> {
    this.calls.push(req);
    // Billed by what was actually sent, so token and cost comparisons between arms mean something.
    const input = estimateTokens(req.system + allText(req));
    const reply = (text: string): ModelResponse => ({ text, toolCalls: [], content: [{ type: "text", text }], usage: { input, output: 10 }, latencyMs: 1 });
    if (req.purpose === "judge" && this.failJudge) throw new BilledError("judge cut off", { input, output: req.maxTokens }, 1);
    if (req.purpose === "reader" && this.cutOff) throw new BilledError("reader cut off", { input, output: req.maxTokens }, 1);
    if (req.purpose === "judge") {
      const prompt = String(req.messages[0]!.content);
      const response = prompt.split("Model Response:")[1] ?? "";
      return reply(response.includes("Denver") ? "yes" : "no");
    }
    if (req.purpose === "summarizer") return reply(allText(req).match(/[^"\\]*moving[^"\\]*/)?.[0] ?? "Gardening chats.");
    if (this.failReader) throw new Error("overloaded");
    if (allText(req).includes("Denver")) return reply("Your sister is moving to Denver.");
    // Like the real API, tool_choice none means no tool call.
    if (req.tools && req.toolChoice !== "none") {
      const tool = { id: "t1", name: "search_history", input: { query: "sister moving" } };
      return { text: "", toolCalls: [tool], content: [{ type: "tool_use", ...tool }], usage: { input, output: 10 }, latencyMs: 1 };
    }
    return reply("I don't know.");
  }
}

const opts = (model: ModelClient) => ({
  model,
  reader: "claude-haiku-5-5",
  judgeModel: "claude-opus-5-5",
  // A short switch point and compaction threshold so this small history still takes the packet and compaction paths.
  profile: { ...PROFILES.claude, switchAt: 500, compactAt: 1500, maxToolRounds: 2 },
  concurrency: 2,
  arms: ["full", "compaction", "compaction-search", "packet", "bare"] as const,
});

test("each arm is scored on what its reader saw, and the packet sees far less than the full history", async () => {
  const model = new StandIn();
  const answers = await runEval([question], { ...opts(model), arms: [...opts(model).arms] });
  const rows = summarize(answers, [...opts(model).arms]);
  const row = (arm: string) => rows.find((r) => r.arm === arm)!;
  for (const arm of opts(model).arms) assert.equal(row(arm).accuracy, 1, `${arm} should find Denver`);
  assert.equal(row("packet").toolCallsPerQuestion, 0, "the packet already held the fact");
  assert.equal(row("bare").toolCallsPerQuestion, 1, "with no packet the reader had to search");
  assert.ok(row("packet").readerInputTokens < row("full").readerInputTokens / 5);
  assert.ok(row("bare").readerInputTokens > row("bare").contextTokens * 5, "reader input counts the search results too, not just the first context");
  const compaction = answers.find((a) => a.arm === "compaction")!;
  const summaries = compaction.calls.filter((c) => c.purpose === "summarizer");
  assert.ok(summaries.length > 0 && summaries.every((c) => c.cost > 0), "the summaries are paid for");
  assert.ok(row("compaction").totalCost >= summaries.reduce((a, c) => a + c.cost, 0), "and billed to compaction");
});

test("the judge sees the reader's answer, not the reference answer twice", async () => {
  const model = new StandIn();
  await runEval([question], { ...opts(model), arms: ["full"] });
  const judged = model.calls.filter((c) => c.purpose === "judge").map((c) => String(c.messages[0]!.content));
  assert.equal(judged.length, 1);
  assert.match(judged[0]!, /Model Response: Your sister is moving to Denver\./);
});

test("no arm's reader ever sees evidence labels or chat ids, which in the benchmark name the answer chats", async () => {
  const model = new StandIn();
  await runEval([question], { ...opts(model), arms: [...opts(model).arms] });
  for (const c of model.calls.filter((c) => c.purpose !== "judge")) assert.doesNotMatch(allText(c), /answer_9c1e|answer_session|has_answer/);
});

test("a failed call counts as a wrong answer and is kept, never dropped, with what it already cost", async () => {
  const answers = await runEval([question], { ...opts(new StandIn(true)), arms: ["packet", "compaction"] });
  const rows = summarize(answers, ["packet", "compaction"]);
  for (const r of rows) {
    assert.equal(r.questions, 1);
    assert.equal(r.accuracy, 0);
    assert.equal(r.errors, 1);
  }
  const compaction = answers.find((a) => a.arm === "compaction")!;
  assert.ok(compaction.calls.some((c) => c.purpose === "summarizer"), "summaries paid for before the reader failed still count");
  assert.ok(rows[1]!.totalCost > 0);
});

test("every arm but classic compaction gets the same tools, and once searches run out it can only answer", async () => {
  const model = new StandIn();
  for (const arm of ["full", "compaction-search", "packet", "bare"] as const) {
    model.calls = [];
    await runEval([question], { ...opts(model), arms: [arm] });
    const readers = model.calls.filter((c) => c.purpose === "reader");
    assert.ok(readers.every((c) => c.tools?.[0]?.name === "search_history"), `${arm} reads with the search tool`);
  }
  model.calls = [];
  await runEval([question], { ...opts(model), arms: ["compaction"] });
  assert.ok(model.calls.filter((c) => c.purpose === "reader").every((c) => !c.tools), "classic compaction has only its summary");

  // A reader that never stops searching: the last round keeps the tool defined but allows no more calls.
  const greedy = new (class extends StandIn {
    async complete(req: ModelRequest): Promise<ModelResponse> {
      if (req.purpose === "reader" && req.toolChoice !== "none") {
        this.calls.push(req);
        const tool = { id: `t${this.calls.length}`, name: "search_history", input: { query: "nothing useful" } };
        return { text: "", toolCalls: [tool], content: [{ type: "tool_use", ...tool }], usage: { input: 100, output: 10 }, latencyMs: 1 };
      }
      return super.complete(req);
    }
  })();
  const [answer] = await runEval([question], { ...opts(greedy), arms: ["bare"] });
  const last = greedy.calls.filter((c) => c.purpose === "reader").at(-1)!;
  assert.equal(answer!.toolCalls, 2, "it searched as many times as the profile allows");
  assert.equal(last.toolChoice, "none");
  assert.equal(last.tools?.[0]?.name, "search_history");
  assert.equal(answer!.error, undefined);
});

test("without tools, an arm only knows what its context holds: bare can't answer, the packet can", async () => {
  const model = new StandIn();
  const noTools = { ...opts(model), profile: { ...opts(model).profile, maxToolRounds: 0 }, arms: ["packet", "bare"] as ("packet" | "bare")[] };
  const answers = await runEval([question], noTools);
  assert.equal(answers.find((a) => a.arm === "packet")!.pass, true);
  assert.equal(answers.find((a) => a.arm === "bare")!.pass, false);
  assert.match(pairedTable(answers, ["packet", "bare"]), /\| packet \| 1 \| \+100\.0 \|/);
});

test("repeats are each judged, and a question repeated counts once in the interval", async () => {
  const model = new StandIn();
  const answers = await runEval([question], { ...opts(model), arms: ["packet"], repeats: 3 });
  assert.deepEqual(answers.map((a) => a.repeat).sort(), [0, 1, 2]);
  assert.equal(model.calls.filter((c) => c.purpose === "judge").length, 3);
  assert.deepEqual(summarize(answers, ["packet"])[0]!.ci, [1, 1]);
});

test("the bootstrap interval is wide on a few questions and narrows with more", () => {
  const few = new Map(Array.from({ length: 10 }, (_, i) => [`q${i}`, i < 7 ? 1 : 0]));
  const many = new Map(Array.from({ length: 400 }, (_, i) => [`q${i}`, i % 10 < 7 ? 1 : 0]));
  const [lo, hi] = bootstrap(few);
  const [lo2, hi2] = bootstrap(many);
  assert.ok(lo <= 0.7 && hi >= 0.7 && hi - lo > 0.4);
  assert.ok(lo2 <= 0.7 && hi2 >= 0.7 && hi2 - lo2 < 0.1);
});


test("a question counts once in the interval however many times it was repeated", () => {
  const a = (questionId: string, repeat: number, pass: boolean) =>
    ({ questionId, repeat, pass, arm: "packet", type: "t", answer: "", calls: [], contextTokens: 0, toolCalls: 0, judgeReply: "" }) as Answer;
  const answers = [0, 1, 2].flatMap((r) => [a("q1", r, true), a("q2", r, false)]);
  // Two questions, one right and one wrong: resampling two values can land on all-wrong or all-right.
  // Counted as six separate answers, the interval would be far narrower.
  assert.deepEqual(summarize(answers, ["packet"])[0]!.ci, [0, 1]);
});

test("a cut-off reader answer is an error that keeps what the cut-off call cost", async () => {
  const answers = await runEval([question], { ...opts(new StandIn(false, { cutOff: true })), arms: ["packet"] });
  const [a] = answers;
  assert.ok(a!.error);
  const reader = a!.calls.filter((c) => c.purpose === "reader");
  assert.equal(reader.length, 1);
  assert.equal(reader[0]!.output, MAX_OUTPUT, "the billed output of the failed call is counted");
  assert.ok(reader[0]!.cost > 0);
});

test("a judge failure keeps the reader's answer and everything already paid for", async () => {
  const [a] = await runEval([question], { ...opts(new StandIn(false, { failJudge: true })), arms: ["packet"] });
  assert.match(a!.answer, /Denver/);
  assert.ok(a!.error);
  assert.equal(a!.pass, false);
  assert.deepEqual(a!.calls.map((c) => c.purpose), ["reader", "judge"]);
});

test("every call gets the same generous output cap, so no arm's answers are cut short by a smaller one", async () => {
  const model = new StandIn();
  await runEval([question], { ...opts(model), arms: [...opts(model).arms] });
  assert.ok(model.calls.length > 10);
  assert.ok(model.calls.every((c) => c.maxTokens === MAX_OUTPUT));
});

test("both compaction arms read one shared summary, so they differ only in the search tool", async () => {
  const model = new StandIn();
  const answers = await runEval([question], { ...opts(model), arms: ["compaction", "compaction-search"] });
  const summaries = model.calls.filter((c) => c.purpose === "summarizer");
  const perArm = answers.map((a) => a.calls.filter((c) => c.purpose === "summarizer").length);
  assert.equal(perArm[0], summaries.length, "the summary was written once");
  assert.equal(perArm[0], perArm[1], "and each arm reports its cost");
  const firstContext = (tools: boolean) => JSON.stringify(model.calls.find((c) => c.purpose === "reader" && !!c.tools === tools)!.messages[0]);
  // The searching arm is also told, as the packet and bare arms are, that the tool reaches the cut history.
  assert.match(firstContext(true), /may leave details out\. The search_history tool can reach all of it\./);
  assert.equal(firstContext(false), firstContext(true).replace(" The search_history tool can reach all of it.", ""));
  const rows = summarize(answers, ["compaction", "compaction-search"]);
  const summaryCost = answers[0]!.calls.filter((c) => c.purpose === "summarizer").reduce((t, c) => t + c.cost, 0);
  assert.ok(summaryCost > 0);
  assert.ok(Math.abs(rows[0]!.totalCost + rows[1]!.totalCost - (rows[0]!.costPerQuestion + rows[1]!.costPerQuestion + rows[0]!.judgeCostPerQuestion + rows[1]!.judgeCostPerQuestion - summaryCost)) < 1e-12, "each arm's own cost includes the summary, and the run total counts it once");
});

test("every arm that can search is told the tool reaches history it doesn't have in front of it", async () => {
  for (const arm of ["compaction-search", "packet", "bare"] as const) {
    const model = new StandIn();
    await runEval([question], { ...opts(model), arms: [arm] });
    const first = model.calls.find((c) => c.purpose === "reader")!;
    assert.match(JSON.stringify(first.messages[0]), /The search_history tool can reach all of it\./, arm);
  }
});

test("with no tools, no arm is told about a search tool it doesn't have", async () => {
  const model = new StandIn();
  const noTools = { ...opts(model), profile: { ...opts(model).profile, maxToolRounds: 0, trustNote: true } };
  await runEval([question], { ...noTools, arms: [...opts(model).arms] });
  const readers = model.calls.filter((c) => c.purpose === "reader");
  assert.ok(readers.length >= 5);
  for (const c of readers) assert.doesNotMatch(allText(c), /search_history|use the tools/);
});

test("the API client turns a cut-off or refused answer into an error that carries the billed usage", async () => {
  for (const stop_reason of ["max_tokens", "refusal"]) {
    const client = { messages: { create: async () => ({ stop_reason, content: [{ type: "text", text: "partial" }], usage: { input_tokens: 1234, output_tokens: 16000 } }) } };
    const model = new AnthropicModel(client as never);
    await assert.rejects(
      model.complete({ model: "claude-haiku-5-5", system: "s", messages: [{ role: "user", content: "q" }], maxTokens: 16000, purpose: "reader" }),
      (err: unknown) => err instanceof BilledError && err.usage.input === 1234 && err.usage.output === 16000,
    );
  }
});

test("an arm's own cost leaves out the judge, which is the same job for every arm; the total still counts it", async () => {
  const model = new StandIn();
  const answers = await runEval([question], { ...opts(model), arms: ["packet"] });
  const [row] = summarize(answers, ["packet"]);
  const judge = answers[0]!.calls.filter((c) => c.purpose === "judge").reduce((a, c) => a + c.cost, 0);
  const all = answers[0]!.calls.reduce((a, c) => a + c.cost, 0);
  assert.ok(judge > 0);
  assert.ok(Math.abs(row!.judgeCostPerQuestion - judge) < 1e-12);
  assert.ok(Math.abs(row!.costPerQuestion - (all - judge)) < 1e-12);
  assert.ok(Math.abs(row!.totalCost - all) < 1e-12);
});

test("a run stops starting new answers once it has spent its cap", async () => {
  const model = new StandIn();
  const many = Array.from({ length: 6 }, (_, i) => ({ ...question, id: `q${i}` }));
  const answers = await runEval(many, { ...opts(model), arms: ["full"], concurrency: 1, maxCost: 1e-9 });
  assert.equal(answers.length, 1, "the first answer runs, then nothing new starts");
  const uncapped = await runEval(many, { ...opts(new StandIn()), arms: ["full"], concurrency: 1 });
  assert.equal(uncapped.length, 6);
});

test("a failed answer doesn't drag the packet-or-context column toward zero", () => {
  const ok = { questionId: "a", repeat: 0, pass: true, arm: "packet", type: "t", answer: "x", calls: [], contextTokens: 1000, toolCalls: 0, judgeReply: "yes" } as Answer;
  const failed = { ...ok, questionId: "b", pass: false, contextTokens: 0, error: "overloaded" } as Answer;
  const [row] = summarize([ok, failed], ["packet"]);
  assert.equal(row!.contextTokens, 1000);
  assert.equal(row!.accuracy, 0.5, "the failure still counts as wrong");
});

test("the paired table differences each question against itself, not against the other arm's average", () => {
  const make = (arm: Answer["arm"], questionId: string, pass: boolean) => ({ questionId, repeat: 0, pass, arm, type: "t", answer: "", calls: [], contextTokens: 0, toolCalls: 0, judgeReply: "" }) as Answer;
  const ids = Array.from({ length: 20 }, (_, i) => `q${i}`);
  // Same questions right and wrong on both arms: the true paired difference is exactly 0 on every question.
  const answers = ids.flatMap((id, i) => [make("packet", id, i % 2 === 0), make("bare", id, i % 2 === 0)]);
  const table = pairedTable(answers, ["packet", "bare"], "bare");
  assert.match(table, /\| packet \| 20 \| \+0\.0 \| \+0\.0 to \+0\.0 \|/);
});

test("the API client sends tool_choice none on the last round, so the model can't call the tool there", async () => {
  const sent: Record<string, unknown>[] = [];
  const client = { messages: { create: async (body: Record<string, unknown>) => (sent.push(body), { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }) } };
  const model = new AnthropicModel(client as never);
  const tools = [{ name: "search_history", description: "d", input_schema: { type: "object" as const, properties: {} } }];
  await model.complete({ model: "claude-haiku-5-5", system: "s", messages: [{ role: "user", content: "q" }], maxTokens: 10, purpose: "reader", tools, toolChoice: "none" });
  assert.deepEqual(sent[0]!.tool_choice, { type: "none" });
  assert.ok(Array.isArray(sent[0]!.tools), "the tool stays defined");
});

test("an empty answer, such as a tool call where only text was allowed, counts as an error, not a quiet wrong answer", async () => {
  const ignoresToolChoice = new (class extends StandIn {
    async complete(req: ModelRequest): Promise<ModelResponse> {
      if (req.purpose !== "reader") return super.complete(req);
      this.calls.push(req);
      const tool = { id: "t", name: "search_history", input: { query: "nothing useful" } };
      return { text: "", toolCalls: [tool], content: [{ type: "tool_use", ...tool }], usage: { input: 100, output: 10 }, latencyMs: 1 };
    }
  })();
  const [answer] = await runEval([question], { ...opts(ignoresToolChoice), arms: ["bare"] });
  assert.match(answer!.error ?? "", /Empty answer/);
  assert.equal(answer!.pass, false);
  assert.ok(answer!.calls.length > 0, "and what it cost is kept");
});

test("both compaction arms keep their context within the profile's compactAt, even when one chat is bigger than that", async () => {
  const model = new StandIn();
  const tight = { ...opts(model), profile: { ...opts(model).profile, compactAt: 200 } };
  const answers = await runEval([question], { ...tight, arms: ["compaction", "compaction-search"] });
  for (const a of answers) assert.ok(a.contextTokens <= 200 + 60, `${a.arm}: ${a.contextTokens} tokens`);
});

test("an answer lost to an API outage is left out of accuracy and the paired tables and counted apart, while the model's own failures still count as wrong", async () => {
  const outage = (purpose: ModelRequest["purpose"], status: number, name: string) =>
    new (class extends StandIn {
      async complete(req: ModelRequest): Promise<ModelResponse> {
        if (req.purpose === purpose) throw Object.assign(new Error(`${status} failed`), { status, name });
        return super.complete(req);
      }
    })();
  const two: Question = { ...question, id: "q2" };
  // A rate limit on the reader that outlasted the retries: packet answers both questions, bare loses one.
  const limited = new (class extends StandIn {
    async complete(req: ModelRequest): Promise<ModelResponse> {
      if (req.purpose === "reader" && !allText(req).includes("Denver") && req.toolChoice !== "none") throw Object.assign(new Error("429 rate limited"), { status: 429, name: "RateLimitError" });
      return super.complete(req);
    }
  })();
  const answers = await runEval([question, two], { ...opts(limited), arms: ["packet", "bare"], concurrency: 1 });
  const [packet, bare] = summarize(answers, ["packet", "bare"]);
  assert.equal(packet!.accuracy, 1);
  assert.equal(bare!.outages, 2, "bare's searches hit the limit");
  assert.equal(bare!.errors, 0);
  assert.match(pairedTable(answers, ["packet", "bare"], "bare"), /\| packet \| 0 \|/, "no question is paired against a lost answer");

  // An overloaded summarizer reaches both compaction arms through the shared summary, and both count it as an outage.
  const shared = await runEval([question], { ...opts(outage("summarizer", 529, "OverloadedError")), arms: ["compaction", "compaction-search"] });
  assert.deepEqual(shared.map((a) => a.outage), [true, true]);

  // A bad request is the harness's or the model's problem, not the API's: still a wrong answer.
  const [bad] = summarize(await runEval([question], { ...opts(outage("reader", 400, "BadRequestError")), arms: ["full"] }), ["full"]);
  assert.equal(bad!.errors, 1);
  assert.equal(bad!.outages, 0);
  assert.equal(bad!.accuracy, 0);
});

test("the compaction summary is asked to keep what the assistant recommended or answered, which some questions ask about", async () => {
  const model = new StandIn();
  await runEval([question], { ...opts(model), arms: ["compaction"] });
  const prompt = allText(model.calls.find((c) => c.purpose === "summarizer")!);
  assert.match(prompt, /what the assistant recommended, listed or answered/);
});

test("the API client allows one search per round, so the cost ceiling and the Searches column hold", async () => {
  const sent: Record<string, unknown>[] = [];
  const client = { messages: { create: async (body: Record<string, unknown>) => (sent.push(body), { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }) } };
  const tools = [{ name: "search_history", description: "d", input_schema: { type: "object" as const, properties: {} } }];
  await new AnthropicModel(client as never).complete({ model: "claude-haiku-5-5", system: "s", messages: [{ role: "user", content: "q" }], maxTokens: 10, purpose: "reader", tools, toolChoice: "auto" });
  assert.deepEqual(sent[0]!.tool_choice, { type: "auto", disable_parallel_tool_use: true });
});
