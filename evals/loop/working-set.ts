// Scores the packet's working-set section (P20) on evals/sets/working-set: coding chats about this repo whose next
// step needs a file named earlier or one near it, plus chats that should get no section. The workspace is this
// repo's file list at the pinned commit, read from git so later edits don't move the labels. Free: no model calls.
// Run: node --experimental-strip-types evals/loop/working-set.ts [--split dev|held-out|all] [--verbose]

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { buildPacket, estimateTokens, PROFILES, WORKING_SET, type Profile, type Session } from "@long-con/core";

type Kind = "named" | "sibling" | "deep" | "empty-nocode" | "empty-falsepath";
interface Chat {
  id: string;
  kind: Kind;
  turns: ["user" | "assistant", string][];
  message: string;
  gold: string[];
}

const ROOT = new URL("../..", import.meta.url).pathname;
const SET = JSON.parse(readFileSync(new URL("../sets/working-set/chats.json", import.meta.url), "utf8")) as { commit: string; seed: number; chats: Chat[] };

/** FNV-1a of seed:id, so the split is fixed and a third is held out. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}
export const splitOf = (id: string) => (fnv1a(`${SET.seed}:${id}`) % 3 === 0 ? "held-out" : "dev");

const workspace = execFileSync("git", ["-C", ROOT, "ls-tree", "-r", "--name-only", SET.commit], { encoding: "utf8" }).split("\n").filter(Boolean);
const files = new Set(workspace);
const dirs = new Set(workspace.flatMap((p) => p.split("/").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("/"))));

/** The section as the packet holds it, read back into the paths it claims: folder lines of "dir/: names". */
export function sectionOf(text: string): string {
  const at = text.indexOf(WORKING_SET);
  if (at < 0) return "";
  const end = text.indexOf("\n\n", at);
  return text.slice(at, end < 0 ? undefined : end);
}

export function listedPaths(section: string): string[] {
  const out: string[] = [];
  for (const line of section.split("\n").slice(1)) {
    const m = line.match(/^(.*)\/: (.*)$/);
    if (!m) {
      out.push(`?malformed:${line}`);
      continue;
    }
    const dir = m[1] === "." ? "" : m[1]!;
    out.push(`${dir}/`);
    for (const name of m[2]!.split(" ")) {
      if (/^\+\d+$/.test(name) || name === "more") continue;
      out.push(`${dir ? `${dir}/` : ""}${name.replace(/^\*/, "")}`);
    }
  }
  return out;
}

const exists = (p: string) => (p.endsWith("/") ? p === "/" || dirs.has(p.slice(0, -1)) : files.has(p));

interface Score {
  chats: number;
  gold: number;
  /** Gold files listed anywhere in the section. */
  covered: number;
  /** Gold files the working set itself holds (the section without its tree). */
  inSet: number;
  listed: number;
  falsePaths: number;
  emptyChats: number;
  emptyRight: number;
  /** Packets with no section that differ from the no-workspace packet. Must be 0. */
  changedWithout: number;
  sections: number;
  tokens: number;
  maxTokens: number;
}

function score(chats: Chat[], profile: Profile, verbose: boolean): Score {
  const s: Score = { chats: 0, gold: 0, covered: 0, inSet: 0, listed: 0, falsePaths: 0, emptyChats: 0, emptyRight: 0, changedWithout: 0, sections: 0, tokens: 0, maxTokens: 0 };
  for (const c of chats) {
    const history: Session[] = [{ id: "chat", turns: c.turns.map(([role, content]) => ({ role, content })) }];
    const input = { history, message: c.message, profile, currentSessionId: "chat" };
    const before = buildPacket(input);
    const after = buildPacket({ ...input, workspace });
    const section = sectionOf(after.text);
    const listed = listedPaths(section);
    const wrong = listed.filter((p) => !exists(p));
    s.chats++;
    s.listed += listed.length;
    s.falsePaths += wrong.length;
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
      if (after.workingSet.includes(g)) s.inSet++;
    }
    if (c.kind.startsWith("empty")) {
      s.emptyChats++;
      if (!section) s.emptyRight++;
    }
    const ok = c.kind.startsWith("empty") ? !section : c.gold.every((g) => listed.includes(g));
    if (verbose && (!ok || wrong.length)) console.log(`  ${ok ? "FALSE" : "MISS"} ${c.id} (${c.kind}): set ${after.workingSet.join(", ") || "none"}${wrong.length ? `; not in workspace: ${wrong.join(", ")}` : ""}`);
  }
  return s;
}

const rate = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}% (${a}/${b})` : "n/a");

const HEADER = [
  "| group / profile / split | chats | gold in section | gold in working set alone | false paths (of listed) | empty right | mean / max section tokens (n) | cap |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
].join("\n");

function row(name: string, s: Score, profile: Profile): string {
  const tokens = s.sections ? `${Math.round(s.tokens / s.sections)} / ${s.maxTokens} (${s.sections})` : "0 / 0 (0)";
  return `| ${name} | ${s.chats} | ${rate(s.covered, s.gold)} | ${rate(s.inSet, s.gold)} | ${rate(s.falsePaths, s.listed)} | ${rate(s.emptyRight, s.emptyChats)} | ${tokens} | ${profile.workingSetTokens} |`;
}

const GROUPS: [string, (c: Chat) => boolean][] = [
  ["named earlier", (c) => c.kind === "named"],
  ["near a named file", (c) => c.kind === "sibling"],
  ["further away", (c) => c.kind === "deep"],
  ["should be empty", (c) => c.kind.startsWith("empty")],
];

function main(): void {
  const { values } = parseArgs({ options: { split: { type: "string", default: "dev" }, verbose: { type: "boolean", default: false } } });
  const splits = values.split === "all" ? ["dev", "held-out"] : [values.split!];
  console.log(`working-set at ${SET.commit.slice(0, 7)}: ${workspace.length} workspace files, ${SET.chats.length} chats\n`);
  console.log(HEADER);
  let changed = 0;
  for (const [group, keep] of GROUPS) {
    for (const profile of [PROFILES.claude, PROFILES.smallLocal]) {
      for (const split of splits) {
        const name = `${group} / ${profile.name} / ${split}`;
        if (values.verbose) console.log(`${name}:`);
        const s = score(SET.chats.filter((c) => keep(c) && splitOf(c.id) === split), profile, values.verbose!);
        changed += s.changedWithout;
        console.log(row(name, s, profile));
      }
    }
  }
  console.log(`\nPackets with no section that differ from the no-workspace packet: ${changed}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
