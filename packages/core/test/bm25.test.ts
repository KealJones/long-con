import { test } from "node:test";
import assert from "node:assert/strict";
import { Bm25, Bm25F } from "../src/bm25.ts";

test("BM25F with one field scores like plain BM25", () => {
  const docs = [["lisbon", "trip", "tram"], ["tram", "tram", "ticket", "price", "zone"], ["paris"]];
  const plain = new Bm25<number>();
  const fielded = new Bm25F<number>([1], [0.75]);
  docs.forEach((d, i) => (plain.add(i, d), fielded.add(i, [d])));
  const a = plain.search(["tram", "lisbon"]);
  const b = fielded.search(["tram", "lisbon"]);
  assert.deepEqual(b.map((h) => h.item), a.map((h) => h.item));
  a.forEach((h, i) => assert.ok(Math.abs(h.score - b[i]!.score) < 1e-9));
  assert.equal(fielded.ceiling(["tram", "lisbon"]), plain.ceiling(["tram", "lisbon"]));
});

test("BM25F up-weights a word said in the heavier field", () => {
  // Same words, same lengths; only the field the query word sits in differs.
  const index = new Bm25F<string>([2, 1], [0.75, 0.75]);
  index.add("user said it", [["lisbon", "trip"], ["museum", "hours"]]);
  index.add("assistant said it", [["museum", "trip"], ["lisbon", "hours"]]);
  index.add("neither", [["paris", "food"], ["bread", "cheese"]]);
  const hits = index.search(["lisbon"]);
  assert.deepEqual(hits.map((h) => h.item), ["user said it", "assistant said it"]);
  assert.ok(hits[0]!.score > hits[1]!.score);
});
