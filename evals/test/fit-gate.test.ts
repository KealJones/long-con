// The unit gate's offline fitter: the logistic fit separates an easy case, its raw-feature weights match core's scorer,
// and AUROC counts ties by halves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPacket, PROFILES, unitProbability, type Session } from "@beep/core";
import { auroc, fitLogistic, type Sample } from "../loop/fit-gate.ts";

test("fitLogistic learns a separable feature, in raw units", () => {
  const samples: Sample[] = [];
  for (let i = 0; i < 200; i++) {
    const x = (i % 20) * 10; // unscaled on purpose: the weights must come back on this scale
    samples.push({ x: [x, (i * 7) % 3], y: x >= 100 ? 1 : 0, w: 1, group: "a" });
  }
  const w = fitLogistic(samples, 1e-3);
  assert.ok(unitProbability([150, 1], w) > 0.9);
  assert.ok(unitProbability([40, 1], w) < 0.1);
  assert.ok(Math.abs(w[2]!) < Math.abs(w[1]!) * 10, "the noise feature gets little weight");
});

test("auroc is 1 for a perfect ranking, 0.5 for all ties", () => {
  assert.equal(auroc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1]), 1);
  assert.equal(auroc([0.5, 0.5, 0.5, 0.5], [0, 1, 0, 1]), 0.5);
});

test("a unit gate that rejects everything leaves the packet without retrieved history", () => {
  const history: Session[] = [{ id: "s", date: "2026/03/06", turns: [{ role: "user", content: "my sister priya moves to denver in april" }] }];
  const open = buildPacket({ history, message: "when does priya move to denver", profile: PROFILES.claude });
  assert.equal(open.segments.length, 1);
  const shut = buildPacket({ history, message: "when does priya move to denver", profile: { ...PROFILES.claude, unitGate: 0.5, unitWeights: [-50, ...new Array(10).fill(0)] } });
  assert.equal(shut.segments.length, 0);
});
