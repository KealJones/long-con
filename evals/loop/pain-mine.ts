// Pain miner (evals/README.md, "Pain-mined"): finds the moments in a real Claude.ai export where memory failed or a
// follow-up leaned on what was just said, and writes them out for labeling. Free, no model calls.
//
//   node --experimental-strip-types evals/loop/pain-mine.ts path/to/conversations.json [--out evals/data/pain/candidates.jsonl]
//
// Get the export from claude.ai: Settings, Privacy, Export data. It arrives by email as a zip; conversations.json is in it.
// The output goes under evals/data/, which git ignores, since it's real chats.
//
// Kinds:
//   failure   "you forgot", "I already told you", "that's wrong": the turn before it is a miss, and what was missed is the label
//   ack       a bare "go" / "yes": the label is which offer it took up
//   bundle    "do all that": the label is the set of open offers
//   result    "multiply it by 32": the label is the number "it" meant
//   ordinal   "the second one": the label is the list item
//   update    "actually it's the 24th": the label is the fact it replaces
//   rule      "from now on always…": the label is the rule and its scope

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { extractRules } from "@long-con/core";
import { isAck, isBundle } from "../../packages/core/src/registers.ts";

interface ExportMessage {
  sender: "human" | "assistant";
  text?: string;
  content?: { type: string; text?: string }[];
  created_at?: string;
}
interface ExportChat {
  uuid: string;
  name?: string;
  chat_messages?: ExportMessage[];
}
export interface Candidate {
  kind: string;
  chat: string;
  title: string;
  index: number;
  date?: string;
  message: string;
  /** The assistant turn before it, clipped: most labels are read off this. */
  before: string;
}

const FAILURE =
  /\b(?:you forgot|you missed|you didn'?t (?:remember|include)|i (?:already )?(?:told|said|mentioned) (?:you|that|this)|as i said|like i said|we already (?:decided|talked|did)|that'?s (?:wrong|not right|not what)|not what i asked|look at our (?:past|previous|old) chats|re-?read|scroll up|te dije|ya te dije|te olvidaste)\b/i;
const RESULT = /\b(?:multipl\w*|times|divide\w*|double|triple|halve|plus|minus|percent|%)\b.*\b(?:it|that|this)\b|\b(?:it|that|this)\b.*\b(?:multipl\w*|times|divide\w*|plus|minus)\b/i;
const ORDINAL = /\b(?:first|second|third|fourth|fifth|last|other) (?:one|option|item|choice|idea)\b/i;
const UPDATE = /^\s*(?:actually|correction|scratch that|update:|en realidad)\b/i;

const textOf = (m: ExportMessage) => m.text?.trim() || (m.content ?? []).map((c) => c.text ?? "").join("\n").trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function kindsOf(message: string): string[] {
  const kinds: string[] = [];
  if (FAILURE.test(message)) kinds.push("failure");
  if (isBundle(message)) kinds.push("bundle");
  else if (isAck(message)) kinds.push("ack");
  if (RESULT.test(message)) kinds.push("result");
  if (ORDINAL.test(message)) kinds.push("ordinal");
  if (UPDATE.test(message)) kinds.push("update");
  if (extractRules(message).length) kinds.push("rule");
  return kinds;
}

export function mine(chats: ExportChat[]): Candidate[] {
  const out: Candidate[] = [];
  for (const chat of chats) {
    const messages = chat.chat_messages ?? [];
    messages.forEach((m, index) => {
      if (m.sender !== "human") return;
      const message = textOf(m);
      const before = [...messages.slice(0, index)].reverse().find((p) => p.sender === "assistant");
      for (const kind of kindsOf(message)) {
        out.push({ kind, chat: chat.uuid, title: chat.name ?? "", index, date: m.created_at, message: clip(message, 600), before: before ? clip(textOf(before), 1200) : "" });
      }
    });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: "string", default: "evals/data/pain/candidates.jsonl" } } });
  if (!positionals[0]) {
    console.error("usage: pain-mine.ts path/to/conversations.json [--out file]");
    process.exit(1);
  }
  const found = mine(JSON.parse(readFileSync(positionals[0], "utf8")) as ExportChat[]);
  mkdirSync(dirname(values.out!), { recursive: true });
  writeFileSync(values.out!, found.map((c) => JSON.stringify(c)).join("\n") + "\n");
  const tally = new Map<string, number>();
  for (const c of found) tally.set(c.kind, (tally.get(c.kind) ?? 0) + 1);
  const counts = [...tally].map(([k, n]) => `${k} ${n}`);
  console.log(`${found.length} candidates (${counts.join(", ")}) → ${values.out}`);
}
