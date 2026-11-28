// Save the chat to a private GitHub repo, the way Squiggle does: sign in with GitHub's device flow through
// Squiggle's relay (github.com's login endpoints send no CORS headers), then write files with the REST API.
// One commit per sync: each day as readable markdown, and each turn as JSON with its exact packet.
// No DOM here, so the test can run it in Node with a fake fetch.

import type { Session } from "@long-con/core";
import type { Step } from "./chat.ts";

// shortcut: borrows Squiggle's relay and GitHub App (it already allows kealjones.com); give Long Con its own
// App and relay if it should show its own name on the GitHub sign-in page.
export const RELAY = "https://squiggle-relay.kealjones.workers.dev/api";
export const INSTALL_URL = "https://github.com/apps/squiggle-github/installations/new";
export const REPO_NAME = "long-con-chats";
export const NEW_REPO_URL = `https://github.com/new?name=${REPO_NAME}&visibility=private&description=Long%20Con%20chats`;
const REST = "https://api.github.com";
export const AUTH_KEY = "long-con:github";
export const REPO_KEY = "long-con:github-repo";
/** Day id → how many turns of it are in the repo, so a sync only sends what's new. */
export const SYNCED_KEY = "long-con:github-synced";
const MARKER = ".long-con.json";

export interface Auth {
  access_token: string;
  refresh_token?: string | null;
  expires_at?: number | null;
}
export interface Repo {
  owner: string;
  name: string;
  branch: string;
}
/** The packet store as the page keeps it: one entry per user turn. */
export type Packets = Record<string, { text: string; tokens: number; steps?: Step[]; model?: string; raw?: number }>;

/** The packet always opens with the history notice; a packet of that line alone found nothing. */
import { packetEmpty } from "@long-con/core";
export { packetEmpty };

/** "packet · 58 tokens · plus the last 6 turns sent raw", or "no packet · 0 tokens · …" when it found nothing and none was sent. */
export function packetLabel(p: Packets[string]): string {
  const raw = p.raw === undefined ? "" : p.raw ? ` · plus the last ${p.raw} ${p.raw === 1 ? "turn" : "turns"} sent raw` : " · no turns sent raw";
  // Older turns saved a notice-only packet that was still sent; newer ones save "" for none sent.
  const head = !p.text ? "no packet · 0 tokens" : packetEmpty(p.text) ? "empty packet, nothing older matched" : `packet · ${p.tokens} tokens`;
  return head + raw;
}

export interface Env {
  store: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  fetch?: typeof fetch;
}

const read = <T>(env: Env, key: string): T | null => {
  try {
    return JSON.parse(env.store.getItem(key) ?? "null");
  } catch {
    return null;
  }
};
const write = (env: Env, key: string, value: unknown) => env.store.setItem(key, JSON.stringify(value));

export const signedIn = (env: Env) => Boolean(read<Auth>(env, AUTH_KEY));
export const savedRepo = (env: Env) => read<Repo>(env, REPO_KEY);
export function signOut(env: Env) {
  env.store.removeItem(AUTH_KEY);
}

async function relay(env: Env, path: string, body: unknown = {}) {
  const res = await (env.fetch ?? fetch)(RELAY + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data.error) data.error = `HTTP ${res.status}`;
  return data;
}

/** Step 1: a code for the person to enter at verification_uri. */
export async function startSignIn(env: Env): Promise<{ device_code: string; user_code: string; verification_uri: string; interval?: number; expires_in?: number }> {
  const d = await relay(env, "/auth/device");
  if (d.error) throw new Error(d.error_description || d.error);
  return d;
}

/** Step 2: wait until they approve on github.com. */
export async function finishSignIn(env: Env, flow: { device_code: string; interval?: number; expires_in?: number }, signal?: AbortSignal, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
  let interval = Math.max(5, flow.interval ?? 5) * 1000;
  const deadline = Date.now() + (flow.expires_in ?? 900) * 1000;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Sign-in cancelled.");
    await sleep(interval);
    const t = await relay(env, "/auth/token", { device_code: flow.device_code });
    if (t.access_token) return saveTokens(env, t);
    if (t.error === "authorization_pending") continue;
    if (t.error === "slow_down") {
      interval += 5000;
      continue;
    }
    throw new Error(t.error_description || t.error || "Sign-in failed.");
  }
  throw new Error("The sign-in code expired. Try again.");
}

function saveTokens(env: Env, t: { access_token: string; refresh_token?: string; expires_in?: number }) {
  write(env, AUTH_KEY, { access_token: t.access_token, refresh_token: t.refresh_token ?? null, expires_at: t.expires_in ? Date.now() + t.expires_in * 1000 : null });
}

async function token(env: Env): Promise<string> {
  const auth = read<Auth>(env, AUTH_KEY);
  if (!auth) throw new Error("Sign in to GitHub in Settings first.");
  if (auth.expires_at && auth.expires_at - Date.now() < 5 * 60_000) {
    const t = auth.refresh_token ? await relay(env, "/auth/refresh", { refresh_token: auth.refresh_token }) : {};
    if (!t.access_token) {
      signOut(env);
      throw new Error("Your GitHub sign-in expired. Sign in again in Settings.");
    }
    saveTokens(env, t);
    return t.access_token;
  }
  return auth.access_token;
}

async function gh(env: Env, path: string, method = "GET", body?: unknown) {
  const res = await (env.fetch ?? fetch)(REST + path, {
    method,
    cache: "no-store",
    headers: { Authorization: `Bearer ${await token(env)}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.message ?? `GitHub API error ${res.status}`), { status: res.status });
  return data;
}

export const login = async (env: Env): Promise<string> => (await gh(env, "/user")).login;

interface GhRepo {
  name: string;
  full_name: string;
  private: boolean;
  owner: { login: string };
}

/** Whether the GitHub app is installed anywhere this person can see. */
export const installed = async (env: Env) => ((await gh(env, "/user/installations?per_page=100")).installations ?? []).length > 0;

/** Every repo the GitHub app can reach for this person. */
export async function accessibleRepos(env: Env): Promise<GhRepo[]> {
  const out: GhRepo[] = [];
  for (const inst of (await gh(env, "/user/installations?per_page=100")).installations ?? [])
    for (let page = 1; page <= 10; page++) {
      const d = await gh(env, `/user/installations/${inst.id}/repositories?per_page=100&page=${page}`);
      out.push(...(d.repositories ?? []));
      if ((d.repositories ?? []).length < 100) break;
    }
  return out;
}

/** Like Squiggle's findExistingStorage: a private repo that already has Long Con's marker, else one named like long-con-chats. */
export async function findRepo(env: Env): Promise<string | null> {
  const repos = (await accessibleRepos(env)).filter((r) => r.private);
  const named = (r: GhRepo) => (r.name.toLowerCase() === REPO_NAME ? 2 : /long-?con/i.test(r.name) ? 1 : 0);
  repos.sort((a, b) => named(b) - named(a));
  for (const r of repos.slice(0, 25)) {
    try {
      await gh(env, `/repos/${r.full_name}/contents/${MARKER}`);
      return r.full_name;
    } catch {
      // Not this one.
    }
  }
  return repos.find(named)?.full_name ?? null;
}

/** Makes a new private repo. Throws with code "cannot-create" when the app isn't allowed to (then the page links to github.com/new). */
export async function createRepo(env: Env, name = REPO_NAME): Promise<string> {
  try {
    return (await gh(env, "/user/repos", "POST", { name, private: true, auto_init: true, description: "Long Con chats: transcripts and packets. Private." })).full_name;
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401 || status === 403 || status === 404) throw Object.assign(new Error("GitHub didn't let Long Con create the repo."), { code: "cannot-create" });
    if (status === 422) throw new Error(`You already have a repo named ${name}. Give the GitHub app access to it and it'll be found.`);
    throw e;
  }
}

/** Checks a repo before using it, like Squiggle: it has to be private and writable. */
export async function useRepo(env: Env, spec: string): Promise<Repo> {
  const m = spec.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$|\/$/g, "").match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) throw new Error("Enter the repo as owner/name.");
  let r;
  try {
    r = await gh(env, `/repos/${m[1]}/${m[2]}`);
  } catch (e) {
    if ((e as { status?: number }).status === 404) throw new Error(`Can't see ${m[1]}/${m[2]}. Install the GitHub app on it first.`);
    throw e;
  }
  if (!r.private) throw new Error("That repo is public, so your chats would be visible to everyone. Make it private or pick another.");
  if (r.permissions && !r.permissions.push) throw new Error("Long Con can read that repo but not write to it. Give the GitHub app access to it.");
  const repo = { owner: r.owner.login, name: r.name, branch: r.default_branch || "main" };
  write(env, REPO_KEY, repo);
  env.store.removeItem(SYNCED_KEY); // A new repo gets everything.
  env.store.removeItem(PULLED_KEY);
  return repo;
}

export function forgetRepo(env: Env) {
  env.store.removeItem(REPO_KEY);
  env.store.removeItem(SYNCED_KEY);
  env.store.removeItem(PULLED_KEY);
}

/** Next sync sends every day again (after an import or a delete changes what's here). */
export const resend = (env: Env) => env.store.removeItem(SYNCED_KEY);

/** "2026/11/27 (Fri)" → "2026-11-27". */
const slug = (id: string) => id.match(/^(\d{4})\/(\d{2})\/(\d{2})/)?.slice(1).join("-") ?? id.replace(/[^\w-]+/g, "-");
const keyOf = (sessionId: string, turn: number) => `${sessionId}#${turn}`;

/** The files for what changed since the last sync: whole days as markdown, new turns as JSON. */
export function changedFiles(history: Session[], packets: Packets, synced: Record<string, number>): Record<string, string> {
  const files: Record<string, string> = {};
  for (const s of history) {
    const done = synced[s.id] ?? 0;
    if (s.turns.length === done) continue;
    files[`days/${slug(s.id)}.md`] = dayMarkdown(s, packets);
    for (let i = done - (done % 2); i < s.turns.length; i += 2) {
      const user = s.turns[i]!;
      const p = packets[keyOf(s.id, i)];
      const turn = { day: s.id, turn: i / 2 + 1, model: p?.model, message: user.content, packet: p?.text, packetTokens: p?.tokens, rawTurns: p?.raw, steps: p?.steps ?? [], answer: s.turns[i + 1]?.content };
      files[`turns/${slug(s.id)}/${String(i / 2 + 1).padStart(3, "0")}.json`] = JSON.stringify(turn, null, 2) + "\n";
    }
  }
  return files;
}

function dayMarkdown(s: Session, packets: Packets): string {
  const fence = (text: string) => {
    const ticks = "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));
    return `${ticks}text\n${text}\n${ticks}`;
  };
  const out = [`# ${s.id}`, ""];
  s.turns.forEach((t, i) => {
    out.push(`**${t.role === "user" ? "You" : "Long Con"}**`, "", t.content, "");
    const p = packets[keyOf(s.id, t.role === "user" ? i : i - 1)];
    if (p && t.role === "user") out.push(`<details><summary>${packetLabel(p)}${p.model ? ` · ${p.model}` : ""}</summary>`, "", fence(p.text), "", "</details>", "");
    if (p?.steps?.length && t.role === "assistant") {
      const steps = p.steps.map((x) => (x.output === undefined ? x.label : `${x.label}\n${x.output}`)).join("\n\n");
      out.push(`<details><summary>${p.steps.length} tool ${p.steps.length === 1 ? "call" : "calls"}</summary>`, "", fence(steps), "", "</details>", "");
    }
  });
  return out.join("\n");
}

const README = `# Long Con chats

Saved by the Long Con web chat. \`days/\` has each day as you'd read it, with the packet behind each message and the tools behind each answer. \`turns/\` has every turn as JSON with the exact packet the model was given.
`;

/** Where a message's attached file goes in the repo: next to that day's turns. */
export const attachmentPath = (sessionId: string, turn: number, name: string) =>
  `attachments/${slug(sessionId)}/${String(Math.floor(turn / 2) + 1).padStart(3, "0")}-${name.replace(/[^\w.-]+/g, "-")}`;

/** Commits whatever changed since the last sync. Returns how many files went up (0 when nothing had changed).
 * `binaries` are extra files as base64, like attachments (path → data); they go up with the next commit. */
export async function sync(env: Env, history: Session[], packets: Packets, now = new Date(), binaries: Record<string, string> = {}): Promise<number> {
  const repo = savedRepo(env);
  if (!repo) return 0;
  const synced = read<Record<string, number>>(env, SYNCED_KEY) ?? {};
  const files = changedFiles(history, packets, synced);
  if (!Object.keys(files).length && !Object.keys(binaries).length) return 0;
  const base = `/repos/${repo.owner}/${repo.name}`;
  for (let attempt = 0; ; attempt++) {
    let parent: string;
    try {
      parent = (await gh(env, `${base}/git/ref/heads/${repo.branch}`)).object.sha;
    } catch (e) {
      // An empty repo has no branch yet, and the tree API can't start one, so the marker file's commit does.
      if (![404, 409].includes((e as { status?: number }).status ?? 0) || attempt) throw e;
      await gh(env, `${base}/contents/${MARKER}`, "PUT", { message: "Start Long Con chats", content: b64(JSON.stringify({ app: "long-con", v: 1, created: now.toISOString() }, null, 2) + "\n"), branch: repo.branch });
      files["README.md"] = README;
      continue;
    }
    const { tree: baseTree } = await gh(env, `${base}/git/commits/${parent}`);
    const blobs = await Promise.all(Object.entries(binaries).map(async ([path, content]) => ({ path, mode: "100644", type: "blob", sha: (await gh(env, `${base}/git/blobs`, "POST", { content, encoding: "base64" })).sha })));
    const tree = await gh(env, `${base}/git/trees`, "POST", { base_tree: baseTree.sha, tree: [...Object.entries(files).map(([path, content]) => ({ path, mode: "100644", type: "blob", content })), ...blobs] });
    const days = history.filter((s) => (synced[s.id] ?? 0) !== s.turns.length).length;
    const commit = await gh(env, `${base}/git/commits`, "POST", { message: `Chat: ${days} ${days === 1 ? "day" : "days"} updated`, tree: tree.sha, parents: [parent] });
    try {
      await gh(env, `${base}/git/refs/heads/${repo.branch}`, "PATCH", { sha: commit.sha });
    } catch (e) {
      // Someone else pushed in between: build on their commit instead (paths here are only ever ours).
      if ((e as { status?: number }).status === 422 && attempt < 3) continue;
      throw e;
    }
    write(env, PULLED_KEY, commit.sha);
    break;
  }
  write(env, SYNCED_KEY, Object.fromEntries(history.map((s) => [s.id, s.turns.length])));
  return Object.keys(files).length + Object.keys(binaries).length;
}

/** Day ids deleted in this browser: a pull leaves them out instead of bringing them back. */
export const SKIP_KEY = "long-con:github-skip";
/** The repo commit this browser last pulled, so an unchanged repo costs one request. */
const PULLED_KEY = "long-con:github-pulled";
export const skipDays = (env: Env, ids: string[]) => write(env, SKIP_KEY, [...new Set([...(read<string[]>(env, SKIP_KEY) ?? []), ...ids])]);

interface SavedTurn { day: string; message: string; answer?: string; model?: string; packet?: string; packetTokens?: number; rawTurns?: number; steps?: Step[] }

/** Brings in turns saved from another browser (the phone, say), merging them into `history` and `packets` in place.
 * A day the repo has more of, or different turns of, becomes the repo's turns followed by any turns only this browser has.
 * Returns how many turns came in. Call it before `sync`, so a sync never writes over another browser's turns. */
export async function pull(env: Env, history: Session[], packets: Packets, canMerge = () => true): Promise<number> {
  const repo = savedRepo(env);
  if (!repo) return 0;
  const base = `/repos/${repo.owner}/${repo.name}`;
  let head: string;
  try {
    head = (await gh(env, `${base}/git/ref/heads/${repo.branch}`)).object.sha;
  } catch (e) {
    if ([404, 409].includes((e as { status?: number }).status ?? 0)) return 0; // Empty repo: nothing to pull.
    throw e;
  }
  if (read<string>(env, PULLED_KEY) === head) return 0;
  const { tree } = await gh(env, `${base}/git/trees/${head}?recursive=1`);
  const files = new Map<string, { path: string; sha: string }[]>();
  for (const f of tree as { path: string; sha: string; type: string }[]) {
    const m = f.type === "blob" && f.path.match(/^turns\/([^/]+)\/\d+\.json$/);
    if (m) files.set(m[1]!, [...(files.get(m[1]!) ?? []), f]);
  }
  const skip = new Set(read<string[]>(env, SKIP_KEY) ?? []);
  const synced = read<Record<string, number>>(env, SYNCED_KEY) ?? {};
  const fetched: SavedTurn[][] = [];
  for (const [daySlug, list] of files) {
    const local = history.find((s) => slug(s.id) === daySlug);
    // Fetch only days with turn files beyond what this browser last saw there. shortcut: misses another browser
    // rewriting a turn file this one already saw, which only happens when both saved while offline from each other.
    if (local && (skip.has(local.id) || Math.ceil((synced[local.id] ?? 0) / 2) >= list.length)) continue;
    list.sort((a, b) => a.path.localeCompare(b.path));
    // shortcut: one request per turn file; a first pull of a long chat is hundreds of requests (GitHub allows 5,000 an hour).
    fetched.push(await Promise.all(list.map(async (f) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob((await gh(env, `${base}/git/blobs/${f.sha}`)).content.replace(/\s/g, "")), (c) => c.charCodeAt(0)))))));
  }
  // A turn started while this was fetching: merge next time, so its turn numbers don't move under it.
  if (!canMerge()) return 0;
  let added = 0;
  for (const saved of fetched) {
    const id = saved[0]!.day;
    const local = history.find((s) => s.id === id);
    if (skip.has(id)) continue;
    const turns: Session["turns"] = [];
    const dayPackets: Packets = {};
    for (const t of saved) {
      if (t.packet !== undefined) dayPackets[keyOf(id, turns.length)] = { text: t.packet, tokens: t.packetTokens ?? 0, model: t.model, raw: t.rawTurns, ...(t.steps?.length ? { steps: t.steps } : {}) };
      turns.push({ role: "user", content: t.message });
      if (t.answer !== undefined) turns.push({ role: "assistant", content: t.answer });
    }
    const inRepo = turns.length;
    // Turns only this browser has go after the repo's, keeping their packets.
    const pairs = new Set(saved.map((t) => `${t.message}\u0000${t.answer ?? ""}`));
    const old = local?.turns ?? [];
    for (let i = 0; i < old.length; i += 2) {
      if (pairs.has(`${old[i]!.content}\u0000${old[i + 1]?.content ?? ""}`)) continue;
      const p = packets[keyOf(id, i)];
      if (p) dayPackets[keyOf(id, turns.length)] = p;
      turns.push(...old.slice(i, i + 2));
    }
    const mine = new Set(old.flatMap((t, i) => (i % 2 ? [] : [`${t.content}\u0000${old[i + 1]?.content ?? ""}`])));
    added += [...pairs].filter((k) => !mine.has(k)).length;
    for (const k of Object.keys(packets)) if (k.startsWith(`${id}#`)) delete packets[k];
    Object.assign(packets, dayPackets);
    if (local) local.turns = turns;
    else history.push({ id, date: id, turns });
    synced[id] = inRepo; // The repo already has these; a sync sends only what's after them.
  }
  history.sort((a, b) => a.id.localeCompare(b.id));
  write(env, SYNCED_KEY, synced);
  write(env, PULLED_KEY, head);
  return added;
}

const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
