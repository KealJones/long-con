// Scratch analysis (P28): for each multi-session dev question, where its missing evidence sits in today's search.
import { readFileSync } from "node:fs";
import { buildPacket, PROFILES, searchUnits, unitProbability, isTallyQuestion } from "@long-con/core";
import { graphSearch } from "../../packages/core/src/phrasegraph.ts";
import { loadLongMemEval } from "../src/longmemeval.ts";
import { DATA, SLICE } from "./empty-rate.ts";

const ids = new Set<string>(JSON.parse(readFileSync(SLICE, "utf8")).ids ?? JSON.parse(readFileSync(SLICE, "utf8")));
const qs = loadLongMemEval(DATA).filter((q) => ids.has(q.id) && !q.abstention && q.type === (process.argv[2] ?? "multi-session"));
const profile = PROFILES.claude;
for (const q of qs) {
  const packet = buildPacket({ history: q.sessions, message: q.question, profile });
  const { hits } = searchUnits(q.sessions, q.question, profile.segmentTokens, undefined, 0, profile.stemmer, profile.gateKey);
  const walk = graphSearch(q.sessions, q.question, profile.segmentTokens, undefined, 0, profile.stemmer);
  console.log(`\n## walk=${walk.length} ${q.id} tally=${isTallyQuestion(q.question)} :: ${q.question}`);
  for (const key of q.evidence.turns) {
    const at = key.lastIndexOf("#");
    const sid = key.slice(0, at), t = Number(key.slice(at + 1));
    const inPacket = packet.segments.some((s) => s.sessionId === sid && t >= s.start && t <= s.end);
    const i = hits.findIndex((h) => h.hit.item.sessionId === sid && t >= h.hit.item.start && t <= h.hit.item.end);
    const h = hits[i];
    const w = walk.findIndex((h) => h.item.sessionId === sid && t >= h.item.start && t <= h.item.end);
    const content = q.sessions.find((s) => s.id === sid)?.turns[t]?.content ?? "";
    console.log(`  ${inPacket ? "IN " : "OUT"} rank=${i} conf=${h?.confidence.toFixed(2)} p=${h ? unitProbability(h.features).toFixed(4) : "-"} walk=${w} matched=${h?.hit.matched.join(",")} :: ${content.slice(0, 140).replace(/\n/g, " ")}`);
  }
}
