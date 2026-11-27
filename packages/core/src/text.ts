// Text helpers shared by search, the resolver and token budgeting.

import { stemmer as porter } from "stemmer";

const STOPWORDS = new Set(
  `a an the and or but if then so of to in on at by for with from up down out over under about into onto
  is are was were be been being am do does did doing have has had having can could should would will shall may might must
  i me my mine myself you your yours yourself we us our ours he him his she her hers it its they them their theirs
  this that these those there here what which who whom whose when where why how all any both each few more most other some such
  no nor not only own same than too very just also as s t don didn doesn isn wasn aren weren won wouldn couldn shouldn
  ok okay yes yeah yep thanks thank please hey hi hello sure cool great got let lets like really well much many`
    .split(/\s+/)
    .filter(Boolean),
);

// Crude suffix stripping. On the claude profile it beat Porter and an inflection-only Porter2 at every gate bar on the dev
// slice: fuller conflation let in more wrong units (P17).
function strip(word: string): string {
  if (word.length > 5 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

// Stripped to a fixed point, so "weddings" -> "wedding" -> "wedd" meets "wedding" and stem(stem(w)) == stem(w).
// Dev: +1 evidence turn on claude, no question, FI +0.05 to +0.12 on tiers 1/1t/3 at bars 0.17 and 0.175 (not kept on main).
function suffix(word: string): string {
  for (let next = strip(word); next !== word; next = strip(word)) word = next;
  return word;
}

/** How content words are stemmed: "suffix" strips a few endings, "porter" is the Porter (1980) stemmer. Set per profile. */
export type Stemmer = "suffix" | "porter";
const STEM: Record<Stemmer, (word: string) => string> = { suffix, porter };

/** Lowercased, stemmed content words. Numbers are kept, since "4096" is often the thing being asked about. */
export function contentWords(text: string, stemmer: Stemmer = "suffix"): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || STOPWORDS.has(raw)) continue;
    out.push(STEM[stemmer](raw));
  }
  return out;
}

// shortcut: ~3.5 characters per token over-counts slightly for English, which is the safe side for budgets and cost.
// Swap for the provider's token counter once a key is wired in.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
