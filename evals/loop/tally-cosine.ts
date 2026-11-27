// Tally cosine sweep: on counting questions, the embedding veto's cosine re-ranks tally pieces (tallyMix), floors them
// (tallyFloor) or sets how many come in (tallyBar). Prints the full recall and abstention rows, plus the counting-question
// subset: recall on answerable counting questions and false inclusions on should-be-empty prompts that trip isTallyQuestion.
//
//   node --experimental-strip-types evals/loop/tally-cosine.ts --profile claude --mixes 0,0.5,1 --floors off,0.3 --bars off,0.4 [--json out.jsonl]

import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { buildPacket, isTallyQuestion, profileByName, type Profile } from "@long-con/core";
import { embedderFor } from "../src/embedder.ts";
import { loadLongMemEval } from "../src/longmemeval.ts";
import { packetRecall, readableRecall } from "../src/recall.ts";
import { buildProbes, DATA, devQuestions, loadTier1, runProbe, summarize, TIER1_TIME } from "./empty-rate.ts";

const { values } = parseArgs({ args: process.argv.slice(2), options: { profile: { type: "string" }, mixes: { type: "string" }, floors: { type: "string" }, bars: { type: "string" }, json: { type: "string" } } });
const base = profileByName(values.profile ?? "claude")!;
const list = (s: string | undefined) => (s ?? "off").split(",").map((x) => (x === "off" ? undefined : Number(x)));
const embed = embedderFor(base);
const dev = devQuestions(loadLongMemEval(DATA));
const answerable = dev.filter((q) => !q.abstention);
const probes = buildProbes(dev, loadTier1(), { timePrompts: loadTier1(TIER1_TIME) });
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const pct = (x: number) => (x * 100).toFixed(1);
const TYPES = [...new Set(answerable.map((q) => q.type))].sort();
const SHOULD_BE_EMPTY = ["tier1-off-history", "tier1t-time-phrases", "tier2-cross-history", "tier3-evidence-ablated"];

for (const tallyMix of list(values.mixes ?? "0")) for (const tallyFloor of list(values.floors)) for (const tallyBar of list(values.bars)) {
  const profile: Profile = { ...base, tallyMix, tallyFloor, tallyBar };
  const runs = answerable.map((q) => {
    const packet = buildPacket({ history: q.sessions, message: q.question, profile, embed });
    return { q, tally: isTallyQuestion(q.question), tokens: packet.tokens, readable: readableRecall(q, packet, profile), ...packetRecall(q, packet, profile.segmentTokens) };
  });
  const results = probes.map((p) => runProbe(p, profile));
  const tiers = summarize(results);
  const tallyEmpty = results.filter((r) => SHOULD_BE_EMPTY.includes(r.probe.tier) && isTallyQuestion(r.probe.message));
  const tallyFI = SHOULD_BE_EMPTY.map((t) => {
    const rs = tallyEmpty.filter((r) => r.probe.tier === t);
    return `${t.split("-")[0]} ${mean(rs.map((r) => r.units - r.evidenceUnits)).toFixed(2)} (${mean(rs.map((r) => r.retrievedTokens)).toFixed(0)}, n=${rs.length})`;
  });
  const setting = `mix ${tallyMix ?? 0} floor ${tallyFloor ?? "off"} bar ${tallyBar ?? "off"}`;
  if (values.json) {
    const questions = runs.map((r) => ({ id: r.q.id, type: r.q.type, tally: r.tally, complete: r.complete, withPointers: r.completeWithPointers, readable: r.readable, turns: r.turnRecall, tokens: r.tokens }));
    const prompts = results.filter((r) => SHOULD_BE_EMPTY.includes(r.probe.tier)).map((r) => ({ tier: r.probe.tier, id: r.probe.id, tally: isTallyQuestion(r.probe.message), fi: r.units - r.evidenceUnits, retrieved: r.retrievedTokens }));
    appendFileSync(values.json, JSON.stringify({ tallyMix, tallyFloor, tallyBar, questions, prompts, tiers }) + "\n");
  }
  const t = runs.filter((r) => r.tally);
  console.log(
    [
      `## ${profile.name} ${setting}`,
      `all-evidence whole ${pct(mean(runs.map((r) => +r.complete)))} | with pointers ${pct(mean(runs.map((r) => +r.completeWithPointers)))} | readable ${pct(mean(runs.map((r) => +r.readable)))} | turns ${pct(mean(runs.map((r) => r.turnRecall)))} (with pointers ${pct(mean(runs.map((r) => r.turnRecallWithPointers)))}) | tokens ${mean(runs.map((r) => r.tokens)).toFixed(0)}`,
      `by type: ${TYPES.map((ty) => `${ty} ${pct(mean(runs.filter((r) => r.q.type === ty).map((r) => +r.complete)))}`).join(", ")}`,
      `tally subset (${t.length} answerable): all-evidence ${pct(mean(t.map((r) => +r.complete)))} | turns ${pct(mean(t.map((r) => r.turnRecall)))} | tokens ${mean(t.map((r) => r.tokens)).toFixed(0)}`,
      `tally-trip FI on should-be-empty (retrieved): ${tallyFI.join(", ")}`,
      ...tiers.map((x) => `${x.tier}: empty ${pct(x.emptyRate)} | FI ${x.falseInclusions.toFixed(2)} | retrieved ${x.meanRetrievedTokens.toFixed(0)} | precision ${x.precision === null ? "n/a" : pct(x.precision)}`),
      "",
    ].join("\n"),
  );
}
