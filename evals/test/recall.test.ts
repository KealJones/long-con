// Packet recall counts evidence turns that landed in the packet's segments.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Packet } from "@long-con/core";
import type { Question } from "../src/longmemeval.ts";
import { packetRecall } from "../src/recall.ts";

const q = { evidence: { sessions: ["s1", "s2"], turns: ["s1#4", "s2#0"] } } as Question;
const packet = (segments: { sessionId: string; start: number; end: number }[]) =>
  ({ segments: segments.map((s) => ({ ...s, confidence: 1, why: "" })) }) as unknown as Packet;

test("all evidence inside the packet is complete recall", () => {
  assert.deepEqual(packetRecall(q, packet([{ sessionId: "s1", start: 2, end: 5 }, { sessionId: "s2", start: 0, end: 1 }])), { sessionRecall: 1, turnRecall: 1, complete: true });
});

test("the right chat but the wrong part of it finds the chat, not the turn", () => {
  const r = packetRecall(q, packet([{ sessionId: "s1", start: 0, end: 3 }, { sessionId: "s2", start: 0, end: 0 }]));
  assert.equal(r.sessionRecall, 1);
  assert.equal(r.turnRecall, 0.5);
  assert.equal(r.complete, false);
});

test("an empty packet finds nothing", () => {
  assert.deepEqual(packetRecall(q, packet([])), { sessionRecall: 0, turnRecall: 0, complete: false });
});
