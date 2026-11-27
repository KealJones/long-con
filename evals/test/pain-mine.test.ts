import { test } from "node:test";
import assert from "node:assert/strict";
import { kindsOf, mine } from "../loop/pain-mine.ts";

test("the pain miner tags failures and lean-on-context follow-ups, and keeps the reply before each", () => {
  assert.deepEqual(kindsOf("you forgot the tax again"), ["failure"]);
  assert.deepEqual(kindsOf("go"), ["ack"]);
  assert.deepEqual(kindsOf("now do all that"), ["bundle"]);
  assert.deepEqual(kindsOf("multiply it by 32"), ["result"]);
  assert.deepEqual(kindsOf("tell me about the second one"), ["ordinal"]);
  assert.deepEqual(kindsOf("write me a haiku"), []);
  const [hit] = mine([{ uuid: "c1", name: "rent", chat_messages: [
    { sender: "human", text: "what's 60% of 2900" },
    { sender: "assistant", content: [{ type: "text", text: "$1,740." }] },
    { sender: "human", text: "double that" },
  ] }]);
  assert.equal(hit!.kind, "result");
  assert.equal(hit!.before, "$1,740.");
});
