// The whole harness with a stand-in model: what each arm's reader actually gets to see decides its score.
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, PROFILES, type Session } from "@long-con/core";
import type { Question } from "../src/longmemeval.ts";
import type { ModelClient, ModelRequest, ModelResponse } from "../src/model.ts";
import { bootstrap, pairedTable, runEval, summarize } from "../src/run.ts";

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
  constructor(failReader = false) {
    this.failReader = failReader;
  }
  async complete(req: ModelRequest): Promise<ModelResponse> {
    this.calls.push(req);
    // Billed by what was actually sent, so token and cost comparisons between arms mean something.
    const input = estimateTokens(req.system + allText(req));
    const reply = (text: string): ModelResponse => ({ text, toolCalls: [], content: [{ type: "text", text }], usage: { input, output: 10 }, latencyMs: 1 });
    if (req.purpose === "judge") {
      const prompt = String(req.messages[0]!.content);
      const response = prompt.split("Model Response:")[1] ?? "";
      return reply(response.includes("Denver") ? "yes" : "no");
    }
    if (req.purpose === "summarizer") return reply(allText(req).match(/[^"\\]*moving[^"\\]*/)?.[0] ?? "Gardening chats.");
    if (this.failReader) throw new Error("overloaded");
    if (allText(req).includes("Denver")) return reply("Your sister is moving to Denver.");
    if (req.tools) {
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
  assert.ok(row("packet").readerInputTokens < row("full").readerInputTokens / 5, "measured on everything the reader took in");
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

