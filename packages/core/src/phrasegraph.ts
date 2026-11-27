// Phrase graph plus personalized PageRank (backlog P28). HippoRAG's retrieval half (Gutiérrez et al. 2024, 2025) without
// its LLM: phrases come from a rule-based chunker, not OpenIE. Phrases link to the units that hold them; a walk seeded from
// the message's phrases scores units, so a unit that shares rare phrases with the units the message hits directly rises too.
// It runs only for aggregation and "what do I know about X" messages, judged on the message text alone.

import type { Session } from "./chat.ts";
import { splitIntoSegments, type Segment } from "./segments.ts";
import { isTallyQuestion } from "./tally.ts";
import { contentWords, type Stemmer } from "./text.ts";

// Written down before any dev result (P28): aggregation is the tally rule; "what do I know about X" is this list.
const RECALL_ALL = /\b(what (?:do|did) (?:i|you) (?:know|remember)|what have i (?:told|said|mentioned)|everything (?:i|we)|so far|over the (?:past|last)|across (?:all|my)|how much (?:did|have) i)\b/i;
export const isGraphQuestion = (message: string): boolean => isTallyQuestion(message) || RECALL_ALL.test(message);

/**
 * Phrases of a text: each content word and each pair of adjacent content words inside one chunk. A chunk is a run of
 * words with no stopword or punctuation between them, a crude noun-phrase stand-in ("new running shoes").
 */
export function phrases(text: string, stemmer: Stemmer = "suffix"): string[] {
  const out: string[] = [];
  // "my cousin's wedding": the possessive would split the chunk at the stopword "s".
  for (const clause of text.replace(/['’]s\b/gi, "").split(/[.,;:!?()"\n]+/)) {
    let run: string[] = [];
    const flush = () => {
      run.forEach((w, i) => out.push(w, ...(i ? [`${run[i - 1]} ${w}`] : [])));
      run = [];
    };
    for (const raw of clause.split(/\s+/)) {
      const w = contentWords(raw, stemmer);
      if (w.length === 1) run.push(w[0]!);
      else flush();
    }
    flush();
  }
  return out;
}

export interface GraphOptions {
  /** Restart probability's complement: the share of mass that keeps walking each step. HippoRAG uses 0.5. */
  damping: number;
  iterations: number;
  /** Phrases in more than this share of units are hubs and leave the graph, so a walk can't spread through "time" or "day". */
  maxShare: number;
  /** Lexical stand-in for HippoRAG 2's synonym edges: a query word also seeds graph words sharing its first this many letters. 0 is off. */
  prefix: number;
}
export const GRAPH_DEFAULTS: GraphOptions = {
  damping: 0.5,
  iterations: 10,
  maxShare: 0.05,
  prefix: 0,
};

/**
 * Personalized PageRank over the unit-phrase bipartite graph, seeded by the query's phrases weighted by specificity (1 / the
 * units holding them, HippoRAG's node specificity). Returns each reached unit's score, best first.
 */
export function phraseRank<T>(units: { item: T; phrases: string[] }[], query: string[], options: GraphOptions = GRAPH_DEFAULTS): { item: T; score: number }[] {
  const holders = new Map<string, number[]>();
  units.forEach((u, i) => {
    for (const p of new Set(u.phrases)) (holders.get(p) ?? holders.set(p, []).get(p)!).push(i);
  });
  const cap = Math.max(1, options.maxShare * units.length);
  for (const [p, list] of holders) if (list.length > cap) holders.delete(p);
  const own = units.map((u) => [...new Set(u.phrases)].filter((p) => holders.has(p)));
  const seed = new Map<string, number>();
  const n = options.prefix;
  for (const q of new Set(query)) {
    const near = n && !q.includes(" ") && q.length >= n ? [...holders.keys()].filter((p) => !p.includes(" ") && p.length >= n && p.startsWith(q.slice(0, n))) : [q];
    for (const p of near) if (holders.has(p)) seed.set(p, 1 / holders.get(p)!.length);
  }
  const total = [...seed.values()].reduce((a, b) => a + b, 0);
  if (!total) return [];
  for (const [p, w] of seed) seed.set(p, w / total);
  // Mass sits on phrases; each step it goes phrase -> units -> phrases, and units keep what passed through them.
  let mass = new Map(seed);
  const unitScore = new Float64Array(units.length);
  for (let it = 0; it < options.iterations; it++) {
    const atUnit = new Float64Array(units.length);
    for (const [p, m] of mass) {
      const list = holders.get(p)!;
      for (const i of list) atUnit[i]! += (options.damping * m) / list.length;
    }
    const next = new Map<string, number>();
    for (const [p, w] of seed) next.set(p, (1 - options.damping) * w);
    atUnit.forEach((m, i) => {
      if (!m) return;
      unitScore[i]! += m;
      const list = own[i]!;
      for (const p of list) next.set(p, (next.get(p) ?? 0) + (options.damping * m) / list.length);
    });
    mass = next;
  }
  return units
    .map((u, i) => ({ item: u.item, score: unitScore[i]! }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** Every unit search would index (same split, recent turns left out), ranked by the walk from the query's phrases. */
export function graphSearch(history: Session[], query: string, segmentTokens: number, currentId?: string, recentStart = 0, stemmer: Stemmer = "suffix") {
  const units: { item: Segment; phrases: string[] }[] = [];
  for (const session of history)
    for (const seg of splitIntoSegments(session, segmentTokens)) {
      if (session.id === currentId && seg.end >= recentStart) continue;
      units.push({ item: seg, phrases: phrases(seg.turns.map((t) => t.content).join("\n"), stemmer) });
    }
  return phraseRank(units, phrases(query, stemmer));
}
