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

/**
 * How a unit's assistant text is indexed (backlog P26, SeCom's "denoise the key, render the value"). Rendering always
 * uses the original turns; only the words search sees change. "boilerplate" drops stock assistant sentences (openers,
 * sign-offs, "here are some tips"); "head:N" keeps the first N content words of each assistant turn; "overlap" keeps only
 * assistant sentences that share a content word with the user turn before them. Modes join with "+". As a gate key
 * (packet.ts searchUnits), "fulllen" scores the key at the full text's length and "matched" takes the matched-share
 * features from the key too.
 */
export type KeyDenoise = string;

// shortcut: English-only phrase list read off the dev haystacks' most common assistant openers and closers.
const BOILERPLATE =
  /^\W*(?:certainly|sure|of course|absolutely|great question|(?:what|that's|that is) (?:a |an )?(?:lovely|great|wonderful|fantastic|thoughtful|critical|excellent|interesting|exciting)\b|you're welcome|i'd be (?:happy|glad|delighted) to|i'm (?:glad|happy|so sorry)|i hope|hope (?:this|that|these)|remember(?:,| to | that )|what do you think|do any of these|\d+\.?$|good luck|happy \w+!|enjoy|have (?:a |an )?(?:great|good|nice|wonderful)|take care|safe travels|feel free|don't hesitate|if you have any|let me know|do you have any other|is there anything else|as an ai|i (?:cannot|can't|do not|don't) (?:hold|have) (?:personal )?(?:opinions|beliefs)|here (?:are|is) (?:some|a few|a list of) |best regards|sincerely|dear \[|\[your name\]|these are just a few|by following these|ultimately,|in conclusion|overall,|i hope you)/i;

const sentencesOf = (text: string) => text.split(/(?<=[.!?:])\s+|\n+/).filter((s) => s.trim());

/** The text a unit is indexed by under a denoise mode; "" or "none" indexes the turns as they are. */
export function segmentKey(session: Session, seg: Segment, mode: KeyDenoise, words: (text: string) => string[]): string {
  if (!mode || mode === "none") return seg.turns.map((t) => t.content).join("\n");
  const modes = mode.split("+");
  const head = Number(modes.find((m) => m.startsWith("head:"))?.slice(5) ?? Infinity);
  // The user turn before each assistant turn: inside the unit, or the last one before it in the session.
  let lastUser = session.turns.slice(0, seg.start).findLast((t) => t.role === "user")?.content ?? "";
  return seg.turns
    .map((t) => {
      if (t.role === "user") return (lastUser = t.content);
      let parts = sentencesOf(t.content);
      if (modes.includes("boilerplate")) parts = parts.filter((s) => !BOILERPLATE.test(s));
      if (modes.includes("overlap")) {
        const asked = new Set(words(lastUser));
        parts = parts.filter((s) => words(s).some((w) => asked.has(w)));
      }
      if (head === Infinity) return parts.join("\n");
      // Cut the raw text, not the stemmed words, so search stems it once like everything else.
      let count = 0;
      return parts.join("\n").split(/\s+/).filter((tok) => count < head && (count += words(tok).length, true)).join(" ");
    })
    .join("\n");
}

/** One turn as pieces under the cap, cut at blank lines, then lines, then sentences, then anywhere. */
export function splitTurn(text: string, maxTokens: number): string[] {
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
