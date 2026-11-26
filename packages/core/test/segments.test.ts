import assert from "node:assert/strict";
import test from "node:test";
import { segmentKey, splitIntoSegments } from "../src/segments.ts";
import { contentWords } from "../src/text.ts";
import type { Session } from "../src/chat.ts";

const session: Session = {
  id: "s1",
  turns: [
    { role: "user", content: "What should I pack for a hiking trip to Patagonia?" },
    { role: "assistant", content: "Certainly! Here are some tips for your trip.\n1.\nPack a waterproof jacket for Patagonia wind.\nBring trekking poles.\nI hope this helps! Happy hiking!" },
  ],
};
const seg = splitIntoSegments(session, 400)[0]!;
const key = (mode: string) => contentWords(segmentKey(session, seg, mode, (t) => contentWords(t)));

test("no denoise indexes the turns as they are", () => {
  assert.equal(segmentKey(session, seg, "", (t) => contentWords(t)), session.turns.map((t) => t.content).join("\n"));
});

test("boilerplate drops stock assistant sentences and list numbers, keeps content and the user turn", () => {
  const words = key("boilerplate");
  for (const w of ["certainly", "tip", "hope", "1"]) assert.ok(!words.includes(w), w);
  for (const w of ["patagonia", "waterproof", "trekk", "pole", "hik"]) assert.ok(words.includes(w), w);
});

test("overlap keeps assistant sentences sharing a word with the user turn before them", () => {
  const assistant = contentWords(segmentKey({ ...session, turns: session.turns }, { ...seg, start: 1, turns: [session.turns[1]!] }, "overlap", (t) => contentWords(t)));
  assert.ok(assistant.includes("waterproof"), "the Patagonia sentence stays");
  assert.ok(!assistant.includes("pole"), "the sentence with no shared word goes");
});

test("head keeps the first N content words of each assistant turn", () => {
  const words = key("head:3");
  assert.deepEqual(words.slice(-3), ["certainly", "tip", "trip"]);
});
