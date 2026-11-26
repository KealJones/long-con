// Packet recall: is the evidence for a question inside the packet? No model, no judge, free.

import { splitTurn, type Packet } from "@long-con/core";
import type { Question } from "./longmemeval.ts";

export interface RecallResult {
  /** Share of evidence chats with at least one unit in the packet. */
  sessionRecall: number;
  /** Share of evidence turns inside the packet. */
  turnRecall: number;
  /** Every evidence turn is in the packet, so the answer is all there. */
  complete: boolean;
}

/**
 * A turn counts only when all of its text is in the packet: a long turn split into pieces needs every piece, and a turn
 * the packet blanked out doesn't count. `segmentTokens` is the cap the packet was built with, so pieces split the same way.
 */
export function packetRecall(question: Question, packet: Pick<Packet, "segments" | "text">, segmentTokens: number): RecallResult {
  const inPacket = (sessionId: string, turn?: number) =>
    packet.segments.some((s) => s.sessionId === sessionId && (turn === undefined || (turn >= s.start && turn <= s.end)));
  const whole = (sessionId: string, turn: number) => {
    const content = question.sessions.find((s) => s.id === sessionId)?.turns[turn]?.content ?? "";
    return splitTurn(content, segmentTokens).every((piece) => packet.text.includes(piece));
  };
  const { sessions, turns } = question.evidence;
  const turnHits = turns.filter((key) => {
    const [sid, t] = splitKey(key);
    return inPacket(sid, t) && whole(sid, t);
  }).length;
  const sessionHits = sessions.filter((sid) => inPacket(sid)).length;
  return {
    sessionRecall: sessions.length ? sessionHits / sessions.length : 1,
    turnRecall: turns.length ? turnHits / turns.length : 1,
    complete: turnHits === turns.length,
  };
}

function splitKey(key: string): [string, number] {
  const at = key.lastIndexOf("#");
  return [key.slice(0, at), Number(key.slice(at + 1))];
}
