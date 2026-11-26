// Tally mode (backlog P06). Counting and aggregation questions ("how many X did I...", "total", "list all") need one
// small piece from each of several chats. Whole segments spend the budget on a few chats and the rest get cut, so in
// this mode the unit is the best sentence of each matching user turn, with its neighbours or its whole turn when the turn is short.

import type { Session } from "./chat.ts";
import { Bm25, type Hit } from "./bm25.ts";
import type { Segment } from "./segments.ts";
import { unitProbability } from "./gate.ts";
import { contentWords, estimateTokens, type Stemmer } from "./text.ts";

// shortcut: English-only phrase rules on the message alone; swap for a learned intent check if false triggers show up in real use.
// "how many days/years..." asks for a span or an age, not a count, so time units don't trigger it.
const TALLY =
  /\b(how many (?!(?:days?|weeks?|months?|years?|hours?|minutes?|seconds?|times?)\b)\w+|in total|total|altogether|combined|list (?:all|every)|all the|every|each|different)\b/i;

// A question about what the assistant said ("how many eggs did you say") asks for one answer, not a tally of the user's life.
export const isTallyQuestion = (message: string): boolean => TALLY.test(message) && !/\byou\b/i.test(message);

/** A user turn this short comes in whole; a longer one comes in as its best sentence and the sentences either side. */
const WHOLE_TURN_TOKENS = 150;

// Swept 0 / 0.4 / 0.5 on the dev slice: 0.4 kept every hit 0 had with fewer wrong pieces; 0.5 lost a multi-session question.
// One sentence matches on fewer words than a segment, so a weak piece needs a higher share of the top to come in.
const MIN_SHARE = 0.4;

// Words of the counting-question grammar itself (TALLY above, plus "number of" and "count"), not the thing counted. They
// match unrelated turns (word problems, "the total came to"), so piece ranking leaves them out; the bar and segment search
// keep them. Dev sweep: dropping held recall with fewer wrong pieces on both profiles; weight 0.3 did less; down-weighting
// words common in the history's user turns lost claude questions, since those were topic words ("music", "project").
const COUNTING = "total altogether combined list every different number count";

const sentences = (text: string) => text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim());

/** Features of a tally piece, from the history and the message alone. The shipped gate uses segGate; evals fit the rest. */
export const TALLY_FEATURES = [
  "absolute", // the piece's BM25 score over the most any sentence could score on the query
  "topAbsolute", // the best piece's absolute score
  "relative", // the piece's score as a share of the top piece
  "rank", // 1 / (1 + rank) among pieces
  "idfCoverage", // IDF of the matched query words over IDF of all query words
  "matchedShare", // matched query words over query words
  "logLength", // log of the piece's indexed word count
  "logPieces", // log of 1 + how many turns matched above the share cut
  "segAbsolute", // absolute score of the best segment holding the piece's turn (segment search)
  "segRank", // 1 / (1 + that segment's place in the fused segment ranking), 0 when no segment matched
  "segTopAbsolute", // the best segment's absolute score (P02's bar)
  "segGate", // the highest unit-gate probability (gate.ts) of a segment holding the turn, 0 when none matched
] as const;
export const SEG_GATE = TALLY_FEATURES.indexOf("segGate");

/**
 * The best sentence of each matching user turn, ranked by BM25 over user sentences. Confidence is the share of the top
 * score, as in the segment search. One unit per turn, not per chat: a chat can hold more than one of the things counted.
 */
export function tallySearch(
  history: Session[],
  query: string,
  currentId: string | undefined,
  recentStart: number,
  units: readonly { hit: Hit<Segment>; score: number; features: number[] }[] = [],
  unitWeights?: readonly number[],
  stemmer: Stemmer = "suffix",
) {
  const index = new Bm25<{ session: Session; turn: number; at: number; all: string[] }>();
  for (const session of history) {
    session.turns.forEach((turn, i) => {
      // Turns already riding along raw don't need retrieving.
      if (turn.role !== "user" || (session.id === currentId && i >= recentStart)) return;
      const all = sentences(turn.content);
      all.forEach((s, at) => index.add({ session, turn: i, at, all }, contentWords(s, stemmer)));
    });
  }
  const counting = new Set(contentWords(COUNTING, stemmer));
  const asked = contentWords(query, stemmer);
  const topic = asked.filter((w) => !counting.has(w));
  // A question that is all counting words ("count them all") keeps them, or nothing would match.
  const words = topic.length ? topic : asked;
  const terms = [...new Set(words)];
  const hits = index.search(words);
  const top = hits[0]?.score ?? 1;
  const ceiling = index.ceiling(words) || 1;
  const idfAll = terms.reduce((a, t) => a + index.idf(t), 0) || 1;
  // The best segment (first in fused order) holding each turn, so a piece can be checked against the segment search.
  const unitOf = new Map<string, { score: number; rank: number; gate: number }>();
  units.forEach(({ hit, score, features }, rank) => {
    const gate = unitProbability(features, unitWeights);
    for (let t = hit.item.start; t <= hit.item.end; t++) {
      const key = `${hit.item.sessionId}#${t}`;
      const prev = unitOf.get(key);
      if (!prev) unitOf.set(key, { score, rank, gate });
      else prev.gate = Math.max(prev.gate, gate);
    }
  });
  const segTop = Math.max(0, ...units.map((u) => u.score));
  const pieces = hits.filter((h) => h.score / top >= MIN_SHARE);
  const turns = new Set(pieces.map((h) => `${h.item.session.id}#${h.item.turn}`)).size;
  const seen = new Set<string>();
  const out: { hit: Hit<Segment>; confidence: number; features: number[] }[] = [];
  for (const h of pieces) {
    const { session, turn, at, all } = h.item;
    const key = `${session.id}#${turn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const whole = session.turns[turn]!.content;
    const content = estimateTokens(whole) <= WHOLE_TURN_TOKENS ? whole : all.slice(Math.max(0, at - 1), at + 2).join(" ");
    const unit: Segment = { sessionId: session.id, date: session.date, start: turn, end: turn, turns: [{ role: "user", content }], ...(content !== whole ? { partial: true } : {}) };
    const seg = unitOf.get(key);
    const features = [
      h.score / ceiling,
      top / ceiling,
      h.score / top,
      1 / (1 + out.length),
      h.matched.reduce((a, t) => a + index.idf(t), 0) / idfAll,
      h.matched.length / (terms.length || 1),
      Math.log(1 + contentWords(all[at]!).length),
      Math.log(1 + turns),
      seg?.score ?? 0,
      seg ? 1 / (1 + seg.rank) : 0,
      segTop,
      seg?.gate ?? 0,
    ];
    out.push({ hit: { item: unit, score: h.score, matched: h.matched }, confidence: h.score / top, features });
  }
  return out;
}
