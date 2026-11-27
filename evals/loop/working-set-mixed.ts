// Scores the working-set section's current-project signal (P20) on evals/sets/working-set-mixed: hand-written chats
// that mix projects, as one endless chat does. The active workspace is either this repo at the pinned commit (file
// list read from git) or a made-up second project; the rest of the window talks about other projects whose file
// names collide with it. Free: no model calls. Split by evals/loop/split.ts on the chat id.
// Run: node --experimental-strip-types evals/loop/working-set-mixed.ts [--split dev|held-out|all] [--verbose]

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { splitOf } from "./split.ts";
import { listedPaths, sectionOf } from "./working-set.ts";
import { buildPacket, estimateTokens, PROFILES, type ActiveWorkspace, type Profile, type Session } from "@long-con/core";

type Kind = "named" | "sibling" | "mixed" | "switched" | "empty";
interface Chat {
  id: string;
  kind: Kind;
  active: string;
  turns: ["user" | "assistant", string][];
  message: string;
  /** What the follow-up needs listed. */
  gold: string[];
  /** The active workspace's files the chat really names for that workspace; any other starred file is a wrong item. */
  allowed: string[];
}
interface SetFile {
  workspaces: Record<string, { root: string; name: string; commit?: string; files?: string[] }>;
  chats: Chat[];
}

const ROOT = new URL("../..", import.meta.url).pathname;
const SET = JSON.parse(readFileSync(new URL("../sets/working-set-mixed/chats.json", import.meta.url), "utf8")) as SetFile;

const WORKSPACES: Record<string, ActiveWorkspace> = Object.fromEntries(
  Object.entries(SET.workspaces).map(([key, w]) => [
    key,
    { root: w.root, name: w.name, files: w.files ?? execFileSync("git", ["-C", ROOT, "ls-tree", "-r", "--name-only", w.commit!], { encoding: "utf8" }).split("\n").filter(Boolean) },
  ]),
);

export interface Score {
  chats: number;
  gold: number;
  covered: number;
  /** Starred files outside the chat's allowed list, summed, and the chats with any. */
  wrongItems: number;
  wrongChats: number;
  emptyChats: number;
  emptyRight: number;
  changedWithout: number;
  sections: number;
  tokens: number;
  maxTokens: number;
}

export function score(chats: Chat[], profile: Profile, verbose = false): Score {
  const s: Score = { chats: 0, gold: 0, covered: 0, wrongItems: 0, wrongChats: 0, emptyChats: 0, emptyRight: 0, changedWithout: 0, sections: 0, tokens: 0, maxTokens: 0 };
  for (const c of chats) {
    const history: Session[] = [{ id: "chat", turns: c.turns.map(([role, content]) => ({ role, content })) }];
    const input = { history, message: c.message, profile, currentSessionId: "chat" };
    const before = buildPacket(input);
    const after = buildPacket({ ...input, workspace: WORKSPACES[c.active]! });
    const section = sectionOf(after.text);
    const listed = listedPaths(section);
    const wrong = after.workingSet.filter((p) => !c.allowed.includes(p));
    s.chats++;
    s.wrongItems += wrong.length;
    if (wrong.length) s.wrongChats++;
    if (!section && after.text !== before.text) s.changedWithout++;
    if (section) {
      const t = estimateTokens(section);
      s.sections++;
      s.tokens += t;
      s.maxTokens = Math.max(s.maxTokens, t);
    }
    for (const g of c.gold) {
      s.gold++;
      if (listed.includes(g)) s.covered++;
    }
    if (c.kind === "empty") {
      s.emptyChats++;
      if (!section) s.emptyRight++;
    }
    const missed = c.gold.filter((g) => !listed.includes(g));
    if (verbose && (missed.length || wrong.length || (c.kind === "empty" && section)))
      console.log(`  ${c.id} (${c.kind}): set ${after.workingSet.join(", ") || "none"}${missed.length ? `; missed ${missed.join(", ")}` : ""}${wrong.length ? `; wrong ${wrong.join(", ")}` : ""}`);
  }
  return s;
}

const rate = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}% (${a}/${b})` : "n/a");

const HEADER = [
  "| group / profile / split | chats | gold in section | wrong items (chats with any) | should-be-empty right | mean / max section tokens (n) | cap |",
  "| --- | --- | --- | --- | --- | --- | --- |",
].join("\n");

function row(name: string, s: Score, profile: Profile): string {
  const tokens = s.sections ? `${Math.round(s.tokens / s.sections)} / ${s.maxTokens} (${s.sections})` : "0 / 0 (0)";
  return `| ${name} | ${s.chats} | ${rate(s.covered, s.gold)} | ${s.wrongItems} (${s.wrongChats}) | ${rate(s.emptyRight, s.emptyChats)} | ${tokens} | ${profile.workingSetTokens} |`;
}

const GROUPS: [string, (c: Chat) => boolean][] = [
  ["named earlier, tied", (c) => c.kind === "named"],
  ["near a named file, tied", (c) => c.kind === "sibling"],
  ["mixed window, about the active project", (c) => c.kind === "mixed"],
  ["switched away from the active project", (c) => c.kind === "switched"],
  ["should be empty: never tied", (c) => c.kind === "empty"],
  ["all", () => true],
];

function main(): void {
  const { values } = parseArgs({ options: { split: { type: "string", default: "dev" }, verbose: { type: "boolean", default: false } } });
  const splits = values.split === "all" ? ["dev", "held-out"] : [values.split!];
  console.log(`working-set-mixed: ${SET.chats.length} chats; workspaces ${Object.entries(WORKSPACES).map(([k, w]) => `${k} (${w.files.length} files)`).join(", ")}\n`);
  console.log(HEADER);
  let changed = 0;
  for (const [group, keep] of GROUPS) {
    for (const profile of [PROFILES.claude, PROFILES.smallLocal]) {
      for (const split of splits) {
        const name = `${group} / ${profile.name} / ${split}`;
        if (values.verbose) console.log(`${name}:`);
        const s = score(SET.chats.filter((c) => keep(c) && splitOf(c.id) === split), profile, values.verbose && group !== "all");
        changed += s.changedWithout;
        console.log(row(name, s, profile));
      }
    }
  }
  console.log(`\nPackets with no section that differ from the no-workspace packet: ${changed}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
