// Deterministic resolver: turns a follow-up like "go", "now do all that", "multiply it by 32" or "the second one" into
// something standalone, using the registers and the current session. When it can't tell, it says "unsure" and names
// the candidates instead of guessing.

import type { Turn } from "./chat.ts";
import { isAck, isBundle, isSmallTalk, type Loop, type Registers } from "./registers.ts";
import { contentWords } from "./text.ts";

export type Resolution =
  | { status: "none"; query: string }
  | { status: "resolved"; query: string; referent: string; reason: string }
  | { status: "unsure"; query: string; reason: string };

/** Open offers the message could be taking up: every one this session, and those from the newest reply that made any. */
export interface LoopsInView {
  all: Loop[];
  latest: Loop[];
}

const ARITHMETIC = /\b(multipl\w*|times|divide\w*|add|plus|subtract\w*|minus|double|triple|halve|square|percent|%|\*|x\s*\d)/i;
const PRONOUN = /\b(it|that|this|the (?:result|answer|number|total)|that (?:number|result|total))\b/i;
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const ORDINAL_REF = new RegExp(`\\b(${ORDINALS.join("|")}|last|other) (?:one|option|item|choice|idea)\\b`, "i");
const VAGUE = /^\s*(?:and |but |so |ok,? |okay,? )?(?:what about |how about )?(?:it|that|this|that one|this one|the other one|them|those)\s*\??\s*$/i;

/**
 * @param recent the turns riding along raw
 * @param session the whole current session before this message, for lists that scrolled out of the raw window
 */
export function resolve(message: string, recent: Turn[], registers: Registers, loops: LoopsInView = { all: [], latest: [] }, session: Turn[] = recent): Resolution {
  if (isBundle(message)) {
    if (!loops.all.length) return { status: "unsure", query: withRecentWords(message, recent), reason: "'all that' with no open offer to point at" };
    const list = loops.all.map((l, i) => `${i + 1}) "${l.text}"${l.unheard ? " (talked over, never heard)" : ""}`).join(" ");
    return { status: "resolved", query: `${message} ${loops.all.map((l) => l.text).join(" ")}`, referent: list, reason: `'${message.trim()}' covers every open offer: ${list}` };
  }

  if (isAck(message)) {
    if (loops.latest.length === 1) {
      const offer = loops.latest[0]!;
      return { status: "resolved", query: `${message} ${offer.text}`, referent: offer.text, reason: `'${message.trim()}' takes up your offer: "${offer.text}"` };
    }
    if (loops.latest.length > 1) {
      const list = loops.latest.map((l, i) => `${i + 1}) "${l.text}"`).join(" or ");
      return { status: "unsure", query: withRecentWords(message, recent), reason: `'${message.trim()}' could take up ${list}; ask which, or do all if that's clearly meant` };
    }
    // A yes with nothing on offer leans on the recent turns, which ride along raw anyway.
    return { status: "none", query: message };
  }

  if (ARITHMETIC.test(message) && PRONOUN.test(message)) {
    const last = registers.results[registers.results.length - 1];
    if (!last) return { status: "unsure", query: message, reason: "a calculation on 'it', but no earlier number to use" };
    if (last.headline) {
      const { value, sentence } = last.headline;
      return { status: "resolved", query: `${message} (${value})`, referent: value, reason: `'it' read as ${value}, from your answer "${sentence}"` };
    }
    const options = last.numbers.slice(0, 3).map((n) => `${n.value} ("${n.sentence}")`).join(" or ");
    return { status: "unsure", query: message, reason: `'it' could be ${options}` };
  }

  const ordinal = message.match(ORDINAL_REF);
  if (ordinal) {
    const list = lastList(session);
    const which = ordinal[1]!.toLowerCase();
    if (list) {
      const picked = pickFromList(list, which, session);
      if (picked) {
        return {
          status: "resolved",
          query: `${message} (${picked})`,
          referent: picked,
          reason: `'the ${which} one' read as "${picked}" from your last list`,
        };
      }
    }
    return { status: "unsure", query: withRecentWords(message, recent), reason: `can't tell which item 'the ${which} one' means` };
  }

  // Thanks, "lol", "nice": nothing to look up, so no packet beyond the head.
  if (isSmallTalk(message) || contentWords(message).length === 0) return { status: "none", query: message };

  if (VAGUE.test(message)) {
    if (recent.length === 0) return { status: "none", query: message };
    return { status: "unsure", query: withRecentWords(message, recent), reason: "a bare follow-up, leaning on the recent turns" };
  }

  return { status: "none", query: message };
}

/** Items of the newest numbered or bulleted list the assistant wrote. */
function lastList(turns: Turn[]): { items: string[]; index: number } | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]!;
    if (turn.role !== "assistant") continue;
    const items = turn.content
      .split("\n")
      .map((l) => l.match(/^\s*(?:\d+[.)]|[-*•])\s+(.*\S)/)?.[1])
      .filter((x): x is string => Boolean(x));
    if (items.length >= 2) return { items, index: i };
  }
  return undefined;
}

function pickFromList(list: { items: string[]; index: number }, which: string, turns: Turn[]): string | undefined {
  const { items } = list;
  if (which === "last") return items[items.length - 1];
  if (which === "other") {
    // "The other one" only makes sense with two items when the user already named one of them.
    if (items.length !== 2) return undefined;
    const later = turns.slice(list.index + 1).filter((t) => t.role === "user").map((t) => new Set(contentWords(t.content)));
    const mentioned = items.map((item) => later.some((words) => contentWords(item).some((w) => words.has(w))));
    if (mentioned[0] === mentioned[1]) return undefined;
    return mentioned[0] ? items[1] : items[0];
  }
  return items[ORDINALS.indexOf(which)];
}

function withRecentWords(message: string, recent: Turn[]): string {
  const lastUser = [...recent].reverse().find((t) => t.role === "user");
  return lastUser ? `${message} ${lastUser.content}` : message;
}
