// The empty-rate scorer: should-be-empty probes are built without leaking evidence, and every unit in them counts against the builder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROFILES, type Session } from "@long-con/core";
import { loadLongMemEval, type Question } from "../src/longmemeval.ts";
import {
  ablate,
  buildProbes,
  crossPairs,
  FIXTURE,
  isEvidenceUnit,
  loadTier1,
  main,
  runProbe,
  scoreProfile,
  summarize,
  TIER1,
  type Probe,
} from "../loop/empty-rate.ts";

const chat = (id: string, contents: string[]): Session => ({ id, turns: contents.map((content, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), content })) });
const question = (id: string, sessions: Session[], evidence: Question["evidence"]): Question =>
  ({ id, type: "single-session-user", question: `question ${id}`, date: "", answer: "", abstention: id.endsWith("_abs"), sessions, evidence }) as Question;

test("tier 1 has 40-50 prompts, unique ids, a reason each, and a dev/held-out split that covers every prompt once", () => {
  const file = JSON.parse(readFileSync(TIER1, "utf8"));
  const ids: string[] = file.prompts.map((p: { id: string }) => p.id);
  assert.ok(ids.length >= 40 && ids.length <= 50, `${ids.length} prompts`);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of file.prompts) assert.ok(p.prompt && p.why && p.kind, p.id);
  const { dev, heldOut } = file.split;
  assert.deepEqual([...dev, ...heldOut].sort(), [...ids].sort());
  assert.equal(new Set(dev).size + new Set(heldOut).size, ids.length);
  assert.equal(loadTier1().length, dev.length);
  assert.equal(loadTier1(TIER1, "heldOut").length, heldOut.length);
  // Every kind lands on both sides, so dev tuning sees every kind.
  const kinds = new Set(file.prompts.map((p: { kind: string }) => p.kind));
  const kindOf = new Map(file.prompts.map((p: { id: string; kind: string }) => [p.id, p.kind]));
  for (const k of kinds) {
    assert.ok(dev.some((id: string) => kindOf.get(id) === k), `${k} in dev`);
    assert.ok(heldOut.some((id: string) => kindOf.get(id) === k), `${k} in held-out`);
  }
});

test("a unit is evidence when it covers an evidence turn; without turn labels, any unit of an evidence chat counts", () => {
  const ev = { sessions: ["chat-2"], turns: ["chat-2#3"] };
  assert.equal(isEvidenceUnit({ sessionId: "chat-2", start: 2, end: 3 }, ev), true);
  assert.equal(isEvidenceUnit({ sessionId: "chat-2", start: 0, end: 1 }, ev), false);
  assert.equal(isEvidenceUnit({ sessionId: "chat-1", start: 3, end: 3 }, ev), false);
  assert.equal(isEvidenceUnit({ sessionId: "chat-2", start: 0, end: 0 }, { sessions: ["chat-2"], turns: [] }), true);
});

test("ablation drops the evidence chats and any filler chat that repeats an evidence turn word for word", () => {
  const evidence = chat("chat-1", ["my sister's dog is Biscuit", "cute"]);
  const copy = chat("chat-3", ["unrelated", "ok", "my sister's dog is Biscuit", "cute"]);
  const filler = chat("chat-2", ["pasta tips?", "salt the water"]);
  const q = question("q1", [evidence, filler, copy], { sessions: ["chat-1"], turns: ["chat-1#0"] });
  assert.deepEqual(ablate(q).map((s) => s.id), ["chat-2"]);
});

test("cross-history pairs skip a history that holds the question's evidence, and the question's _abs twin", () => {
  const dog = chat("chat-1", ["my sister's dog is Biscuit", "cute"]);
  const a = question("a", [dog], { sessions: ["chat-1"], turns: ["chat-1#0"] });
  const aAbs = question("a_abs", [chat("chat-1", ["something else entirely", "ok"])], { sessions: [], turns: [] });
  const b = question("b", [chat("chat-1", ["pasta tips?", "salt it"]), chat("chat-2", ["my sister's dog is Biscuit", "cute"])], { sessions: ["chat-1"], turns: ["chat-1#0"] });
  const c = question("c", [chat("chat-1", ["new job on June 3", "congrats"])], { sessions: ["chat-1"], turns: ["chat-1#0"] });
  const pairs = new Map(crossPairs([a, aAbs, b, c]).map(({ a, b }) => [a.id, b.id]));
  assert.equal(pairs.get("a"), "c", "a_abs is a's twin and b holds a's evidence");
  assert.equal(pairs.get("a_abs"), "b");
});

test("probes: tier 1 is prompts x histories, tier 3 holds no evidence chat, only tier 4 and answerable carry evidence", () => {
  const q1 = question("q1", [chat("chat-1", ["I fly to Lisbon in October", "nice"]), chat("chat-2", ["pasta?", "salt"])], { sessions: ["chat-1"], turns: ["chat-1#0"] });
  const q2 = question("q2_abs", [chat("chat-1", ["the gym opens at six", "ok"])], { sessions: ["chat-1"], turns: [] });
  const tier1 = [{ id: "t1", kind: "greeting", prompt: "hi", why: "" }, { id: "t2", kind: "arithmetic", prompt: "17 times 23?", why: "" }];
  const probes = buildProbes([q1, q2], tier1);
  const count = (tier: Probe["tier"]) => probes.filter((p) => p.tier === tier).length;
  assert.equal(count("tier1-off-history"), 4);
  assert.equal(count("tier3-evidence-ablated"), 1);
  assert.equal(count("tier4-abstention"), 1);
  assert.equal(count("answerable"), 1);
  assert.deepEqual(probes.find((p) => p.tier === "tier3-evidence-ablated")!.history.map((s) => s.id), ["chat-2"]);
  for (const p of probes) assert.equal(!!p.evidence, p.tier === "tier4-abstention" || p.tier === "answerable", p.tier);
  assert.equal(buildProbes([q1, q2], tier1, { tier1Histories: 1 }).filter((p) => p.tier === "tier1-off-history").length, 2);
});

test("summary: empty rate, false inclusions, retrieved tokens and pooled precision", () => {
  const seg = (sessionId: string, turn: number) => ({ sessionId, start: turn, end: turn, confidence: 1, why: "" });
  const empty = { segments: [], text: "notice", tokens: 2 };
  const withUnits = (n: number) => ({ segments: Array.from({ length: n }, (_, i) => seg("chat-1", i)), text: "notice\n\nRetrieved history, oldest first:\nuser: x", tokens: 20 });
  const off: Probe = { tier: "tier1-off-history", id: "a", message: "hi", history: [] };
  const ans: Probe = { tier: "answerable", id: "b", message: "q", history: [], evidence: { sessions: ["chat-1"], turns: ["chat-1#0"] } };
  const results = [
    runProbe(off, PROFILES.claude, () => empty),
    runProbe({ ...off, id: "c" }, PROFILES.claude, () => withUnits(3)),
    runProbe(ans, PROFILES.claude, () => withUnits(4)),
  ];
  const [t1, a] = summarize(results);
  assert.equal(t1!.tier, "tier1-off-history");
  assert.equal(t1!.emptyRate, 0.5);
  assert.equal(t1!.falseInclusions, 1.5, "every unit off history is false");
  assert.equal(t1!.precision, null);
  assert.equal(t1!.meanRetrievedTokens, (0 + Math.ceil("Retrieved history, oldest first:\nuser: x".length / 3.5)) / 2);
  assert.equal(a!.falseInclusions, 3);
  assert.equal(a!.precision, 0.25);
});

test("end to end on the synthetic fixture: every tier runs on both profiles and a greeting retrieves nothing", () => {
  const dev = loadLongMemEval(FIXTURE);
  const probes = buildProbes(dev, loadTier1());
  for (const profile of Object.values(PROFILES)) {
    const tiers = scoreProfile(probes, profile);
    assert.deepEqual(tiers.map((t) => t.tier), ["tier1-off-history", "tier2-cross-history", "tier3-evidence-ablated", "tier4-abstention", "answerable"]);
    for (const t of tiers) assert.ok(t.emptyRate >= 0 && t.emptyRate <= 1 && t.meanTokens > 0, t.tier);
  }
  const hi = runProbe({ tier: "tier1-off-history", id: "hi", message: "hi there", history: dev[0]!.sessions }, PROFILES.claude);
  assert.equal(hi.units, 0);
});

test("missing data fails with a clear message instead of a stack trace", (t) => {
  const errors: string[] = [];
  t.mock.method(console, "error", (m: string) => errors.push(m));
  assert.equal(main(["--data", "/nonexistent/longmemeval.json"]), 1);
  assert.match(errors.join("\n"), /No LongMemEval data at \/nonexistent\/longmemeval\.json\. Run evals\/scripts\/fetch-longmemeval\.sh/);
});
