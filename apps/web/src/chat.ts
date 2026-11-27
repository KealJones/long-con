// One chat turn: build the packet from history, send it to Claude, and add both turns to history.
// No DOM here, so the test can run it in Node with a fake fetch.

import { assemblePrompt, buildPacket, PROFILES, type Session } from "@long-con/core";
import { packetEmpty } from "./github.ts";
import { runTool, toolDefs, type ToolContext } from "./tools.ts";

// The "best guess" trust note is off here: the R&D loop's 50-question run found it about tripled searches and doubled tokens with no accuracy gain.
export const PROFILE = { ...PROFILES.claude, trustNote: false };
/** Model calls per message at most; the last one gets no tools, so it has to answer. */
export const MAX_ROUNDS = 12;

export const SYSTEM =
  "You are a helpful assistant in a long-running chat with the user. Each message comes with a packet of what seemed relevant from your past chats with them. Use it when it helps. If it doesn't say and you don't know, say so instead of guessing. You also have tools: a bash shell whose /home files stay in this browser, a search of all your past chats, and web search and fetch. Write like you're texting a friend: plain and conversational, no headings or tables.";

export const MODELS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"];

/** One session per local day, so retrieved history carries a date. The format sorts as text, like core expects. */
export function dayLabel(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const weekday = now.toLocaleDateString("en-US", { weekday: "short" });
  return `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} (${weekday})`;
}

export interface TurnOptions {
  apiKey: string;
  model: string;
  now?: Date;
  fetch?: typeof fetch;
  /** Where the shell keeps /home (localStorage when left out). */
  store?: ToolContext["store"];
  /** How many of today's latest turns go word for word; the packet searches everything else. */
  rawTurns?: number;
  /** Called as each tool runs, for a live "typing" line. */
  onStep?: (label: string) => void;
}

/** One tool call in a turn, as the chat shows it. */
export interface Step {
  label: string;
  output?: string;
}

export interface TurnResult {
  answer: string;
  packet: string;
  packetTokens: number;
  /** Today's latest turns, sent word for word after the packet. */
  rawTurns: number;
  /** Where the new user turn sits, for keying the packet. */
  sessionId: string;
  turn: number;
  steps: Step[];
}

/** Sends one message. Only changes `history` once the answer is back, so a failed call loses nothing. */
export async function sendTurn(history: Session[], message: string, opts: TurnOptions): Promise<TurnResult> {
  const today = dayLabel(opts.now ?? new Date());
  // Always a packet, even on a short chat (the profile's switchAt would send it whole), since seeing it is the point.
  const profile = { ...PROFILE, rawTurns: opts.rawTurns ?? PROFILE.rawTurns };
  const packet = buildPacket({ history, message, profile, currentSessionId: today });
  const prompt = assemblePrompt({ system: `${SYSTEM}\n\nToday is ${today}.`, packet: packet.text, recentTurns: packet.recentTurns, message });

  // A packet that found nothing older isn't sent at all: just today's latest turns and the message.
  const sent = packetEmpty(packet.text) ? "" : packet.text;
  const doFetch = opts.fetch ?? fetch;
  const messages: unknown[] = sent ? [...prompt.messages] : prompt.messages.slice(1);
  const steps: Step[] = [];
  const toolCtx: ToolContext = { history, profile, store: opts.store, fetch: opts.fetch };
  let body: { content?: Block[]; stop_reason?: string } | null = null;
  for (let round = 1; ; round++) {
    const res = await doFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: PROFILE.answerTokens,
        system: prompt.system,
        messages,
        tools: toolDefs(opts.model),
        ...(round >= MAX_ROUNDS ? { tool_choice: { type: "none" } } : {}),
      }),
    });
    body = await res.json().catch(() => null);
    if (!res.ok) throw new Error((body as { error?: { message?: string } } | null)?.error?.message ?? `Anthropic API error ${res.status}`);
    const content = body?.content ?? [];
    // The whole content goes back as it came (thinking, server tool results), so the next call can carry on.
    messages.push({ role: "assistant", content });
    for (const b of content) if (b.type === "server_tool_use") report(steps, opts, serverLabel(b));
    if (body?.stop_reason === "pause_turn" && round < MAX_ROUNDS) continue;
    const calls = content.filter((b) => b.type === "tool_use");
    if (body?.stop_reason !== "tool_use" || !calls.length) break;
    const results = await Promise.all(
      calls.map(async (b) => {
        const run = await runTool(b.name!, b.input ?? {}, toolCtx).catch((e) => ({ output: String(e?.message ?? e), isError: true, label: b.name! }));
        report(steps, opts, run.label, run.output);
        return { type: "tool_result", tool_use_id: b.id, content: run.output, ...(run.isError ? { is_error: true } : {}) };
      }),
    );
    messages.push({ role: "user", content: results });
  }
  const answer = (body?.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
  if (!answer) throw new Error(`No text in the answer (stop reason: ${body?.stop_reason ?? "unknown"})`);

  let session = history.find((s) => s.id === today);
  if (!session) history.push((session = { id: today, date: today, turns: [] }));
  session.turns.push({ role: "user", content: message }, { role: "assistant", content: answer });
  return { answer, packet: sent, packetTokens: sent ? packet.tokens : 0, rawTurns: packet.recentTurns.length, sessionId: today, turn: session.turns.length - 2, steps };
}

interface Block {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

function report(steps: Step[], opts: TurnOptions, label: string, output?: string) {
  // shortcut: shown output capped at 4K characters to spare localStorage; the model still got all of it.
  steps.push(output === undefined ? { label } : { label, output: output.length > 4000 ? `${output.slice(0, 4000)}\n…` : output });
  opts.onStep?.(label);
}

function serverLabel(b: Block): string {
  const input = b.input ?? {};
  if (b.name === "web_search") return `searched the web for “${input.query ?? ""}”`;
  if (b.name === "web_fetch") return `read ${input.url ?? "a page"}`;
  return String(b.name);
}
