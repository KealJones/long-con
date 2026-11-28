// The empty-rate scorer: should-be-empty probes are built without leaking evidence, and every unit in them counts against the builder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROFILES, type Session } from "@beep/core";
import { loadLongMemEval, type Question } from "../src/longmemeval.ts";
import {
  ablate,
  buildProbes,
  crossPairs,
  distinctHistories,
  FIXTURE,
  isEvidenceUnit,
  loadTier1,
  main,
  nearCopy,
  runProbe,
  scoreProfile,
  summarize,
  TIER1,
  type Probe,
} from "../loop/empty-rate.ts";

const chat = (id: string, contents: string[]): Session => ({ id, turns: contents.map((content, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), content })) });
const question = (id: string, sessions: Session[], evidence: Question["evidence"]): Question =>
  ({ id, type: "single-session-user", question: `question ${id}`, date: "", answer: "", abstention: id.endsWith("_abs"), sessions, evidence }) as Question;
const seg = (sessionId: string, turn: number) => ({ sessionId, start: turn, end: turn, confidence: 1, why: "" });
const none = { sessions: [], turns: [] };

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

test("ablation drops the evidence chats, any chat repeating an evidence turn, and near-copies of an evidence chat", () => {
  const evidence = chat("chat-1", ["my sister's dog is Biscuit", "cute", "he is a beagle", "lovely breed"]);
  const copy = chat("chat-3", ["unrelated", "ok", "my sister's dog is Biscuit", "cute"]);
  // Half its turns match the evidence chat's non-evidence turns: a near-copy by the held-out split's rule.
  const near = chat("chat-4", ["he is a beagle", "lovely breed", "any tips on walks?", "short ones at first"]);
  const filler = chat("chat-2", ["pasta tips?", "salt the water", "he is a beagle", "fresh basil"]);
  const q = question("q1", [evidence, filler, copy, near], { sessions: ["chat-1"], turns: ["chat-1#0"] });
  assert.equal(nearCopy(q, near), true);
  assert.equal(nearCopy(q, filler), false, "one shared turn of four is under half");
  assert.deepEqual(ablate(q).map((s) => s.id), ["chat-2"]);
});

test("cross-history pairs skip a history holding the question's evidence or a near-copy of it, and the _abs twin", () => {
  const dog = chat("chat-1", ["my sister's dog is Biscuit", "cute"]);
  const a = question("a", [dog], { sessions: ["chat-1"], turns: ["chat-1#0"] });
  const aAbs = question("a_abs", [chat("chat-1", ["something else entirely", "ok"])], none);
  const b = question("b", [chat("chat-1", ["pasta tips?", "salt it"]), chat("chat-2", ["my sister's dog is Biscuit", "cute"])], { sessions: ["chat-1"], turns: ["chat-1#0"] });
  const c = question("c", [chat("chat-1", ["new job on June 3", "congrats"])], { sessions: ["chat-1"], turns: ["chat-1#0"] });
  const pairs = new Map(crossPairs([a, aAbs, b, c]).map(({ a, b }) => [a.id, b.id]));
  assert.equal(pairs.get("a"), "c", "a_abs is a's twin and b holds a's evidence");
  assert.equal(pairs.get("a_abs"), "b");
  const c2 = question("c2", [chat("chat-1", ["new job on June 3", "congrats", "it's at the studio", "nice"])], { sessions: ["chat-1"], turns: ["chat-1#0"] });
  const d = question("d", [chat("chat-1", ["it's at the studio", "nice"])], none);
  const e = question("e", [chat("chat-1", ["pasta?", "salt"])], none);
  assert.equal(new Map(crossPairs([c2, d, e]).map(({ a, b }) => [a.id, b.id])).get("c2"), "e", "d holds a near-copy of c2's evidence chat");
});

test("tier 1 takes one history per X/X_abs twin pair", () => {
  const h = [chat("chat-1", ["x", "y"])];
  const qs = [question("a", h, none), question("a_abs", h, none), question("b", h, none)];
  assert.deepEqual(distinctHistories(qs).map((q) => q.id), ["a", "b"]);
  const probes = buildProbes(qs.slice(0, 2), [{ id: "t1", kind: "greeting", prompt: "hi", why: "" }]);
  assert.equal(probes.filter((p) => p.tier === "tier1-off-history").length, 1);
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

test("summary with stub packets: empty rate, false inclusions, retrieved tokens, precision, and _abs kept informational", () => {
  const empty = { segments: [], text: "notice", tokens: 2 };
  const withUnits = (n: number) => ({ segments: Array.from({ length: n }, (_, i) => seg("chat-1", i)), text: "notice\n\nRetrieved history, oldest first:\nuser: x", tokens: 20 });
  const off: Probe = { tier: "tier1-off-history", id: "a", message: "hi", history: [] };
  const ans: Probe = { tier: "answerable", id: "b", message: "q", history: [], evidence: { sessions: ["chat-1"], turns: ["chat-1#0"] } };
  const abs: Probe = { tier: "tier4-abstention", id: "d_abs", message: "q", history: [], evidence: { sessions: ["chat-1"], turns: [] } };
  const results = [
    runProbe(off, PROFILES.claude, () => empty),
    runProbe({ ...off, id: "c" }, PROFILES.claude, () => withUnits(3)),
    runProbe(ans, PROFILES.claude, () => withUnits(4)),
    runProbe(abs, PROFILES.claude, () => ({ segments: [seg("chat-1", 0), seg("chat-2", 0)], text: "x", tokens: 5 })),
  ];
  assert.deepEqual([results[0]!.units, results[0]!.retrievedTokens], [0, 0]);
  const [t1, t4, a] = summarize(results);
  assert.equal(t1!.tier, "tier1-off-history");
  assert.equal(t1!.informational, false);
  assert.equal(t1!.emptyRate, 0.5);
  assert.equal(t1!.falseInclusions, 1.5, "every unit off history is false");
  assert.equal(t1!.meanTokens, 11);
  assert.equal(t1!.precision, null);
  assert.equal(t1!.meanRetrievedTokens, (0 + Math.ceil("Retrieved history, oldest first:\nuser: x".length / 3.5)) / 2);
  assert.equal(t4!.tier, "tier4-abstention");
  assert.equal(t4!.informational, true, "_abs stays out of the headline");
  assert.equal(t4!.evidenceUnits, 1, "a unit from the related evidence chat");
  assert.equal(t4!.falseInclusions, 1);
  assert.equal(t4!.precision, null);
  assert.equal(a!.falseInclusions, 3);
  assert.equal(a!.precision, 0.25);
});

test("end to end on the synthetic fixture: every tier runs on both profiles", () => {
  const dev = loadLongMemEval(FIXTURE);
  const probes = buildProbes(dev, loadTier1());
  // 3 distinct histories (fx-dog and fx-dog_abs are twins) times the dev tier 1 prompts.
  assert.equal(probes.filter((p) => p.tier === "tier1-off-history").length, 3 * loadTier1().length);
  for (const profile of Object.values(PROFILES)) {
    const tiers = scoreProfile(probes, profile);
    assert.deepEqual(tiers.map((t) => t.tier), ["tier1-off-history", "tier2-cross-history", "tier3-evidence-ablated", "tier4-abstention", "answerable"]);
    for (const t of tiers) assert.ok(t.emptyRate >= 0 && t.emptyRate <= 1 && t.meanTokens > 0, t.tier);
  }
});

test("missing data fails with a clear message instead of a stack trace", (t) => {
  const errors: string[] = [];
  t.mock.method(console, "error", (m: string) => errors.push(m));
  assert.equal(main(["--data", "/nonexistent/longmemeval.json"]), 1);
  assert.match(errors.join("\n"), /No LongMemEval data at \/nonexistent\/longmemeval\.json\. Run evals\/scripts\/fetch-longmemeval\.sh/);
});
