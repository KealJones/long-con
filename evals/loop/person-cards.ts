// Person-card scorer (backlog P24): each profile with and without the person index, dev slice only, free.
// Recall on all answerable questions and on the person-centric ones, empty-rate tiers 1/1t/2/3 with card pointers
// counted as inclusions, and the should-be-empty person probes (evals/sets/person-probes, dev split only).
//
//   node --experimental-strip-types --no-warnings evals/loop/person-cards.ts [--profile claude]
//
// Person-centric rule, fixed before any card was scored: a question is person-centric when its text holds one of the
// relation words below as a whole word (any case). Names alone don't count: on question text a capitalized word is as
// often a place or brand as a person.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { buildPacket, buildPersonIndex, estimateTokens, PEOPLE, PROFILES, profileByName, type PersonIndex, type Profile, type Session } from "@long-con/core";
import { loadLongMemEval, type Question } from "../src/longmemeval.ts";
import { packetRecall } from "../src/recall.ts";
import { buildProbes, DATA, devQuestions, loadTier1, runProbe, summarize, TIER1_TIME, type Probe } from "./empty-rate.ts";
import { splitOf } from "./split.ts";

export const PERSON_CENTRIC =
  /\b(?:mom|mum|mother|dad|father|parents?|wife|husband|partner|spouse|boyfriend|girlfriend|fianc[eé]e?|sisters?|brothers?|siblings?|sons?|daughters?|kids?|child|children|grandma|grandmother|grandpa|grandfather|grandparents?|aunts?|uncles?|cousins?|nieces?|nephews?|friends?|roommates?|neighbou?rs?|boss|manager|co-?workers?|colleagues?|teammates?|classmates?|mentor|in-laws?)\b/i;

interface PersonProbe {
  id: string;
  kind: string;
  prompt: string;
  match: string;
  split: string;
}

const { values } = parseArgs({ args: process.argv.slice(2), options: { profile: { type: "string" } } });
const profiles = values.profile ? [profileByName(values.profile)!] : Object.values(PROFILES);
const dev = devQuestions(loadLongMemEval(DATA));
const answerable = dev.filter((q) => !q.abstention);
const centric = answerable.filter((q) => PERSON_CENTRIC.test(q.question));
const set = JSON.parse(readFileSync(new URL("../sets/person-probes/prompts.json", import.meta.url), "utf8")) as { prompts: PersonProbe[] };
// Only the dev split runs; the file's split field must agree with the shared hash split.
const personProbes = set.prompts.filter((p) => {
  if (p.split !== splitOf(p.id)) throw new Error(`${p.id}: split field disagrees with split.ts`);
  return p.split === "dev";
});

const indexes = new Map<Session[], PersonIndex>();
const indexOf = (h: Session[]) => indexes.get(h) ?? indexes.set(h, buildPersonIndex(h)).get(h)!;
const build = (profile: Profile, on: boolean) => (p: { history: Session[]; message: string }) =>
  buildPacket({ history: p.history, message: p.message, profile, people: on ? indexOf(p.history) : undefined });
const cardTokens = (text: string) => {
  const at = text.indexOf(PEOPLE);
  if (at < 0) return 0;
  const after = text.slice(at).split("\n");
  const end = after.findIndex((l, i) => i > 0 && !l.startsWith("- "));
  return estimateTokens(after.slice(0, end < 0 ? undefined : end).join("\n"));
};

const histories = [...new Map(dev.map((q) => [q.id.replace(/_abs$/, ""), q.sessions])).values()];
const personRuns: Probe[] = [];
for (const p of personProbes)
  histories.forEach((h, i) => {
    const needle = p.match.toLowerCase();
    if (h.some((s) => s.turns.some((t) => t.content.toLowerCase().includes(needle)))) return;
    personRuns.push({ tier: "tier1-off-history", id: `${p.id}@${i}`, message: p.prompt, history: h });
  });
const probes = buildProbes(dev, loadTier1(), { timePrompts: loadTier1(TIER1_TIME) });

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const pct = (x: number) => (x * 100).toFixed(1);

function recall(qs: Question[], profile: Profile, on: boolean) {
  const runs = qs.map((q) => {
    const packet = build(profile, on)({ history: q.sessions, message: q.question });
    return { tokens: packet.tokens, cards: packet.people.length, card: cardTokens(packet.text), ...packetRecall(q, packet, profile.segmentTokens) };
  });
  return {
    whole: mean(runs.map((r) => +r.complete)),
    withPointers: mean(runs.map((r) => +r.completeWithPointers)),
    turns: mean(runs.map((r) => r.turnRecall)),
    turnsWithPointers: mean(runs.map((r) => r.turnRecallWithPointers)),
    tokens: mean(runs.map((r) => r.tokens)),
    fired: runs.filter((r) => r.cards).length,
    cardTokens: mean(runs.map((r) => r.card)),
  };
}

console.log(`dev answerable ${answerable.length}, person-centric by rule ${centric.length}: ${centric.map((q) => q.id).join(", ")}`);
console.log(`person probes: ${personProbes.length} dev prompts, ${personRuns.length} prompt x history pairs\n`);
for (const profile of profiles) {
  console.log(`## ${profile.name}`);
  for (const on of [false, true]) {
    for (const [name, qs] of [["all answerable", answerable], ["person-centric", centric]] as const) {
      const r = recall(qs, profile, on);
      console.log(
        `${on ? "cards on " : "cards off"} | ${name}: all-evidence whole ${pct(r.whole)} / with pointers ${pct(r.withPointers)} | turns ${pct(r.turns)} / ${pct(r.turnsWithPointers)} | tokens ${r.tokens.toFixed(0)} | cards fired ${r.fired}/${qs.length}, card tokens ${r.cardTokens.toFixed(1)}`,
      );
    }
    // Records which probes got a card, so each packet is built once.
    const carded = new Set<Probe>();
    const counting = (p: Probe) => {
      const packet = build(profile, on)(p);
      if (packet.people.length) carded.add(p);
      return packet;
    };
    const results = probes.map((p) => runProbe(p, profile, counting));
    for (const t of summarize(results).filter((t) => t.tier !== "tier4-abstention")) {
      const fired = results.filter((r) => r.probe.tier === t.tier && carded.has(r.probe)).length;
      console.log(
        `  ${t.tier}: empty ${pct(t.emptyRate)} | FI ${t.falseInclusions.toFixed(2)} (pointers ${t.falsePointers.toFixed(2)}) | retrieved ${t.meanRetrievedTokens.toFixed(0)} | precision ${t.precision === null ? "n/a" : pct(t.precision)} | cards fired ${fired}/${t.prompts}`,
      );
    }
    const [s] = summarize(personRuns.map((p) => runProbe(p, profile, counting)));
    console.log(`  person probes: empty ${pct(s!.emptyRate)} | FI ${s!.falseInclusions.toFixed(2)} | retrieved ${s!.meanRetrievedTokens.toFixed(0)} | cards fired ${personRuns.filter((p) => carded.has(p)).length}/${personRuns.length}`);
  }
  console.log("");
}
