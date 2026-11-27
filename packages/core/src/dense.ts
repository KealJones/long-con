// Dense channel (backlog P10): a third ranking by embedding cosine, fused with the two BM25 rankings by RRF. Only units at or
// over an absolute cosine floor enter it, and it never opens a packet on its own: the builder lets a unit in by cosine only
// when the lexical side already let something in (or, if a profile sets one, at a much higher dense-only floor).

import type { Hit } from "./bm25.ts";
import { dot, type Embed } from "./embed.ts";
import type { Segment } from "./segments.ts";

export interface DenseSettings {
  /** Absolute cosine a unit needs to enter the dense ranking. */
  floor: number;
  /** Weight of the dense ranking's RRF term beside the two BM25 terms (each weight 1). */
  weight: number;
  /** "message": a unit scores its best message (max-sim). "segment": one vector for the whole unit (control arm). */
  unit: "message" | "segment";
  /** A unit at or over this cosine comes in even when no lexical unit did (still behind the minScore bar). Absent: never. */
  onlyFloor?: number;
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

/** Each unit's cosine to the query. */
export function denseScores(units: readonly Segment[], query: string, embed: Embed, unit: DenseSettings["unit"]): Map<Segment, number> {
  const q = embed(query);
  const out = new Map<Segment, number>();
  for (const seg of units) {
    const cos = unit === "segment" ? dot(q, embed(seg.turns.map((t) => t.content).join("\n"))) : Math.max(...seg.turns.map((t) => dot(q, embed(t.content))));
    out.set(seg, cos);
  }
  return out;
}

/**
 * The lexical ranking re-sorted with a weighted RRF term for units over the floor, plus dense-only units appended
 * where their fused score places them. Lexical scores are fuse()'s RRF sums, so k = 60 matches.
 */
export function fuseDense(ranked: readonly Ranked[], cosines: Map<Segment, number>, { floor, weight }: DenseSettings): Ranked[] {
  const dense = [...cosines].filter(([, c]) => c >= floor).sort((a, b) => b[1] - a[1]);
  const rank = new Map(dense.map(([seg], r) => [seg, r]));
  const term = (seg: Segment) => (rank.has(seg) ? weight / (60 + rank.get(seg)!) : 0);
  const lexical = new Set(ranked.map((r) => r.hit.item));
  const all: (Ranked & { fused: number })[] = [
    ...ranked.map((r) => ({ ...r, cosine: cosines.get(r.hit.item), fused: r.hit.score + term(r.hit.item) })),
    ...dense
      .filter(([seg]) => !lexical.has(seg))
      .map(([seg, cos]) => ({ hit: { item: seg, score: 0, matched: [] }, confidence: 0, cosine: cos, denseOnly: true, fused: term(seg) })),
  ];
  return all.sort((a, b) => b.fused - a.fused);
}
