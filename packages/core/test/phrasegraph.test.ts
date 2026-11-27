// P28 phrase graph: chunking, the message rule, and a walk that reaches a unit through a shared phrase.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isGraphQuestion, phraseRank, phrases } from "../src/phrasegraph.ts";

test("phrases are content words plus adjacent pairs inside a chunk, possessives kept in the chunk", () => {
  assert.deepEqual(phrases("I went to my cousin's wedding. Fun!"), ["went", "cousin", "wedd", "cousin wedd", "fun"]);
});

test("the graph runs only for aggregation and what-do-I-know messages", () => {
  for (const m of ["How many weddings did I go to?", "What do I know about the bakery?", "how much have I spent so far"]) assert.ok(isGraphQuestion(m), m);
  for (const m of ["Where did I park?", "What did the doctor say about my knee?"]) assert.ok(!isGraphQuestion(m), m);
});

test("a walk reaches a unit that shares a rare phrase with a directly hit unit, and hubs leave the graph", () => {
  const filler = Array.from({ length: 40 }, (_, i) => ({ item: `f${i}`, phrases: ["day"] }));
  const units = [
    { item: "a", phrases: ["wedd", "aunt mary"] },
    { item: "b", phrases: ["aunt mary", "ceremony"] },
    { item: "c", phrases: ["garden"] },
    ...filler,
  ];
  const ranked = phraseRank(units, ["wedd", "day"]).map((x) => x.item);
  assert.deepEqual(ranked, ["a", "b"]);
});
