// One chat turn: build the packet from history, send it to Claude, and add both turns to history.
// No DOM here, so the test can run it in Node with a fake fetch.

import { assemblePrompt, buildPacket, PROFILES, type Session } from "@long-con/core";
import { packetEmpty } from "./github.ts";
import { costOf, decide, DEFAULT_PERMISSIONS, offeredTools, siteOf, spentLastHour, type Permissions, type Spend, type Usage } from "./permissions.ts";
import { runTool, toolDefs, type ToolContext } from "./tools.ts";

// The "best guess" trust note is off here: the R&D loop's 50-question run found it about tripled searches and doubled tokens with no accuracy gain.
export const PROFILE = { ...PROFILES.claude, trustNote: false };
/** Model calls per message at most; the last one gets no tools, so it has to answer. */
export const MAX_ROUNDS = 12;

export const SYSTEM =
  "You are a helpful assistant in a long-running chat with the user. Each message comes with a packet of what seemed relevant from your past chats with them. Use it when it helps. If it doesn't say and you don't know, say so instead of guessing. You also have tools: a bash shell whose /home files stay in this browser, a search of all your past chats, and web search and fetch. Write like you're texting a friend: plain and conversational, no headings or tables.";

export const VOICE_NOTE =
  "You're on a voice call: your reply is read aloud. Keep it short and spoken, with no lists, links, code or markdown.";

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
  /** On a voice call the reply is read aloud, so the model is asked to keep it short and speakable. */
  voice?: boolean;
  /** How many of today's latest turns go word for word; the packet searches everything else. */
  rawTurns?: number;
  /** Called as each tool runs, for a live "typing" line. */
  onStep?: (label: string) => void;
  /** What may run without asking; everything is allowed when left out. */
  permissions?: Permissions;
  /** Shows an ask and resolves true when the user allows it. With none, anything that needs asking is refused. */
  approve?: (ask: Ask) => Promise<boolean>;
  /** The spending log the hourly cap is checked against; each API response adds to it. */
  spend?: { log: Spend[]; record: (s: Spend) => void };
  /** More history the packet may search, like side threads. */
  extraSessions?: Session[];
  /** A note added to the end of the packet, like the list of open side threads. */
  note?: string;
  /** Images and PDFs sent with this message. */
  attachments?: Attachment[];
}

/** A file sent with a message: base64 data, as the Messages API takes it. */
export interface Attachment {
  name: string;
  type: string;
  data: string;
}

/** One thing the model wants to do that the user's settings say to ask about. */
export interface Ask {
  tool: string;
  label: string;
  detail: string;
  site?: string;
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
  const searchable = opts.extraSessions?.length ? [...history, ...opts.extraSessions] : history;
  const packet = buildPacket({ history: searchable, message, profile, currentSessionId: today });
  // A packet that found nothing older isn't sent at all: just today's latest turns and the message.
  const found = packetEmpty(packet.text) ? "" : packet.text;
  const sent = [found, opts.note ?? ""].filter(Boolean).join("\n\n");
  const prompt = assemblePrompt({ system: `${SYSTEM}${opts.voice ? `\n\n${VOICE_NOTE}` : ""}\n\nToday is ${today}.`, packet: sent, recentTurns: packet.recentTurns, message });
  const messages: unknown[] = sent ? [...prompt.messages] : prompt.messages.slice(1);
  withAttachments(messages, opts.attachments);
  const { answer, steps } = await runModel(prompt.system, messages, opts, { history: searchable, profile, store: opts.store, fetch: opts.fetch });

  let session = history.find((s) => s.id === today);
  if (!session) history.push((session = { id: today, date: today, turns: [] }));
  session.turns.push({ role: "user", content: message + attachedNote(opts.attachments) }, { role: "assistant", content: answer });
  return { answer, packet: sent, packetTokens: sent ? packet.tokens : 0, rawTurns: packet.recentTurns.length, sessionId: today, turn: session.turns.length - 2, steps };
}

/** "[Attached: a.png, b.pdf]" on the saved turn, so later packets and searches know a file came with it. */
export const attachedNote = (files?: Attachment[]) => (files?.length ? `\n\n[Attached: ${files.map((f) => f.name).join(", ")}]` : "");

/** Puts the files in front of the text of the last user message, as image and document blocks. */
export function withAttachments(messages: unknown[], files?: Attachment[]) {
  if (!files?.length) return;
  const last = messages.at(-1) as { content: unknown };
  const blocks = files.map((f) =>
    f.type === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: f.type, data: f.data }, title: f.name }
      : { type: "image", source: { type: "base64", media_type: f.type, data: f.data } },
  );
  last.content = [...blocks, { type: "text", text: String(last.content) }];
}

/**
 * The model loop: calls the API, runs tools (asking first where the settings say to), and goes back until it answers.
 * `messages` grows as it goes. With tools off, it's one plain call.
 */
export async function runModel(system: string, messages: unknown[], opts: TurnOptions, toolCtx: ToolContext, tools = true): Promise<{ answer: string; steps: Step[] }> {
  const doFetch = opts.fetch ?? fetch;
  const perms = opts.permissions ?? { ...DEFAULT_PERMISSIONS, preset: "auto" as const, capPerHour: Infinity };
  const approved = new Set<string>();
  const steps: Step[] = [];
  let body: { content?: Block[]; stop_reason?: string; usage?: Usage } | null = null;
  for (let round = 1; ; round++) {
    if (opts.spend && spentLastHour(opts.spend.log) >= perms.capPerHour)
      throw new Error(`That hit your spending cap of $${perms.capPerHour} an hour. Raise it in Settings to keep going.`);
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
        system,
        messages,
        ...(tools ? { tools: offeredTools(toolDefs(opts.model), perms, approved) } : {}),
        ...(tools && round >= MAX_ROUNDS ? { tool_choice: { type: "none" } } : {}),
      }),
    });
    body = await res.json().catch(() => null);
    if (!res.ok) throw new Error((body as { error?: { message?: string } } | null)?.error?.message ?? `Anthropic API error ${res.status}`);
    opts.spend?.record({ at: Date.now(), usd: costOf(opts.model, body?.usage) });
    const content = body?.content ?? [];
    // The whole content goes back as it came (thinking, server tool results), so the next call can carry on.
    messages.push({ role: "assistant", content });
    for (const b of content) if (b.type === "server_tool_use") report(steps, opts, serverLabel(b));
    if (body?.stop_reason === "pause_turn" && round < MAX_ROUNDS) continue;
    const calls = content.filter((b) => b.type === "tool_use");
    if (body?.stop_reason !== "tool_use" || !calls.length) break;
    const results = [];
    // One at a time, so asks come up in order.
    for (const b of calls) {
      const run = await gated(b.name!, b.input ?? {}, perms, approved, opts, toolCtx).catch((e) => ({ output: String(e?.message ?? e), isError: true, label: b.name! }));
      report(steps, opts, run.label, run.output);
      results.push({ type: "tool_result", tool_use_id: b.id, content: run.output, ...(run.isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }
  const answer = (body?.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
  if (!answer) throw new Error(`No text in the answer (stop reason: ${body?.stop_reason ?? "unknown"})`);
  return { answer, steps };
}

/** Runs one tool call if the settings allow it, asking first when they say to. */
async function gated(name: string, input: Record<string, unknown>, perms: Permissions, approved: Set<string>, opts: TurnOptions, ctx: ToolContext) {
  // The web stand-ins: an OK turns the real tool on for the rest of this turn.
  if (name === "ask_web_search" || name === "ask_web_fetch") {
    const web = name.slice(4);
    const site = web === "web_fetch" ? siteOf(String(input.url ?? "")) : null;
    const what = web === "web_fetch" ? String(input.url ?? "") : `“${input.query ?? ""}”`;
    const label = web === "web_fetch" ? `asked to read ${what}` : `asked to search the web for ${what}`;
    if (web === "web_fetch" && !site) return { output: "That isn't a web address.", isError: true, label };
    const rule = decide(perms, web, input);
    const ok = rule === "allow" || (rule === "ask" && (await opts.approve?.({ tool: web, label: web === "web_fetch" ? `Read ${site}?` : "Search the web?", detail: what, ...(site ? { site } : {}) })));
    if (!ok) return { output: rule === "deny" ? "The user's settings block this." : "The user said no.", isError: true, label };
    approved.add(site ?? "web_search");
    return { output: `Allowed. ${web} is on now${site ? ` for ${site}` : ""}: call it.`, isError: false, label };
  }
  const rule = decide(perms, name, input);
  const label = name === "bash" ? `$ ${String(input.command ?? "").replace(/\s+/g, " ").slice(0, 80)}` : name;
  if (rule === "deny") return { output: "The user's settings block this tool.", isError: true, label };
  if (rule === "ask" && !(await opts.approve?.({ tool: name, label: name === "bash" ? "Run this command?" : "Search your past chats?", detail: name === "bash" ? String(input.command ?? "") : String(input.query ?? "") })))
    return { output: "The user said no to this.", isError: true, label };
  return runTool(name, input, ctx);
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
