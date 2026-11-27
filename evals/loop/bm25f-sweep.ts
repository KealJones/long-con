// P17 BM25F sweep on the dev slice: for each field setting, recall on the answerable questions and the empty-rate tiers,
// both profiles, in one process (the dataset loads once). Also a SHA-256 over every packet text, so a setting that should
// leave a profile untouched can be proven byte-identical. Free: no model calls, dev slice only.
//
//   node --experimental-strip-types evals/loop/bm25f-sweep.ts [--profile claude] [--variants off,2:0.75:0.75,3:0.5:0.75]
//
// A variant is "off" (today's two-ranking fusion) or user-weight:bUser:bAssistant, with ":share" to keep today's
// relative confidence (BM25F then only orders the units) or ":fuse" to add BM25F as a third RRF list.

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildPacket, PROFILES, profileByName, type FieldWeights, type Packet, type Profile } from "@long-con/core";
import { loadLongMemEval, type Question } from "../src/longmemeval.ts";
import { packetRecall } from "../src/recall.ts";
import { buildProbes, DATA, devQuestions, loadTier1, runProbe, summarize, TIER1_TIME, type Probe } from "./empty-rate.ts";

export function parseVariant(v: string): FieldWeights | undefined {
  if (v === "off") return undefined;
  const parts = v.split(":");
  const flags = parts.slice(3);
  const [user, bUser, bAssistant] = parts.slice(0, 3).map(Number);
  if (![user, bUser, bAssistant].every((x) => Number.isFinite(x))) throw new Error(`bad variant ${v}`);
  return { user: user!, bUser: bUser!, bAssistant: bAssistant!, ...(flags.includes("share") ? { keepShare: true } : {}), ...(flags.includes("fuse") ? { fuse: true } : {}) };
}

function main(argv: string[]) {
  const { values } = parseArgs({ args: argv, options: { profile: { type: "string" }, variants: { type: "string" } } });
  const dev = devQuestions(loadLongMemEval(DATA));
  const byId = new Map<string, Question>(dev.map((q) => [q.id, q]));
  const probes = buildProbes(dev, loadTier1(), { timePrompts: loadTier1(TIER1_TIME) });
  const profiles = values.profile ? [profileByName(values.profile)!] : Object.values(PROFILES);
  const variants = (values.variants ?? "off").split(",");
  const pct = (x: number) => (x * 100).toFixed(1);
  console.log("| profile | variant | all-ev | +ptr | turns | +ptr | tokens | multi | temporal | pref | t1 FI (retr) | t1t FI (retr) | t2 FI (retr) | t3 FI (retr) | empty t1/t1t/t2/t3 | ans empty | precision | sha256 |");
  console.log("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- |");
  for (const base of profiles as Profile[]) {
    for (const v of variants) {
      const profile: Profile = { ...base, fields: parseVariant(v) };
      const hash = createHash("sha256");
      const recall: { q: Question; r: ReturnType<typeof packetRecall> }[] = [];
      const results = probes.map((p: Probe) =>
        runProbe(p, profile, (probe) => {
          const packet: Packet = buildPacket({ history: probe.history, message: probe.message, profile });
          hash.update(`${probe.tier}|${probe.id}\n${packet.text}\n`);
          if (probe.tier === "answerable") recall.push({ q: byId.get(probe.id)!, r: packetRecall(byId.get(probe.id)!, packet, profile.segmentTokens) });
          return packet;
        }),
      );
      const tiers = summarize(results);
      const t = (name: string) => tiers.find((x) => x.tier === name)!;
      const mean = (rs: typeof recall, f: (r: (typeof recall)[number]["r"]) => number) => rs.reduce((a, x) => a + f(x.r), 0) / (rs.length || 1);
      const type = (name: string) => pct(mean(recall.filter((x) => x.q.type === name), (r) => +r.complete));
      const fi = (name: string) => `${t(name).falseInclusions.toFixed(2)} (${Math.round(t(name).meanRetrievedTokens)})`;
      const names = ["tier1-off-history", "tier1t-time-phrases", "tier2-cross-history", "tier3-evidence-ablated"];
      console.log(
        `| ${base.name} | ${v} | ${pct(mean(recall, (r) => +r.complete))} | ${pct(mean(recall, (r) => +r.completeWithPointers))} | ${pct(mean(recall, (r) => r.turnRecall))} | ${pct(mean(recall, (r) => r.turnRecallWithPointers))} | ${Math.round(t("answerable").meanTokens)} | ${type("multi-session")} | ${type("temporal-reasoning")} | ${type("single-session-preference")} | ${names.map(fi).join(" | ")} | ${names.map((n) => pct(t(n).emptyRate)).join("/")} | ${pct(t("answerable").emptyRate)} | ${pct(t("answerable").precision ?? 0)} | ${hash.digest("hex").slice(0, 16)} |`,
      );
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
