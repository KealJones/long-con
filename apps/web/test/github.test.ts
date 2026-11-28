import assert from "node:assert/strict";
import { test } from "node:test";
import type { Session } from "@beep/core";
import * as GH from "../src/github.ts";

function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

/** A fake relay plus GitHub REST, recording every call. */
function fakeGitHub(opts: { empty?: boolean; conflictOnce?: boolean; publicRepo?: boolean } = {}) {
  const calls: { method: string; url: string; body?: any }[] = [];
  let empty = opts.empty ?? false;
  let conflict = opts.conflictOnce ?? false;
  let polls = 0;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetch = (async (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const p = url.replace(GH.RELAY, "relay:").replace("https://api.github.com", "");
    if (p === "relay:/auth/device") return json({ device_code: "dc", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", interval: 5 });
    if (p === "relay:/auth/token") return json(++polls < 2 ? { error: "authorization_pending" } : { access_token: "tok", refresh_token: "ref", expires_in: 28800 });
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer tok");
    if (p === "/user") return json({ login: "KealJones" });
    if (p === "/repos/KealJones/chats") return json({ private: !opts.publicRepo, owner: { login: "KealJones" }, name: "chats", default_branch: "main", permissions: { push: true } });
    if (p === "/repos/KealJones/chats/git/ref/heads/main") return empty ? json({ message: "Git Repository is empty." }, 409) : json({ object: { sha: "c1" } });
    if (p === "/repos/KealJones/chats/contents/.beep.json") return (empty = false), json({}, 201);
    if (p === "/repos/KealJones/chats/git/commits/c1") return json({ tree: { sha: "t1" } });
    if (p === "/repos/KealJones/chats/git/blobs") return json({ sha: "b1" }, 201);
    if (p === "/repos/KealJones/chats/git/trees") return json({ sha: "t2" }, 201);
    if (p === "/repos/KealJones/chats/git/commits") return json({ sha: "c2" }, 201);
    if (p === "/repos/KealJones/chats/git/refs/heads/main") return conflict ? ((conflict = false), json({ message: "Update is not a fast forward" }, 422)) : json({});
    return json({ message: `unexpected ${method} ${p}` }, 500);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const day = "2026/11/27 (Fri)";
const history = (): Session[] => [{ id: day, date: day, turns: [{ role: "user", content: "hi" }, { role: "assistant", content: "hey!" }] }];
const packets: GH.Packets = { [`${day}#0`]: { text: "NOTICE\nPACKET ```x```", tokens: 12, model: "claude-opus-5-5", raw: 6, steps: [{ label: "$ ls", output: "a.txt" }] } };

test("signs in with the device flow and refuses a public repo", async () => {
  const gh = fakeGitHub({ publicRepo: true });
  const env = { store: memStore(), fetch: gh.fetch };
  const flow = await GH.startSignIn(env);
  assert.equal(flow.user_code, "ABCD-1234");
  await GH.finishSignIn(env, flow, undefined, async () => {});
  assert.ok(GH.signedIn(env));
  assert.equal(await GH.login(env), "KealJones");
  await assert.rejects(GH.useRepo(env, "KealJones/chats"), /public/);
  assert.equal(GH.savedRepo(env), null);
});

test("an empty repo gets its marker, then one commit with the day and the turn", async () => {
  const gh = fakeGitHub({ empty: true });
  const env = { store: memStore(), fetch: gh.fetch };
  env.store.setItem(GH.AUTH_KEY, JSON.stringify({ access_token: "tok" }));
  await GH.useRepo(env, "https://github.com/KealJones/chats");
  assert.equal(await GH.sync(env, history(), packets), 3);
  const tree = gh.calls.find((c) => c.url.endsWith("/git/trees"))!.body;
  assert.equal(tree.base_tree, "t1");
  const files = Object.fromEntries(tree.tree.map((f: { path: string; content: string }) => [f.path, f.content]));
  assert.deepEqual(Object.keys(files).sort(), ["README.md", "days/2026-11-27.md", "turns/2026-11-27/001.json"]);
  assert.match(files["days/2026-11-27.md"], /\*\*You\*\*\n\nhi[\s\S]*packet · 12 tokens · plus the last 6 turns sent raw · claude-opus-5-5[\s\S]*````text\nNOTICE\nPACKET ```x```\n````[\s\S]*1 tool call/);
  assert.deepEqual(JSON.parse(files["turns/2026-11-27/001.json"]), { day, turn: 1, model: "claude-opus-5-5", message: "hi", packet: "NOTICE\nPACKET ```x```", packetTokens: 12, rawTurns: 6, steps: [{ label: "$ ls", output: "a.txt" }], answer: "hey!" });
  // Nothing new: no commit.
  const before = gh.calls.length;
  assert.equal(await GH.sync(env, history(), packets), 0);
  assert.equal(gh.calls.length, before);
});

test("a later turn sends only its day and its own turn, and retries when someone else pushed first", async () => {
  const gh = fakeGitHub({ conflictOnce: true });
  const env = { store: memStore(), fetch: gh.fetch };
  env.store.setItem(GH.AUTH_KEY, JSON.stringify({ access_token: "tok" }));
  env.store.setItem(GH.REPO_KEY, JSON.stringify({ owner: "KealJones", name: "chats", branch: "main" }));
  env.store.setItem(GH.SYNCED_KEY, JSON.stringify({ [day]: 2 }));
  const h = history();
  h[0]!.turns.push({ role: "user", content: "again" }, { role: "assistant", content: "yep" });
  assert.equal(await GH.sync(env, h, packets), 2);
  const trees = gh.calls.filter((c) => c.url.endsWith("/git/trees"));
  assert.equal(trees.length, 2);
  assert.deepEqual(trees[1]!.body.tree.map((f: { path: string }) => f.path), ["days/2026-11-27.md", "turns/2026-11-27/002.json"]);
  assert.deepEqual(JSON.parse(env.store.getItem(GH.SYNCED_KEY)!), { [day]: 4 });
});

test("packet labels say when nothing matched and how many turns went raw", () => {
  assert.equal(GH.packetLabel({ text: "Earlier chat history was left out to fit.", tokens: 9, raw: 2 }), "empty packet, nothing older matched · plus the last 2 turns sent raw");
  assert.equal(GH.packetLabel({ text: "notice\n\nRetrieved:\nstuff", tokens: 40, raw: 0 }), "packet · 40 tokens · no turns sent raw");
  assert.equal(GH.packetLabel({ text: "old\nentry", tokens: 5 }), "packet · 5 tokens");
  assert.equal(GH.packetLabel({ text: "", tokens: 0, raw: 2 }), "no packet · 0 tokens · plus the last 2 turns sent raw");
});

test("finds a chats repo that already has the marker, else one named like beep-chats", async () => {
  const repos = [
    { name: "notes", full_name: "KealJones/notes", private: true, owner: { login: "KealJones" } },
    { name: "beep", full_name: "KealJones/beep", private: false, owner: { login: "KealJones" } },
    { name: "beep-chats", full_name: "KealJones/beep-chats", private: true, owner: { login: "KealJones" } },
  ];
  const run = async (marked: string | null, marker = ".beep.json") => {
    const fetch = (async (url: string): Promise<Response> => {
      const p = url.replace("https://api.github.com", "");
      if (p.startsWith("/user/installations?")) return new Response(JSON.stringify({ installations: [{ id: 7 }] }));
      if (p.startsWith("/user/installations/7/repositories")) return new Response(JSON.stringify({ repositories: repos }));
      if (marked && p === `/repos/${marked}/contents/${marker}`) return new Response("{}");
      return new Response("{}", { status: 404 });
    }) as typeof globalThis.fetch;
    const env = { store: memStore(), fetch };
    env.store.setItem(GH.AUTH_KEY, JSON.stringify({ access_token: "tok" }));
    return GH.findRepo(env);
  };
  assert.equal(await run("KealJones/notes"), "KealJones/notes");
  assert.equal(await run("KealJones/notes", ".long-con.json"), "KealJones/notes"); // a repo set up before the rename
  assert.equal(await run(null), "KealJones/beep-chats");
  repos.pop();
  assert.equal(await run(null), null);
});

test("attachments go up as blobs next to their day, even when no text changed", async () => {
  const gh = fakeGitHub();
  const env = { store: memStore(), fetch: gh.fetch };
  env.store.setItem(GH.AUTH_KEY, JSON.stringify({ access_token: "tok" }));
  await GH.useRepo(env, "KealJones/chats");
  await GH.sync(env, history(), packets);
  const path = GH.attachmentPath(day, 0, "my cat.jpg");
  assert.equal(path, "attachments/2026-11-27/001-my-cat.jpg");
  assert.equal(await GH.sync(env, history(), packets, new Date(), { [path]: "AAA" }), 1);
  assert.deepEqual(gh.calls.find((c) => c.url.endsWith("/git/blobs"))!.body, { content: "AAA", encoding: "base64" });
  assert.deepEqual(gh.calls.filter((c) => c.url.endsWith("/git/trees")).at(-1)!.body.tree, [{ path, mode: "100644", type: "blob", sha: "b1" }]);
});
