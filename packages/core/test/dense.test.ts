// The dense channel's one hard rule: it adds by meaning only when the lexical side already let something in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPacket, PROFILES, type Embed, type Session } from "../src/index.ts";
import { filler } from "./fixtures.ts";

// A fake embedder: one axis per topic, so "relocating to colorado" sits next to "moving" with no shared word.
const topics = [/mov|relocat|colorado|denver|bike/, /priya|sister/];
const fake: Embed = (text) => {
  const v = new Float32Array([...topics.map((t) => (t.test(text.toLowerCase()) ? 1 : 0)), 0.05]);
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};

const history: Session[] = [
  ...filler,
  { id: "family", date: "2026/03/06 (Fri) 21:15", turns: [{ role: "user", content: "my sister priya just told me shes moving to denver in april" }, { role: "assistant", content: "That's a big change." }] },
  { id: "boxes", date: "2026/03/18 (Wed) 09:00", turns: [{ role: "user", content: "she asked me to help with relocating to colorado, need boxes" }, { role: "assistant", content: "Liquor stores give them away free." }] },
];
const profile = { ...PROFILES.claude, pointerGate: 0, embedFloor: 0, dense: { floor: 0.6, weight: 1, unit: "maxsim" as const } };

test("the dense channel adds a unit close in meaning when the lexical side already let one in", () => {
  assert.doesNotMatch(buildPacket({ history, message: "when is priya moving again", profile }).text, /boxes/, "no embedder, no dense channel");
  const dense = buildPacket({ history, message: "when is priya moving again", profile, embed: fake });
  assert.match(dense.text, /moving to denver/);
  assert.match(dense.text, /relocating to colorado/, "in by meaning, with no shared word");
  assert.ok(dense.segments.some((s) => s.why === "similar in meaning"));
});

test("the dense channel never fills a packet the lexical side leaves empty", () => {
  // Close in meaning to the moving chats, but nothing lexical clears the bar.
  assert.equal(buildPacket({ history, message: "my bike", profile, embed: fake }).segments.length, 0);
  // The veto drops every lexical unit, so nothing lexical is in and no dense unit may come in either.
  assert.equal(buildPacket({ history, message: "when is priya moving again", profile: { ...profile, embedFloor: 2 }, embed: fake }).segments.length, 0);
});
