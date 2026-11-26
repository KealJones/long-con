// Deterministic resolver: turns a follow-up like "multiply it by 32" or "the second one" into something
// standalone, using the registers and the recent turns. When it can't tell, it says "unsure" instead of guessing.

import type { Turn } from "./chat.ts";
import type { Registers } from "./registers.ts";
import { contentWords } from "./text.ts";

export type Resolution =
  | { status: "none"; query: string }
  | { status: "resolved"; query: string; referent: string; reason: string }
  | { status: "unsure"; query: string; reason: string };

const ARITHMETIC = /\b(multipl\w*|times|divide\w*|add|plus|subtract\w*|minus|double|triple|halve|square|percent|%|\*|x\s*\d)/i;
const PRONOUN = /\b(it|that|this|the (?:result|answer|number|total)|that (?:number|result|total))\b/i;
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const ORDINAL_REF = new RegExp(`\\b(${ORDINALS.join("|")}|last|other) (?:one|option|item|choice|idea)\\b`, "i");
const VAGUE = /^\s*(?:and |but |so |ok,? |okay,? )?(?:what about |how about )?(?:it|that|this|that one|this one|the other one|them|those)\s*\??\s*$/i;

export function resolve(message: string, recent: Turn[], registers: Registers): Resolution {
  if (ARITHMETIC.test(message) && PRONOUN.test(message)) {
    const last = registers.results[registers.results.length - 1];
    if (!last) return { status: "unsure", query: message, reason: "a calculation on 'it', but no earlier number to use" };
    return {
      status: "resolved",
      query: `${message} (${last.value})`,
      referent: last.value,
      reason: `'it' read as the last result, ${last.value}`,
    };
  }

  const ordinal = message.match(ORDINAL_REF);
  if (ordinal) {
    const list = lastList(recent);
    const which = ordinal[1]!.toLowerCase();
    if (list) {
      const picked = pickFromList(list, which, recent);
      if (picked) {
        return {
          status: "resolved",
          query: `${message} (${picked})`,
          referent: picked,
          reason: `'the ${which} one' read as "${picked}" from the last list`,
        };
      }
    }
    return { status: "unsure", query: withRecentWords(message, recent), reason: `can't tell which item 'the ${which} one' means` };
  }

  if (VAGUE.test(message) || contentWords(message).length === 0) {
    if (recent.length === 0) return { status: "none", query: message };
    return { status: "unsure", query: withRecentWords(message, recent), reason: "a bare follow-up, leaning on the recent turns" };
  }

  return { status: "none", query: message };
}

/** Items of the newest numbered or bulleted list the assistant wrote in the recent turns. */
function lastList(recent: Turn[]): { items: string[]; index: number } | undefined {
  for (let i = recent.length - 1; i >= 0; i--) {
    const turn = recent[i]!;
    if (turn.role !== "assistant") continue;
    const items = turn.content
      .split("\n")
      .map((l) => l.match(/^\s*(?:\d+[.)]|[-*•])\s+(.*\S)/)?.[1])
      .filter((x): x is string => Boolean(x));
    if (items.length >= 2) return { items, index: i };
  }
  return undefined;
}

function pickFromList(list: { items: string[]; index: number }, which: string, recent: Turn[]): string | undefined {
  const { items } = list;
  if (which === "last") return items[items.length - 1];
  if (which === "other") {
    // "The other one" only makes sense with two items when the user already named one of them.
    if (items.length !== 2) return undefined;
    const later = recent.slice(list.index + 1).filter((t) => t.role === "user").map((t) => new Set(contentWords(t.content)));
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
