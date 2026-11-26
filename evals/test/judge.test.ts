// The judge asks LongMemEval's question for each type and reads the verdict the way the benchmark does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { judgePrompt, passes } from "../src/judge.ts";
import type { Question } from "../src/longmemeval.ts";

const q = (type: string, abstention = false): Question => ({
  id: "q",
  type,
  question: "How many days between the two trips?",
  date: "2023/05/30",
  answer: "18 days",
  abstention,
  sessions: [],
  evidence: { sessions: [], turns: [] },
});

test("every prompt carries the question, the expected answer and the model's response", () => {
  for (const type of ["single-session-user", "single-session-assistant", "multi-session", "temporal-reasoning", "knowledge-update", "single-session-preference"]) {
    const prompt = judgePrompt(q(type), "It was 19 days.");
    for (const part of ["How many days between the two trips?", "18 days", "It was 19 days."]) assert.ok(prompt.includes(part), `${type} prompt lacks ${part}`);
  }
});

test("temporal questions forgive an off-by-one day count, other types don't", () => {
  assert.match(judgePrompt(q("temporal-reasoning"), "19"), /off-by-one/);
  assert.doesNotMatch(judgePrompt(q("multi-session"), "19"), /off-by-one/);
});

test("a knowledge update accepts old facts alongside the new answer", () => {
  assert.match(judgePrompt(q("knowledge-update"), "x"), /previous information along with an updated answer/);
});

test("a preference question is graded against a rubric", () => {
  assert.match(judgePrompt(q("single-session-preference"), "x"), /Rubric: 18 days/);
});

test("an abstention question passes for saying it can't be answered", () => {
  const prompt = judgePrompt(q("multi-session", true), "I don't know.");
  assert.match(prompt, /correctly identifies the question as unanswerable/);
  assert.doesNotMatch(prompt, /Correct Answer/);
});

test("an unknown type fails loudly instead of being graded by the wrong rubric", () => {
  assert.throws(() => judgePrompt(q("made-up"), "x"));
});

test("a yes anywhere passes and a no fails, as in the benchmark's script", () => {
  assert.equal(passes("Yes."), true);
  assert.equal(passes("yes"), true);
  assert.equal(passes("No."), false);
});
