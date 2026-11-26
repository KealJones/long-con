// Packet recall counts evidence turns whose whole text landed in the packet.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Session } from "@long-con/core";
import type { Question } from "../src/longmemeval.ts";
import { packetRecall } from "../src/recall.ts";

const chat = (id: string, contents: string[]): Session => ({ id, turns: contents.map((content, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), content })) });
const s1 = chat("chat-1", ["hi", "hello", "what's new?", "not much", "my sister is moving to Denver", "Exciting!"]);
const s2 = chat("chat-2", ["she starts her new job on June 3", "Good luck to her."]);
const q = { sessions: [s1, s2], evidence: { sessions: ["chat-1", "chat-2"], turns: ["chat-1#4", "chat-2#0"] } } as unknown as Question;
const render = (s: Session, start: number, end: number) => s.turns.slice(start, end + 1).map((t) => `${t.role}: ${t.content}`).join("\n");
const packet = (parts: [Session, number, number][]) => ({
  segments: parts.map(([s, start, end]) => ({ sessionId: s.id, start, end, confidence: 1, why: "" })),
  text: parts.map(([s, start, end]) => render(s, start, end)).join("\n"),
});

test("all evidence inside the packet is complete recall", () => {
  assert.deepEqual(packetRecall(q, packet([[s1, 2, 5], [s2, 0, 1]]), 400), { sessionRecall: 1, turnRecall: 1, complete: true, turnRecallWithPointers: 1, completeWithPointers: true });
});

test("the right chat but the wrong part of it finds the chat, not the turn", () => {
  const r = packetRecall(q, packet([[s1, 0, 3], [s2, 0, 0]]), 400);
  assert.equal(r.sessionRecall, 1);
  assert.equal(r.turnRecall, 0.5);
  assert.equal(r.complete, false);
});

test("an empty packet finds nothing", () => {
  assert.deepEqual(packetRecall(q, { segments: [], text: "" }, 400), { sessionRecall: 0, turnRecall: 0, complete: false, turnRecallWithPointers: 0, completeWithPointers: false });
});

test("a long turn counts only when every piece of it made it in, not just the piece that matched", () => {
  const long = chat("chat-1", [`${"Some background on the move. ".repeat(60)}\n\nThe new address is 41 Larimer Street.`, "Noted."]);
  const lq = { sessions: [long], evidence: { sessions: ["chat-1"], turns: ["chat-1#0"] } } as unknown as Question;
  const firstPiece = { segments: [{ sessionId: "chat-1", start: 0, end: 0, confidence: 1, why: "" }], text: `user: ${"Some background on the move. ".repeat(60)}` };
  assert.equal(packetRecall(lq, firstPiece, 400).turnRecall, 0, "the address sat in the piece that was left out");
  assert.equal(packetRecall(lq, { ...firstPiece, text: `${firstPiece.text}\n\nuser: The new address is 41 Larimer Street.` }, 400).turnRecall, 1);
});

test("a turn the packet blanked out isn't recalled, even though its place is covered", () => {
  const blanked = { segments: [{ sessionId: "chat-1", start: 4, end: 5, confidence: 1, why: "" }], text: "user: [an answer the user rejected, left out]\nassistant: Exciting!" };
  assert.equal(packetRecall(q, blanked, 400).turnRecall, 0);
});

test("a pointer to an evidence turn counts as found, needs a read, and only in the pointer columns (P15)", () => {
  const p = { ...packet([[s2, 0, 1]]), pointers: [{ sessionId: "chat-1", start: 4, end: 5, confidence: 0.5, why: "", query: "sister denver" }] };
  const r = packetRecall(q, p, 400);
  assert.equal(r.turnRecall, 0.5, "the pointed-at turn isn't in the packet");
  assert.equal(r.complete, false);
  assert.equal(r.turnRecallWithPointers, 1);
  assert.equal(r.completeWithPointers, true);
});
