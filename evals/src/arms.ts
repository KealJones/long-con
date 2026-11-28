// The arms. Each answers one question from the same past chats, seeing them a different way.
// Every arm gets the same system prompt and question. Every arm but plain `compaction` gets the same search
// tool, so `compaction` stays the classic approach and `compaction-search` is the fair comparison.

import type Anthropic from "@anthropic-ai/sdk";
import { assemblePrompt, buildPacket, messagePrompt, searchHistory, estimateTokens, HISTORY_NOTICE, SEARCH_TOOL as CORE_SEARCH_TOOL, type Packet, type Profile, type Session } from "@beep/core";
import { embedderFor } from "./embedder.ts";
import type { Question } from "./longmemeval.ts";
import { BilledError, costOf, type ModelClient, type ModelRequest } from "./model.ts";

export type ArmName = "full" | "compaction" | "compaction-search" | "packet" | "packet-tools" | "packet-notrust" | "packet-norules" | "bare";
/** The five main arms, run when --arms isn't given. */
export const DEFAULT_ARMS: ArmName[] = ["full", "compaction", "compaction-search", "packet", "bare"];
/** Every arm: the main five plus packet variants that each change one thing. */
export const ARMS: ArmName[] = [...DEFAULT_ARMS, "packet-tools", "packet-notrust", "packet-norules"];

/** Output cap per call. Generous, since a cut-off answer is a measurement error; profile.answerTokens only budgets the window. */
export const MAX_OUTPUT = 16_000;

/** Everything model-specific comes from the profile: budgets, windows, tools, search size. */
export interface ArmConfig {
  model: ModelClient;
  reader: string;
  profile: Profile;
  /** Which repeat this is. Real models vary run to run; the subagent backend keys answers by it. */
  seed?: number;
  /**
   * Compaction summaries by question and repeat, so `compaction` and `compaction-search` read the same summary
   * and differ only in the tool. Each arm still reports the summary's cost as its own; the second arm's copy is
   * marked reused, so run totals count it once.
   */
  summaries?: Map<string, Promise<{ context: string; calls: Call[] }>>;
}

export interface Call {
  purpose: ModelRequest["purpose"];
  model: string;
  input: number;
  output: number;
  cost: number;
  /** A shared compaction summary another arm already paid for: in this arm's own cost, not again in the run's total. */
  reused?: boolean;
  latencyMs: number;
}

export interface ArmResult {
  answer: string;
  calls: Call[];
  /** Tokens of context the reader saw on its first call: the history, summary or packet. */
  contextTokens: number;
  toolCalls: number;
}

export const SYSTEM =
  "You are a helpful assistant in a long-running chat with the user. Use what you know from your past chats with them to answer. If the past chats don't say, say so instead of guessing.";

/** core's definition, the one the web chat offers. */
export const SEARCH_TOOL: Anthropic.Tool = CORE_SEARCH_TOOL;

export const SUMMARY_NOTE = (canSearch: boolean) =>
  `Earlier chat history was summarized to fit, and the summary may leave details out.${canSearch ? " The search_history tool can reach all of it." : ""}`;

const ask = (q: Question) => `Current date: ${q.date}\n\n${q.question}`;

/** The reader's first message for an arm, exactly as sent. Compaction needs the model, so it isn't here. */
export function firstMessages(arm: Exclude<ArmName, "compaction" | "compaction-search">, q: Question, profile: Profile): { messages: Anthropic.MessageParam[]; contextTokens: number } {
  switch (arm) {
    case "full": {
      const context = renderChats(q.sessions);
      return { messages: [{ role: "user", content: `Past chats:\n\n${context}\n\n${ask(q)}` }], contextTokens: estimateTokens(context) };
    }
    case "packet": {
      // Below the profile's switch point the chat is still short enough to send whole.
      if (estimateTokens(renderChats(q.sessions)) <= profile.switchAt) return firstMessages("full", q, profile);
      // core's messagePrompt, the code the web chat runs: a packet that found nothing older isn't sent.
      const { packet, sent, prompt } = messagePrompt({ system: SYSTEM, history: q.sessions, message: q.question, sendAs: ask(q), profile, embed: embedderFor(profile) });
      return { messages: prompt.messages, contextTokens: sent ? packet.tokens : 0 };
    }
    // Ablations: the same packet with one part of its head left out. The builder drops it, so the freed tokens go back to the budget.
    case "packet-notrust":
      return firstMessages("packet", q, { ...profile, trustNote: false });
    case "packet-norules":
      return firstMessages("packet", q, { ...profile, standingRules: false });
    case "packet-tools": {
      if (estimateTokens(renderChats(q.sessions)) <= profile.switchAt) return firstMessages("full", q, profile);
      const packet = buildPacket({ history: q.sessions, message: q.question, profile, embed: embedderFor(profile) });
      return { messages: packetAsToolCall(packet, ask(q)), contextTokens: packet.tokens };
    }
    case "bare": {
      const notice = HISTORY_NOTICE(q.sessions.map((s) => s.date ?? "").filter(Boolean).sort()[0] ?? "", profile.maxToolRounds > 0);
      return { messages: [{ role: "user", content: `${notice}\n\n${ask(q)}` }], contextTokens: estimateTokens(notice) };
    }
  }
}

const RETRIEVED_AT = "\n\nRetrieved history, oldest first:\n";
export const PACKET_TOOL_ID = "toolu_packet_1";

/**
 * The packet's retrieved units delivered as if the model had searched for them itself: an assistant search_history
 * call with the builder's query, then its result. The head (left-out notice, trust note, registers) stays a short
 * packet block ahead of it, since it's about the context, not a search hit, and the user's rules shouldn't read as
 * tool output. Order, content and token count otherwise match `packet`. No search ran when the gate closed, so no call is shown.
 */
export function packetAsToolCall(packet: Packet, message: string): Anthropic.MessageParam[] {
  const cut = packet.text.indexOf(RETRIEVED_AT);
  const head = cut < 0 ? packet.text : packet.text.slice(0, cut);
  const [first, ...rest] = assemblePrompt({ system: SYSTEM, packet: head, recentTurns: packet.recentTurns, message }).messages;
  if (!packet.retrieved) return [first!, ...rest];
  return alternate([
    first!,
    { role: "assistant", content: [{ type: "tool_use", id: PACKET_TOOL_ID, name: SEARCH_TOOL.name, input: { query: packet.resolution.query } }] },
    // An open gate that kept nothing reads as the search tool's own empty result.
    { role: "user", content: [{ type: "tool_result", tool_use_id: PACKET_TOOL_ID, content: cut < 0 ? "No matches." : packet.text.slice(cut + 2) }] },
    ...rest,
  ]);
}

/** Joins back-to-back turns from one role into one, so a tool_result and the text after it share a user turn, as the API requires. */
export function alternate(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const blocks = (c: Anthropic.MessageParam["content"]) => (typeof c === "string" ? [{ type: "text" as const, text: c }] : c);
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    const last = out.at(-1);
    if (last?.role === m.role) out[out.length - 1] = { role: m.role, content: [...blocks(last.content), ...blocks(m.content)] } as Anthropic.MessageParam;
    else out.push(m);
  }
  return out;
}

export async function runArm(arm: ArmName, q: Question, cfg: ArmConfig): Promise<ArmResult> {
  const calls: Call[] = [];
  try {
    if (arm === "compaction" || arm === "compaction-search") {
      const { context, calls: paid } = await summarize(q, cfg).catch((err) => {
        calls.push(...((err as { calls?: Call[] }).calls ?? []));
        throw err;
      });
      calls.push(...paid);
      const reader = arm === "compaction" ? { ...cfg, profile: { ...cfg.profile, maxToolRounds: 0 } } : cfg;
      // Told what the packet and bare arms are told: history was cut, and the tool (when there is one) reaches all of it.
      const note = SUMMARY_NOTE(reader.profile.maxToolRounds > 0);
      return await readerLoop(reader, calls, [{ role: "user", content: `${note}\n\n${context}\n\n${ask(q)}` }], estimateTokens(`${note}\n\n${context}`), q);
    }
    const { messages, contextTokens } = firstMessages(arm, q, cfg.profile);
    return await readerLoop(cfg, calls, messages, contextTokens, q);
  } catch (err) {
    // Calls made before the failure were still paid for, so they go with the error. A new error each time,
    // since a shared summary's failure reaches two arms.
    const e = err instanceof Error ? err : new Error(String(err));
    throw Object.assign(new Error(e.message), e, { name: e.name, calls });
  }
}

function summarize(q: Question, cfg: ArmConfig): Promise<{ context: string; calls: Call[] }> {
  const key = `${q.id}#${cfg.seed ?? 0}`;
  const cached = cfg.summaries?.get(key);
  if (cached) {
    const reuse = (calls: Call[]) => calls.map((c) => ({ ...c, reused: true }));
    return cached.then(
      (made) => ({ ...made, calls: reuse(made.calls) }),
      (err) => {
        const e = err instanceof Error ? err : new Error(String(err));
        throw Object.assign(new Error(e.message), e, { name: e.name, calls: reuse((err as { calls?: Call[] }).calls ?? []) });
      },
    );
  }
  const own: Call[] = [];
  const made = compact(q.sessions, cfg, own).then(
    (context) => ({ context, calls: own }),
    (err) => {
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), { calls: own });
    },
  );
  cfg.summaries?.set(key, made);
  return made;
}

async function readerLoop(cfg: ArmConfig, calls: Call[], messages: Anthropic.MessageParam[], contextTokens: number, q: Question): Promise<ArmResult> {
  const { maxToolRounds } = cfg.profile;
  let toolCalls = 0;
  for (let round = 0; ; round++) {
    const canSearch = round < maxToolRounds;
    // Once searches run out the tool stays defined, since earlier turns use it, but the model can only answer.
    // A tool_use already in the messages (packet-tools) needs the tool defined even with no searches left.
    const defined = maxToolRounds > 0 || messages.some((m) => typeof m.content !== "string" && m.content.some((b) => b.type === "tool_use"));
    const tools = defined ? { tools: [SEARCH_TOOL], toolChoice: canSearch ? ("auto" as const) : ("none" as const) } : {};
    const res = await call(cfg, calls, { model: cfg.reader, system: SYSTEM, messages, maxTokens: MAX_OUTPUT, purpose: "reader", ...tools });
    if (!res.toolCalls.length || !canSearch) return { answer: res.text, calls, contextTokens, toolCalls };
    toolCalls += res.toolCalls.length;
    messages = [
      ...messages,
      { role: "assistant", content: res.content },
      {
        role: "user",
        content: res.toolCalls.map((tc) => ({
          type: "tool_result" as const,
          tool_use_id: tc.id,
          content: searchHistory(q.sessions, String(tc.input.query ?? ""), cfg.profile, embedderFor(cfg.profile)),
        })),
      },
    ];
  }
}

async function call(cfg: ArmConfig, calls: Call[], req: ModelRequest) {
  const record = (usage: { input: number; output: number }, latencyMs: number) =>
    calls.push({ purpose: req.purpose, model: req.model, ...usage, cost: costOf(req.model, usage), latencyMs });
  try {
    const res = await cfg.model.complete({ ...req, seed: cfg.seed });
    record(res.usage, res.latencyMs);
    return res;
  } catch (err) {
    // A cut-off or refused answer is still billed.
    if (err instanceof BilledError) record(err.usage, err.latencyMs);
    throw err;
  }
}

/** The classic approach: keep the transcript, and fold it into a summary whenever it gets too long. */
async function compact(sessions: Session[], cfg: ArmConfig, calls: Call[]): Promise<string> {
  const { compactAt } = cfg.profile;
  // About a third of the budget in tokens, so the summary leaves room for recent chats and stays well under the
  // output cap (7,500 words is about 10K tokens on claude). Asked for, not forced: the context column shows what each arm got.
  const words = Math.round(compactAt * 0.25);
  let summary = "";
  let pending = "";
  const fold = async () => {
    const res = await call(cfg, calls, {
      model: cfg.reader,
      system: "You keep a running summary of a long chat between a user and an assistant, so the assistant can keep helping later without the full transcript.",
      messages: [
        {
          role: "user",
          content: `${summary ? `Summary so far:\n${summary}\n\n` : ""}New chats:\n\n${pending}\n\nWrite the updated summary in at most ${words} words. Keep facts about the user, what they asked for, decisions, preferences, names, numbers and dates, and what the assistant recommended, listed or answered. Drop small talk.`,
        },
      ],
      maxTokens: MAX_OUTPUT,
      purpose: "summarizer",
    });
    summary = res.text;
    pending = "";
  };
  for (const chat of renderEach(sessions)) {
    if (pending && estimateTokens(summary + pending + chat) > compactAt) await fold();
    pending += chat + "\n\n";
  }
  // A last chat bigger than the budget on its own still gets folded, so the context stays within compactAt.
  if (estimateTokens(summary + pending) > compactAt) await fold();
  return `${summary ? `Summary of earlier chats:\n${summary}\n\n` : ""}Recent chats:\n\n${pending.trim()}`;
}


const renderEach = (sessions: Session[]) =>
  sessions.map((s) => `### Chat on ${s.date ?? "an unknown date"}\n${s.turns.map((t) => `${t.role}: ${t.content}`).join("\n")}`);
const renderChats = (sessions: Session[]) => renderEach(sessions).join("\n\n");
