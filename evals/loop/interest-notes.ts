// Interest notes (backlog P31): what the rule noter saves and whether the packet's notes point at the evidence.
// No model, no judge, free, dev slice only.
//
//   node --experimental-strip-types evals/loop/interest-notes.ts                 # note recall + timing, both profiles
//   node --experimental-strip-types evals/loop/interest-notes.ts --dump 10       # every note on the first 10 dev histories, as JSON
//   node --experimental-strip-types evals/loop/interest-notes.ts --precision     # precision on the hand-labeled sample
//
// Note recall: for knowledge-update and single-session-preference dev questions, is a note whose source turn is an
// evidence turn in the packet. A one-line note is not the turn, so the standard recall scorer never credits it.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildPacket, PROFILES, type Profile } from "@beep/core";
import { extractNotes, notesFromTurn } from "../../packages/core/src/notes.ts";
import { loadLongMemEval } from "../src/longmemeval.ts";
import { packetRecall } from "../src/recall.ts";
import { DATA, devQuestions, distinctHistories } from "./empty-rate.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const SAMPLE = join(ROOT, "evals/sets/interest-notes/sample.json");
const TYPES = ["knowledge-update", "single-session-preference"];

const { values } = parseArgs({ options: { dump: { type: "string" }, sample: { type: "boolean", default: false }, precision: { type: "boolean", default: false } } });

if (values.precision) {
  const sample = JSON.parse(readFileSync(SAMPLE, "utf8")).notes as { real: boolean }[];
  const real = sample.filter((n) => n.real).length;
  const usable = sample.filter((n) => (n as { valueUsable?: boolean }).valueUsable).length;
  console.log(`Note precision on the labeled sample: real ${real}/${sample.length} = ${((real / sample.length) * 100).toFixed(1)}%, real with a usable value ${usable}/${sample.length} = ${((usable / sample.length) * 100).toFixed(1)}%`);
  process.exit(0);
}

const dev = devQuestions(loadLongMemEval(DATA));

if (values.dump) {
  const notes = distinctHistories(dev)
    .slice(0, Number(values.dump))
    .flatMap((q) =>
      extractNotes(q.sessions).map((n) => {
        const said = q.sessions.find((s) => s.id === n.from.sessionId)!.turns[n.from.turn]!.content;
        // The sentence the note came from, so a label can be checked without the history.
        const sentence = said.split(/(?<=[.!?])\s+|\n+/).find((s) => notesFromTurn(s, n.from).some((m) => m.value === n.value)) ?? "";
        return { history: q.id, ...n, sentence: sentence.slice(0, 300) };
      }),
    );
  if (!values.sample) {
    console.log(JSON.stringify(notes, null, 2));
    process.exit(0);
  }
  // Dev histories share filler chats, so the same saved sentence repeats; label each one once.
  const unique = [...new Map(notes.map((n) => [`${n.sentence}|${n.value}`, n])).values()];
  let seed = 31;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [unique[i], unique[j]] = [unique[j]!, unique[i]!];
  }
  console.error(`${notes.length} notes saved on ${values.dump} histories, ${unique.length} distinct; sampling ${Math.min(60, unique.length)}.`);
  console.log(JSON.stringify(unique.slice(0, 60).map(({ history, cue, topic, value, date, sentence }) => ({ history, cue, topic, value, date, sentence, real: null })), null, 2));
  process.exit(0);
}

const rows: string[] = ["| Profile | Type | Questions | All evidence (standard) | Note recall | Mean packet tokens | Mean notes shown |", "| --- | --- | ---: | ---: | ---: | ---: | ---: |"];
for (const profile of Object.values(PROFILES) as Profile[]) {
  for (const type of TYPES) {
    const qs = dev.filter((q) => q.type === type && !q.abstention);
    let complete = 0, noted = 0, tokens = 0, shown = 0;
    for (const q of qs) {
      const packet = buildPacket({ history: q.sessions, message: q.question, profile });
      complete += packetRecall(q, packet, profile.segmentTokens).complete ? 1 : 0;
      const hit = packet.notes.some((n) => q.evidence.turns.includes(`${n.from.sessionId}#${n.from.turn}`));
      noted += hit ? 1 : 0;
      tokens += packet.tokens;
      shown += packet.notes.length;
      if (packet.notes.length) console.error(`${profile.name} ${q.id} ${hit ? "EVIDENCE" : "other"}: ${packet.text.split("\n").filter((l) => l.startsWith("- ")).join(" | ")}`);
    }
    const pct = (n: number) => `${((n / qs.length) * 100).toFixed(1)}% (${n}/${qs.length})`;
    rows.push(`| ${profile.name} | ${type} | ${qs.length} | ${pct(complete)} | ${pct(noted)} | ${Math.round(tokens / qs.length)} | ${(shown / qs.length).toFixed(2)} |`);
  }
}
console.log(rows.join("\n"));

// The noter runs after every saved turn; this times a whole history at once, the worst case of a cold start.
const longest = [...dev].sort((a, b) => b.sessions.length - a.sessions.length)[0]!;
const runs = Array.from({ length: 7 }, () => {
  const t = performance.now();
  extractNotes(longest.sessions);
  return performance.now() - t;
}).sort((a, b) => a - b);
const turns = longest.sessions.reduce((a, s) => a + s.turns.length, 0);
console.log(`\nNoter time on one full history (${longest.id}, ${longest.sessions.length} chats, ${turns} turns): median ${runs[3]!.toFixed(1)} ms over 7 runs, ${((runs[3]! / turns) * 1000).toFixed(1)} µs per turn.`);
