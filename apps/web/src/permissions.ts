// What the model may do without asking, and how much it may spend. No DOM, so it tests in Node.

export type Rule = "allow" | "ask" | "deny";
/** ask: ask before every tool call. risky: ask only for what's hard to undo. auto: never ask. */
export type Preset = "ask" | "risky" | "auto";

export interface Permissions {
  preset: Preset;
  /** Per-tool overrides; a missing tool follows the preset. */
  tools: Partial<Record<string, Rule>>;
  /** Per-site rules for web_fetch (and blocks for web_search), keyed by host like "example.com". */
  sites: Record<string, Rule>;
  /** Dollars of API use per rolling hour. Applies under every preset. */
  capPerHour: number;
}

export const DEFAULT_PERMISSIONS: Permissions = { preset: "risky", tools: {}, sites: {}, capPerHour: 2 };

export const PRESETS: Record<Preset, string> = {
  ask: "Ask before everything",
  risky: "Ask only for risky stuff",
  auto: "Do whatever (never ask)",
};

export const TOOL_NAMES: Record<string, string> = {
  bash: "Shell (files in this browser)",
  search_history: "Search past chats",
  web_search: "Web search",
  web_fetch: "Read web pages",
};

/** "https://www.example.com/a" → "example.com". */
export function siteOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

/** A site's rule, matching the host or any domain above it (a rule for example.com covers docs.example.com). */
export function siteRule(p: Permissions, host: string | null): Rule | undefined {
  for (let h = host; h; h = h.includes(".") ? h.slice(h.indexOf(".") + 1) : null) if (p.sites[h]) return p.sites[h];
  return undefined;
}

/** Shell commands that delete or overwrite files. Appending (>>) and writing to /tmp or /dev/null don't count. */
export function risky(tool: string, input: Record<string, unknown>): boolean {
  if (tool !== "bash") return false;
  const cmd = String(input.command ?? "");
  return /\b(rm|rmdir|mv|truncate|shred)\b|\bsed\s+(-\w*\s+)*-i|(^|[^>&\d])>(?![>&])\s*(?!\/tmp\/|\/dev\/null)\S/.test(cmd);
}

/** Whether one tool call may run, must be asked about, or is refused. */
export function decide(p: Permissions, tool: string, input: Record<string, unknown> = {}): Rule {
  const site = tool === "web_fetch" ? siteRule(p, siteOf(String(input.url ?? ""))) : undefined;
  if (site === "deny" || p.tools[tool] === "deny") return "deny";
  if (site) return site;
  if (p.tools[tool]) return p.tools[tool]!;
  if (p.preset === "auto") return "allow";
  if (p.preset === "ask") return "ask";
  return risky(tool, input) ? "ask" : "allow";
}

type Def = { name: string; [k: string]: unknown };

/**
 * The tools to offer this round. Web search and fetch run on Anthropic's side, so the app can't pause them mid-call:
 * when one needs asking, the model gets a stand-in (ask_web_search, ask_web_fetch) whose call shows the ask, and an
 * approval turns the real tool on for the rest of the turn. `approved` holds "web_search" and approved hosts.
 */
export function offeredTools(defs: Def[], p: Permissions, approved: Set<string>): Def[] {
  const out: Def[] = [];
  const hosts = (rules: Rule[]) => Object.keys(p.sites).filter((h) => rules.includes(p.sites[h]!) && !approved.has(h));
  for (const d of defs) {
    const rule = decide(p, d.name);
    if (rule === "deny") continue;
    if (d.name === "web_search") {
      const blocked = hosts(["deny"]);
      if (rule === "allow" || approved.has("web_search")) out.push({ ...d, ...(blocked.length ? { blocked_domains: blocked } : {}) });
      else out.push(stub("ask_web_search", "Search the web. The user is asked first; if they allow it, web_search turns on and you call it.", "query"));
    } else if (d.name === "web_fetch") {
      const allowedHosts = [...approved].filter((h) => h !== "web_search");
      if (rule === "allow") {
        const blocked = hosts(["deny", "ask"]);
        out.push({ ...d, ...(blocked.length ? { blocked_domains: blocked } : {}) });
        if (hosts(["ask"]).length) out.push(stub("ask_web_fetch", `Read a page on a site the user wants to be asked about first (${hosts(["ask"]).join(", ")}). If they allow it, call web_fetch.`, "url"));
      } else {
        if (allowedHosts.length) out.push({ ...d, allowed_domains: allowedHosts });
        out.push(stub("ask_web_fetch", "Read a web page. The user is asked first; if they allow the site, web_fetch turns on for it and you call it.", "url"));
      }
    } else out.push(d);
  }
  return out;
}

const stub = (name: string, description: string, field: string): Def => ({
  name,
  description,
  input_schema: { type: "object", properties: { [field]: { type: "string" } }, required: [field] },
});

// ── Spending ──────────────────────────────────────────────────────────────

/** Dollars per million tokens, input then output. */
const PRICES: [RegExp, number, number][] = [
  [/opus/, 4, 20],
  [/sonnet/, 2, 10],
  [/haiku/, 0.1, 0.5],
];

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  server_tool_use?: { web_search_requests?: number };
}

/** What one API response cost, in dollars. Unknown models are priced like Opus, to stay on the safe side. */
export function costOf(model: string, u: Usage = {}): number {
  const [, inp, out] = PRICES.find(([re]) => re.test(model)) ?? PRICES[0]!;
  const readRate = model.includes("haiku") ? 0.1 : 0.05;
  const tokens = (u.input_tokens ?? 0) * inp + (u.cache_creation_input_tokens ?? 0) * inp * 1.25 + (u.cache_read_input_tokens ?? 0) * inp * readRate + (u.output_tokens ?? 0) * out;
  return tokens / 1e6 + (u.server_tool_use?.web_search_requests ?? 0) * 0.01;
}

export interface Spend {
  at: number;
  usd: number;
}

export function spentLastHour(log: Spend[], now = Date.now()): number {
  return log.reduce((sum, s) => (now - s.at < 3_600_000 ? sum + s.usd : sum), 0);
}
