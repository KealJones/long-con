// The benchmark plumbing: the builder never sees the answer labels, and the dev slice is fair and fixed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLongMemEval, stratifiedSlice } from "../src/longmemeval.ts";

const raw = [
  {
    question_id: "q1",
    question_type: "single-session-user",
    question: "Where is my sister moving?",
    question_date: "2023/05/30 (Tue) 23:40",
    answer: "Denver",
    answer_session_ids: ["answer_4f2a_1"],
    haystack_dates: ["2023/05/01 (Mon) 10:00", "2023/05/02 (Tue) 10:00"],
    haystack_session_ids: ["sharegpt_x1", "answer_4f2a_1"],
    haystack_sessions: [
      [{ role: "user", content: "pasta tips?" }, { role: "assistant", content: "Salt the water." }],
      [{ role: "user", content: "my sister is moving to Denver", has_answer: true }, { role: "assistant", content: "Big change!" }],
    ],
  },
  { question_id: "q2_abs", question_type: "multi-session", question: "What is my dog's name?", question_date: "2023/06/01", answer: "You never mentioned a dog.", answer_session_ids: [], haystack_dates: [], haystack_session_ids: [], haystack_sessions: [] },
];

function load() {
  const path = join(mkdtempSync(join(tmpdir(), "lme-")), "data.json");
  writeFileSync(path, JSON.stringify(raw));
  return loadLongMemEval(path);
}

test("the chats a builder reads carry no evidence labels, not even in their ids", () => {
  const [q] = load();
  // The benchmark's real ids name every evidence chat "answer_...".
  assert.doesNotMatch(JSON.stringify(q!.sessions), /has_answer|answer_session_ids|answer_4f2a/);
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
