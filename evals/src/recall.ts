// Packet recall: is the evidence for a question inside the packet? No model, no judge, free.

import { searchUnits, splitTurn, type Packet, type PacketPointer, type Profile } from "@long-con/core";
import type { Question } from "./longmemeval.ts";

export interface RecallResult {
  /** Share of evidence chats with at least one unit in the packet. */
  sessionRecall: number;
  /** Share of evidence turns inside the packet. */
  turnRecall: number;
  /** Every evidence turn is in the packet, so the answer is all there. */
  complete: boolean;
  /**
   * The same two with a pointer (P15) to an evidence turn counted as found, needs a read: the reader has to run the
   * pointer's search to see it. Equal to the plain ones when the packet has no pointers.
   */
  turnRecallWithPointers: number;
  completeWithPointers: boolean;
}

/**
 * A turn counts only when all of its text is in the packet: a long turn split into pieces needs every piece, and a turn
 * the packet blanked out doesn't count. `segmentTokens` is the cap the packet was built with, so pieces split the same way.
 */
export function packetRecall(question: Question, packet: Pick<Packet, "segments" | "text"> & Partial<Pick<Packet, "pointers">>, segmentTokens: number): RecallResult {
  const { sessions, turns } = question.evidence;
  const found = foundTurns(question, packet, segmentTokens);
  const turnHits = found.filter(Boolean).length;
  const pointed = turns.filter((key, i) => {
    const [sid, t] = splitKey(key);
    return found[i] || (packet.pointers ?? []).some((p) => p.sessionId === sid && t >= p.start && t <= p.end);
  }).length;
  const sessionHits = sessions.filter((sid) => packet.segments.some((s) => s.sessionId === sid)).length;
  return {
    sessionRecall: sessions.length ? sessionHits / sessions.length : 1,
    turnRecall: turns.length ? turnHits / turns.length : 1,
    complete: turnHits === turns.length,
    turnRecallWithPointers: turns.length ? pointed / turns.length : 1,
    completeWithPointers: pointed === turns.length,
  };
}

/** Per evidence turn: is all of its text inside the packet? */
function foundTurns(question: Question, packet: Pick<Packet, "segments" | "text">, segmentTokens: number): boolean[] {
  return question.evidence.turns.map((key) => {
    const [sid, t] = splitKey(key);
    const content = question.sessions.find((s) => s.id === sid)?.turns[t]?.content ?? "";
    return packet.segments.some((s) => s.sessionId === sid && t >= s.start && t <= s.end) && splitTurn(content, segmentTokens).every((piece) => packet.text.includes(piece));
  });
}

type SearchProfile = Pick<Profile, "segmentTokens" | "stemmer" | "gateKey" | "searchResults" | "maxToolRounds">;

/** Does the pointer's query bring its unit back in the search_history tool's top results? Same search path as the tool. */
export function pointerOpens(question: Pick<Question, "sessions">, p: PacketPointer, profile: SearchProfile): boolean {
  const { hits } = searchUnits(question.sessions, p.query, profile.segmentTokens, undefined, 0, profile.stemmer, profile.gateKey);
  return hits.slice(0, profile.searchResults).some(({ hit }) => hit.item.sessionId === p.sessionId && hit.item.start === p.start && hit.item.end === p.end);
}

/**
 * P15 "readable" all-evidence, the strict pointers-as-found: every evidence turn is whole in the packet or behind a
 * pointer, the pointers needed fit in the profile's search rounds, and each one's query brings its unit back.
 */
export function readableRecall(question: Question, packet: Pick<Packet, "segments" | "text" | "pointers">, profile: SearchProfile): boolean {
  const found = foundTurns(question, packet, profile.segmentTokens);
  const needed = new Set<PacketPointer>();
  for (const [i, key] of question.evidence.turns.entries()) {
    if (found[i]) continue;
    const [sid, t] = splitKey(key);
    const p = packet.pointers.find((p) => p.sessionId === sid && t >= p.start && t <= p.end);
    if (!p) return false;
    needed.add(p);
  }
  return needed.size <= profile.maxToolRounds && [...needed].every((p) => pointerOpens(question, p, profile));
}

function splitKey(key: string): [string, number] {
  const at = key.lastIndexOf("#");
  return [key.slice(0, at), Number(key.slice(at + 1))];
}
