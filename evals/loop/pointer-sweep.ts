// Pointer tier sweep (backlog P15): medium-confidence units (unit-gate probability between the profile's unitGate and
// pointerGate) come in as one-line pointers instead of whole units. Scores each pointerGate on the dev slice: recall with
// and without pointers as hits, false inclusions split into whole units and pointers, and whether each pointer's
// search_history query brings its unit back within the profile's searchResults. "Readable" all-evidence is the strict
// version of pointers-as-hits: every evidence turn is whole in the packet or behind a pointer, the pointers needed fit in
// the profile's search rounds, and each one's query brings its unit back.
//
//   node --experimental-strip-types evals/loop/pointer-sweep.ts --profile small-local --gates 0,0.02,0.05,0.1 --caps Infinity,1 [--json]

import { parseArgs } from "node:util";
import { buildPacket, profileByName, type PointerPick, type Profile } from "@beep/core";
import { embedderFor } from "../src/embedder.ts";
import { loadLongMemEval } from "../src/longmemeval.ts";
import { packetRecall, pointerOpens, readableRecall } from "../src/recall.ts";
import { buildProbes, DATA, devQuestions, loadTier1, runProbe, summarize, TIER1_TIME } from "./empty-rate.ts";

const { values } = parseArgs({ args: process.argv.slice(2), options: { profile: { type: "string" }, gates: { type: "string" }, caps: { type: "string" }, picks: { type: "string" }, promotes: { type: "string" }, floors: { type: "string" }, json: { type: "boolean" } } });
const base = profileByName(values.profile ?? "small-local")!;
const gates = (values.gates ?? "0").split(",").map(Number);
const caps = (values.caps ?? "Infinity").split(",").map(Number);
const picks = (values.picks ?? "rank").split(",") as PointerPick[];
// "off" leaves pointerPromote unset.
const promotes = (values.promotes ?? "off").split(",").map((x) => (x === "off" ? undefined : Number(x)));
const floors = (values.floors ?? "off").split(",").map((x) => (x === "off" ? undefined : Number(x)));
const embed = embedderFor(base);
const dev = devQuestions(loadLongMemEval(DATA));
const answerable = dev.filter((q) => !q.abstention);
const probes = buildProbes(dev, loadTier1(), { timePrompts: loadTier1(TIER1_TIME) });
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const pct = (x: number) => `${(x * 100).toFixed(1)}`;
const TYPES = ["multi-session", "temporal-reasoning", "single-session-preference"];

for (const pointerGate of gates) for (const maxPointers of caps) for (const pointerPick of picks) for (const pointerPromote of promotes) for (const pointerFloor of floors) {
  const profile: Profile = { ...base, pointerGate, maxPointers, pointerPick, pointerPromote, pointerFloor };
  let pointers = 0;
  let reachable = 0;
  const runs = answerable.map((q) => {
    const packet = buildPacket({ history: q.sessions, message: q.question, profile, embed });
    pointers += packet.pointers.length;
    reachable += packet.pointers.filter((p) => pointerOpens(q, p, profile)).length;
    return { q, tokens: packet.tokens, readable: readableRecall(q, packet, profile), ...packetRecall(q, packet, profile.segmentTokens) };
  });
  const tiers = summarize(probes.map((p) => runProbe(p, profile)));
  const row = (tier: string) => tiers.find((t) => t.tier === tier)!;
  // --json: one line per setting with per-question results, for grouped cross-validation of a pick.
  if (values.json) {
    const questions = runs.map((r) => ({ id: r.q.id, type: r.q.type, complete: r.complete, withPointers: r.completeWithPointers, readable: r.readable, tokens: r.tokens }));
    console.log(JSON.stringify({ pointerGate, maxPointers, pointerPick, pointerPromote, pointerFloor, questions, tiers }));
    continue;
  }
  const byType = TYPES.map((t) => {
    const r = runs.filter((x) => x.q.type === t);
    return `${t.split("-")[0]} ${pct(mean(r.map((x) => +x.complete)))}/${pct(mean(r.map((x) => +x.completeWithPointers)))}`;
  });
  console.log(
    [
      `## ${profile.name} pointerGate ${pointerGate} maxPointers ${maxPointers} pick ${pointerPick} promote ${pointerPromote ?? "off"} floor ${pointerFloor ?? "off"}`,
      `all-evidence whole ${pct(mean(runs.map((r) => +r.complete)))} | with pointers ${pct(mean(runs.map((r) => +r.completeWithPointers)))} | readable ${pct(mean(runs.map((r) => +r.readable)))} | turns whole ${pct(mean(runs.map((r) => r.turnRecall)))} | turns with pointers ${pct(mean(runs.map((r) => r.turnRecallWithPointers)))} | tokens ${mean(runs.map((r) => r.tokens)).toFixed(0)}`,
      `by type (whole/with pointers): ${byType.join(", ")}`,
      `pointers on answerable: ${(pointers / answerable.length).toFixed(2)} per question, ${pointers ? pct(reachable / pointers) : "n/a"}% reachable in top ${profile.searchResults}`,
      ...tiers.map(
        (t) =>
          `${t.tier}: empty ${pct(t.emptyRate)} | FI ${t.falseInclusions.toFixed(2)} (whole ${(t.falseInclusions - t.falsePointers).toFixed(2)}, pointers ${t.falsePointers.toFixed(2)}) | retrieved ${t.meanRetrievedTokens.toFixed(0)} (pointer ${t.meanPointerTokens.toFixed(0)}) | precision ${t.precision === null ? "n/a" : pct(t.precision)}`,
      ),
      `answerable empty ${pct(row("answerable").emptyRate)}`,
      "",
    ].join("\n"),
  );
}
