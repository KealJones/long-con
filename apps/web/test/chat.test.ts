import assert from "node:assert/strict";
import { test } from "node:test";
import type { Session } from "@beep/core";
import { dayLabel, sendTurn } from "../src/chat.ts";

function fakeApi(answer: string, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const body = status === 200 ? { content: [{ type: "text", text: answer }], stop_reason: "end_turn" } : { error: { message: "invalid x-api-key" } };
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const now = new Date(2026, 10, 26, 12);

test("a turn sends system, packet, then the message, and saves both turns", async () => {
  const day = (d: number, user: string, assistant: string): Session => {
    const id = dayLabel(new Date(2026, 10, d, 12));
    return { id, date: id, turns: [{ role: "user", content: user }, { role: "assistant", content: assistant }] };
  };
  const history = [
    day(18, "Thinking about repainting the kitchen green.", "Sage green works well with wood."),
    day(19, "Work was rough, the build broke twice.", "Sounds exhausting."),
    day(20, "My dog Biscuit hates the vacuum.", "Poor Biscuit."),
  ];
  const api = fakeApi("Probably, yes.");
  const result = await sendTurn(history, "Does Biscuit still hate the vacuum?", { apiKey: "k", model: "claude-sonnet-5-5", now, fetch: api.fetch });

  assert.equal(api.calls.length, 1);
  const { url, init } = api.calls[0]!;
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  const headers = init.headers as Record<string, string>;
  assert.equal(headers["x-api-key"], "k");
  assert.equal(headers["anthropic-dangerous-direct-browser-access"], "true");
  const body = JSON.parse(String(init.body));
  assert.equal(body.model, "claude-sonnet-5-5");
  assert.match(body.system, /Today is 2026\/11\/26 \(Thu\)/);
  assert.match(body.messages[0].content, /^<packet>[\s\S]*Biscuit[\s\S]*<\/packet>$/);
  assert.deepEqual(body.tools.map((t: { name: string }) => t.name), ["bash", "search_history", "web_search", "web_fetch"]);
  assert.doesNotMatch(body.messages[0].content, /kitchen/, "unrelated days stay out");
  assert.deepEqual(body.messages.at(-1), { role: "user", content: "Does Biscuit still hate the vacuum?" });

  assert.equal(result.answer, "Probably, yes.");
  assert.equal(result.sessionId, "2026/11/26 (Thu)");
  assert.equal(result.turn, 0);
  // The trust note is off in the web chat, and a new day has no turns to send raw yet.
  assert.doesNotMatch(result.packet, /best guess/);
  assert.equal(result.rawTurns, 0);
  assert.deepEqual(history.at(-1)!.turns, [
    { role: "user", content: "Does Biscuit still hate the vacuum?" },
    { role: "assistant", content: "Probably, yes." },
  ]);
});

test("with nothing older to find, no packet is sent, only today's turns raw", async () => {
  const history: Session[] = [];
  await sendTurn(history, "hi", { apiKey: "k", model: "m", now, fetch: fakeApi("hello").fetch });
  const api = fakeApi("ok");
  const result = await sendTurn(history, "again", { apiKey: "k", model: "m", now, fetch: api.fetch });
  const { messages } = JSON.parse(String(api.calls[0]!.init.body));
  assert.deepEqual(messages.map((m: { content: string }) => m.content), ["hi", "hello", "again"]);
  assert.equal(result.packet, "");
  assert.equal(result.packetTokens, 0);
  assert.equal(result.rawTurns, 2);
  assert.equal(history.length, 1);
  assert.equal(history[0]!.turns.length, 4);
});

test("a failed call leaves history untouched and surfaces the API's message", async () => {
  const history: Session[] = [];
  await assert.rejects(sendTurn(history, "hi", { apiKey: "bad", model: "m", now, fetch: fakeApi("", 401).fetch }), /invalid x-api-key/);
  assert.deepEqual(history, []);
});

test("tool calls run and go back until the model answers", async () => {
  const replies = [
    { content: [{ type: "text", text: "Let me look." }, { type: "tool_use", id: "t1", name: "bash", input: { command: "echo 6*7 | bc > /home/n.txt; cat /home/n.txt" } }], stop_reason: "tool_use" },
    { content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "answer" } }], stop_reason: "pause_turn" },
    { content: [{ type: "text", text: "It's 42." }], stop_reason: "end_turn" },
  ];
  const sent: { messages: { role: string; content: unknown }[] }[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify(replies[sent.length - 1]), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  const store = new Map<string, string>();
  const history: Session[] = [];
  const seen: string[] = [];
  const result = await sendTurn(history, "what's 6 times 7?", {
    apiKey: "k", model: "claude-sonnet-5-5", now, fetch,
    store: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    onStep: (l) => seen.push(l),
  });

  assert.equal(sent.length, 3);
  // The tool's result goes back as a user turn right after the assistant's call, whole content kept.
  assert.deepEqual(sent[1]!.messages.at(-2), { role: "assistant", content: replies[0]!.content });
  assert.deepEqual(sent[1]!.messages.at(-1), { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "42\n" }] });
  // pause_turn resends with no new user turn.
  assert.deepEqual(sent[2]!.messages.at(-1), { role: "assistant", content: replies[1]!.content });
  assert.equal(result.answer, "It's 42.");
  assert.deepEqual(seen, ["$ echo 6*7 | bc > /home/n.txt; cat /home/n.txt", "searched the web for “answer”"]);
  assert.deepEqual(result.steps[0], { label: seen[0], output: "42\n" });
  assert.deepEqual(JSON.parse(store.get("beep:files")!), { "/home/n.txt": "42\n" });
  // Only the question and the final answer join the history.
  assert.deepEqual(history[0]!.turns.map((t) => t.content), ["what's 6 times 7?", "It's 42."]);
});

test("with 0 raw turns, today's earlier turns come back through the packet instead", async () => {
  const history: Session[] = [];
  await sendTurn(history, "My cat Mochi loves cardboard boxes.", { apiKey: "k", model: "m", now, fetch: fakeApi("Cute!").fetch });
  const api = fakeApi("Yes.");
  const result = await sendTurn(history, "What does Mochi love?", { apiKey: "k", model: "m", now, rawTurns: 0, fetch: api.fetch });
  const { messages } = JSON.parse(String(api.calls[0]!.init.body));
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /^<packet>[\s\S]*cardboard boxes[\s\S]*<\/packet>$/);
  assert.equal(result.rawTurns, 0);
});
