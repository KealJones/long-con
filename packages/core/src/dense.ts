// Dense channel (backlog P10): a third ranking by embedding cosine, fused with the two BM25 rankings by RRF. Only units at or
// over an absolute cosine floor enter it, and it never opens a packet on its own: the builder lets a unit in by cosine only
// when the lexical side already let something in (or, if a profile sets one, at a much higher dense-only floor).

import type { Hit } from "./bm25.ts";
import type { Segment } from "./segments.ts";

export interface DenseSettings {
  /** Absolute cosine a unit needs to enter the dense ranking. */
  floor: number;
  /** Weight of the dense ranking's RRF term beside the two BM25 terms (each weight 1). */
  weight: number;
  /** "maxsim": a unit scores its best turn. "segment": one vector for the whole unit (control arm). */
  unit: "maxsim" | "segment";
  /** A unit at or over this cosine comes in even when no lexical unit did (still behind the minScore bar). Absent: never. */
  onlyFloor?: number;
  /** Also run on counting questions, adding whole units after the tally pieces. */
  tally?: boolean;
}

export interface Ranked {
  hit: Hit<Segment>;
  confidence: number;
  score?: number;
  features?: number[];
  /** Cosine to the message, when the dense channel ran. */
  cosine?: number;
  /** In the dense ranking only: no BM25 match, so no unit-gate features. */
  denseOnly?: boolean;
}

/**
 * The lexical ranking re-sorted with a weighted RRF term for units over the floor, plus dense-only units placed where
 * their fused score puts them. Lexical scores are fuse()'s RRF sums, so k = 60 matches.
 */
export function fuseDense(ranked: readonly Ranked[], units: readonly Segment[], sim: (seg: Segment) => number, { floor, weight }: DenseSettings): Ranked[] {
  const dense = units.map((seg) => [seg, sim(seg)] as const).filter(([, c]) => c >= floor).sort((a, b) => b[1] - a[1]);
  const rank = new Map(dense.map(([seg], r) => [seg, r]));
  const term = (seg: Segment) => (rank.has(seg) ? weight / (60 + rank.get(seg)!) : 0);
  const lexical = new Set(ranked.map((r) => r.hit.item));
  const all: (Ranked & { fused: number })[] = [
    ...ranked.map((r) => ({ ...r, cosine: sim(r.hit.item), fused: r.hit.score + term(r.hit.item) })),
    ...dense
      .filter(([seg]) => !lexical.has(seg))
      .map(([seg, cos]) => ({ hit: { item: seg, score: 0, matched: [] }, confidence: 0, cosine: cos, denseOnly: true, fused: term(seg) })),
  ];
  return all.sort((a, b) => b.fused - a.fused);
}
