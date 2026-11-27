import assert from "node:assert/strict";
import { test } from "node:test";
import type { Session } from "@long-con/core";
import { sendTurn } from "../src/chat.ts";
import { newThread, sendThreadTurn, threadSessions, threadsNote, wrapUp } from "../src/threads.ts";

function fakeApi(...answers: string[]) {
  const bodies: any[] = [];
  const fetch = (async (_u: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ content: [{ type: "text", text: answers[bodies.length - 1] ?? "ok" }], stop_reason: "end_turn" }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, bodies };
}

const now = new Date(2026, 10, 27, 12);
const day = "2026/11/27 (Fri)";

test("a thread hangs off its message, keeps its own turns, and searches the main chat", async () => {
  const history: Session[] = [
    { id: "2026/11/20 (Fri)", date: "2026/11/20 (Fri)", turns: [{ role: "user", content: "The garage door code is 4417." }, { role: "assistant", content: "Noted." }] },
    { id: day, date: day, turns: [{ role: "user", content: "Should I repaint the garage?" }, { role: "assistant", content: "Sure, sage green would suit it." }] },
  ];
  const t = newThread(`${day}#1`, "assistant", history[1]!.turns[1]!.content, now);
  const api = fakeApi("Sage or olive.", "Olive it is.");
  await sendThreadTurn(t, history, [t], "What was the garage door code again?", { apiKey: "k", model: "m", now, fetch: api.fetch });
  const first = api.bodies[0];
  assert.match(first.system, /side thread[\s\S]*sage green would suit it/);
  assert.match(first.messages[0].content, /<packet>[\s\S]*garage door code is 4417/);
  assert.equal(t.title, "What was the garage door code again?");

  await sendThreadTurn(t, history, [t], "Let's do olive.", { apiKey: "k", model: "m", now, fetch: api.fetch });
  // The thread's own turns go word for word; the main chat's today turns are only found through the packet.
  const msgs = api.bodies[1].messages.map((m: { content: string }) => m.content);
  assert.deepEqual(msgs.slice(-3), ["What was the garage door code again?", "Sage or olive.", "Let's do olive."]);
  assert.ok(!msgs.includes("Should I repaint the garage?"));
  assert.equal(t.turns.length, 4);
  assert.equal(history[1]!.turns.length, 2, "the main chat is untouched");
});

test("open threads ride on the main chat's packet as loose ends, wrapped ones as records", async () => {
  const t = newThread(`${day}#0`, "user", "Should I repaint the garage?", now);
  t.title = "Garage colors";
  t.turns.push({ role: "user", content: "Garage colors?" }, { role: "assistant", content: "Olive works." });
  assert.match(threadsNote([t], day), /Open, not wrapped up: “Garage colors”, last said: Olive works\./);

  const api = fakeApi("Picked olive for the garage and ordered a sample pot.");
  await wrapUp(t, `${day}#3`, { apiKey: "k", model: "m", now, fetch: api.fetch });
  assert.equal(api.bodies[0].tools, undefined, "wrapping up is one plain call");
  assert.equal(t.wrap, "Picked olive for the garage and ordered a sample pot.");
  assert.equal(t.after, `${day}#3`);
  assert.match(threadsNote([t], day), /Wrapped up: “Garage colors”: Picked olive/);
  assert.equal(threadsNote([t], "2026/11/28 (Sat)"), "", "a wrap from another day is found by search, not listed");
  assert.match(threadSessions([t])[0]!.turns.at(-1)!.content, /^Wrap-up: Picked olive/);

  // The main chat gets the note even when its own search finds nothing.
  const main = fakeApi("Yep.");
  const r = await sendTurn([], "hi", { apiKey: "k", model: "m", now, fetch: main.fetch, note: threadsNote([t], day), extraSessions: threadSessions([t]) });
  assert.match(main.bodies[0].messages[0].content, /^<packet>[\s\S]*Wrapped up: “Garage colors”/);
  assert.match(r.packet, /Garage colors/);
});

test("talking again in a wrapped thread reopens it", async () => {
  const t = newThread(`${day}#0`, "user", "x", now);
  t.title = "x";
  t.turns.push({ role: "user", content: "a" }, { role: "assistant", content: "b" });
  t.wrap = "done";
  t.after = `${day}#1`;
  await sendThreadTurn(t, [], [t], "one more thing", { apiKey: "k", model: "m", now, fetch: fakeApi("sure").fetch });
  assert.equal(t.wrap, undefined);
  assert.equal(t.after, undefined);
});

test("attachments go to the model as image and document blocks, and the saved turn names them", async () => {
  const api = fakeApi("A cat.");
  const history: Session[] = [];
  await sendTurn(history, "what is this?", { apiKey: "k", model: "m", now, fetch: api.fetch, attachments: [{ name: "cat.jpg", type: "image/jpeg", data: "AAA" }, { name: "menu.pdf", type: "application/pdf", data: "BBB" }] });
  assert.deepEqual(api.bodies[0].messages.at(-1).content, [
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAA" } },
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: "BBB" }, title: "menu.pdf" },
    { type: "text", text: "what is this?" },
  ]);
  assert.equal(history[0]!.turns[0]!.content, "what is this?\n\n[Attached: cat.jpg, menu.pdf]");
});
