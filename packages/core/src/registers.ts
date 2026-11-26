// Registers: what the packet carries without searching. Standing rules, recent results,
// the model's own recent answers, and which answers were shot down.

import type { Session, TurnRef } from "./chat.ts";

export interface Registers {
  rules: { text: string; from: TurnRef }[];
  /** Numbers the assistant produced, newest last. "Multiply it by 32" reads the last one. */
  results: { value: string; from: TurnRef }[];
  /** The assistant's latest answers, newest last. */
  recentAnswers: { text: string; from: TurnRef }[];
  /** Assistant turns the user rejected ("no", "that didn't work", "not that one"). */
  rejected: Set<string>;
}

export const refKey = (r: TurnRef) => `${r.sessionId}#${r.turn}`;

const RULE = /(?:^|[.!?\n]\s*)((?:from now on|going forward|always|never|don'?t ever|do not ever|please always|please never|remember to)\b[^.!?\n]*[.!?]?)/gi;
const NEGATIVE = /^\s*(?:no\b|nope\b|nah\b|wrong\b|not that\b|not quite\b|that'?s (?:wrong|not (?:it|right|what))|that (?:didn'?t|did not|doesn'?t|does not) work|that'?s not)/i;
const NUMBER = /-?\d[\d,]*(?:\.\d+)?/g;

export function buildRegisters(history: Session[], recentAnswerCount: number): Registers {
  const regs: Registers = { rules: [], results: [], recentAnswers: [], rejected: new Set() };
  for (const session of history) {
    session.turns.forEach((turn, i) => {
      const from = { sessionId: session.id, turn: i };
      if (turn.role === "user") {
        for (const m of turn.content.matchAll(RULE)) regs.rules.push({ text: m[1]!.trim(), from });
        const prev = session.turns[i - 1];
        if (prev?.role === "assistant" && NEGATIVE.test(turn.content)) {
          regs.rejected.add(refKey({ sessionId: session.id, turn: i - 1 }));
        }
        return;
      }
      // List markers like "3." are numbering, not results.
      const numbers = turn.content.replace(/^\s*\d+[.)]\s/gm, "").match(NUMBER);
      if (numbers) regs.results.push({ value: numbers[numbers.length - 1]!.replace(/,/g, ""), from });
      regs.recentAnswers.push({ text: firstLine(turn.content), from });
    });
  }
  // A rejected answer is never a result or a recent answer to lean on.
  regs.results = regs.results.filter((r) => !regs.rejected.has(refKey(r.from)));
  const kept = regs.recentAnswers.filter((a) => !regs.rejected.has(refKey(a.from)));
  regs.recentAnswers = recentAnswerCount > 0 ? kept.slice(-recentAnswerCount) : [];
  return regs;
}

function firstLine(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 240 ? line.slice(0, 237) + "..." : line;
}
