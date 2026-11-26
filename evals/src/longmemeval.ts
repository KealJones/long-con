// LongMemEval (Wu et al., ICLR 2025, MIT). Each question comes with its own haystack of past chats.
// The evidence labels (has_answer, answer_session_ids) are kept apart from the chats, so nothing
// the packet builder reads can see them. Chat ids are replaced too: the benchmark names every evidence
// chat "answer_...", which would hand a reader the answer's location.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Session } from "@long-con/core";

export interface Question {
  id: string;
  type: string;
  question: string;
  /** When the question is asked, e.g. "2023/05/30 (Tue) 23:40". */
  date: string;
  answer: string;
  /** False-premise questions whose right answer is "we never talked about that". */
  abstention: boolean;
  sessions: Session[];
  evidence: { sessions: string[]; turns: string[] };
}

interface RawTurn {
  role: "user" | "assistant";
  content: string;
  has_answer?: boolean;
}

interface RawQuestion {
  question_id: string;
  question_type: string;
  question: string;
  question_date: string;
  answer: string | number;
  answer_session_ids: string[];
  haystack_dates: string[];
  haystack_session_ids: string[];
  haystack_sessions: RawTurn[][];
}

export const turnKey = (sessionId: string, turn: number) => `${sessionId}#${turn}`;

export function loadLongMemEval(path: string): Question[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as RawQuestion[];
  return raw.map((q) => {
    const turns: string[] = [];
    const opaque = new Map<string, string>();
    const sessions = q.haystack_sessions.map((chat, i): Session => {
      const id = `chat-${i + 1}`;
      opaque.set(q.haystack_session_ids[i]!, id);
      chat.forEach((t, j) => t.has_answer && turns.push(turnKey(id, j)));
      return { id, date: q.haystack_dates[i], turns: chat.map(({ role, content }) => ({ role, content })) };
    });
    return {
      id: q.question_id,
      type: q.question_type,
      question: q.question,
      date: q.question_date,
      answer: String(q.answer),
      abstention: q.question_id.endsWith("_abs"),
      sessions,
      evidence: { sessions: q.answer_session_ids.map((sid) => opaque.get(sid)!).filter(Boolean), turns },
    };
  });
}

/**
 * A fixed, stratified dev slice: each question type keeps its share of the full set, picked with a seeded
 * shuffle, so the slice is the same on every machine. Everything not in it is held out.
 */
export function stratifiedSlice<T extends { id: string; type: string }>(items: T[], size: number, seed: number): { dev: T[]; heldOut: T[] } {
  const byType = new Map<string, T[]>();
  for (const it of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
    byType.set(it.type, [...(byType.get(it.type) ?? []), it]);
  }
  const types = [...byType.keys()].sort();
  // Largest-remainder split, so the counts add up to exactly `size`.
  const exact = types.map((t) => (byType.get(t)!.length / items.length) * size);
  const counts = exact.map(Math.floor);
  const byRemainder = types.map((_, i) => i).sort((a, b) => exact[b]! - counts[b]! - (exact[a]! - counts[a]!));
  for (let k = 0; counts.reduce((a, b) => a + b, 0) < size; k++) counts[byRemainder[k % types.length]!]!++;

  const rand = mulberry32(seed);
  const dev: T[] = [];
  types.forEach((t, i) => {
    const pool = [...byType.get(t)!];
    for (let j = pool.length - 1; j > 0; j--) {
      const r = Math.floor(rand() * (j + 1));
      [pool[j], pool[r]] = [pool[r]!, pool[j]!];
    }
    dev.push(...pool.slice(0, counts[i]));
  });
  const devIds = new Set(dev.map((d) => d.id));
  return { dev, heldOut: items.filter((it) => !devIds.has(it.id)) };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Groups questions that share evidence: `X` and `X_abs` siblings, and questions whose evidence chats are word
 * for word the same. A question's group id is the smallest question id in it.
 */
export function evidenceGroups(questions: Question[]): Map<string, string> {
  const parent = new Map(questions.map((q) => [q.id, q.id]));
  const find = (x: string): string => {
    while (parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  const join = (a: string, b: string) => {
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };
  const owner = new Map<string, string>();
  for (const q of questions) {
    const sibling = q.id.replace(/_abs$/, "");
    if (sibling !== q.id && parent.has(sibling)) join(q.id, sibling);
    for (const sid of q.evidence.sessions) {
      const chat = q.sessions.find((s) => s.id === sid);
      if (!chat) continue;
      const key = createHash("sha256").update(JSON.stringify(chat.turns)).digest("hex");
      const seen = owner.get(key);
      if (seen) join(q.id, seen);
      else owner.set(key, q.id);
    }
  }
  return new Map(questions.map((q) => [q.id, find(q.id)]));
}

/** Everything outside the dev slice that shares no evidence with it. Questions that do are left out of both. */
export function heldOutSplit(all: Question[], dev: Question[]): { heldOut: Question[]; excluded: number } {
  const groups = evidenceGroups(all);
  const devIds = new Set(dev.map((q) => q.id));
  const devGroups = new Set(dev.map((q) => groups.get(q.id)));
  const rest = all.filter((q) => !devIds.has(q.id));
  const heldOut = rest.filter((q) => !devGroups.has(groups.get(q.id)));
  return { heldOut, excluded: rest.length - heldOut.length };
}
