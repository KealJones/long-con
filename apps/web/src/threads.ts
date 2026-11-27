// Side threads: a conversation branched off one message of the main chat. No DOM, so it tests in Node.
//
// A thread's model sees the message it hangs off, a packet searched from the main chat (and other threads), and the
// thread's own turns word for word. It has the same tools as the main chat, so it acts on what's decided there.
// "Wrap up" writes a short record of what was decided and done, which shows in the main chat and joins its packets.
// Threads never wrapped up are listed in every main-chat packet as loose ends.

import { assemblePrompt, buildPacket, type Session, type Turn } from "@long-con/core";
import { attachedNote, dayLabel, PROFILE, runModel, SYSTEM, withAttachments, type TurnOptions, type Step } from "./chat.ts";
import { packetEmpty } from "./github.ts";

export interface Thread {
  id: string;
  /** Key of the main-chat message it hangs off, like "2026/11/27 (Fri)#4". */
  parent: string;
  parentRole: "user" | "assistant";
  parentText: string;
  title: string;
  /** The day it started, as a session id. */
  day: string;
  turns: Turn[];
  /** Tool calls behind each answer, by the index of its user turn. */
  steps?: Record<number, Step[]>;
  /** The wrap-up record, once wrapped. */
  wrap?: string;
  /** Key of the main-chat message the record shows after (the latest one when it was wrapped). */
  after?: string;
}

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);

export function newThread(parent: string, parentRole: Thread["parentRole"], parentText: string, now = new Date()): Thread {
  return { id: `t${now.getTime().toString(36)}`, parent, parentRole, parentText, title: "", day: dayLabel(now), turns: [] };
}

/** Threads as sessions, so the main chat's packet search can find what was said in them. */
export function threadSessions(threads: Thread[]): Session[] {
  return threads
    .filter((t) => t.turns.length)
    .map((t) => ({
      id: `${t.day} · side thread “${t.title}”`,
      date: t.day,
      turns: [...t.turns, ...(t.wrap ? [{ role: "assistant" as const, content: `Wrap-up: ${t.wrap}` }] : [])],
    }));
}

/** The note on every main-chat packet: open threads as loose ends, and threads wrapped today with their record. */
export function threadsNote(threads: Thread[], today: string): string {
  const open = threads.filter((t) => t.turns.length && !t.wrap).slice(-10);
  const wrapped = threads.filter((t) => t.wrap && t.day === today);
  if (!open.length && !wrapped.length) return "";
  const out = ["Side threads (branched off messages in this chat):"];
  for (const t of open) out.push(`- Open, not wrapped up: “${t.title}”, last said: ${clip(t.turns.at(-1)!.content.replace(/\s+/g, " "), 140)}`);
  for (const t of wrapped) out.push(`- Wrapped up: “${t.title}”: ${t.wrap}`);
  return out.join("\n");
}

const threadSystem = (t: Thread, today: string) =>
  `${SYSTEM}\n\nThis is a side thread the user branched off one message in the main chat, to talk about it on its own. ` +
  `That message (${t.parentRole === "user" ? "theirs" : "yours"}):\n"""\n${t.parentText}\n"""\n` +
  "Stay on it. Use your tools here to act on what you two decide. When the user wraps up, a short record of this thread goes back to the main chat." +
  `\n\nToday is ${today}.`;

/** One turn in a thread. Like sendTurn, it only changes the thread once the answer is back. */
export async function sendThreadTurn(thread: Thread, history: Session[], others: Thread[], message: string, opts: TurnOptions) {
  const today = dayLabel(opts.now ?? new Date());
  const searchable = [...history, ...threadSessions(others.filter((o) => o.id !== thread.id))];
  // No session is "current", so the whole main chat is searchable; the thread's own turns go word for word instead.
  const profile = { ...PROFILE, rawTurns: 0 };
  const packet = buildPacket({ history: searchable, message, profile });
  const sent = packetEmpty(packet.text) ? "" : packet.text;
  const prompt = assemblePrompt({ system: threadSystem(thread, today), packet: sent, recentTurns: thread.turns, message });
  const messages: unknown[] = sent ? [...prompt.messages] : prompt.messages.slice(1);
  withAttachments(messages, opts.attachments);
  const { answer, steps } = await runModel(prompt.system, messages, opts, { history: searchable, profile, store: opts.store, fetch: opts.fetch });
  if (!thread.title) thread.title = clip(message.replace(/\s+/g, " "), 60);
  // Talking again in a wrapped thread reopens it; the next wrap-up writes a new record.
  delete thread.wrap;
  delete thread.after;
  thread.turns.push({ role: "user", content: message + attachedNote(opts.attachments) }, { role: "assistant", content: answer });
  if (steps.length) (thread.steps ??= {})[thread.turns.length - 2] = steps;
  return { answer, packet: sent, steps };
}

export const WRAP_PROMPT =
  "Wrap up this side thread for the main chat's record. In two or three plain sentences, say what was decided and what was done here. " +
  "Not a to-do list for the main chat: it's a record. No preamble.";

/** Writes the thread's record. `after` is the main chat's latest message key, so the record shows where things stood. */
export async function wrapUp(thread: Thread, after: string, opts: TurnOptions): Promise<string> {
  const transcript = thread.turns.map((t) => `${t.role === "user" ? "User" : "You"}: ${t.content}`).join("\n\n");
  const messages: unknown[] = [{ role: "user", content: `${transcript}\n\n${WRAP_PROMPT}` }];
  const { answer } = await runModel(threadSystem(thread, dayLabel(opts.now ?? new Date())), messages, opts, { history: [], profile: PROFILE }, false);
  thread.wrap = answer.trim();
  thread.after = after;
  return thread.wrap;
}
