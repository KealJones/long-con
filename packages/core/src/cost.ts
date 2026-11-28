// What a chat costs on Claude's API, and what the same chat would cost as a classic chat that resends its whole
// history every turn. One copy for the web chat, the CLI and the evals, so they all report the same numbers.
import { estimateTokens } from "./text.ts";

/** USD per million tokens, from Anthropic's price list (Nov 2026). Haiku 5.5 bills more once a prompt passes 100K tokens. */
export interface Price {
  name: string;
  input: number;
  output: number;
  cacheRead: number;
  longAbove?: number;
  long?: { input: number; output: number; cacheRead: number };
}
export const PRICES: Record<string, Price> = {
  "claude-opus-5-5": { name: "Opus 5.5", input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { name: "Sonnet 5.5", input: 2, output: 10, cacheRead: 0.1 },
  "claude-haiku-5-5": { name: "Haiku 5.5", input: 0.1, output: 0.5, cacheRead: 0.01, longAbove: 100_000, long: { input: 0.5, output: 2.5, cacheRead: 0.05 } },
};
/** A cache write costs this many times the input price: 5-minute cache, 1-hour cache. */
export const WRITE_5M = 1.25;
export const WRITE_1H = 2;
export const WEB_SEARCH_USD = 0.01;
export const MINUTE = 60_000;

/** The price list a model bills at: its own, else its family's, else Opus, to stay on the safe side. */
export function priceOf(model: string): Price {
  const family = /haiku/.test(model) ? "claude-haiku-5-5" : /sonnet/.test(model) ? "claude-sonnet-5-5" : "claude-opus-5-5";
  return PRICES[model] ?? PRICES[family]!;
}

/** One API call's tokens. `input` is the uncached part of the prompt. */
export interface Usage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  cacheWrite1h?: number;
  webSearches?: number;
}

export const promptTokens = (u: Usage) => u.input + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) + (u.cacheWrite1h ?? 0);

export function costOf(model: string, u: Usage): number {
  const p = priceOf(model);
  const r = p.long && promptTokens(u) > p.longAbove! ? p.long : p;
  const tokens = u.input * r.input + (u.cacheWrite ?? 0) * r.input * WRITE_5M + (u.cacheWrite1h ?? 0) * r.input * WRITE_1H + (u.cacheRead ?? 0) * r.cacheRead + u.output * r.output;
  return tokens / 1e6 + (u.webSearches ?? 0) * WEB_SEARCH_USD;
}

/** One API call of a Beep turn, with when it was sent (ms). */
export interface CostCall extends Usage {
  at: number;
}
/** One turn of the chat. `context` is the tokens Beep sent in place of the history (packet plus raw turns).
 * A turn without `calls` wasn't metered: it still grows the classic chat's history, but costs nothing on either side. */
export interface CostTurn {
  model?: string;
  message: string;
  answer?: string;
  context?: number;
  calls?: CostCall[];
}

export interface ClassicOptions {
  /** How long a cached prefix lives after it was last used. */
  ttl: number;
  /** A classic chat compacts when a prompt would pass this. */
  compactAt?: number;
  /** Tokens left after a compaction. */
  summary?: number;
}
// shortcut: compaction is assumed at ~1M (Opus 5.5's window, less room to answer) and to leave a 10K-token summary;
// set both from the compaction docs or real runs if the meter ever leans on them.
export const COMPACT_AT = 950_000;
export const SUMMARY_TOKENS = 10_000;

export interface CostTotals {
  beep: number;
  classic: number;
  turns: number;
  compactions: number;
  /** The largest prompt the classic chat sent. */
  peak: number;
}

/**
 * Prices the metered turns as Beep sent them, and as a classic chat would have: the same system prompt, tools and
 * answers, but the whole history in place of the packet, cached between calls while the cache lives.
 */
export function compareCost(turns: CostTurn[], o: ClassicOptions): CostTotals {
  const compactAt = o.compactAt ?? COMPACT_AT;
  const summary = o.summary ?? SUMMARY_TOKENS;
  const write = (n: number): Partial<Usage> => (o.ttl > 5 * MINUTE ? { cacheWrite1h: n } : { cacheWrite: n });
  let history = 0;
  let cached = 0;
  let last = -Infinity;
  const totals: CostTotals = { beep: 0, classic: 0, turns: 0, compactions: 0, peak: 0 };
  for (const t of turns) {
    const calls = t.calls ?? [];
    const model = t.model ?? "claude-opus-5-5";
    if (calls.length) totals.turns++;
    for (const c of calls) {
      totals.beep += costOf(model, c);
      let prompt = promptTokens(c) - (t.context ?? 0) + history;
      if (prompt > compactAt) {
        // The summarizing call reads the whole history and writes the summary; the next prompt starts a new cache.
        const read = c.at - last <= o.ttl ? Math.min(cached, prompt) : 0;
        totals.classic += costOf(model, { input: 0, cacheRead: read, ...write(prompt - read), output: summary });
        history = summary;
        cached = 0;
        totals.compactions++;
        prompt = promptTokens(c) - (t.context ?? 0) + history;
      }
      const read = c.at - last <= o.ttl ? Math.min(cached, prompt) : 0;
      totals.classic += costOf(model, { input: 0, cacheRead: read, ...write(prompt - read), output: c.output, webSearches: c.webSearches });
      totals.peak = Math.max(totals.peak, prompt);
      cached = prompt;
      last = c.at;
    }
    // What the turn leaves in a classic transcript: the message, any tool rounds, and the answer.
    const rounds = calls.length ? promptTokens(calls.at(-1)!) - promptTokens(calls[0]!) : 0;
    history += estimateTokens(t.message) + rounds + (calls.length ? calls.at(-1)!.output : estimateTokens(t.answer ?? ""));
  }
  return totals;
}
