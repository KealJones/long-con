// Splits history into whole units for retrieval. A unit is a run of back-and-forth exchanges from one session,
// never a trimmed snippet, so a question always arrives with its answer.

import type { Session, Turn } from "./chat.ts";
import { estimateTokens } from "./text.ts";

export interface Segment {
  sessionId: string;
  date?: string;
  /** Index of the first and last turn in the session, inclusive. */
  start: number;
  end: number;
  turns: Turn[];
}

// shortcut: splits on size, not topic. The planned online topic splitter replaces this once the sorter exists.
export function splitIntoSegments(session: Session, maxTokens: number): Segment[] {
  const segments: Segment[] = [];
  let start = 0;
  let size = 0;
  for (let i = 0; i < session.turns.length; i++) {
    const turn = session.turns[i]!;
    const tokens = estimateTokens(turn.content);
    // Only cut before a user turn, so an answer is never separated from its question.
    if (i > start && turn.role === "user" && size + tokens > maxTokens) {
      segments.push(slice(session, start, i - 1));
      start = i;
      size = 0;
    }
    size += tokens;
  }
  if (start < session.turns.length) segments.push(slice(session, start, session.turns.length - 1));
  return segments;
}

function slice(session: Session, start: number, end: number): Segment {
  return { sessionId: session.id, date: session.date, start, end, turns: session.turns.slice(start, end + 1) };
}
