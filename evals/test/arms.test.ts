// The packet variants: packet-tools is a valid Messages API request carrying the packet's own content, and each
// ablation differs from `packet` only in the part it leaves out.
import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { buildPacket, PROFILES, TRUST_NOTE, type Session } from "@beep/core";
import type { Question } from "../src/longmemeval.ts";
import { firstMessages, packetAsToolCall, PACKET_TOOL_ID } from "../src/arms.ts";
import { EstimatingModel } from "../src/estimate.ts";
import type { ModelRequest, ModelResponse } from "../src/model.ts";
import { runEval } from "../src/run.ts";

const filler = (i: number): Session => ({
  id: `f${i}`,
  date: `2023/04/${String(i + 1).padStart(2, "0")} (Sat) 10:00`,
  turns: [
    { role: "user", content: `can you help me plan a garden bed, number ${i}? thinking tomatoes and basil` },
    { role: "assistant", content: `Sure. Bed ${i}: tomatoes need six hours of sun. ${"Water deeply twice a week. ".repeat(20)}` },
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
    { id: "r", date: "2023/03/01 (Wed) 09:00", turns: [{ role: "user", content: "From now on, always give me distances in kilometers." }, { role: "assistant", content: "Will do." }] },
    ...Array.from({ length: 10 }, (_, i) => filler(i)),
    { id: "a", date: "2023/04/20 (Thu) 09:00", turns: [{ role: "user", content: "my sister is moving to Denver next month" }, { role: "assistant", content: "Exciting news for her!" }] },
  ],
  evidence: { sessions: ["a"], turns: ["a#0"] },
};

const profile = { ...PROFILES.claude, switchAt: 500 };
const text = (m: Anthropic.MessageParam) => (typeof m.content === "string" ? m.content : m.content.map((b) => (b.type === "text" ? b.text : "")).join(""));

/** The Messages API's rules: user first, roles alternate, and each tool_result answers a tool_use in the turn just before it, results first. */
function assertValidRequest(messages: Anthropic.MessageParam[]) {
  assert.equal(messages[0]!.role, "user");
  messages.forEach((m, i) => {
    if (i) assert.notEqual(m.role, messages[i - 1]!.role, `turn ${i} repeats a role`);
    const blocks = typeof m.content === "string" ? [] : m.content;
    const uses = blocks.flatMap((b) => (b.type === "tool_use" ? [b.id] : []));
    if (uses.length) assert.equal(m.role, "assistant");
    const prev = messages[i - 1];
    const asked = prev && typeof prev.content !== "string" ? prev.content.flatMap((b) => (b.type === "tool_use" ? [b.id] : [])) : [];
    const answered = blocks.flatMap((b) => (b.type === "tool_result" ? [b.tool_use_id] : []));
    assert.deepEqual(answered.sort(), asked.sort(), `turn ${i}: every tool_use is answered in the next turn and no tool_result stands alone`);
    assert.ok(blocks.slice(0, answered.length).every((b) => b.type === "tool_result"), "tool_results come first");
  });
}

test("packet-tools carries the packet as a search_history call and result, then the question", () => {
  const packet = buildPacket({ history: question.sessions, message: question.question, profile });
  const { messages, contextTokens } = firstMessages("packet-tools", question, profile);
  assertValidRequest(messages);
  assert.equal(contextTokens, packet.tokens);
  assert.equal(messages.length, 3);
  const [head, call, result] = messages;
  const cut = packet.text.indexOf("\n\nRetrieved history");
  assert.equal(head!.content, `<packet>\n${packet.text.slice(0, cut)}\n</packet>`);
  assert.deepEqual(call!.content, [{ type: "tool_use", id: PACKET_TOOL_ID, name: "search_history", input: { query: question.question } }]);
  const blocks = result!.content as Anthropic.ContentBlockParam[];
  assert.deepEqual(blocks[0], { type: "tool_result", tool_use_id: PACKET_TOOL_ID, content: packet.text.slice(cut + 2) });
  assert.match(String((blocks[0] as Anthropic.ToolResultBlockParam).content), /Denver/);
  assert.equal(text(result!), `Current date: ${question.date}\n\n${question.question}`);
  // Same words as `packet`, just moved.
  const plain = firstMessages("packet", question, profile).messages.map(text).join("");
  assert.equal(plain.replace("<packet>\n", "").replace("\n</packet>", ""), packet.text + `Current date: ${question.date}\n\n${question.question}`);
});

test("packet-tools: a closed gate shows no call, an empty search shows the tool's empty result", () => {
  const packet = buildPacket({ history: question.sessions, message: question.question, profile });
  const closed = packetAsToolCall({ ...packet, retrieved: false, text: "Earlier chat history was left out to fit." }, "hi");
  assert.deepEqual(closed.map((m) => m.role), ["user", "user"]);
  assert.ok(!JSON.stringify(closed).includes("tool_use"));
  const empty = packetAsToolCall({ ...packet, text: "Earlier chat history was left out to fit." }, "hi");
  assertValidRequest(empty);
  assert.equal(((empty[2]!.content as Anthropic.ContentBlockParam[])[0] as Anthropic.ToolResultBlockParam).content, "No matches.");
});

class Capture extends EstimatingModel {
  reqs: ModelRequest[] = [];
  override async complete(req: ModelRequest): Promise<ModelResponse> {
    this.reqs.push(req);
    // Unique ids, as the API gives.
    const res = await super.complete(req);
    const id = `toolu_${this.reqs.length}`;
    return { ...res, toolCalls: res.toolCalls.map((t) => ({ ...t, id })), content: res.content.map((b) => (b.type === "tool_use" ? { ...b, id } : b)) };
  }
}

test("every packet-tools reader request stays valid through search rounds, and keeps the tool defined with no searches", async () => {
  for (const maxToolRounds of [2, 0]) {
    const model = new Capture(true);
    const [answer] = await runEval([question], { model, arms: ["packet-tools"], reader: "claude-haiku-5-5", judgeModel: "claude-opus-5-5", profile: { ...profile, maxToolRounds }, concurrency: 1 });
    assert.ok(!answer!.error, answer!.error);
    const readers = model.reqs.filter((r) => r.purpose === "reader");
    assert.equal(readers.length, maxToolRounds + 1);
    for (const r of readers) {
      assertValidRequest(r.messages);
      // A tool_use in the history needs the tool defined, even when the reader may only answer.
      assert.equal(r.tools?.[0]?.name, "search_history");
    }
    assert.equal(readers.at(-1)!.toolChoice, "none");
    // The estimate's searches use the question, not the packet head.
    if (maxToolRounds) assert.match(JSON.stringify(readers[1]!.messages), /"query":"Current date: [^"]*Where is my sister moving\?"/);
  }
});

test("packet-notrust and packet-norules differ from packet only in the part they leave out", () => {
  // claude has the trust note off (as in the web chat), so turn it on to see packet-notrust drop it.
  const trusting = { ...profile, trustNote: true };
  const packetText = text(firstMessages("packet", question, trusting).messages[0]!);
  const notrust = text(firstMessages("packet-notrust", question, trusting).messages[0]!);
  const norules = text(firstMessages("packet-norules", question, trusting).messages[0]!);
  assert.ok(packetText.includes(TRUST_NOTE(true)) && packetText.includes("Standing rules"));
  assert.equal(notrust, packetText.replace(`\n${TRUST_NOTE(true)}`, ""));
  assert.equal(norules, packetText.replace(/\n\nStanding rules from the user, word for word:\n- "[^\n]*/, ""));
  // Everything after the first message (the question) is the same.
  for (const arm of ["packet-notrust", "packet-norules"] as const) assert.deepEqual(firstMessages(arm, question, trusting).messages.slice(1), firstMessages("packet", question, trusting).messages.slice(1));
});
