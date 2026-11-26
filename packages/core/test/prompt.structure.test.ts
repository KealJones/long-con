// Structure tests, kept apart on purpose: here the order itself is the behavior,
// because a stable prefix is what lets the provider cache it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assemblePrompt } from "../src/index.ts";

test("the packet comes before the recent turns, and the new message is last", () => {
  const { messages } = assemblePrompt({
    system: "sys",
    packet: "PACKET",
    recentTurns: [
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
    ],
    message: "new message",
  });
  const flat = messages.map((m) => m.content).join("\n");
  assert.ok(flat.indexOf("PACKET") < flat.indexOf("earlier question"));
  assert.ok(flat.indexOf("earlier answer") < flat.indexOf("new message"));
  assert.equal(messages[messages.length - 1]!.content, "new message");
});

test("the system prompt is passed through untouched, so it caches across turns", () => {
  const a = assemblePrompt({ system: "stable", packet: "one", recentTurns: [], message: "a" });
  const b = assemblePrompt({ system: "stable", packet: "two", recentTurns: [], message: "b" });
  assert.equal(a.system, b.system);
});
