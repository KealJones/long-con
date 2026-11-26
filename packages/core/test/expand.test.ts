// Tally-mode query expansion: a category word also matches its members, at a lower weight than the word itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Bm25 } from "../src/bm25.ts";
import { expandQuery } from "../src/expand.ts";
import { contentWords } from "../src/text.ts";

test("category words in the query expand to their members on both stemmers, leaving out words the query has", () => {
  for (const stemmer of ["suffix", "porter"] as const) {
    const of = expandQuery("How many siblings and pets do I have?", stemmer);
    const [sibling] = contentWords("siblings", stemmer);
    assert.ok(of.get(sibling!)!.includes(contentWords("sisters", stemmer)[0]!), stemmer);
    assert.ok(of.get(contentWords("pets", stemmer)[0]!)!.includes(contentWords("dogs", stemmer)[0]!), stemmer);
  }
  assert.ok(!expandQuery("how many sisters and siblings").get("sibling")!.includes("sister"));
  assert.equal(expandQuery("what did I eat for lunch").size, 0);
});

test("a member stands in for a missing query word below the word's own score, and is reported as that word", () => {
  const index = new Bm25<string>();
  for (const [id, text] of [["sisters", "I have 3 sisters"], ["siblings", "I have siblings"], ["other", "I have a car"]] as const) index.add(id, contentWords(text));
  const alt = { of: expandQuery("siblings"), weight: 0.5 };
  assert.deepEqual(index.search(contentWords("siblings")).map((h) => h.item), ["siblings"]);
  const hits = index.search(contentWords("siblings"), Infinity, alt);
  assert.deepEqual(hits.map((h) => h.item), ["siblings", "sisters"]);
  assert.deepEqual(hits[1]!.matched, ["sibling"]);
  assert.ok(hits[1]!.score <= 0.5 * hits[0]!.score + 1e-9);
});
