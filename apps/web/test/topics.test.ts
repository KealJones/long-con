import assert from "node:assert/strict";
import { test } from "node:test";
import { dayName, topics } from "../src/topics.ts";

test("topics counts the user's words by stem and skips filler", () => {
  const history = [
    { id: "a", turns: [{ role: "user" as const, content: "My dog hates the vacuum. Dogs are weird." }, { role: "assistant" as const, content: "dog dog dog" }] },
    { id: "b", turns: [{ role: "user" as const, content: "The dog again, and the kitchen paint." }] },
  ];
  const t = topics(history);
  assert.deepEqual(t[0], { word: "dog", count: 3 });
  assert.ok(t.some((x) => x.word === "vacuum"));
  assert.ok(!t.some((x) => ["the", "are", "and", "my"].includes(x.word)));
});

test("dayName reads session ids as friendly days", () => {
  const now = new Date(2026, 10, 26, 15);
  assert.equal(dayName("2026/11/26 (Thu)", now), "Today");
  assert.equal(dayName("2026/11/25 (Wed)", now), "Yesterday");
  assert.equal(dayName("2026/11/20 (Fri)", now), "Fri, Nov 20");
  assert.equal(dayName("2025/12/31 (Wed)", now), "Wed, Dec 31, 2025");
});
