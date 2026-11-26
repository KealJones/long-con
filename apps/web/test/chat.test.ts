import assert from "node:assert/strict";
import { test } from "node:test";
import type { Session } from "@long-con/core";
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
  assert.doesNotMatch(body.messages[0].content, /search_history/, "no tool, so the packet mustn't promise one");
  assert.doesNotMatch(body.messages[0].content, /kitchen/, "unrelated days stay out");
  assert.deepEqual(body.messages.at(-1), { role: "user", content: "Does Biscuit still hate the vacuum?" });

  assert.equal(result.answer, "Probably, yes.");
  assert.equal(result.sessionId, "2026/11/26 (Thu)");
  assert.equal(result.turn, 0);
  assert.deepEqual(history.at(-1)!.turns, [
    { role: "user", content: "Does Biscuit still hate the vacuum?" },
    { role: "assistant", content: "Probably, yes." },
  ]);
});

test("today's turns ride along raw after the packet", async () => {
  const history: Session[] = [];
  await sendTurn(history, "hi", { apiKey: "k", model: "m", now, fetch: fakeApi("hello").fetch });
  const api = fakeApi("ok");
  await sendTurn(history, "again", { apiKey: "k", model: "m", now, fetch: api.fetch });
  const { messages } = JSON.parse(String(api.calls[0]!.init.body));
  assert.deepEqual(messages.slice(1).map((m: { content: string }) => m.content), ["hi", "hello", "again"]);
  assert.equal(history.length, 1);
  assert.equal(history[0]!.turns.length, 4);
});

test("a failed call leaves history untouched and surfaces the API's message", async () => {
  const history: Session[] = [];
  await assert.rejects(sendTurn(history, "hi", { apiKey: "bad", model: "m", now, fetch: fakeApi("", 401).fetch }), /invalid x-api-key/);
  assert.deepEqual(history, []);
});
