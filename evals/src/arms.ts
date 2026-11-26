// The arms. Each answers one question from the same past chats, seeing them a different way.
// Every arm gets the same system prompt and question. Every arm but plain `compaction` gets the same search
// tool, so `compaction` stays the classic approach and `compaction-search` is the fair comparison.

import type Anthropic from "@anthropic-ai/sdk";
import { assemblePrompt, Bm25, buildPacket, contentWords, estimateTokens, HISTORY_NOTICE, splitIntoSegments, type Profile, type Segment, type Session } from "@long-con/core";
import type { Question } from "./longmemeval.ts";
import { BilledError, costOf, type ModelClient, type ModelRequest } from "./model.ts";

export type ArmName = "full" | "compaction" | "compaction-search" | "packet" | "bare";
export const ARMS: ArmName[] = ["full", "compaction", "compaction-search", "packet", "bare"];

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

export const SEARCH_TOOL: Anthropic.Tool = {
  name: "search_history",
  description: "Search all past chats with the user. Returns the best-matching passages with their dates.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string", description: "What to look for" } },
    required: ["query"],
  },
};

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
      const packet = buildPacket({ history: q.sessions, message: q.question, profile });
      return { messages: assemblePrompt({ system: SYSTEM, packet: packet.text, recentTurns: packet.recentTurns, message: ask(q) }).messages, contextTokens: packet.tokens };
    }
    case "bare": {
      const notice = HISTORY_NOTICE(q.sessions.map((s) => s.date ?? "").filter(Boolean).sort()[0] ?? "", profile.maxToolRounds > 0);
      return { messages: [{ role: "user", content: `${notice}\n\n${ask(q)}` }], contextTokens: estimateTokens(notice) };
    }
  }
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
    const tools = maxToolRounds > 0 ? { tools: [SEARCH_TOOL], toolChoice: canSearch ? ("auto" as const) : ("none" as const) } : {};
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
          content: searchHistory(q.sessions, String(tc.input.query ?? ""), cfg.profile),
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
  // About half the budget in words, so the summary leaves room for recent chats. Asked for, not forced: the
  // summary column in the run's summary shows what each arm really got.
  const words = Math.round(compactAt * 0.375);
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

export function searchHistory(sessions: Session[], query: string, profile: Profile): string {
  const index = new Bm25<Segment>();
  for (const s of sessions) for (const seg of splitIntoSegments(s, profile.segmentTokens)) index.add(seg, contentWords(seg.turns.map((t) => t.content).join("\n")));
  const hits = index.search(contentWords(query), profile.searchResults);
  if (!hits.length) return "No matches.";
  return hits.map(({ item }) => `### ${item.date ?? "undated"}\n${item.turns.map((t) => `${t.role}: ${t.content}`).join("\n")}`).join("\n\n");
}

const renderEach = (sessions: Session[]) =>
  sessions.map((s) => `### Chat on ${s.date ?? "an unknown date"}\n${s.turns.map((t) => `${t.role}: ${t.content}`).join("\n")}`);
const renderChats = (sessions: Session[]) => renderEach(sessions).join("\n\n");
