// One chat turn: build the packet from history, send it to Claude, and add both turns to history.
// No DOM here, so the test can run it in Node with a fake fetch.

import { assemblePrompt, buildPacket, PROFILES, type Session } from "@long-con/core";

// shortcut: no search tool yet, so the packet doesn't promise one. Turn it back on once core exports the
// shared search function (the packet R&D loop is moving it there).
export const PROFILE = { ...PROFILES.claude, maxToolRounds: 0 };

export const SYSTEM =
  "You are a helpful assistant in a long-running chat with the user. Each message comes with a packet of what seemed relevant from your past chats with them. Use it when it helps. If it doesn't say and you don't know, say so instead of guessing.";

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
}

export interface TurnResult {
  answer: string;
  packet: string;
  packetTokens: number;
  /** Where the new user turn sits, for keying the packet. */
  sessionId: string;
  turn: number;
}

/** Sends one message. Only changes `history` once the answer is back, so a failed call loses nothing. */
export async function sendTurn(history: Session[], message: string, opts: TurnOptions): Promise<TurnResult> {
  const today = dayLabel(opts.now ?? new Date());
  // Always a packet, even on a short chat (the profile's switchAt would send it whole), since seeing it is the point.
  const packet = buildPacket({ history, message, profile: PROFILE, currentSessionId: today, now: today });
  const prompt = assemblePrompt({ system: `${SYSTEM}\n\nToday is ${today}.`, packet: packet.text, recentTurns: packet.recentTurns, message });

  const res = await (opts.fetch ?? fetch)("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model: opts.model, max_tokens: PROFILE.answerTokens, system: prompt.system, messages: prompt.messages }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? `Anthropic API error ${res.status}`);
  const answer = (body?.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  if (!answer) throw new Error(`No text in the answer (stop reason: ${body?.stop_reason ?? "unknown"})`);

  let session = history.find((s) => s.id === today);
  if (!session) history.push((session = { id: today, date: today, turns: [] }));
  session.turns.push({ role: "user", content: message }, { role: "assistant", content: answer });
  return { answer, packet: packet.text, packetTokens: packet.tokens, sessionId: today, turn: session.turns.length - 2 };
}
