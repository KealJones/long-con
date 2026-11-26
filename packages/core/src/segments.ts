// Splits history into units for retrieval. A unit is a run of back-and-forth exchanges from one session,
// so a question arrives with its answer while they fit. Every unit stays under the profile's cap: an exchange that is too
// big splits between turns, and a single turn that is too big splits at paragraph breaks.

import type { Session, Turn } from "./chat.ts";
import { estimateTokens } from "./text.ts";

export interface Segment {
  sessionId: string;
  date?: string;
  /** Index of the first and last turn in the session, inclusive. */
  start: number;
  end: number;
  turns: Turn[];
  /** Holds only part of a turn that was too long for one unit. */
  partial?: boolean;
}

// shortcut: splits on size, not topic. The planned online topic splitter replaces this once the sorter exists.
export function splitIntoSegments(session: Session, maxTokens: number): Segment[] {
  const pieces = session.turns.flatMap((turn, index) =>
    splitTurn(turn.content, maxTokens).map((content, _, all) => ({ index, turn: { role: turn.role, content }, partial: all.length > 1 })),
  );
  const segments: Segment[] = [];
  let current: typeof pieces = [];
  let size = 0;
  const flush = () => {
    if (!current.length) return;
    segments.push({
      sessionId: session.id,
      date: session.date,
      start: current[0]!.index,
      end: current.at(-1)!.index,
      turns: current.map((p) => p.turn),
      ...(current.some((p) => p.partial) ? { partial: true } : {}),
    });
    current = [];
    size = 0;
  };
  for (const piece of pieces) {
    const tokens = estimateTokens(piece.turn.content);
    if (current.length && size + tokens > maxTokens) flush();
    current.push(piece);
    size += tokens;
  }
  flush();
  return segments;
}

/** One turn as pieces under the cap, cut at blank lines, then lines, then sentences, then anywhere. */
function splitTurn(text: string, maxTokens: number): string[] {
  if (estimateTokens(text) <= maxTokens) return [text];
  for (const sep of ["\n\n", "\n", ". "]) {
    const parts = text.split(sep);
    if (parts.length < 2) continue;
    const out: string[] = [];
    let buf = "";
    for (const part of parts) {
      const next = buf ? buf + sep + part : part;
      if (buf && estimateTokens(next) > maxTokens) {
        out.push(buf);
        buf = part;
      } else buf = next;
    }
    if (buf) out.push(buf);
    return out.flatMap((p) => splitTurn(p, maxTokens));
  }
  const chars = Math.floor(maxTokens * 3.5);
  return Array.from({ length: Math.ceil(text.length / chars) }, (_, i) => text.slice(i * chars, (i + 1) * chars));
}
