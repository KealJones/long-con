// The packet builder: every turn, a fresh context built from history for this one message.
// Order of work follows docs/architecture.md: gate, resolve, registers, search, filter, fit.

import type { Session, Turn, TurnRef } from "./chat.ts";
import { Bm25, type Hit } from "./bm25.ts";
import { buildRegisters, refKey } from "./registers.ts";
import { resolve, type Resolution } from "./resolver.ts";
import { splitIntoSegments, type Segment } from "./segments.ts";
import type { Profile } from "./profiles.ts";
import { contentWords, estimateTokens } from "./text.ts";

export interface BuildPacketInput {
  history: Session[];
  message: string;
  profile: Profile;
  /** Set when the message continues an existing session; its latest turns ride along raw. */
  currentSessionId?: string;
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

export interface Packet {
  /** The packet as the model reads it. */
  text: string;
  tokens: number;
  /** Recent turns that ride along raw after the packet. */
  recentTurns: Turn[];
  resolution: Resolution;
  retrieved: boolean;
  segments: PacketSegment[];
}

/** Mentions the search tool only when the model has one, so no arm is told about a tool it can't use. */
export const HISTORY_NOTICE = (since: string, canSearch = true) =>
  `Earlier chat history${since ? ` (since ${since})` : ""} was left out to fit.${canSearch ? " The search_history tool can reach all of it." : ""}`;
export const TRUST_NOTE = (canSearch = true) =>
  `This packet is a best guess at what's relevant. Don't rely on anything in it that looks wrong${canSearch ? "; use the tools instead" : ""}.`;

export function buildPacket({ history, message, profile, currentSessionId }: BuildPacketInput): Packet {
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
  if (registers.rules.length) {
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
  const chosen: { segment: Segment; hit: Hit<Segment>; confidence: number }[] = [];

  if (gateOpen) {
    const seen = new Set<string>();
    const hits = search(history, resolution.query, profile.segmentTokens, current?.id, recentStart);
    // The absolute bar asks whether history holds anything strong enough to answer at all. It judges the best unit
    // only: per unit, it cut the weaker second piece multi-session questions need (P02 dev sweep).
    const found = hits.some((h) => h.score >= profile.minScore);
    for (const { hit, confidence } of found ? hits : []) {
      // The budget is a ceiling, not a target: weak matches stay out even when there's room.
      if (confidence < profile.minConfidence) continue;
      // The same exchange saved twice only needs to come in once.
      const text = hit.item.turns.map((t) => t.content).join("\n");
      if (seen.has(text)) continue;
      const cost = estimateTokens("\n" + renderSegment(hit.item, registers.rejected, confidence, hit.matched));
      // Whole units only: a unit that doesn't fit is skipped, never trimmed.
      if (cost > budget) continue;
      seen.add(text);
      budget -= cost;
      chosen.push({ segment: hit.item, hit, confidence });
    }
  }

  // Oldest first reads like the chat did, and keeps dates in order for "how long ago" questions.
  chosen.sort((a, b) => order(history, a.segment).localeCompare(order(history, b.segment)));
  const body = chosen.map((c) => renderSegment(c.segment, registers.rejected, c.confidence, c.hit.matched));
  const text = [...head, ...(body.length ? ["", RETRIEVED, ...body] : [])].join("\n");

  return {
    text,
    tokens: estimateTokens(text),
    recentTurns,
    resolution,
    retrieved: gateOpen,
    segments: chosen.map(({ segment, hit, confidence }) => ({
      sessionId: segment.sessionId,
      date: segment.date,
      start: segment.start,
      end: segment.end,
      confidence: round(confidence),
      why: `matched ${hit.matched.slice(0, 3).join(", ")}`,
    })),
  };
}

/**
 * Units ranked by fusing two BM25 rankings. Confidence is the unit's best score as a share of the top score
 * in either ranking, so it says how close a unit comes to the best match. Score is its best score as a share of
 * the most any unit could score on the query: absolute, so a weak best match shows as weak.
 */
function search(history: Session[], query: string, segmentTokens: number, currentId: string | undefined, recentStart: number) {
  // Each unit is indexed two ways, all its words and the user's words alone, then the rankings are fused.
  const all = new Bm25<Segment>();
  const user = new Bm25<Segment>();
  for (const session of history) {
    for (const seg of splitIntoSegments(session, segmentTokens)) {
      // Turns already riding along raw don't need retrieving.
      if (session.id === currentId && seg.end >= recentStart) continue;
      all.add(seg, contentWords(seg.turns.map((t) => t.content).join("\n")));
      user.add(seg, contentWords(seg.turns.filter((t) => t.role === "user").map((t) => t.content).join("\n")));
    }
  }
  const words = contentWords(query);
  const lists = [all.search(words), user.search(words)];
  const ceilings = [all.ceiling(words), user.ceiling(words)];
  const share = new Map<Segment, number>();
  const absolute = new Map<Segment, number>();
  lists.forEach((list, i) => {
    for (const h of list) {
      share.set(h.item, Math.max(share.get(h.item) ?? 0, h.score / list[0]!.score));
      absolute.set(h.item, Math.max(absolute.get(h.item) ?? 0, h.score / ceilings[i]!));
    }
  });
  return fuse(...lists).map((hit) => ({ hit, confidence: share.get(hit.item)!, score: absolute.get(hit.item)! }));
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
