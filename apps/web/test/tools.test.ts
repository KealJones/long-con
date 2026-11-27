import assert from "node:assert/strict";
import { test } from "node:test";
import { PROFILES, type Session } from "@long-con/core";
import { FILES_KEY, resetShell, runTool } from "../src/tools.ts";

function ctx(fetch?: typeof globalThis.fetch) {
  const store = new Map<string, string>();
  const history: Session[] = [
    { id: "2026/11/20 (Fri)", date: "2026/11/20 (Fri)", turns: [{ role: "user", content: "My dog Biscuit hates the vacuum." }, { role: "assistant", content: "Poor Biscuit." }] },
  ];
  return { store, ctx: { history, profile: PROFILES.claude, fetch, store: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } } };
}

test("bash keeps /home between runs and in the store, and /tmp only for the page", async () => {
  resetShell();
  const { store, ctx: c } = ctx();
  await runTool("bash", { command: "mkdir -p notes && echo milk > notes/shop.txt && echo scratch > /tmp/x" }, c);
  assert.deepEqual(JSON.parse(store.get(FILES_KEY)!), { "/home/notes/shop.txt": "milk\n" });
  resetShell(); // a reload: /home comes back from the store, /tmp doesn't
  const r = await runTool("bash", { command: "cat ~/notes/shop.txt; cat /tmp/x" }, c);
  assert.match(r.output, /^milk\n/);
  assert.match(r.output, /exit code 1/);
  assert.equal(r.label, "$ cat ~/notes/shop.txt; cat /tmp/x (exit 1)");
});

test("custom commands: bc, man, --help, curl and wiki", async () => {
  resetShell();
  const fetch = (async (url: string) =>
    url.includes("wikipedia")
      ? new Response(JSON.stringify({ query: { pages: [{ title: "Emma Stone", extract: "American actress.", fullurl: "https://en.wikipedia.org/wiki/Emma_Stone", index: 1 }] } }))
      : new Response("plain text page\nline two\n", { headers: { "content-type": "text/plain" } })) as unknown as typeof globalThis.fetch;
  const { ctx: c } = ctx(fetch);
  const run = async (command: string) => (await runTool("bash", { command }, c)).output;
  assert.equal(await run('echo "15% of 240" | bc -l'), "36\n");
  assert.match(await run("man"), /curl +curl URL/);
  assert.match(await run("curl --help"), /GET only/);
  assert.equal(await run("curl example.com | grep two"), "line two\n");
  assert.match(await run("curl -X POST https://example.com"), /only reads pages/);
  assert.match(await run("wiki emma stone"), /^Emma Stone \(https:\/\/en\.wikipedia\.org\/wiki\/Emma_Stone\)\nAmerican actress\./);
});

test("search_history uses core's search", async () => {
  const { ctx: c } = ctx();
  const r = await runTool("search_history", { query: "Biscuit vacuum" }, c);
  assert.match(r.output, /Biscuit hates the vacuum/);
  assert.equal(r.label, "searched past chats for “Biscuit vacuum”");
});
