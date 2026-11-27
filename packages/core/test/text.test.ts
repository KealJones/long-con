import assert from "node:assert/strict";
import test from "node:test";
import { contentWords } from "../src/text.ts";

const stems = (words: string[]) => new Set(words.map((w) => contentWords(w, "porter")[0]));

test("the suffix stripper is idempotent and gives a plural the stem of its singular", () => {
  const stem = (w: string) => contentWords(w)[0];
  for (const w of ["weddings", "meetings", "speeds", "focused", "succeeding", "parties", "plans"]) assert.equal(stem(stem(w)!), stem(w), w);
  for (const [a, b] of [["wedding", "weddings"], ["meeting", "meetings"], ["focus", "focused"], ["speed", "speeds"]]) assert.equal(stem(a), stem(b), `${a}/${b}`);
});

test("porter conflates the inflections the suffix stripper split", () => {
  for (const group of [["wedding", "weddings", "wedded"], ["party", "parties"], ["plan", "plans", "planned", "planning"], ["box", "boxes"]]) {
    assert.equal(stems(group).size, 1, group.join(", "));
  }
});

test("porter keeps stopwords out and numbers whole", () => {
  assert.deepEqual(contentWords("the 4096 tokens I was using", "porter"), ["4096", "token", "us"]);
});
