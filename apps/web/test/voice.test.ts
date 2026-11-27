import assert from "node:assert/strict";
import { test } from "node:test";
import { interruptNote, sentences, speakable } from "../src/voice.ts";

test("replies read aloud lose markdown and links, and split into sentences with tiny ones joined", () => {
  assert.equal(speakable("**Sure!** See [the docs](https://x.y) or https://a.b/c\n- one\n- `two`"), "Sure! See the docs or a link one two");
  assert.deepEqual(sentences("Yes. It's done now. Want more? Okay then, here it is."), ["Yes. It's done now.", "Want more? Okay then, here it is."]);
});

test("talking over a reply notes where it stopped, partway through a sentence", () => {
  const parts = ["The first part is short.", "Then a second sentence with eight words."];
  assert.equal(interruptNote(parts, 1, 0.5), `[The user interrupted while your last reply was being read aloud. They heard up to: "The first part is short. Then a second". The rest wasn't heard.]`);
  assert.match(interruptNote(parts, 0, 0), /before any of it was read aloud/);
  const long = ["one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen."];
  assert.match(interruptNote(long, 1, 0), /heard up to: "…three four .* seventeen\."/);
});
