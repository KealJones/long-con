// search_history tool marks: the packet abstains when unsure, the tool returns weak hits marked low confidence. This
// scores those marks on the dev slice, free: for answerable questions, is evidence in the tool's top results and is it
// marked strong; for the should-be-empty tiers of empty-rate.ts, how many hits get a strong mark. Sweeps the tool's
// cosine floor (embedFloor; 0 is the tool before it took the veto) over one search per query.
//
//   node --experimental-strip-types evals/loop/search-tool.ts --profile claude [--floors 0,0.2]
//
// Queries: each answerable question as asked, plus (profiles with pointers) the query of every pointer its packet renders.

import { parseArgs } from "node:util";
import { buildPacket, markResults, profileByName, searchUnits, unitSimilarity, type Profile, type SearchResult, type Session } from "@long-con/core";
import { embedderFor } from "../src/embedder.ts";
import { loadLongMemEval, type Question } from "../src/longmemeval.ts";
import { buildProbes, DATA, devQuestions, isEvidenceUnit, loadTier1, TIER1_TIME, type TierName } from "./empty-rate.ts";

const { values } = parseArgs({ args: process.argv.slice(2), options: { profile: { type: "string" }, floors: { type: "string" } } });
const base = profileByName(values.profile ?? "claude")!;
const list = (s: string | undefined, d: string) => (s ?? d).split(",").map(Number);
const floors = list(values.floors, `0,0.1,0.15,0.2,0.25,0.3`);
const embed = embedderFor(base);
if (!embed) throw new Error("No embedder; run evals/scripts/fetch-embedders.sh");
const dev = devQuestions(loadLongMemEval(DATA));
const answerable = dev.filter((q) => !q.abstention);
const probes = buildProbes(dev, loadTier1(), { timePrompts: loadTier1(TIER1_TIME) }).filter((p) => p.tier !== "tier4-abstention" && p.tier !== "answerable");

/** One search per query, kept so every setting re-marks the same hits. */
const search = (history: Session[], query: string) => ({
  hits: searchUnits(history, query, base.segmentTokens, undefined, 0, base.stemmer, base.gateKey).hits,
  sim: unitSimilarity(embed, query, base.embedSim ?? "maxsim"),
});
const asked = answerable.map((q) => ({ q, ...search(q.sessions, q.question) }));
const pointed = base.pointerGate > 0
  ? answerable.flatMap((q) => buildPacket({ history: q.sessions, message: q.question, profile: base, embed }).pointers.map((p) => ({ q, p, ...search(q.sessions, p.query) })))
  : [];
const empty = probes.map((p) => ({ tier: p.tier, ...search(p.history, p.message) }));
const TIERS: TierName[] = ["tier1-off-history", "tier1t-time-phrases", "tier2-cross-history", "tier3-evidence-ablated"];

const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) : "n/a");
const ev = (q: Question, r: SearchResult) => isEvidenceUnit({ sessionId: r.segment.sessionId, start: r.segment.start, end: r.segment.end }, q.evidence);
const lines = [
  `# search_history marks, ${base.name} (top ${base.searchResults}), ${answerable.length} answerable dev questions, ${pointed.length} pointer queries, ${empty.length} should-be-empty prompts`,
  "",
  "| floor | ev found % | ev strong % | ev hits low | false strong / q | ptr ev opens | ptr ev strong | ptr false strong | strong/prompt t1 · t1t · t2 · t3 | all-low prompts t1 · t1t · t2 · t3 % |",
  "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |",
];
for (const floor of floors) {
  const profile: Profile = { ...base, embedFloor: floor };
  const mark = (s: ReturnType<typeof search>) => markResults(s.hits, profile, s.sim);
  let found = 0, strongFound = 0, evHits = 0, evLow = 0, falseStrong = 0;
  for (const a of asked) {
    const rs = mark(a);
    const e = rs.filter((r) => ev(a.q, r));
    found += +(e.length > 0);
    strongFound += +e.some((r) => r.strong);
    evHits += e.length;
    evLow += e.filter((r) => !r.strong).length;
    falseStrong += rs.filter((r) => r.strong && !ev(a.q, r)).length;
  }
  // A pointer opens when its own unit comes back in the top results.
  let pEv = 0, pOpen = 0, pStrong = 0, pFalse = 0;
  for (const x of pointed) {
    const rs = mark(x);
    const own = rs.find((r) => r.segment.sessionId === x.p.sessionId && r.segment.start === x.p.start && r.segment.end === x.p.end);
    if (isEvidenceUnit(x.p, x.q.evidence)) {
      pEv++;
      pOpen += +!!own;
      pStrong += +!!own?.strong;
    }
    pFalse += rs.filter((r) => r.strong && !ev(x.q, r)).length;
  }
  const tier = TIERS.map((t) => {
    const rs = empty.filter((e) => e.tier === t).map((e) => mark(e).filter((r) => r.strong).length);
    return { perPrompt: (rs.reduce((a, b) => a + b, 0) / (rs.length || 1)).toFixed(2), allLow: pct(rs.filter((n) => n === 0).length, rs.length) };
  });
  lines.push(
    `| ${floor} | ${pct(found, asked.length)} | ${pct(strongFound, asked.length)} | ${evLow}/${evHits} | ${(falseStrong / asked.length).toFixed(2)} | ${pointed.length ? `${pOpen}/${pEv}` : "-"} | ${pointed.length ? `${pStrong}/${pEv}` : "-"} | ${pointed.length ? (pFalse / pointed.length).toFixed(2) : "-"} | ${tier.map((t) => t.perPrompt).join(" · ")} | ${tier.map((t) => t.allLow).join(" · ")} |`,
  );
}
console.log(lines.join("\n"));
