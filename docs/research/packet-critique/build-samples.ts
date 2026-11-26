// Builds the sample packets in samples.md. Run from the repo root after evals/scripts/fetch-longmemeval.sh:
// node --experimental-strip-types docs/research/packet-critique/build-samples.ts docs/research/packet-critique/real-samples.md
// (samples.md is that output with a short header on top.)
import { buildPacket, PROFILES, type Session, type Profile } from "../../../packages/core/src/index.ts";
import { loadLongMemEval } from "../../../evals/src/longmemeval.ts";
import { writeFileSync } from "node:fs";

const out: string[] = [];
const leaks: string[] = [];
function emit(title: string, history: Session[], message: string, current?: string, note = "") {
  for (const profile of [PROFILES.claude, PROFILES.smallLocal] as Profile[]) {
    const p = buildPacket({ history, message, profile, currentSessionId: current });
    if (/answer_|has_answer|answer_session/.test(p.text)) leaks.push(`${title} @ ${profile.name}`);
    out.push(`## ${title} — ${profile.name} profile (ceiling ${profile.packetTokens}, built ${p.tokens} tokens, retrieval ${p.retrieved ? "ran" : "skipped"}, resolver ${p.resolution.status})`);
    if (note) out.push(note);
    out.push(`New message: ${JSON.stringify(message)}`, "", "Packet as the model reads it:", "```text", p.text, "```");
    if (p.recentTurns.length) {
      out.push("", "Recent turns riding along raw after the packet:", "```text", ...p.recentTurns.map((t) => `${t.role}: ${t.content}`), "```");
    }
    out.push("");
  }
}

// ---------- Made-up realistic chats ----------
const older: Session[] = [
  { id: "a", date: "2026/10/02 (Fri) 21:14", turns: [
    { role: "user", content: "ok so for the tilde repo from now on always write typescript, never suggest python for it. and remember to keep deps at zero if you can" },
    { role: "assistant", content: "Got it: TypeScript only for tilde, and no new dependencies unless there's no way around it." },
    { role: "user", content: "cool. whats the fastest way to get webgpu adapter info without blocking first paint" },
    { role: "assistant", content: "Request the adapter inside requestIdleCallback after first paint, then read adapter.info. Cache the result in sessionStorage so reloads skip it." },
  ]},
  { id: "b", date: "2026/10/20 (Tue) 18:02", turns: [
    { role: "user", content: "rent is 2900 total, im paying 60 percent and my roommate pays the rest. whats my share" },
    { role: "assistant", content: "Your share is $1,450 a month." },
    { role: "user", content: "no thats wrong, its 60/40 not even" },
    { role: "assistant", content: "Sorry, you're right. 60% of $2,900 is $1,740 a month, and your roommate pays $1,160." },
    { role: "user", content: "ok perfect, multiply it by 12" },
    { role: "assistant", content: "$1,740 × 12 = $20,880 a year." },
  ]},
  { id: "c", date: "2026/11/10 (Tue) 09:30", turns: [
    { role: "user", content: "whats the cheapest way to get from phoenix to san diego for thanksgiving, me emmy and dash" },
    { role: "assistant", content: "Three options:\n1. Drive: about 5 hours, roughly $48 in gas each way for the car.\n2. Fly Southwest: about $129 each, so around $390 each way for three.\n3. Amtrak: about 9 hours with a bus connection, $62 each.\nWant me to check fares for the Wednesday before?" },
    { role: "user", content: "driving prob, dash gets carsick on planes anyway" },
    { role: "assistant", content: "Driving makes sense. Leave before 6am Wednesday to beat the I-8 traffic, and stop in Yuma for a break." },
  ]},
];
const current: Session = { id: "d", date: "2026/11/25 (Wed) 20:40", turns: [
  { role: "user", content: "ok the weekend after thanksgiving i wanna hit a hike near san diego, give me a few" },
  { role: "assistant", content: "Here are a few:\n1. Cowles Mountain: 3 miles round trip, steep, great sunrise view.\n2. Torrey Pines: 2 miles of easy coastal trails, parking fills up by 9am.\n3. Potato Chip Rock: 7.5 miles, hot and exposed, long line for the photo." },
  { role: "user", content: "dash is 7 so nothing crazy" },
  { role: "assistant", content: "Then Torrey Pines is the best fit: short, flat, and the beach is at the bottom." },
]};
const all = [...older, current];

emit("S1 Ordinal follow-up resolved", all, "ok what about the third one tho, is it doable", "d",
  "Meant to exercise: history notice, trust note, standing rules, resolver 'resolved', own recent answers, retrieval.");
emit("S2 Ordinal follow-up unsure ('the other one' with three items)", all, "nah the other one", "d",
  "Meant to exercise: resolver 'unsure'.");
emit("S3 Near-empty packet: a thanks", all, "thanks!!", "d", "Meant to exercise: gate closing, near-empty packet.");
emit("S4 New chat asking about something old (rejected answer in history)", older, "wait what did we land on for my rent share again", undefined,
  "Meant to exercise: a rejected answer marked and left out; no current session, so no recent turns.");
const budget: Session = { id: "e", date: "2026/11/25 (Wed) 21:05", turns: [
  { role: "user", content: "if i put 450 a month into the hysa at 4.1 percent how much after a year, roughly" },
  { role: "assistant", content: "About $5,500: $5,400 in deposits plus roughly $100 in interest." },
]};
emit("S5 Arithmetic on 'it' resolved from results", [...older, budget], "now double it", "e", "Meant to exercise: results register and resolver 'resolved' via a number.");
emit("S6 Arithmetic on 'it' with no number (unsure)", [...older, current], "multiply it by 3", "d", "Meant to exercise: resolver 'unsure' with no earlier number in the recent turns.");
emit("S7 Tool-ish request leaning on rules", all, "write me a tiny script to log the webgpu adapter info for tilde", "d", "Meant to exercise: rules register doing its job on a coding ask.");

const longCurrent: Session = { id: "f", date: "2026/11/25 (Wed) 22:10", turns: [
  { role: "user", content: "ok switching to the tilde loader, should the model weights stream or load all at once" },
  { role: "assistant", content: "Stream them. Fetch shards with a ReadableStream and upload each to a GPU buffer as it lands, so first token comes sooner." },
  { role: "user", content: "what shard size" },
  { role: "assistant", content: "Around 64 MB. Big enough to keep the fetches efficient, small enough that a failed shard is cheap to retry." },
  { role: "user", content: "and cache them where, cache api or opfs" },
  { role: "assistant", content: "OPFS. It handles large binary files better than the Cache API and you can write to it from a worker." },
  { role: "user", content: "ok cool and if opfs isnt there" },
  { role: "assistant", content: "Fall back to the Cache API, and if that's missing too, just stream from the network every time." },
  { role: "user", content: "makes sense" },
  { role: "assistant", content: "One more thing: check navigator.storage.estimate() first so you don't start a 1.2 GB download on a phone with no room." },
]};
emit("S8 Long current session (own recent answers register)", [...older, longCurrent], "wait so what shard size did you say and why", "f",
  "Meant to exercise: the model's own recent answers outside the raw window.");

// ---------- LongMemEval ----------
const qs = loadLongMemEval(new URL("../../../evals/data/longmemeval/longmemeval_s_cleaned.json", import.meta.url).pathname);
for (const id of ["18bc8abd", "gpt4_6ed717ea", "6d550036", "60bf93ed_abs"]) {
  const q = qs.find((x) => x.id === id)!;
  emit(`LME ${q.type} (${id})`, q.sessions, q.question, undefined,
    `LongMemEval question asked on ${q.date} (the packet itself does not carry this date).`);
}

writeFileSync(process.argv[2]!, out.join("\n"));
console.log("leaks:", leaks.length ? leaks : "none");
