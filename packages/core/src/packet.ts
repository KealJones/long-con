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

export const HISTORY_NOTICE = (since: string) =>
  `Earlier chat history${since ? ` (since ${since})` : ""} was left out to fit. The search_history tool can reach all of it.`;
export const TRUST_NOTE =
  "This packet is a best guess at what's relevant. Don't rely on anything in it that looks wrong; use the tools instead.";

export function buildPacket({ history, message, profile, currentSessionId }: BuildPacketInput): Packet {
  const current = history.find((s) => s.id === currentSessionId);
  const recentStart = current ? Math.max(0, current.turns.length - profile.rawTurns) : 0;
  const recentTurns = current ? current.turns.slice(recentStart) : [];
  const registers = buildRegisters(history, profile.recentAnswers);
  const isRecent = (ref: TurnRef) => ref.sessionId === current?.id && ref.turn >= recentStart;
  // "It" points at something just said, so only results from the recent turns count.
  registers.results = registers.results.filter((r) => isRecent(r.from));
  // Answers already riding along raw don't need repeating.
  registers.recentAnswers = registers.recentAnswers.filter((a) => !isRecent(a.from));
  const resolution = resolve(message, recentTurns, registers);

  const head: string[] = [HISTORY_NOTICE(history.find((s) => s.date)?.date ?? "")];
  if (profile.trustNote) head.push(TRUST_NOTE);
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
  let budget = profile.packetTokens - estimateTokens(head.join("\n"));
  const chosen: { segment: Segment; hit: Hit<Segment>; confidence: number }[] = [];

  if (gateOpen) {
    const hits = search(history, resolution.query, profile.segmentTokens, current?.id, recentStart);
    const top = hits[0]?.score ?? 1;
    for (const hit of hits) {
      const cost = estimateTokens(renderSegment(hit.item, registers.rejected, 1, hit.matched));
      // Whole units only: a unit that doesn't fit is skipped, never trimmed.
      if (cost > budget) continue;
      budget -= cost;
      chosen.push({ segment: hit.item, hit, confidence: hit.score / top });
    }
  }

  // Oldest first reads like the chat did, and keeps dates in order for "how long ago" questions.
  chosen.sort((a, b) => order(history, a.segment) - order(history, b.segment));
  const body = chosen.map((c) => renderSegment(c.segment, registers.rejected, c.confidence, c.hit.matched));
  const text = [...head, ...(body.length ? ["", "Retrieved history, oldest first:", ...body] : [])].join("\n");

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
      why: `matched ${hit.matched.slice(0, 4).join(", ")}`,
    })),
  };
}

function search(history: Session[], query: string, segmentTokens: number, currentId: string | undefined, recentStart: number): Hit<Segment>[] {
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
  return fuse(all.search(words), user.search(words));
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

function renderSegment(seg: Segment, rejected: Set<string>, confidence: number, matched: string[]): string {
  const where = `${seg.date ?? "undated"} · chat ${seg.sessionId} · turns ${seg.start + 1}-${seg.end + 1}`;
  const lines = [`### ${where} · confidence ${round(confidence)} · matched ${matched.slice(0, 4).join(", ")}`];
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

function order(history: Session[], seg: Segment): number {
  return history.findIndex((s) => s.id === seg.sessionId) * 1e6 + seg.start;
}

const round = (n: number) => Math.round(n * 100) / 100;
