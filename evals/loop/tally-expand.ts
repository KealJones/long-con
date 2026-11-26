// Tally-mode query expansion sweep (expand.ts): recall, false inclusions and per-question multi-session flips for each
// member weight, on both profiles. Dev slice only. Labels are read here, by the scorer, never by the builder.
//
//   node --experimental-strip-types --no-warnings evals/loop/tally-expand.ts [--weights 0,0.3,0.5,0.7] [--profile claude]

import { parseArgs } from "node:util";
import { buildPacket, PROFILES, profileByName, type Profile } from "@long-con/core";
import { loadLongMemEval } from "../src/longmemeval.ts";
import { packetRecall } from "../src/recall.ts";
import { buildProbes, DATA, devQuestions, loadTier1, scoreProfile } from "./empty-rate.ts";

const { values } = parseArgs({ options: { weights: { type: "string", default: "0,0.3,0.5,0.7" }, profile: { type: "string" } } });
const weights = values.weights.split(",").map(Number);
const profiles = values.profile ? [profileByName(values.profile)!] : Object.values(PROFILES);
const dev = devQuestions(loadLongMemEval(DATA));
const answerable = dev.filter((q) => !q.abstention);
const probes = buildProbes(dev, loadTier1());
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

for (const base of profiles as Profile[]) {
  let first: Map<string, boolean> | undefined;
  for (const w of weights) {
    const profile = { ...base, tallyExpand: w };
    const runs = answerable.map((q) => {
      const packet = buildPacket({ history: q.sessions, message: q.question, profile });
      return { q, tokens: packet.tokens, ...packetRecall(q, packet, profile.segmentTokens) };
    });
    const mean = (f: (r: (typeof runs)[number]) => number, rs = runs) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
    const multi = runs.filter((r) => r.q.type === "multi-session");
    const tiers = scoreProfile(probes, profile);
    const t = (name: string) => tiers.find((x) => x.tier === name)!;
    const flips = first ? multi.filter((r) => first!.get(r.q.id) !== r.complete).map((r) => `${r.q.id} ${r.complete ? "+" : "-"}`) : [];
    if (!first) first = new Map(multi.map((r) => [r.q.id, r.complete]));
    console.log(
      [
        `${base.name} w=${w}`,
        `all ${pct(mean((r) => +r.complete))}`,
        `turns ${pct(mean((r) => r.turnRecall))}`,
        `tok ${Math.round(mean((r) => r.tokens))}`,
        `multi ${pct(mean((r) => +r.complete, multi))} (${Math.round(mean((r) => r.tokens, multi))} tok, turns ${pct(mean((r) => r.turnRecall, multi))})`,
        ...["tier1-off-history", "tier2-cross-history", "tier3-evidence-ablated"].map(
          (n, i) => `t${i + 1} empty ${pct(t(n).emptyRate)} FI ${t(n).falseInclusions.toFixed(2)} (${Math.round(t(n).meanRetrievedTokens)} tok)`,
        ),
        `prec ${pct(t("answerable").precision ?? 0)}`,
        flips.length ? `flips: ${flips.join(", ")}` : "",
      ].join(" | "),
    );
  }
}
