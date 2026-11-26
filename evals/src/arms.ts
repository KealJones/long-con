// The four arms. Each answers one question from the same past chats, seeing them a different way.
// Every arm gets the same system prompt and the same question; only the context differs.

import type Anthropic from "@anthropic-ai/sdk";
import { assemblePrompt, Bm25, buildPacket, contentWords, estimateTokens, HISTORY_NOTICE, splitIntoSegments, type Profile, type Segment, type Session } from "@long-con/core";
import type { Question } from "./longmemeval.ts";
import { costOf, type ModelClient, type ModelRequest } from "./model.ts";

export type ArmName = "full" | "compaction" | "packet" | "bare";
export const ARMS: ArmName[] = ["full", "compaction", "packet", "bare"];

export interface ArmConfig {
  model: ModelClient;
  reader: string;
  profile: Profile;
  /** Compaction folds the transcript into a summary whenever it passes this many tokens. */
  compactAt: number;
  maxToolRounds: number;
}

export interface Call {
  purpose: ModelRequest["purpose"];
  model: string;
  input: number;
  output: number;
  cost: number;
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

const SEARCH_TOOL: Anthropic.Tool = {
  name: "search_history",
  description: "Search all past chats with the user. Returns the best-matching passages with their dates.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string", description: "What to look for" } },
    required: ["query"],
  },
};

const ask = (q: Question) => `Current date: ${q.date}\n\n${q.question}`;

export async function runArm(arm: ArmName, q: Question, cfg: ArmConfig): Promise<ArmResult> {
  const calls: Call[] = [];
  switch (arm) {
    case "full": {
      const context = renderChats(q.sessions);
      return readerLoop(cfg, calls, [{ role: "user", content: `Past chats:\n\n${context}\n\n${ask(q)}` }], estimateTokens(context), q, false);
    }
    case "compaction": {
      const context = await compact(q.sessions, cfg, calls);
      return readerLoop(cfg, calls, [{ role: "user", content: `${context}\n\n${ask(q)}` }], estimateTokens(context), q, false);
    }
    case "packet": {
      const packet = buildPacket({ history: q.sessions, message: q.question, profile: cfg.profile });
      const { messages } = assemblePrompt({ system: SYSTEM, packet: packet.text, recentTurns: packet.recentTurns, message: ask(q) });
      return readerLoop(cfg, calls, messages, packet.tokens, q, true);
    }
    case "bare": {
      const notice = HISTORY_NOTICE(q.sessions.find((s) => s.date)?.date ?? "");
      return readerLoop(cfg, calls, [{ role: "user", content: `${notice}\n\n${ask(q)}` }], estimateTokens(notice), q, true);
    }
  }
}

async function readerLoop(cfg: ArmConfig, calls: Call[], messages: Anthropic.MessageParam[], contextTokens: number, q: Question, tools: boolean): Promise<ArmResult> {
  let toolCalls = 0;
  for (let round = 0; ; round++) {
    const canSearch = tools && round < cfg.maxToolRounds;
    const res = await call(cfg, calls, { model: cfg.reader, system: SYSTEM, messages, maxTokens: 4000, purpose: "reader", ...(canSearch ? { tools: [SEARCH_TOOL] } : {}) });
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
          content: searchHistory(q.sessions, String(tc.input.query ?? ""), cfg.profile.segmentTokens),
        })),
      },
    ];
  }
}

async function call(cfg: ArmConfig, calls: Call[], req: ModelRequest) {
  const res = await cfg.model.complete(req);
  calls.push({ purpose: req.purpose, model: req.model, ...res.usage, cost: costOf(req.model, res.usage), latencyMs: res.latencyMs });
  return res;
}

/** The classic approach: keep the transcript, and fold it into a summary whenever it gets too long. */
async function compact(sessions: Session[], cfg: ArmConfig, calls: Call[]): Promise<string> {
  let summary = "";
  let pending = "";
  for (const chat of renderEach(sessions)) {
    if (pending && estimateTokens(summary + pending + chat) > cfg.compactAt) {
      const res = await call(cfg, calls, {
        model: cfg.reader,
        system: "You keep a running summary of a long chat between a user and an assistant, so the assistant can keep helping later without the full transcript.",
        messages: [
          {
            role: "user",
            content: `${summary ? `Summary so far:\n${summary}\n\n` : ""}New chats:\n\n${pending}\n\nWrite the updated summary. Keep facts about the user, what they asked for, decisions, preferences, names, numbers and dates. Drop small talk.`,
          },
        ],
        maxTokens: 4000,
        purpose: "summarizer",
      });
      summary = res.text;
      pending = "";
    }
    pending += chat + "\n\n";
  }
  return `${summary ? `Summary of earlier chats:\n${summary}\n\n` : ""}Recent chats:\n\n${pending.trim()}`;
}

function searchHistory(sessions: Session[], query: string, segmentTokens: number): string {
  const index = new Bm25<Segment>();
  for (const s of sessions) for (const seg of splitIntoSegments(s, segmentTokens)) index.add(seg, contentWords(seg.turns.map((t) => t.content).join("\n")));
  const hits = index.search(contentWords(query), 3);
  if (!hits.length) return "No matches.";
  return hits.map(({ item }) => `### ${item.date ?? "undated"}\n${item.turns.map((t) => `${t.role}: ${t.content}`).join("\n")}`).join("\n\n");
}

const renderEach = (sessions: Session[]) =>
  sessions.map((s) => `### Chat on ${s.date ?? "an unknown date"}\n${s.turns.map((t) => `${t.role}: ${t.content}`).join("\n")}`);
const renderChats = (sessions: Session[]) => renderEach(sessions).join("\n\n");
