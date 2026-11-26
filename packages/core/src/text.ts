// Text helpers shared by search, the resolver and token budgeting.

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

// shortcut: crude suffix stripping, swap for a real stemmer if recall shows it matters.
function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Lowercased, stemmed content words. Numbers are kept, since "4096" is often the thing being asked about. */
export function contentWords(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || STOPWORDS.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

// shortcut: ~3.5 characters per token over-counts slightly for English, which is the safe side for budgets and cost.
// Swap for the provider's token counter once a key is wired in.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
