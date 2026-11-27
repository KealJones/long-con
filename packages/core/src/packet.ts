// The packet builder: every turn, a fresh context built from history for this one message.
// Order of work follows docs/architecture.md: gate, resolve, registers, search, filter, fit.

import type { Session, Turn, TurnRef } from "./chat.ts";
import { Bm25, type Hit } from "./bm25.ts";
import { buildRegisters, refKey } from "./registers.ts";
import { resolve, type Resolution } from "./resolver.ts";
import { segmentKey, splitIntoSegments, type KeyDenoise, type Segment } from "./segments.ts";
import { extractNotes, groupNotes, groupWords, renderGroup, type Note } from "./notes.ts";
import type { PointerPick, Profile } from "./profiles.ts";
import { isTallyQuestion, rankTallyPieces, SEG_GATE, tallySearch } from "./tally.ts";
import { unitProbability } from "./gate.ts";
import { contentWords, estimateTokens, type Stemmer } from "./text.ts";
import { lookupSymbols, type SymbolIndex, type SymbolItem } from "./symbols.ts";
import { cosine, type Embed } from "./embed.ts";

export interface BuildPacketInput {
  history: Session[];
  message: string;
  profile: Profile;
  /** Set when the message continues an existing session; its latest turns ride along raw. */
  currentSessionId?: string;
  /**
   * The workspace's symbol index, when the caller has one. A message naming an identifier with exactly one definition
   * gets its path:line and signature, two or three get pointers, anything else gets no Code section.
   */
  code?: SymbolIndex;
  /** A text embedder (embed.ts), for profiles that also judge units by cosine (profile.embedSim). Optional. */
  embed?: Embed;
}

/** One retrieved unit of history in the packet, with the labels the model sees. */
export interface PacketSegment {
  sessionId: string;
  date?: string;
  start: number;
  end: number;
  confidence: number;
  why: string;
}

/** A medium-confidence unit shown as one line (P15): the reader runs `query` through search_history to open it. */
export interface PacketPointer extends PacketSegment {
  query: string;
}

export interface Packet {
  /** The packet as the model reads it. */
  text: string;
  tokens: number;
  /** Recent turns that ride along raw after the packet. */
  recentTurns: Turn[];
  resolution: Resolution;
  retrieved: boolean;
  segments: PacketSegment[];
  /** Units shown as one-line pointers, not whole (profile.pointerGate). */
  pointers: PacketPointer[];
  /** Interest notes shown, newest value of each topic first. Their source turns stay reachable by search. */
  notes: Note[];
  /** Definitions in the Code section: a signature for a single match, pointers otherwise. */
  code: SymbolItem[];
}

/** Mentions the search tool only when the model has one, so no arm is told about a tool it can't use. */
export const HISTORY_NOTICE = (since: string, canSearch = true) =>
  `Earlier chat history${since ? ` (since ${since})` : ""} was left out to fit.${canSearch ? " The search_history tool can reach all of it." : ""}`;
export const TRUST_NOTE = (canSearch = true) =>
  `This packet is a best guess at what's relevant. Don't rely on anything in it that looks wrong${canSearch ? "; use the tools instead" : ""}.`;

export function buildPacket({ history, message, profile, currentSessionId, code, embed }: BuildPacketInput): Packet {
  const current = history.find((s) => s.id === currentSessionId);
  const recentStart = current ? Math.max(0, current.turns.length - profile.rawTurns) : 0;
  const recentTurns = current ? current.turns.slice(recentStart) : [];
  const registers = buildRegisters(history, profile.recentAnswers);
  const isRecent = (ref: TurnRef) => ref.sessionId === current?.id && ref.turn >= recentStart;
  // "It" points at something just said, so only results from the recent turns count.
  registers.results = registers.results.filter((r) => isRecent(r.from));
  // Only answers from this chat count, and ones already riding along raw don't need repeating.
  registers.recentAnswers = registers.recentAnswers.filter((a) => a.from.sessionId === current?.id && !isRecent(a.from));
  const resolution = resolve(message, recentTurns, registers);

  const canSearch = profile.maxToolRounds > 0;
  const head: string[] = [HISTORY_NOTICE(earliestDate(history), canSearch)];
  if (profile.trustNote) head.push(TRUST_NOTE(canSearch));
  if (profile.standingRules !== false && registers.rules.length) {
    head.push("", "Standing rules from the user, word for word:");
    for (const r of registers.rules) head.push(`- "${r.text}" (${label(history, r.from)})`);
  }
  if (resolution.status === "resolved") head.push("", `Reference resolved: ${resolution.reason}.`);
  if (resolution.status === "unsure") head.push("", `Reference unclear: ${resolution.reason}. Check before assuming.`);
  const results = registers.results.slice(-3);
  if (results.length) head.push("", `Latest results you gave: ${results.map((r) => r.value).join(", ")}`);
  if (registers.recentAnswers.length) {
    head.push("", "Your latest answers, so you stay consistent:");
    for (const a of registers.recentAnswers) head.push(`- ${a.text}`);
  }

  const gateOpen = !profile.gate || resolution.status !== "none" || contentWords(message).length > 0;
  // Every character of the final text is counted, joins and the section line included, so the packet can't pass its ceiling.
  let budget = profile.packetTokens - estimateTokens(head.join("\n") + `\n\n${RETRIEVED}`);
  // Code is its own source with its own exactness rule, so it sits behind no history bar; it spends the same budget.
  const symbols = code ? lookupSymbols(message, code, { blockTokens: 0, packetTokens: budget - estimateTokens(`\n\n${CODE}\n`), shape: "signature" }) : undefined;
  const codeLines = symbols?.text ? ["", CODE, symbols.text] : [];
  budget -= estimateTokens(codeLines.join("\n"));
  const chosen: { segment: Segment; hit: Hit<Segment>; confidence: number; medium: boolean; p: number; sim?: number }[] = [];
  const pointed: { segment: Segment; hit: Hit<Segment>; confidence: number; query: string; line: string }[] = [];
  // A pointer is only worth its line when the reader can open it.
  const pointing = canSearch && profile.pointerGate > 0;
  let idfOf = (_: string) => 0;
  const noteLines: string[] = [];
  const shownNotes: Note[] = [];

  if (gateOpen) {
    const seen = new Set<string>();
    const { hits, idf } = searchUnits(history, resolution.query, profile.segmentTokens, current?.id, recentStart, profile.stemmer, profile.gateKey);
    idfOf = idf;
    // Embedding gate: the message's cosine to a unit (whole, or its best turn) vetoes units under embedFloor and, when the
    // weights carry one more entry than the search's features, is one more unit-gate feature.
    const sim = embed && profile.embedSim ? unitSimilarity(embed, resolution.query, profile.embedSim) : undefined;
    if (sim && hits.length && (profile.unitWeights?.length ?? 0) > hits[0]!.features.length + 1) for (const h of hits) h.features = [...h.features, sim(h.hit.item)];
    // The absolute bar asks whether history holds anything strong enough to answer at all. It judges the best unit
    // only: per unit, it cut the weaker second piece multi-session questions need (P02 dev sweep).
    const found = hits.some((h) => h.score >= profile.minScore);
    // Interest notes come in only behind the same bar, and only when they cover enough of the message's weight,
    // so a note can never turn a should-be-empty packet into a non-empty one on its own.
    if (found && profile.noteCoverage > 0) {
      const words = [...new Set(contentWords(resolution.query, profile.stemmer))];
      const total = words.reduce((a, w) => a + idf(w), 0);
      const groups = groupNotes(extractNotes(history, isRecent))
        .map((g) => ({ g, hit: words.filter((w) => groupWords(g, profile.stemmer).has(w)) }))
        // One shared word is chance ("good morning!" fully covered by "morning walks in the park"), so it takes two.
        .filter(({ hit }) => hit.length >= MIN_NOTE_WORDS)
        .map(({ g, hit }) => ({ g, cover: hit.reduce((a, w) => a + idf(w), 0) / total }))
        .filter((x) => x.cover >= profile.noteCoverage)
        .sort((a, b) => b.cover - a.cover)
        .slice(0, MAX_NOTE_GROUPS);
      for (const { g } of groups) {
        const line = renderGroup(g);
        const cost = estimateTokens(`\n${noteLines.length ? "" : `\n${NOTES}\n`}${line}`);
        if (cost > budget) continue;
        budget -= cost;
        noteLines.push(line);
        shownNotes.push(...g.notes);
      }
    }
    // Counting questions take one small piece per matching user turn instead of whole segments (see tally.ts).
    const tally = found && profile.tallyPieces > 0 && isTallyQuestion(message);
    const ranked: { hit: Hit<Segment>; confidence: number; features?: number[] }[] = !found
      ? []
      : tally
        ? tallyRank(tallySearch(history, resolution.query, current?.id, recentStart, hits, profile.unitWeights, profile.stemmer), sim, profile).slice(0, profile.tallyPieces)
        : hits;
    // A tally piece is judged by the best unit-gate probability of a segment holding its turn (or by an eval's logistic).
    const gate = tally ? profile.tallyGate : profile.unitGate;
    const probability = (f: number[]) =>
      !tally ? unitProbability(f, profile.unitWeights) : profile.tallyWeights ? unitProbability(f, profile.tallyWeights) : f[SEG_GATE]!;
    for (const { hit, confidence, features } of ranked) {
      // The budget is a ceiling, not a target: weak matches stay out even when there's room.
      if (confidence < profile.minConfidence) continue;
      const p = features && gate > 0 ? probability(features) : 1;
      if (p < gate) continue;
      const s = sim?.(hit.item);
      if (s !== undefined && (profile.embedFloor ?? 0) > 0 && s < profile.embedFloor!) continue;
      // The same exchange saved twice only needs to come in once.
      const text = hit.item.turns.map((t) => t.content).join("\n");
      if (seen.has(text)) continue;
      const cost = estimateTokens("\n" + renderSegment(hit.item, registers.rejected, confidence, hit.matched));
      // Whole units only: a unit that doesn't fit is skipped, never trimmed.
      if (cost > budget) continue;
      seen.add(text);
      budget -= cost;
      // A medium unit whose best turn reads very close to the message stays whole (pointerPromote).
      const promoted = s !== undefined && profile.pointerPromote !== undefined && s >= profile.pointerPromote;
      chosen.push({ segment: hit.item, hit, confidence, medium: pointing && !tally && p < profile.pointerGate && !promoted, p, sim: s });
    }
  }

  // Pointer tier (P15): the units above were picked exactly as before, at whole cost, so the pointer tier can't let in
  // a unit that wouldn't have come in whole. Medium ones then shrink to a line, up to what the reader can
  // open, in pointerPick order; past that they drop. A unit shorter than its pointer stays whole.
  // A medium unit reading too far from the message drops instead of taking a pointer line (pointerFloor), even one
  // shorter than its pointer.
  const far = (c: (typeof chosen)[number]) => profile.pointerFloor !== undefined && c.sim !== undefined && c.sim < profile.pointerFloor;
  const medium = chosen
    .map((c, rank) => ({ c, rank, query: "", line: "" }))
    .filter((m) => m.c.medium && !far(m.c))
    .filter((m) => {
      m.query = pointerQuery(m.c.segment, idfOf, profile.stemmer);
      m.line = renderPointer(m.c.segment, m.query);
      return estimateTokens(`\n${m.line}`) < estimateTokens("\n" + renderSegment(m.c.segment, registers.rejected, m.c.confidence, m.c.hit.matched));
    });
  const kept = pickPointers(medium.map((m) => ({ rank: m.rank, p: m.c.p, sim: m.c.sim })), profile.pointerPick ?? "rank", profile.maxPointers);
  for (const m of medium) if (kept.has(m.rank)) pointed.push({ ...m.c, query: m.query, line: m.line });
  const gone = new Set([...medium.map((m) => m.c), ...chosen.filter((c) => c.medium && far(c))]);
  for (let i = chosen.length - 1; i >= 0; i--) if (gone.has(chosen[i]!)) chosen.splice(i, 1);

  // Oldest first reads like the chat did, and keeps dates in order for "how long ago" questions.
  chosen.sort((a, b) => order(history, a.segment).localeCompare(order(history, b.segment)));
  pointed.sort((a, b) => order(history, a.segment).localeCompare(order(history, b.segment)));
  const body = chosen.map((c) => renderSegment(c.segment, registers.rejected, c.confidence, c.hit.matched));
  const text = [
    ...head,
    ...codeLines,
    ...(noteLines.length ? ["", NOTES, ...noteLines] : []),
    ...(body.length ? ["", RETRIEVED, ...body] : []),
    ...(pointed.length ? ["", POINTERS, ...pointed.map((p) => p.line)] : []),
  ].join("\n");
  const shown = ({ segment, hit, confidence }: Pick<(typeof chosen)[number], "segment" | "hit" | "confidence">): PacketSegment => ({
    sessionId: segment.sessionId,
    date: segment.date,
    start: segment.start,
    end: segment.end,
    confidence: round(confidence),
    why: `matched ${hit.matched.slice(0, 3).join(", ")}`,
  });

  return {
    text,
    tokens: estimateTokens(text),
    recentTurns,
    resolution,
    retrieved: gateOpen,
    segments: chosen.map(shown),
    pointers: pointed.map((p) => ({ ...shown(p), query: p.query })),
    notes: shownNotes,
    code: symbols?.items ?? [],
  };
}

/** Tally pieces re-ranked, floored or counted by cosine (profile.tallyMix / tallyFloor / tallyBar) when there is one. */
const tallyRank = <T extends { hit: Hit<Segment> }>(pieces: T[], sim: ((s: Segment) => number) | undefined, p: Profile) =>
  sim && (p.tallyMix || p.tallyFloor !== undefined || p.tallyBar !== undefined)
    ? rankTallyPieces(pieces, (x) => sim(x.hit.item), { mix: p.tallyMix, floor: p.tallyFloor, bar: p.tallyBar })
    : pieces;

/**
 * Which medium units become pointers (the rest drop): the first `cap` by search rank, by gate probability, by the
 * embedding veto's best-turn cosine, or by the sum of their places in those two orders ("mix"). Returns the ranks kept.
 * Without a cosine, "cosine" and "mix" fall back to rank.
 */
export function pickPointers(units: { rank: number; p: number; sim?: number }[], pick: PointerPick, cap: number): Set<number> {
  const by = (f: (u: (typeof units)[number]) => number) => {
    const place = new Map([...units].sort((a, b) => f(b) - f(a) || a.rank - b.rank).map((u, i) => [u.rank, i]));
    return (u: (typeof units)[number]) => place.get(u.rank)!;
  };
  const hasSim = units.every((u) => u.sim !== undefined);
  const gate = by((u) => u.p);
  const cos = by((u) => u.sim ?? 0);
  const key =
    pick === "gate" ? gate : pick === "cosine" && hasSim ? cos : pick === "mix" && hasSim ? (u: (typeof units)[number]) => gate(u) + cos(u) : (u: (typeof units)[number]) => u.rank;
  return new Set([...units].sort((a, b) => key(a) - key(b) || a.rank - b.rank).slice(0, Math.max(0, cap)).map((u) => u.rank));
}

/**
 * Units ranked by fusing two BM25 rankings. Confidence is the unit's best score as a share of the top score
 * in either ranking, so it says how close a unit comes to the best match. Score is its best score as a share of
 * the most any unit could score on the query: absolute, so a weak best match shows as weak. Features feed the unit gate (gate.ts).
 */
export function searchUnits(history: Session[], query: string, segmentTokens: number, currentId?: string, recentStart = 0, stemmer: Stemmer = "suffix", gateKey: KeyDenoise = "") {
  // Each unit is indexed two ways, all its words and the user's words alone, then the rankings are fused.
  const all = new Bm25<Segment>();
  const user = new Bm25<Segment>();
  // P26 gate keys: with gateKey set, a third all-words index on the denoised text feeds the absolute score (the minScore
  // bar and the gate's absolute features) while ranking stays on the full text.
  const key = gateKey ? new Bm25<Segment>() : all;
  const length = new Map<Segment, number>();
  for (const session of history) {
    for (const seg of splitIntoSegments(session, segmentTokens)) {
      // Turns already riding along raw don't need retrieving.
      if (session.id === currentId && seg.end >= recentStart) continue;
      const words = contentWords(seg.turns.map((t) => t.content).join("\n"), stemmer);
      length.set(seg, words.length);
      all.add(seg, words);
      if (key !== all) key.add(seg, contentWords(segmentKey(session, seg, gateKey, (t) => contentWords(t, stemmer)), stemmer), gateKey.includes("fulllen") ? words.length : undefined);
      user.add(seg, contentWords(seg.turns.filter((t) => t.role === "user").map((t) => t.content).join("\n"), stemmer));
    }
  }
  const words = contentWords(query, stemmer);
  const terms = [...new Set(words)];
  const lists = [all.search(words), user.search(words)];
  const ceilings = [key.ceiling(words), user.ceiling(words)];
  const keyHits = key === all ? undefined : new Map(key.search(words).map((h) => [h.item, h]));
  // "+matched" also takes the matched-share features from the denoised key (plus the user index).
  const userMatched = new Map(lists[1]!.map((h) => [h.item, h.matched]));
  const gateMatched = (hit: Hit<Segment>) =>
    keyHits && gateKey.includes("matched") ? [...new Set([...(keyHits.get(hit.item)?.matched ?? []), ...(userMatched.get(hit.item) ?? [])])] : hit.matched;
  const share = new Map<Segment, number>();
  const absolute = new Map<Segment, number>();
  const ranks = lists.map((list) => new Map(list.map((h, r) => [h.item, r])));
  lists.forEach((list, i) => {
    for (const h of list) {
      share.set(h.item, Math.max(share.get(h.item) ?? 0, h.score / list[0]!.score));
      const score = i === 0 && keyHits ? (keyHits.get(h.item)?.score ?? 0) : h.score;
      absolute.set(h.item, Math.max(absolute.get(h.item) ?? 0, score / ceilings[i]!));
    }
  });
  const topAbsolute = Math.max(0, ...absolute.values());
  const top5 = lists.map((l) => new Set(l.slice(0, 5).map((h) => h.item)));
  const agreement = [...top5[0]!].filter((x) => top5[1]!.has(x)).length / 5;
  const idfAll = terms.reduce((a, t) => a + all.idf(t), 0) || 1;
  const hits = fuse(...lists).map((hit) => {
    const rank = (i: number) => (ranks[i]!.has(hit.item) ? 1 / (1 + ranks[i]!.get(hit.item)!) : 0);
    const features = [
      absolute.get(hit.item)!,
      topAbsolute,
      share.get(hit.item)!,
      rank(0),
      rank(1),
      agreement,
      gateMatched(hit).reduce((a, t) => a + all.idf(t), 0) / idfAll,
      gateMatched(hit).length / (terms.length || 1),
      Math.log(1 + (length.get(hit.item) ?? 0)),
      Math.log(1 + terms.length),
    ];
    return { hit, confidence: share.get(hit.item)!, score: absolute.get(hit.item)!, features };
  });
  return { hits, idf: (w: string) => all.idf(w) };
}

/** The message's cosine to a unit, memoized per unit: the whole unit's text, or its best turn's ("maxsim"). */
export function unitSimilarity(embed: Embed, query: string, mode: "segment" | "maxsim") {
  const q = embed(query);
  const memo = new Map<Segment, number>();
  return (seg: Segment): number => {
    let s = memo.get(seg);
    if (s === undefined) {
      s = mode === "maxsim" ? Math.max(...seg.turns.map((t) => cosine(q, embed(t.content)))) : cosine(q, embed(seg.turns.map((t) => t.content).join("\n")));
      memo.set(seg, s);
    }
    return s;
  };
}

/** One search_history result: the unit, its labels, and whether the tool vouches for it. */
export interface SearchResult {
  segment: Segment;
  confidence: number;
  matched: string[];
  /** False when the packet would have left the unit out; the tool then shows it marked low confidence. */
  strong: boolean;
  /** The query's cosine to the unit, when an embedder judged it. */
  sim?: number;
}

/**
 * The search_history tool: the same fused search the packet uses, so a better ranking helps both. Where the packet
 * abstains, the tool still answers: a unit the packet would leave out comes back marked low confidence. With an embedder,
 * that includes the packet's embedding veto (embedFloor): on dev it marked no evidence hit low on either profile.
 */
export function searchHistory(history: Session[], query: string, profile: Profile, embed?: Embed): string {
  const results = searchResults(history, query, profile, embed);
  if (!results.length) return "No matches.";
  const rejected = buildRegisters(history, profile.recentAnswers).rejected;
  return results
    .map(({ segment, confidence, matched, strong }) => {
      const text = renderSegment(segment, rejected, confidence, matched);
      return strong ? text : text.replace("\n", " · low confidence, likely not what you asked about\n");
    })
    .join("\n\n");
}

/** The units search_history returns, best first, with their marks. */
export function searchResults(history: Session[], query: string, profile: Profile, embed?: Embed): SearchResult[] {
  const { hits } = searchUnits(history, query, profile.segmentTokens, undefined, 0, profile.stemmer, profile.gateKey);
  return markResults(hits, profile, embed && profile.embedSim ? unitSimilarity(embed, query, profile.embedSim) : undefined);
}

/**
 * The tool's marks over searchUnits hits, split out so an eval can sweep settings over one search. Order stays the
 * search's: re-ranking the top 10 or 20 by a mix of confidence and cosine lost evidence on dev (evals/loop/search-tool.ts).
 */
export function markResults(hits: ReturnType<typeof searchUnits>["hits"], profile: Profile, sim?: (seg: Segment) => number): SearchResult[] {
  const found = hits.some((h) => h.score >= profile.minScore);
  return hits.slice(0, profile.searchResults).map(({ hit, confidence, features }) => {
    const s = sim?.(hit.item);
    const vetoed = s !== undefined && (profile.embedFloor ?? 0) > 0 && s < profile.embedFloor!;
    const gated = profile.unitGate > 0 && unitProbability(features, profile.unitWeights) < profile.unitGate;
    return { segment: hit.item, confidence, matched: hit.matched, strong: found && confidence >= profile.minConfidence && !gated && !vetoed, sim: s };
  });
}

/** Reciprocal-rank fusion, keeping the matched words from both lists. */
function fuse<T>(...lists: Hit<T>[][]): Hit<T>[] {
  const merged = new Map<T, Hit<T>>();
  for (const list of lists) {
    list.forEach((hit, rank) => {
      const prev = merged.get(hit.item);
      const score = 1 / (60 + rank);
      if (prev) {
        prev.score += score;
        prev.matched = [...new Set([...prev.matched, ...hit.matched])];
      } else merged.set(hit.item, { item: hit.item, score, matched: [...hit.matched] });
    });
  }
  return [...merged.values()].sort((a, b) => b.score - a.score);
}

const RETRIEVED = "Retrieved history, oldest first:";
const CODE = "Code the message names, from the workspace's symbol index (read the file before editing):";
export const NOTES = "Notes on what the user said they like, newest value first:";
// shortcut: a fixed cap; make it per profile once a reader run shows how many notes help.
const MAX_NOTE_GROUPS = 3;
const MIN_NOTE_WORDS = 2;
export const POINTERS = "Maybe related, not shown (search_history with the quoted words opens one):";
// shortcut: fixed sizes picked by eye, not swept; tune once a reader run shows whether pointers get opened.
const POINTER_WORDS = 4;
const SNIPPET_WORDS = 8;

/** The unit's rarest user words (all its words when it has no user turn), so a search for them brings the unit back. */
function pointerQuery(seg: Segment, idf: (w: string) => number, stemmer: Stemmer): string {
  const own = seg.turns.filter((t) => t.role === "user");
  const raw = (own.length ? own : seg.turns).map((t) => t.content).join(" ").toLowerCase().split(/[^a-z0-9]+/);
  const byStem = new Map<string, string>();
  for (const w of raw) {
    const stem = contentWords(w, stemmer)[0];
    if (stem && !byStem.has(stem)) byStem.set(stem, w);
  }
  return [...byStem]
    .sort((a, b) => idf(b[0]) - idf(a[0]))
    .slice(0, POINTER_WORDS)
    .map(([, w]) => w)
    .join(" ");
}

function renderPointer(seg: Segment, query: string): string {
  const first = (seg.turns.find((t) => t.role === "user") ?? seg.turns[0])?.content.split(/\s+/).filter(Boolean) ?? [];
  const snippet = first.slice(0, SNIPPET_WORDS).join(" ") + (first.length > SNIPPET_WORDS ? "…" : "");
  return `- ${seg.date ?? "undated"}: "${snippet}" · "${query}"`;
}

function renderSegment(seg: Segment, rejected: Set<string>, confidence: number, matched: string[]): string {
  // No chat ids here: the date is the source the model can use, and ids can carry labels it shouldn't see.
  const lines = [`### ${seg.date ?? "undated"} · confidence ${round(confidence)} · matched ${matched.slice(0, 3).join(", ")}${seg.partial ? " · part of a longer turn" : ""}`];
  seg.turns.forEach((turn, i) => {
    const key = refKey({ sessionId: seg.sessionId, turn: seg.start + i });
    lines.push(`${turn.role}: ${rejected.has(key) ? "[an answer the user rejected, left out]" : turn.content}`);
  });
  return lines.join("\n");
}

function label(history: Session[], ref: TurnRef): string {
  const date = history.find((s) => s.id === ref.sessionId)?.date;
  return date ? `said ${date}` : `chat ${ref.sessionId}`;
}

/** Sort key: date first (dates like "2023/05/20 (Sat) 10:19" sort as text), then place in the history. */
function order(history: Session[], seg: Segment): string {
  const at = history.findIndex((s) => s.id === seg.sessionId);
  return `${seg.date ?? ""}|${String(at).padStart(6, "0")}|${String(seg.start).padStart(6, "0")}`;
}

function earliestDate(history: Session[]): string {
  return history.map((s) => s.date).filter((d): d is string => !!d).sort()[0] ?? "";
}

const round = (n: number) => Math.round(n * 100) / 100;
