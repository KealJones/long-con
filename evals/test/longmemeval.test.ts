// The benchmark plumbing: the builder never sees the answer labels, and the dev slice is fair and fixed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { heldOutSplit, loadLongMemEval, stratifiedSlice, type Question } from "../src/longmemeval.ts";

const raw = [
  {
    question_id: "58bf7951",
    question_type: "single-session-user",
    question: "Where is my sister moving?",
    question_date: "2023/05/30 (Tue) 23:40",
    answer: "Denver",
    answer_session_ids: ["answer_355c48bb"],
    haystack_dates: ["2023/05/01 (Mon) 10:00", "2023/05/02 (Tue) 10:00"],
    haystack_session_ids: ["sharegpt_LG0uJvY_0", "answer_355c48bb"],
    haystack_sessions: [
      [{ role: "user", content: "pasta tips?" }, { role: "assistant", content: "Salt the water." }],
      [{ role: "user", content: "my sister is moving to Denver", has_answer: true }, { role: "assistant", content: "Big change!" }],
    ],
  },
  { question_id: "0862e8bf_abs", question_type: "multi-session", question: "What is my dog's name?", question_date: "2023/06/01", answer: "You never mentioned a dog.", answer_session_ids: [], haystack_dates: [], haystack_session_ids: [], haystack_sessions: [] },
];

function load() {
  const path = join(mkdtempSync(join(tmpdir(), "lme-")), "data.json");
  writeFileSync(path, JSON.stringify(raw));
  return loadLongMemEval(path);
}

test("the chats a builder reads carry no evidence labels, not even in their ids", () => {
  const [q] = load();
  // The benchmark's real ids name every evidence chat "answer_...".
  assert.doesNotMatch(JSON.stringify(q!.sessions), /has_answer|answer_session_ids|answer_355c48bb|answer_/);
  assert.doesNotMatch(JSON.stringify(q!.sessions), /sharegpt/, "filler ids are replaced too, so ids carry no pattern");
});

test("the evidence is kept apart, pointing at the right chat and turn", () => {
  const [q] = load();
  const id = q!.sessions[1]!.id;
  assert.deepEqual(q!.evidence, { sessions: [id], turns: [`${id}#0`] });
});

test("a question with _abs on its id is an abstention question", () => {
  const [q1, q2] = load();
  assert.equal(q1!.abstention, false);
  assert.equal(q2!.abstention, true);
});

const pool = [
  ...Array.from({ length: 60 }, (_, i) => ({ id: `a${i}`, type: "temporal" })),
  ...Array.from({ length: 30 }, (_, i) => ({ id: `b${i}`, type: "update" })),
  ...Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, type: "preference" })),
];

test("the dev slice keeps each type's share of the whole set", () => {
  const { dev } = stratifiedSlice(pool, 20, 7);
  const count = (t: string) => dev.filter((d) => d.type === t).length;
  assert.deepEqual([count("temporal"), count("update"), count("preference")], [12, 6, 2]);
});

test("dev and held-out never share a question, and together they are the whole set", () => {
  const { dev, heldOut } = stratifiedSlice(pool, 20, 7);
  const devIds = new Set(dev.map((d) => d.id));
  assert.equal(heldOut.filter((h) => devIds.has(h.id)).length, 0);
  assert.equal(dev.length + heldOut.length, pool.length);
});

test("the same seed picks the same slice whatever order the questions come in", () => {
  const a = stratifiedSlice(pool, 20, 7).dev.map((d) => d.id).sort();
  const b = stratifiedSlice([...pool].reverse(), 20, 7).dev.map((d) => d.id).sort();
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, stratifiedSlice(pool, 20, 8).dev.map((d) => d.id).sort(), "a different seed picks differently");
});

const chat = (id: string, text: string) => ({ id, date: "2023/05/01 (Mon) 10:00", turns: [{ role: "user" as const, content: text }] });
const q = (id: string, evidence: string): Question => ({
  id, type: "single-session-user", question: "?", date: "2023/05/30", answer: "", abstention: id.endsWith("_abs"),
  sessions: [chat("chat-1", evidence), chat("chat-2", "pasta tips?")],
  evidence: { sessions: ["chat-1"], turns: ["chat-1#0"] },
});

test("held-out leaves out every question that shares evidence with dev, so tuning on dev can't leak into it", () => {
  const all = [
    q("58bf7951", "my sister is moving to Denver"),
    q("58bf7951_abs", "my sister is moving to Denver"), // the abstention twin of a dev question
    q("1e043500", "my sister is moving to Denver"), // a different question over the same evidence chat
    q("c4a1ceb8", "I adopted a beagle named Pepper"),
  ];
  const { heldOut, excluded } = heldOutSplit(all, [all[0]!]);
  assert.deepEqual(heldOut.map((h) => h.id), ["c4a1ceb8"]);
  assert.equal(excluded, 2);
});

test("a near-copy of a dev question's evidence chat is left out too, not just an exact copy", () => {
  const near = q("1e4a8aeb", "my sister is moving to Denver");
  near.sessions[0] = { ...near.sessions[0]!, turns: [{ role: "user", content: "my sister is moving to Denver" }, { role: "assistant", content: "A different reply this time." }] };
  const dev = q("1e4a8aec", "my sister is moving to Denver");
  dev.sessions[0] = { ...dev.sessions[0]!, turns: [{ role: "user", content: "my sister is moving to Denver" }, { role: "assistant", content: "Exciting news for her!" }] };
  const { heldOut } = heldOutSplit([dev, near, q("c4a1ceb8", "I adopted a beagle named Pepper")], [dev]);
  assert.deepEqual(heldOut.map((h) => h.id), ["c4a1ceb8"]);
});

// Each grouping rule on its own, so dropping any one of them fails a test.
const withChat = (id: string, turns: string[]): Question => ({
  ...q(id, ""),
  sessions: [{ id: "chat-1", date: "2023/05/01 (Mon) 10:00", turns: turns.map((content, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), content })) }, chat("chat-2", "pasta tips?")],
});

test("an abstention twin is held out with its question even when its evidence chat is different", () => {
  const dev = q("7a1b2c3d", "my sister is moving to Denver");
  const twin = q("7a1b2c3d_abs", "my cousin is moving to Boise");
  const { heldOut } = heldOutSplit([dev, twin, q("c4a1ceb8", "I adopted a beagle named Pepper")], [dev]);
  assert.deepEqual(heldOut.map((h) => h.id), ["c4a1ceb8"]);
});

test("one shared evidence turn is enough to hold a question out, even in an otherwise different chat", () => {
  const dev = withChat("aa000001", ["my sister is moving to Denver", "a1", "a2", "a3", "a4", "a5"]);
  const other = withChat("aa000002", ["my sister is moving to Denver", "b1", "b2", "b3", "b4", "b5"]);
  const { heldOut } = heldOutSplit([dev, other, q("c4a1ceb8", "I adopted a beagle named Pepper")], [dev]);
  assert.deepEqual(heldOut.map((h) => h.id), ["c4a1ceb8"]);
});

test("an evidence chat sharing half its turns with a dev evidence chat is held out, even with a different evidence turn", () => {
  const dev = withChat("bb000001", ["my sister is moving to Denver", "shared one", "shared two", "a4"]);
  const other = withChat("bb000002", ["my brother bought a canoe", "shared one", "shared two", "b4"]);
  const { heldOut } = heldOutSplit([dev, other, q("c4a1ceb8", "I adopted a beagle named Pepper")], [dev]);
  assert.deepEqual(heldOut.map((h) => h.id), ["c4a1ceb8"]);
});
