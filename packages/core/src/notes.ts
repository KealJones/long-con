// Interest notes (backlog P31, arm A): a free rule noter. When the user says what they like, prefer or switched to
// ("my favorite", "obsessed with", "I've been loving", "switched to", "I'm into", "I prefer", "no longer"), it saves a
// dated note: topic, value, date and source turn. Newest value wins; older values stay as history.
// Only explicit wording counts (docs/research/people.md, takeaway 4); everything else stays findable in the log.

import type { Session, TurnRef } from "./chat.ts";
import { contentWords, type Stemmer } from "./text.ts";

export interface Note {
  topic: string;
  value: string;
  /** The wording that triggered it, e.g. "favorite", "obsessed with". */
  cue: string;
  date?: string;
  from: TurnRef;
}

/** A topic with its values, newest first. */
export interface NoteGroup {
  topic: string;
  notes: Note[];
}

// shortcut: English-only first-person rules; a small-model noter (P31 arm B) would catch implicit wording.
// Each rule yields [cue, topic | undefined, value]. With no topic, the value is its own topic.
const ADV = "(?:really |totally |so |super |currently |now |also |still |kind of |kinda |pretty |very |absolutely |honestly |lately |recently |just )*";
const RULES: { cue: string; re: RegExp; topic?: number; value: number }[] = [
  { cue: "favorite", re: /\bmy (?:new |current |all-time |absolute |personal |top )?favou?rite (?:one )?(?:is|are|was|were|has to be|would be|right now is) (.+)/i, value: 1 },
  { cue: "favorite", re: /\bmy (?:new |current |all-time |absolute |personal |top )?favou?rite ([a-z][a-z' -]{1,40}?)(?:,| is | are | has to be | would be | right now is | these days is |: | - )\s*(.+)/i, topic: 1, value: 2 },
  { cue: "favorite", re: /\b((?:[A-Z0-9][\w'&.-]*\s?){1,6}) (?:is|are) (?:now |still |definitely |probably )?my (?:new |all-time |absolute )?favou?rite\s*([a-z][a-z -]{1,30})?/, topic: 2, value: 1 },
  { cue: "obsessed with", re: new RegExp(`\\bI(?:'m|’m| am| have been|'ve been|’ve been) ${ADV}(?:obsessed with|hooked on|addicted to) (.+)`, "i"), value: 1 },
  { cue: "loving", re: new RegExp(`\\bI(?:'ve|’ve| have) been ${ADV}(?:loving|enjoying|getting into|into) (.+)`, "i"), value: 1 },
  { cue: "into", re: new RegExp(`\\bI(?:'m|’m| am) ${ADV}(?:getting )?into (?!it\\b|that\\b|this\\b)(.+)`, "i"), value: 1 },
  { cue: "fan of", re: new RegExp(`\\bI(?:'m|’m| am) ${ADV}(?:a )?(?:huge |big |massive |great )?fan of (.+)`, "i"), value: 1 },
  { cue: "prefer", re: /\bI (?:really |usually |generally |definitely |much |always |still |now )?prefer (?!not\b)(.+)/i, value: 1 },
  { cue: "switched to", re: /\bI(?:'ve|’ve| have)? (?:recently |just |finally |since |already )?(?:switched|moved over|changed) (?:over )?(?:from .+? )?to (.+)/i, value: 1 },
  // "the CDs I no longer listen to" is a relative clause about the CDs, so "I" must open a clause here.
  { cue: "no longer", re: /(?:^|[,;-]\s*|\b(?:and|but|so|now|actually|honestly)\s)I(?:'m|’m| am)? no longer (.+)/i, value: 1 },
  { cue: "no longer", re: /\bI (?:don't|don’t|do not) (.+?) any ?more\b/i, value: 1 },
];

// Special categories stay out of automatic notes (people.md takeaway 12): saved only when the user asks.
const SENSITIVE = /\b(meds?|medications?|therap(?:y|ist)|diagnos\w*|anxiety|depress\w*|religio\w*|church|mosque|synagogue|pray\w*|democrat\w*|republican\w*|politic\w*|sex\w*|pregnan\w*|diet pills?)\b/i;
// A question or a hypothetical isn't a statement of taste.
const QUESTION = /^(?:do|does|is|are|can|could|would|should|what|which|how|why|will|have|did|any)\b/i;
const HYPOTHETICAL = /\b(?:if|whether|wonder(?:ing)?|should|might)\b[^.]*$/i;
// The value ends at the first clause break.
const CLAUSE_END = /[.,;:!?()\n]|\s[-–—]\s|\s(?:and I|and it|but|because|since|so|which|who|that I|when|while|though|although|as well|lately|right now|these days|a lot)\b/i;
const MAX_VALUE_WORDS = 8;
// A clause that opens with a conjunction, pronoun or preposition is the rest of the sentence, not the thing liked.
const NOT_A_VALUE = /^(?:but|and|so|or|because|i|i'm|it|it's|this|that|they|we|you|he|she|with|from|at|in|on|for|to do|do|does|what|how)\b/i;
const LEAD = /^(?:the|a|an|my|some|including|like|such as|probably|definitely|actually|still|honestly)\s+/i;
const TRAIL = /\s+(?:and|or|the|a|an|of|to|on|in|with|for|at|from|I)$/i;

const sentences = (text: string) => text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim());

function clip(raw: string): string {
  const cut = raw.search(CLAUSE_END);
  let v = (cut < 0 ? raw : raw.slice(0, cut)).trim().split(/\s+/).slice(0, MAX_VALUE_WORDS).join(" ");
  while (LEAD.test(v)) v = v.replace(LEAD, "");
  while (TRAIL.test(v)) v = v.replace(TRAIL, "");
  return v.replace(/["“”]/g, "").replace(/^'+|'+$/g, "").trim();
}

/** The notes one user turn yields. Runs after every saved user turn, so it stays a handful of regexes per sentence. */
export function notesFromTurn(content: string, from: TurnRef, date?: string): Note[] {
  const out: Note[] = [];
  for (const s of sentences(content)) {
    if (QUESTION.test(s.trim()) || SENSITIVE.test(s)) continue;
    for (const rule of RULES) {
      const m = rule.re.exec(s);
      if (!m || HYPOTHETICAL.test(s.slice(0, m.index))) continue;
      const value = clip(m[rule.value] ?? "");
      const topic = rule.topic !== undefined && m[rule.topic] ? clip(m[rule.topic]!) : value;
      if (!contentWords(value).length || !contentWords(topic).length || NOT_A_VALUE.test(value)) continue;
      out.push({ topic, value, cue: rule.cue, date: date?.slice(0, 10), from });
      break; // one note per sentence: the first rule that fires is the most specific
    }
  }
  return out;
}

/** Every note in the user turns of a history, oldest first. `skip` leaves out turns already riding along raw. */
export function extractNotes(history: Session[], skip: (ref: TurnRef) => boolean = () => false): Note[] {
  const out: Note[] = [];
  for (const session of history) {
    session.turns.forEach((turn, i) => {
      const from = { sessionId: session.id, turn: i };
      if (turn.role === "user" && !skip(from)) out.push(...notesFromTurn(turn.content, from, session.date));
    });
  }
  return out;
}

/**
 * Notes grouped by topic, newest value first. A later note joins an earlier topic when it names every word of that
 * topic ("my favorite BBQ sauce, Sweet Baby Ray's", then "obsessed with Kansas City Masterpiece BBQ sauce").
 */
export function groupNotes(notes: Note[]): NoteGroup[] {
  const groups: { words: string[]; group: NoteGroup }[] = [];
  for (const note of notes) {
    const said = new Set(contentWords(`${note.topic} ${note.value}`));
    const home = groups.findLast((g) => g.words.every((w) => said.has(w)));
    if (home) home.group.notes.unshift(note);
    else groups.push({ words: contentWords(note.topic), group: { topic: note.topic, notes: [note] } });
  }
  return groups.map((g) => g.group);
}

/** The words a message can match a group on: its topic, every value, and the cue ("obsessed", "favorite"). */
export const groupWords = (g: NoteGroup, stemmer: Stemmer = "suffix"): Set<string> => new Set(g.notes.flatMap((n) => contentWords(`${g.topic} ${n.value} ${n.cue}`, stemmer)));

/** One line per group: the newest value with its date, then up to two earlier values marked as earlier. */
export function renderGroup(g: NoteGroup): string {
  const [now, ...before] = g.notes;
  const at = (n: Note) => `${n.cue}, ${n.date ?? "undated"}`;
  const head = now!.value.toLowerCase() === g.topic.toLowerCase() ? `- ${now!.value} (${at(now!)})` : `- ${g.topic}: ${now!.value} (${at(now!)})`;
  const earlier = before.slice(0, 2).map((n) => `${n.value} (${at(n)})`);
  return earlier.length ? `${head}; earlier: ${earlier.join("; ")}` : head;
}
