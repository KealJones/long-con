// Registers: what the packet carries without searching, tagged when a turn is written. Standing rules, the numbers
// the assistant gave (with the sentence that says what each is), open offers ("want me to…?") still waiting on the
// user, later updates to earlier facts, and which answers were shot down.

import type { Session, TurnRef } from "./chat.ts";
import { contentWords } from "./text.ts";

/** A number the assistant gave, with the sentence it sits in, so the model sees what it is. */
export interface Num {
  value: string;
  sentence: string;
}

/** One assistant turn's numbers. `headline` is the answer itself when the turn makes it clear; else it's left out. */
export interface Result {
  headline?: Num;
  numbers: Num[];
  from: TurnRef;
}

/** An offer or question the assistant made that the user hasn't taken up or turned down. Ignoring it isn't a no. */
export interface Loop {
  text: string;
  from: TurnRef;
  /** The user talked over the reply before this part was read aloud, so they never heard it. */
  unheard?: boolean;
}

/** A user turn that changed an earlier fact ("update: it's actually the 24th"), linked when it was said. */
export interface Update {
  text: string;
  from: TurnRef;
  /** The earlier turn it replaces. */
  replaces: TurnRef;
}

export interface Registers {
  rules: { text: string; from: TurnRef }[];
  /** Assistant turns with numbers, newest last. "Multiply it by 32" reads the last one's headline. */
  results: Result[];
  /** The assistant's latest answers, newest last. */
  recentAnswers: { text: string; from: TurnRef }[];
  /** Assistant turns the user rejected or corrected ("no", "that didn't work", "you forgot…"). */
  rejected: Set<string>;
  /** Offers still open, oldest first. */
  openLoops: Loop[];
  /** Earlier user turns a later one changed, keyed by refKey of the old turn. */
  updates: Map<string, Update>;
}

export const refKey = (r: TurnRef) => `${r.sessionId}#${r.turn}`;

// ---- Cues, English and Spanish. Whole-message cues are anchored so a long message that merely starts with "ok" isn't one.

/** A short message that takes up an offer: "go", "yes", "do it", "dale". */
const ACK = /^\s*(?:(?:ok(?:ay)?|alright|all right|yeah|yes|yep|yup|sure|sí|si|dale|claro|va|órale|orale)[\s,!.]*)*(?:go(?: ahead| for it)?|yes|yeah|yep|yup|sure|do it|do that|please do|sounds good|let'?s do it|let'?s go|ok(?:ay)?|dale|sí|si|hazlo|claro|va|órale|orale|adelante)[\s!.]*$/i;
/** "go do all that", "do both", "haz todo eso": every open offer, not just the last. */
const BUNDLE = /\b(?:do|go|run|handle|make|send|haz|hazlo|hagan)\b.*\b(?:all (?:of )?(?:that|those|them|it|this|these)|everything|both|todo(?: eso)?)\b/i;
/** Thanks and small talk: nothing to look up and nothing accepted. */
const SMALL_TALK = /^\s*(?:thanks?|thank you|thx|ty|lol|lmao|haha+|nice|perfect|awesome|cool|great|gracias|got it|makes sense|word|bet|love it|amazing)\b[\s\w]{0,12}?[\s!.?]*$/i;
const NEGATIVE =
  /^\s*(?:no\b|nope\b|nah\b|wrong\b|not that\b|not quite\b|that'?s (?:wrong|not (?:it|right|what))|that (?:didn'?t|did not|doesn'?t|does not) work|that'?s not|you forgot\b|you missed\b|not what i asked|eso no\b|está mal|esta mal|te olvidaste)/i;
/** A sentence that sets a standing rule. "From now on" counts anywhere in it; the rest must open it. */
const RULE_ANYWHERE = /\b(?:from now on|going forward|from here on(?: out)?|de ahora en adelante|a partir de ahora)\b/i;
const RULE_START = /^(?:(?:ok|okay|so|and|also|please|pls|oh)[,\s]+)*(?:always|never(?! ?mind)|don'?t ever|do not ever|siempre|nunca|no vuelvas a)\b/i;
/** A sentence where the assistant offers to do something or asks the user to say go. */
const OFFER =
  /\b(?:want me to|do you want me to|would you like me to|should i|shall i|i can also|if you(?:'d)? (?:want|like),? i(?:'ll| can| could)|say ["“']?go["”']?|just say the word|quieres que)\b/i;
/** A user turn that changes an earlier fact. */
const UPDATE = /\b(?:actually|update|correction|scratch that|changed (?:it )?to|moved (?:it )?to|now it'?s|instead|en realidad|cambió a|cambio a|ahora es)\b/i;
const MONTH = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const SLOTS: Record<string, RegExp> = {
  date: new RegExp(`\\b(?:(?:${MONTH})\\.? \\d{1,2}(?:st|nd|rd|th)?|\\d{1,2}(?:st|nd|rd|th)(?: of (?:${MONTH}))?|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\\b`, "i"),
  time: /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\b\d{1,2}:\d{2}\b/i,
  money: /[$€£]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:dollars|bucks|pesos)\b/i,
};
const NUMBER =
  /[$€£]?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|percent\b|[kKMB]\b|GB\b|MB\b|KB\b|TB\b|mph\b|mpg\b|miles?\b|mi\b|km\b|hours?\b|hrs?\b|minutes?\b|mins?\b|days?\b|weeks?\b|months?\b|years?\b|lbs?\b|kg\b|tokens?\b))?/g;
/** The number right after these is the answer: "= 512", "is $1,740", "comes to about 3 hours". */
const ANSWER_LEAD = /(?:=|\bis|\bare|\bcomes? to|\bequals|\btotals?|\bworks out to|\bcomes out to)\s*(?:about|around|roughly|approximately|~)?\s*$/i;
const APPROX_START = /^(?:about|around|roughly|approximately|~|it'?s|that'?s|that is|it is)\b/i;
const LIST_LINE = /^\s*(?:\d+[.)]|[-*•])\s/;
// The web app's note on the message after a talked-over reply (apps/web/src/voice.ts interruptNote).
const INTERRUPTED = /\[The user interrupted/;
const INTERRUPTED_NOTE = /\[The user interrupted[^\]]*\]/g;

export const isAck = (message: string) => ACK.test(message);
export const isBundle = (message: string) => BUNDLE.test(message);
export const isSmallTalk = (message: string) => SMALL_TALK.test(message) && !BUNDLE.test(message);

export function buildRegisters(history: Session[], recentAnswerCount: number): Registers {
  const regs: Registers = { rules: [], results: [], recentAnswers: [], rejected: new Set(), openLoops: [], updates: new Map() };
  const userTurns: { text: string; from: TurnRef; slots: string[] }[] = [];
  for (const session of history) {
    session.turns.forEach((turn, i) => {
      const from = { sessionId: session.id, turn: i };
      if (turn.role === "user") {
        for (const text of extractRules(turn.content)) regs.rules.push({ text, from });
        const prev = session.turns[i - 1];
        const prevFrom = { sessionId: session.id, turn: i - 1 };
        const prevLoops = regs.openLoops.filter((l) => l.from.sessionId === session.id && l.from.turn === i - 1);
        if (prev?.role === "assistant" && NEGATIVE.test(turn.content)) {
          regs.rejected.add(refKey(prevFrom));
          close(regs, prevLoops);
        } else if (INTERRUPTED.test(turn.content)) {
          // A talked-over reply's offers stay open, marked unheard; the turn's own words may still accept or bundle.
          // shortcut: marks every offer in that reply, even one read aloud before the cut; match against the heard tail if it misleads.
          for (const l of prevLoops) l.unheard = true;
        }
        const words = turn.content.replace(INTERRUPTED_NOTE, "").trim();
        if (isBundle(words)) close(regs, regs.openLoops.filter((l) => l.from.sessionId === session.id));
        else if (isAck(words) && prevLoops.length === 1) close(regs, prevLoops);
        linkUpdate(regs, userTurns, turn.content, from);
        userTurns.push({ text: turn.content, from, slots: slotsOf(turn.content) });
        return;
      }
      const result = resultOf(turn.content, from);
      if (result) regs.results.push(result);
      for (const text of offersIn(turn.content)) regs.openLoops.push({ text, from });
      regs.recentAnswers.push({ text: firstLine(turn.content), from });
    });
  }
  // A rejected answer is never a result, an open offer or a recent answer to lean on.
  const ok = (r: { from: TurnRef }) => !regs.rejected.has(refKey(r.from));
  regs.results = regs.results.filter(ok);
  regs.openLoops = regs.openLoops.filter(ok);
  const kept = regs.recentAnswers.filter(ok);
  regs.recentAnswers = recentAnswerCount > 0 ? kept.slice(-recentAnswerCount) : [];
  return regs;
}

const close = (regs: Registers, loops: Loop[]) => {
  regs.openLoops = regs.openLoops.filter((l) => !loops.includes(l));
};

const sentencesOf = (text: string) =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Standing rules in one user message, each as its whole sentence so the scope ("for the tilde repo") comes with it. */
export function extractRules(text: string): string[] {
  return sentencesOf(text).filter((s) => RULE_ANYWHERE.test(s) || RULE_START.test(s));
}

function offersIn(text: string): string[] {
  return sentencesOf(text.replace(/\n\s*(?:\d+[.)]|[-*•])\s[^\n]*/g, "")).filter((s) => OFFER.test(s));
}

/** Numbers outside list items, each with its sentence, and the headline when the turn makes it plain. */
function resultOf(text: string, from: TurnRef): Result | undefined {
  const prose = text
    .split("\n")
    .filter((l) => !LIST_LINE.test(l))
    .join("\n");
  const numbers: Num[] = [];
  let headline: Num | undefined;
  sentencesOf(prose).forEach((sentence, si) => {
    for (const m of sentence.matchAll(NUMBER)) {
      const num = { value: m[0].trim(), sentence: clip(sentence, 160) };
      numbers.push(num);
      if (!headline && ANSWER_LEAD.test(sentence.slice(0, m.index))) headline = num;
      if (!headline && si === 0 && APPROX_START.test(sentence) && numbers.length === 1) headline = num;
    }
  });
  if (!numbers.length) return undefined;
  return { headline: headline ?? (numbers.length === 1 ? numbers[0] : undefined), numbers, from };
}

function slotsOf(text: string): string[] {
  return Object.entries(SLOTS)
    .filter(([, re]) => re.test(text))
    .map(([name]) => name);
}

/**
 * Links an update to the turn it changes, when it's said: the latest earlier user turn with the same kind of value
 * (a date for "it's actually the 24th") that shares a word with it, else the nearest one a few turns back.
 * It never guesses past that: with no candidate, nothing is linked.
 */
function linkUpdate(regs: Registers, earlier: { text: string; from: TurnRef; slots: string[] }[], text: string, from: TurnRef) {
  if (!UPDATE.test(text)) return;
  const slots = slotsOf(text);
  if (!slots.length) return;
  const words = new Set(contentWords(text));
  const window = earlier.slice(-20).reverse();
  const sameSlot = window.filter((e) => e.slots.some((s) => slots.includes(s)));
  const old = sameSlot.find((e) => contentWords(e.text).some((w) => words.has(w))) ?? sameSlot.find((e) => window.indexOf(e) < 6);
  if (!old || regs.updates.has(refKey(old.from))) return;
  regs.updates.set(refKey(old.from), { text: clip(text, 200), from, replaces: old.from });
}

function firstLine(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return clip(line, 240);
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 3) + "..." : s);
