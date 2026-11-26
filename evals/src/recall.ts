// Packet recall: is the evidence for a question inside the packet? No model, no judge, free.

import type { Packet } from "@long-con/core";
import type { Question } from "./longmemeval.ts";

export interface RecallResult {
  /** Share of evidence chats with at least one unit in the packet. */
  sessionRecall: number;
  /** Share of evidence turns inside the packet. */
  turnRecall: number;
  /** Every evidence turn is in the packet, so the answer is all there. */
  complete: boolean;
}

export function packetRecall(question: Question, packet: Packet): RecallResult {
  const inPacket = (sessionId: string, turn?: number) =>
    packet.segments.some((s) => s.sessionId === sessionId && (turn === undefined || (turn >= s.start && turn <= s.end)));
  const { sessions, turns } = question.evidence;
  const turnHits = turns.filter((key) => {
    const [sid, t] = splitKey(key);
    return inPacket(sid, t);
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
