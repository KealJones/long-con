// Person index (backlog P24): an alias table of the people the user names, and a short card of dated pointers to the
// user turns that mention them. Only clear wording makes an entry (docs/research/people.md, takeaways 1, 4 and 8):
// "my <relation>", and a name only where the user ties it to a relation ("my sister Emma", "Emma, my sister").
// Merges happen only on that stated link or an exact match; two entries are never guessed to be one person.
// A card holds pointers, never traits or summaries, and no health, money or other private word is copied onto it.

import type { Session, TurnRef } from "./chat.ts";
import { contentWords, estimateTokens } from "./text.ts";

/** Relation words, each mapped to one spelling so "mom" and "mother" are one key. Plurals map to the singular. */
const RELATIONS: Record<string, string> = Object.fromEntries(
  `mother:mom,mum,mommy,mama,mother;father:dad,daddy,papa,father;parent:parents;wife:wife;husband:husband;partner:partner;
  spouse:spouse;boyfriend:boyfriend,bf;girlfriend:girlfriend,gf;fiance:fiance,fiancee,fiancé,fiancée;sister:sister,sis,sisters;
  brother:brother,bro,brothers;sibling:sibling,siblings;son:son,sons;daughter:daughter,daughters;kid:kid,kids,child,children;
  grandmother:grandma,grandmother,granny,nana,grandmothers;grandfather:grandpa,grandfather,grandfathers;grandparent:grandparents;
  aunt:aunt,auntie,aunts;uncle:uncle,uncles;cousin:cousin,cousins;niece:niece,nieces;nephew:nephew,nephews;
  friend:friend,friends,buddy,pal;roommate:roommate,roommates;neighbor:neighbor,neighbour,neighbors,neighbours;
  boss:boss;manager:manager;coworker:coworker,co-worker,coworkers,co-workers;colleague:colleague,colleagues;
  teammate:teammate,teammates;classmate:classmate,classmates;mentor:mentor;
  in-law:in-laws;mother-in-law:mother-in-law;father-in-law:father-in-law;sister-in-law:sister-in-law;
  brother-in-law:brother-in-law;stepmother:stepmom,stepmother;stepfather:stepdad,stepfather;stepson:stepson;
  stepdaughter:stepdaughter;godmother:godmother;godfather:godfather;goddaughter:goddaughter;godson:godson`
    .split(";")
    .flatMap((group) => {
      const [key, words] = group.trim().split(":");
      return words!.split(",").map((w) => [w, key!]);
    }),
);
/** Relations a person usually has many of: a bare "my friend" can't say which one, so it gets no card. */
const MANY = new Set(["friend", "coworker", "colleague", "cousin", "neighbor", "classmate", "teammate", "kid", "sibling", "in-law", "aunt", "uncle", "niece", "nephew"]);
/** Words that tell two people of one relation apart; part of the key, so "my older sister" and "my sister" stay apart. */
const DISTINCT = "older|younger|little|big|baby|elder|eldest|oldest|youngest|twin|best|ex|step|half";
// "late" is soft on purpose: a death stays off the card.
const SOFT = "close|old|good|new|dear|lovely|dearest|late";
const REL_WORDS = Object.keys(RELATIONS)
  .sort((a, b) => b.length - a.length)
  .map((w) => w.replace(/-/g, "[- ]?"))
  .join("|");
// "my (little) sister('s)", optionally followed by a stated name: "my sister Emma", "my sister, Emma,".
const RELATION_RE = new RegExp(`\\b[Mm]y\\s+((?:(?:${DISTINCT}|${SOFT})[- ]?\\s*)*)(${REL_WORDS})(?:'s|’s)?\\b(?:,?\\s+([A-Z][a-z]{1,15})\\b)?`, "g");
// "Emma, my sister": the appositive puts the name first.
const APPOSITIVE_RE = new RegExp(`\\b([A-Z][a-z]{1,15}),\\s+my\\s+((?:(?:${DISTINCT}|${SOFT})[- ]?\\s*)*)(${REL_WORDS})\\b`, "g");
/** Capitalized words that aren't names, so "my sister Monday" or "my friend I met" make no name. */
const NOT_NAMES = new Set(
  `I I'm I've I'll I'd And But So Or The A An My We He She They It This That There Here When What Which Who How Why Yes No Ok Okay
  Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December
  Christmas Easter Thanksgiving Halloween Mom Dad Grandma Grandpa Also Just Then Now Today Tomorrow Yesterday Last Next Since After Before`.split(/\s+/),
);
/** Health, money, legal and other private matters: never copied onto a card, even as a search word. */
const PRIVATE =
  /^(?:meds?|medication|medicine|pill|therap|diagnos|anxiety|depress|cancer|tumou?r|chemo|surgery|hospital|sick|ill|illness|disease|injur|pregnan|miscarriage|rehab|addict|alcohol|drunk|died|death|dead|funeral|grief|passed|divorce|affair|cheat|arrest|jail|prison|court|lawsuit|lawyer|police|debt|loan|owe|salary|paycheck|income|money|rent|mortgage|bankrupt|broke|credit|bill|religio|church|pray|politic|sex|dating|immigra|visa|deport)/;

export interface Mention {
  ref: TurnRef;
  date?: string;
  /** The turn's content words, stemmed, for ranking against the message. */
  words: Set<string>;
  /** The turn's own words in order, lowercased, for the pointer's search words. */
  raw: string[];
}

export interface Person {
  /** How the card names them, in the user's words: "my sister Emma", "my boss". */
  label: string;
  name?: string;
  /** Relation keys with their distinguishing words, e.g. "older sister". */
  relations: Set<string>;
  mentions: Mention[];
}

export interface PersonIndex {
  people: Person[];
  /** Turns per stemmed word, for picking a pointer's rarest search words. */
  df: Map<string, number>;
}

interface Found {
  key: string;
  base: string;
  name?: string;
}

/** Every "my <relation>" in a text, with the name the user tied to it, if any. */
function relationsIn(text: string): Found[] {
  const out: Found[] = [];
  for (const m of text.matchAll(RELATION_RE)) {
    const base = RELATIONS[m[2]!.toLowerCase().replace(/ /g, "-")];
    if (!base) continue;
    const mods = (m[1] ?? "").toLowerCase().match(new RegExp(`\\b(?:${DISTINCT})\\b`, "g")) ?? [];
    const name = m[3] && !NOT_NAMES.has(m[3]) ? m[3] : undefined;
    out.push({ key: [...mods, base].join(" "), base, name });
  }
  for (const m of text.matchAll(APPOSITIVE_RE)) {
    const base = RELATIONS[m[3]!.toLowerCase().replace(/ /g, "-")];
    if (!base || NOT_NAMES.has(m[1]!)) continue;
    const mods = m[2]!.toLowerCase().match(new RegExp(`\\b(?:${DISTINCT})\\b`, "g")) ?? [];
    out.push({ key: [...mods, base].join(" "), base, name: m[1] });
  }
  return out;
}

// A name opening a sentence could be a plain word ("Will it rain?"), so only a name inside a sentence counts.
const nameRe = (name: string) => new RegExp(`(?<!^\\s*|[.!?]\\s+)\\b${name}\\b`);
const baseOf = (key: string) => key.split(" ").at(-1)!;

/**
 * The alias table, from the user's own turns only. A relation tied to exactly one name is that named person; tied to
 * two or more names, each name is its own person and the bare relation names nobody. A name tied to two different
 * relations ("my boss Sam", "my friend Sam") is two people the user may mean, so it names nobody either.
 */
export function buildPersonIndex(history: Session[]): PersonIndex {
  const df = new Map<string, number>();
  const turns: { ref: TurnRef; date?: string; text: string; words: Set<string>; found: Found[] }[] = [];
  for (const s of history) {
    s.turns.forEach((t, i) => {
      if (t.role !== "user") return;
      const words = new Set(contentWords(t.content));
      for (const w of words) df.set(w, (df.get(w) ?? 0) + 1);
      turns.push({ ref: { sessionId: s.id, turn: i }, date: s.date, text: t.content, words, found: relationsIn(t.content) });
    });
  }
  const namesOf = new Map<string, Set<string>>(); // relation key -> names stated with it
  const keysOf = new Map<string, Set<string>>(); // name -> relation keys stated with it
  for (const t of turns)
    for (const f of t.found) {
      if (!namesOf.has(f.key)) namesOf.set(f.key, new Set());
      if (!f.name) continue;
      namesOf.get(f.key)!.add(f.name);
      if (!keysOf.has(f.name)) keysOf.set(f.name, new Set());
      keysOf.get(f.name)!.add(f.key);
    }
  const people: Person[] = [];
  for (const [name, keys] of keysOf) {
    const bases = new Set([...keys].map(baseOf));
    if (bases.size > 1) continue; // one name, two kinds of person: never guessed to be one
    const key = [...keys][0]!;
    people.push({ label: `my ${key} ${name}`, name, relations: new Set(keys), mentions: [] });
  }
  for (const [key, names] of namesOf) if (!names.size) people.push({ label: `my ${key}`, relations: new Set([key]), mentions: [] });
  // A bare relation mention belongs to a named person only when that relation was tied to that one name.
  const owner = new Map<string, Person>();
  for (const p of people) if (p.name) for (const k of p.relations) if (namesOf.get(k)!.size === 1) owner.set(k, p);
  for (const p of people) if (!p.name) owner.set([...p.relations][0]!, p);
  for (const t of turns) {
    const hit = new Set<Person>();
    for (const f of t.found) {
      const p = f.name ? people.find((x) => x.name === f.name) : owner.get(f.key);
      if (p) hit.add(p);
    }
    for (const p of people) if (p.name && nameRe(p.name).test(t.text)) hit.add(p);
    const raw = t.text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    for (const p of hit) p.mentions.push({ ref: t.ref, date: t.date, words: t.words, raw });
  }
  return { people: people.filter((p) => p.mentions.length), df };
}

/**
 * The people a message names, or none. A name must be in the table and tied to one kind of person; a bare relation
 * must match one person, and never one of the relations people have many of ("my friend").
 */
export function peopleIn(message: string, index: PersonIndex): Person[] {
  const out = new Set<Person>();
  for (const f of relationsIn(message)) {
    if (f.name) {
      const p = index.people.find((x) => x.name === f.name);
      if (p) out.add(p);
      continue;
    }
    if (MANY.has(f.base)) continue;
    // A bare "my sister" matches every sister key; a keyed "my older sister" only its own.
    const bare = f.key === f.base;
    const matches = index.people.filter((p) => [...p.relations].some((k) => k === f.key || (bare && baseOf(k) === f.base)));
    if (matches.length === 1) out.add(matches[0]!);
  }
  for (const p of index.people) if (p.name && nameRe(p.name).test(message)) out.add(p);
  return [...out];
}

export const PEOPLE = "People the message names, pointers to the user's own mentions (search_history with the quoted words opens one):";
// shortcut: fixed sizes from the research's 40-80 token card; tune once a reader run shows how many pointers get opened.
export const CARD_TOKENS = 80;
export const MAX_CARDS = 2;
const QUERY_WORDS = 2;

export interface CardPointer extends TurnRef {
  date?: string;
  query: string;
}

export interface PersonCard {
  label: string;
  mentions: number;
  pointers: CardPointer[];
  line: string;
}

/**
 * One line per person: their label, how often the user mentioned them, and dated pointers, the mentions sharing the
 * most words with the message first, then the newest. Each pointer's search words are the person's word plus the
 * mention's rarest words, skipping private ones. `skip` drops turns the reader already has (the raw recent turns).
 */
export function personCard(person: Person, message: string, index: PersonIndex, skip: (ref: TurnRef) => boolean = () => false): PersonCard | undefined {
  const asked = new Set(contentWords(message));
  const own = new Set(contentWords(person.label));
  const mentions = person.mentions
    .filter((m) => !skip(m.ref))
    .map((m) => ({ m, overlap: [...asked].filter((w) => !own.has(w) && m.words.has(w)).length }))
    .sort((a, b) => b.overlap - a.overlap || (b.m.date ?? "").localeCompare(a.m.date ?? ""));
  if (!mentions.length) return undefined;
  const base = baseOf([...person.relations][0]!);
  const pointers: CardPointer[] = [];
  let line = `- ${person.label}, ${mentions.length} mention${mentions.length === 1 ? "" : "s"}:`;
  for (const { m } of mentions) {
    // The person's word as the user wrote it in this turn, so a search for it finds the turn ("mom", not "mother").
    const handle = person.name?.toLowerCase() ?? m.raw.find((w) => RELATIONS[w] === base) ?? base;
    const words: string[] = [];
    for (const w of [...new Set(m.raw)].sort((a, b) => rarity(a, index) - rarity(b, index))) {
      if (words.length >= QUERY_WORDS) break;
      const stem = contentWords(w)[0];
      if (!stem || own.has(stem) || w === handle || RELATIONS[w] === base || PRIVATE.test(w) || /^\d+$/.test(w)) continue;
      words.push(w);
    }
    const query = [handle, ...words].join(" ");
    const next = `${line} ${m.date?.split(" ")[0] ?? "undated"} "${query}";`;
    if (estimateTokens(`${PEOPLE}\n${next}`) > CARD_TOKENS) break;
    line = next;
    pointers.push({ ...m.ref, date: m.date, query });
  }
  return pointers.length ? { label: person.label, mentions: mentions.length, pointers, line: line.replace(/;$/, "") } : undefined;
}

const rarity = (w: string, index: PersonIndex) => {
  const stem = contentWords(w)[0];
  return stem ? (index.df.get(stem) ?? 0) : Infinity;
};
