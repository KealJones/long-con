import assert from "node:assert/strict";
import { test } from "node:test";
import { compareCost, costOf, MINUTE, priceOf, type CostTurn } from "../src/index.ts";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("prices: cache reads and writes, Haiku's long-prompt rates, unknown models as Opus", () => {
  close(costOf("claude-opus-5-5", { input: 1e6, output: 1e6 }), 24);
  close(costOf("claude-opus-5-5", { input: 0, output: 0, cacheRead: 1e6, cacheWrite: 1e6, cacheWrite1h: 1e6 }), 0.2 + 5 + 8);
  close(costOf("claude-haiku-5-5", { input: 100_000, output: 0 }), 0.01);
  close(costOf("claude-haiku-5-5", { input: 100_001, output: 0 }), 100_001 * 0.5 / 1e6);
  close(costOf("claude-opus-5-5", { input: 0, output: 0, webSearches: 3 }), 0.03);
  assert.equal(priceOf("something-new").name, "Opus 5.5");
});

// The packet replaces a history of 2,000 tokens: each Beep prompt is 1,500 (1,000 of it cached system + tools).
const turn = (at: number): CostTurn => ({ model: "claude-opus-5-5", message: "x".repeat(350), context: 400, calls: [{ at, input: 500, cacheRead: 1000, output: 100 }] });

test("a classic chat reads its history from cache while it lives, and writes it again after a gap", () => {
  const near = compareCost([turn(0), turn(MINUTE)], { ttl: 5 * MINUTE });
  close(near.beep, 2 * costOf("claude-opus-5-5", { input: 500, cacheRead: 1000, output: 100 }));
  // Turn 1: 1,100 tokens (1,500 less the 400 packet), all written. Its transcript adds 100 (message) + 100 (answer).
  // Turn 2: 1,300 tokens, 1,100 read from cache, 200 written.
  const w = (n: number) => costOf("claude-opus-5-5", { input: 0, output: 100, cacheWrite: n });
  close(near.classic, w(1100) + w(200) + costOf("claude-opus-5-5", { input: 0, output: 0, cacheRead: 1100 }));

  const far = compareCost([turn(0), turn(10 * MINUTE)], { ttl: 5 * MINUTE });
  close(far.classic, w(1100) + w(1300));
  const hour = compareCost([turn(0), turn(10 * MINUTE)], { ttl: 60 * MINUTE });
  const w1 = (n: number) => costOf("claude-opus-5-5", { input: 0, output: 100, cacheWrite1h: n });
  close(hour.classic, w1(1100) + w1(200) + costOf("claude-opus-5-5", { input: 0, output: 0, cacheRead: 1100 }));
});

test("unmetered turns still grow the classic history, and a full window compacts", () => {
  const old: CostTurn = { message: "y".repeat(3500), answer: "z".repeat(3500) }; // 2,000 tokens, never billed
  const r = compareCost([old, turn(0)], { ttl: 5 * MINUTE });
  assert.equal(r.turns, 1);
  assert.equal(r.peak, 1100 + 2000);

  const big: CostTurn = { message: "b".repeat(3_500_000) }; // 1M tokens of history
  const c = compareCost([big, turn(0), turn(MINUTE)], { ttl: 5 * MINUTE, summary: 5000 });
  assert.equal(c.compactions, 1);
  assert.equal(c.peak, 1100 + 5000 + 200);
});
