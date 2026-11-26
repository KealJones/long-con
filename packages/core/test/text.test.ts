import assert from "node:assert/strict";
import test from "node:test";
import { contentWords } from "../src/text.ts";

const stems = (words: string[]) => new Set(words.map((w) => contentWords(w, "porter")[0]));

test("porter conflates the inflections the suffix stripper split", () => {
  assert.notEqual(contentWords("wedding")[0], contentWords("weddings")[0]);
  for (const group of [["wedding", "weddings", "wedded"], ["party", "parties"], ["plan", "plans", "planned", "planning"], ["box", "boxes"]]) {
    assert.equal(stems(group).size, 1, group.join(", "));
  }
});

test("porter keeps stopwords out and numbers whole", () => {
  assert.deepEqual(contentWords("the 4096 tokens I was using", "porter"), ["4096", "token", "us"]);
});
