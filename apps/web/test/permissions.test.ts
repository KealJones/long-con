import assert from "node:assert/strict";
import { test } from "node:test";
import type { Session } from "@beep/core";
import { sendTurn, type Ask } from "../src/chat.ts";
import { costOf, decide, DEFAULT_PERMISSIONS, offeredTools, risky, siteOf, spentLastHour, type Permissions } from "../src/permissions.ts";
import { toolDefs } from "../src/tools.ts";

const perms = (over: Partial<Permissions> = {}): Permissions => ({ ...DEFAULT_PERMISSIONS, ...over });

test("risky means deleting or overwriting files, not reading or appending", () => {
  for (const c of ["rm /home/a.txt", "mv a b", "echo hi > /home/notes.txt", "sed -i s/a/b/ f", "cat x >f"]) assert.ok(risky("bash", { command: c }), c);
  for (const c of ["ls /home", "cat a | grep b", "echo hi >> /home/log.txt", "ls 2>&1", "echo x > /tmp/y", "cmd > /dev/null", "grep -rn form /home"]) assert.ok(!risky("bash", { command: c }), c);
  assert.ok(!risky("web_search", {}));
});

test("presets, then tool overrides, then sites, with a block anywhere winning", () => {
  assert.equal(decide(perms({ preset: "auto" }), "bash", { command: "rm -r /home" }), "allow");
  assert.equal(decide(perms({ preset: "ask" }), "search_history", { query: "x" }), "ask");
  assert.equal(decide(perms({ preset: "risky" }), "bash", { command: "rm a" }), "ask");
  assert.equal(decide(perms({ preset: "risky" }), "bash", { command: "ls" }), "allow");
  assert.equal(decide(perms({ preset: "ask", tools: { bash: "allow" } }), "bash", { command: "rm a" }), "allow");
  assert.equal(decide(perms({ preset: "auto", tools: { web_fetch: "deny" }, sites: { "example.com": "allow" } }), "web_fetch", { url: "https://example.com" }), "deny");
  assert.equal(decide(perms({ preset: "auto", sites: { "example.com": "ask" } }), "web_fetch", { url: "https://docs.example.com/a" }), "ask");
  assert.equal(decide(perms({ preset: "ask", sites: { "example.com": "allow" } }), "web_fetch", { url: "https://www.example.com/" }), "allow");
  assert.equal(siteOf("not a url"), null);
});

test("web tools that need asking become stand-ins, and an OK turns the real one on for that site", () => {
  const defs = toolDefs("claude-sonnet-5-5");
  const names = (p: Permissions, a = new Set<string>()) => offeredTools(defs, p, a).map((d) => d.name);
  assert.deepEqual(names(perms({ preset: "auto" })), ["bash", "search_history", "web_search", "web_fetch"]);
  assert.deepEqual(names(perms({ preset: "ask" })), ["bash", "search_history", "ask_web_search", "ask_web_fetch"]);
  assert.deepEqual(names(perms({ preset: "ask" }), new Set(["web_search", "a.com"])), ["bash", "search_history", "web_search", "web_fetch", "ask_web_fetch"]);
  assert.deepEqual(offeredTools(defs, perms({ preset: "ask" }), new Set(["a.com"])).find((d) => d.name === "web_fetch")?.allowed_domains, ["a.com"]);
  const auto = offeredTools(defs, perms({ preset: "auto", tools: { bash: "deny" }, sites: { "bad.com": "deny", "careful.com": "ask" } }), new Set());
  assert.deepEqual(auto.map((d) => d.name), ["search_history", "web_search", "web_fetch", "ask_web_fetch"]);
  assert.deepEqual(auto.find((d) => d.name === "web_fetch")?.blocked_domains, ["bad.com", "careful.com"]);
  assert.deepEqual(auto.find((d) => d.name === "web_search")?.blocked_domains, ["bad.com"]);
});

test("cost: tokens by model, plus web searches", () => {
  assert.equal(costOf("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 100_000 }), 3);
  assert.equal(costOf("claude-opus-5-5", { input_tokens: 0, output_tokens: 0, server_tool_use: { web_search_requests: 3 } }), 0.03);
  assert.equal(spentLastHour([{ at: 0, usd: 5 }, { at: 3_000_000, usd: 1 }], 3_700_000), 1);
});

/** A fake API that asks for one tool call, then answers. */
function api(call: { name: string; input: Record<string, unknown> }) {
  const bodies: any[] = [];
  const fetch = (async (_u: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    const first = bodies.length === 1;
    const content = first ? [{ type: "tool_use", id: "t1", ...call }] : [{ type: "text", text: "done" }];
    return new Response(JSON.stringify({ content, stop_reason: first ? "tool_use" : "end_turn", usage: { input_tokens: 1000, output_tokens: 100 } }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, bodies };
}

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

test("an ask that's refused never runs the tool, and the model is told", async () => {
  const a = api({ name: "bash", input: { command: "rm /home/a.txt" } });
  const asks: Ask[] = [];
  const history: Session[] = [];
  await sendTurn(history, "clean up", { apiKey: "k", model: "claude-sonnet-5-5", fetch: a.fetch, store: store(), permissions: perms(), approve: async (x) => (asks.push(x), false) });
  assert.equal(asks.length, 1);
  assert.equal(asks[0]!.detail, "rm /home/a.txt");
  assert.deepEqual(a.bodies[1].messages.at(-1).content[0], { type: "tool_result", tool_use_id: "t1", content: "The user said no to this.", is_error: true });
});

test("approving a site turns web_fetch on for it in the next call", async () => {
  const a = api({ name: "ask_web_fetch", input: { url: "https://news.example.com/story" } });
  await sendTurn([], "read it", { apiKey: "k", model: "claude-sonnet-5-5", fetch: a.fetch, permissions: perms({ preset: "ask" }), approve: async (x) => x.site === "news.example.com" });
  assert.ok(!a.bodies[0].tools.some((t: { name: string }) => t.name === "web_fetch"));
  assert.deepEqual(a.bodies[1].tools.find((t: { name: string }) => t.name === "web_fetch").allowed_domains, ["news.example.com"]);
});

test("the spending cap stops a turn before the next call, under every preset", async () => {
  const a = api({ name: "search_history", input: { query: "x" } });
  const log = [{ at: Date.now(), usd: 0.998 }];
  await assert.rejects(
    sendTurn([], "hi", { apiKey: "k", model: "claude-opus-5-5", fetch: a.fetch, permissions: perms({ preset: "auto", capPerHour: 1 }), spend: { log, record: (s) => log.push(s) } }),
    /spending cap of \$1 an hour/,
  );
  assert.equal(a.bodies.length, 1, "the first call went, the second was stopped");
});
