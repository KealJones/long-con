// The page: a texting-style chat, a settings dialog, and a sidebar for topics and your data.

import { compareCost, MINUTE, priceOf, type CostTurn, type Session } from "@beep/core";
import { attachedNote, dayLabel, MODELS, PROFILE, sendTurn, type Ask, type Attachment } from "./chat.ts";
import * as Files from "./files.ts";
import * as P from "./permissions.ts";
import * as T from "./threads.ts";
import { extractRules } from "@beep/core";
import * as Voice from "./voice.ts";
import * as GH from "./github.ts";
import { FILES_KEY, resetShell } from "./tools.ts";
import { dayName, topics } from "./topics.ts";
import { loadEmbedder } from "./embedder.ts";
import type { Embed } from "@beep/core";

// The evals' embedding veto runs here too. Loading starts now; a send waits for it, and a failed load is retried next send.
let embedReady: Promise<Embed | undefined> | null = null;
const embedder = () =>
  (embedReady ??= loadEmbedder(PROFILE).catch((err) => {
    embedReady = null;
    throw new Error(`Couldn't load the search model: ${err instanceof Error ? err.message : err}`);
  }));
embedder().catch(() => {});

/** Per user turn: the packet it went with, the model, and the tools the answer used. */
type Packets = GH.Packets;

// Moves anything saved under the old key prefix to "beep:", once (same origin, so it carries over).
for (const old of Object.keys(localStorage).filter((k) => k.startsWith("long-con:"))) {
  const key = `beep:${old.slice(9)}`;
  const value = localStorage.getItem(old)!;
  localStorage.removeItem(old); // first, so a big history doesn't need room for two copies
  try {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
  } catch {
    localStorage.setItem(old, value);
  }
}

// shortcut: localStorage caps out around 5 MB; move to IndexedDB once a chat gets near that.
const load = <T>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
};
const saveChat = () => {
  try {
    localStorage.setItem("beep:history", JSON.stringify(history));
    localStorage.setItem("beep:packets", JSON.stringify(packets));
    localStorage.setItem("beep:threads", JSON.stringify(threads));
  } catch {
    setStatus("Couldn't save to this browser's storage. Export your chat so nothing is lost.");
  }
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const app = document.querySelector<HTMLElement>(".app")!;
const log = $("log");
const form = $<HTMLFormElement>("form");
const input = $<HTMLTextAreaElement>("input");
const send = $<HTMLButtonElement>("send");
const status = $("status");
const presence = $("presence");
const keyInput = $<HTMLInputElement>("key");
const modelSelect = $<HTMLSelectElement>("model");
const settings = $<HTMLDialogElement>("settings");
const sidebar = $("sidebar");
const scrim = $("scrim");
const search = $<HTMLInputElement>("search");

const history: Session[] = load("beep:history", []);
const packets: Packets = load("beep:packets", {});
const threads: T.Thread[] = load("beep:threads", []);
const perms: P.Permissions = { ...P.DEFAULT_PERMISSIONS, ...load<Partial<P.Permissions>>("beep:permissions", {}) };
// shortcut: undone rules live in this browser only; sync them with the chat if undo on one device should hold on all.
const mutedRules: string[] = load("beep:muted-rules", []);
const saveMuted = () => localStorage.setItem("beep:muted-rules", JSON.stringify(mutedRules));
const savePerms = () => localStorage.setItem("beep:permissions", JSON.stringify(perms));
const spendLog: P.Spend[] = load<P.Spend[]>("beep:spend", []).filter((s) => Date.now() - s.at < 3_600_000);
const spend = { log: spendLog, record: (s: P.Spend) => (spendLog.push(s), localStorage.setItem("beep:spend", JSON.stringify(spendLog)), renderSpent()) };
/** Attached files not in the GitHub repo yet, path → base64. shortcut: kept for this page only; a reload before a save leaves them out of the repo (they stay in this browser). */
const unsavedFiles: Record<string, string> = {};
/** The marker a saved turn carries for its files (see attachedNote). */
const ATTACHED = /\n\n\[Attached: [^\]]*\]$/;
const keyOf = (sessionId: string, turn: number) => `${sessionId}#${turn}`;

// ---------- Settings ----------

keyInput.value = localStorage.getItem("beep:key") ?? "";
keyInput.addEventListener("input", () => localStorage.setItem("beep:key", keyInput.value.trim()));
for (const m of MODELS) modelSelect.add(new Option(m, m));
modelSelect.value = localStorage.getItem("beep:model") ?? MODELS[0]!;
modelSelect.addEventListener("change", () => localStorage.setItem("beep:model", modelSelect.value));
const rawSelect = $<HTMLSelectElement>("raw-turns");
for (let n = 0; n <= PROFILE.rawTurns; n++) rawSelect.append(new Option(n === PROFILE.rawTurns ? `${n} (default)` : String(n), String(n)));
rawSelect.value = localStorage.getItem("beep:raw-turns") ?? String(PROFILE.rawTurns);
rawSelect.addEventListener("change", () => localStorage.setItem("beep:raw-turns", rawSelect.value));

// Permissions: a preset, per-tool and per-site overrides, and the hourly spending cap.
const RULES: Record<P.Rule, string> = { allow: "Allow", ask: "Ask", deny: "Block" };
const ruleSelect = (value: string, withDefault: boolean) => {
  const sel = document.createElement("select");
  if (withDefault) sel.add(new Option("Like the preset", ""));
  for (const [v, label] of Object.entries(RULES)) sel.add(new Option(label, v));
  sel.value = value;
  return sel;
};
const presetSelect = $<HTMLSelectElement>("preset");
for (const [v, label] of Object.entries(P.PRESETS)) presetSelect.add(new Option(label, v));
presetSelect.value = perms.preset;
presetSelect.addEventListener("change", () => ((perms.preset = presetSelect.value as P.Preset), savePerms()));
const capInput = $<HTMLInputElement>("cap");
capInput.value = String(perms.capPerHour);
capInput.addEventListener("change", () => {
  const v = Number(capInput.value);
  if (Number.isFinite(v) && v >= 0) (perms.capPerHour = v), savePerms();
  capInput.value = String(perms.capPerHour);
  renderSpent();
});
function renderSpent() {
  $("spent").textContent = `Spent in the last hour: $${P.spentLastHour(spendLog).toFixed(2)} of $${perms.capPerHour}. Turns stop at the cap, whatever the preset.`;
}
function renderRules() {
  $("tool-rules").replaceChildren(...Object.entries(P.TOOL_NAMES).map(([tool, name]) => {
    const row = el("label", "rule-row");
    const sel = ruleSelect(perms.tools[tool] ?? "", true);
    sel.addEventListener("change", () => {
      if (sel.value) perms.tools[tool] = sel.value as P.Rule;
      else delete perms.tools[tool];
      savePerms();
    });
    row.append(el("span", "", name), sel);
    return row;
  }));
  $("site-rules").replaceChildren(...Object.entries(perms.sites).map(([host, rule]) => {
    const row = el("div", "rule-row");
    const sel = ruleSelect(rule, false);
    sel.setAttribute("aria-label", `Rule for ${host}`);
    sel.addEventListener("change", () => ((perms.sites[host] = sel.value as P.Rule), savePerms()));
    const del = btn("", "✕");
    del.setAttribute("aria-label", `Remove ${host}`);
    del.addEventListener("click", () => (delete perms.sites[host], savePerms(), renderRules()));
    row.append(el("span", "", host), sel, del);
    return row;
  }));
}
const siteRuleSelect = $<HTMLSelectElement>("site-rule");
for (const [v, label] of Object.entries(RULES)) siteRuleSelect.add(new Option(label, v));
$("site-add").addEventListener("click", () => {
  const field = $<HTMLInputElement>("site-host");
  const host = P.siteOf(field.value.includes("://") ? field.value : `https://${field.value.trim()}`);
  if (!host) return;
  perms.sites[host] = siteRuleSelect.value as P.Rule;
  field.value = "";
  savePerms();
  renderRules();
});

/** Shows an ask as a card in a chat log and waits for a tap. "Always" saves the rule, so it's not asked again. */
const approver = (where: HTMLElement) => (ask: Ask) =>
  new Promise<boolean>((resolve) => {
    const row = el("div", "row assistant");
    const card = el("div", "approval");
    card.append(el("b", "", ask.label));
    if (ask.detail) card.append(el("pre", "", ask.detail));
    const acts = el("div", "acts");
    const choose = (ok: boolean, always = false) => {
      if (always) {
        if (ask.site) perms.sites[ask.site] = "allow";
        else perms.tools[ask.tool] = "allow";
        savePerms();
        renderRules();
      }
      acts.replaceWith(el("div", "done", ok ? (always ? `Allowed, and won't ask again for ${ask.site ?? P.TOOL_NAMES[ask.tool] ?? ask.tool}.` : "Allowed.") : "Not allowed."));
      resolve(ok);
    };
    const yes = action("Allow", () => choose(true), true);
    acts.append(yes, action(ask.site ? `Always allow ${ask.site}` : "Always allow", () => choose(true, true)), action("Don't", () => choose(false)));
    card.append(acts);
    row.append(card);
    where.append(row);
    where.scrollTop = where.scrollHeight;
    yes.focus();
  });
$("show-key").addEventListener("click", (e) => {
  const show = keyInput.type === "password";
  keyInput.type = show ? "text" : "password";
  (e.currentTarget as HTMLElement).textContent = show ? "Hide" : "Show";
  (e.currentTarget as HTMLElement).setAttribute("aria-pressed", String(show));
});
$("open-settings").addEventListener("click", () => settings.showModal());
settings.addEventListener("close", () => {
  keyInput.type = "password";
  input.focus();
});

// ---------- Save to GitHub: the same steps as Squiggle's setup ----------

const ghEnv: GH.Env = { store: localStorage };
const ghBox = $("gh");
let ghLogin = "";
let ghSaved: Date | null = null;
/** A setup step is on screen, so the usual view stays out of its way. */
let ghStep = false;

const hint = (text: string) => el("p", "hint", text);
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const actions = (...nodes: Node[]) => {
  const d = el("div", "gh-actions");
  d.append(...nodes);
  return d;
};
const action = (text: string, onClick: () => void, primary = false) => {
  const b = btn(primary ? "primary" : "", text);
  b.addEventListener("click", onClick);
  return b;
};
const away = (text: string, href: string, primary = false) => Object.assign(el("a", `button${primary ? " primary" : ""}`, text), { href, target: "_blank", rel: "noopener" });
const show = (...nodes: Node[]) => {
  ghStep = true;
  ghBox.replaceChildren(...nodes);
};

/** The usual view: signed out, or saving to a repo. */
function renderGitHub(note = "") {
  if (ghStep) return;
  if (!GH.signedIn(ghEnv)) return ghBox.replaceChildren(hint(note || "Keep a copy of every message, packet and tool call in a private repo of yours."), actions(action("Sign in with GitHub", signIn, true)));
  if (!ghLogin) GH.login(ghEnv).then((l) => ((ghLogin = l), renderGitHub()), () => {});
  const repo = GH.savedRepo(ghEnv);
  if (!repo) return ghBox.replaceChildren(hint(note || "Signed in, but no repo yet."), actions(action("Find my repo", setUpRepo, true), action("Sign out", signOut)));
  const when = ghSaved ? `, last at ${ghSaved.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "";
  ghBox.replaceChildren(
    hint(note || `${ghLogin ? `Signed in as ${ghLogin}. ` : ""}Each message saves to ${repo.owner}/${repo.name}${when}. Deleting here doesn't delete it there.`),
    actions(action("Save now", () => saveToGitHub(true)), action("Change repo", pickRepo), action("Sign out", signOut)),
  );
}

function fail(err: unknown) {
  ghStep = false;
  renderGitHub(errText(err));
}

async function signIn() {
  show(hint("Asking GitHub for a code…"));
  try {
    const flow = await GH.startSignIn(ghEnv);
    // One tap copies the code and opens GitHub's page, so it's just a paste there.
    const go = action("Copy code and open GitHub", () => {
      navigator.clipboard?.writeText(flow.user_code).catch(() => {});
      window.open("https://github.com/login/device", "_blank", "noopener");
      go.textContent = "Copied. Paste it on GitHub";
    }, true);
    show(hint("Enter this code on GitHub:"), el("div", "gh-code", flow.user_code), actions(go), hint("Waiting for you to approve… this continues on its own."));
    go.focus();
    await GH.finishSignIn(ghEnv, flow);
    await setUpRepo();
  } catch (err) {
    fail(err);
  }
}

/** After sign-in: make sure the app can see repos, then use the chats repo if there is one. */
async function setUpRepo() {
  show(hint("Signed in. Looking for your chats repo…"));
  try {
    if (!(await GH.installed(ghEnv))) {
      show(hint("Give the GitHub app access to your repos. This continues on its own when you come back."), actions(away("Give access on GitHub", GH.INSTALL_URL, true), action("I did it", setUpRepo)));
      addEventListener("focus", setUpRepo, { once: true });
      return;
    }
    const found = await GH.findRepo(ghEnv);
    if (found) return await connect(found);
    show(hint(`No chats repo yet. Beep saves to a private repo of yours named ${GH.REPO_NAME}.`), actions(action(`Create ${GH.REPO_NAME}`, createRepo, true), action("Use another repo", pickRepo)));
  } catch (err) {
    fail(err);
  }
}

async function createRepo() {
  show(hint("Creating it…"));
  try {
    await connect(await GH.createRepo(ghEnv));
  } catch (err) {
    if ((err as { code?: string }).code !== "cannot-create") return fail(err);
    // Squiggle's fallback: a pre-filled github.com/new, then give the app access, then find it.
    show(
      hint("GitHub didn't let Beep make it, so it's two quick steps on GitHub:"),
      actions(away("1. Create the repo", GH.NEW_REPO_URL, true), away("2. Give the app access", GH.INSTALL_URL)),
      actions(action("Done, continue", setUpRepo)),
    );
  }
}

async function pickRepo() {
  show(hint("Loading your repos…"));
  try {
    const repos = (await GH.accessibleRepos(ghEnv)).filter((r) => r.private);
    const list = el("div", "gh-repos");
    list.append(...repos.map((r) => action(r.full_name, () => connect(r.full_name))));
    show(
      hint(repos.length ? "Pick a private repo:" : "The GitHub app can't see any private repos yet."),
      list,
      actions(away("Give the app access to another", GH.INSTALL_URL), action("Refresh", pickRepo), action("Back", () => ((ghStep = false), renderGitHub()))),
    );
  } catch (err) {
    fail(err);
  }
}

async function connect(fullName: string) {
  show(hint(`Connecting to ${fullName}…`));
  try {
    await GH.useRepo(ghEnv, fullName);
    ghStep = false;
    renderGitHub();
    saveToGitHub();
  } catch (err) {
    show(hint(errText(err)), actions(action("Pick another repo", pickRepo)));
  }
}

function signOut() {
  GH.signOut(ghEnv);
  ghLogin = "";
  ghStep = false;
  renderGitHub();
}

// One sync at a time; each one sends whatever is new by then.
let ghQueue = Promise.resolve();
function saveToGitHub(loud = false) {
  if (!GH.signedIn(ghEnv) || !GH.savedRepo(ghEnv)) return;
  if (loud) renderGitHub("Saving…");
  ghQueue = ghQueue.then(async () => {
    try {
      const sending = { ...unsavedFiles };
      // Side threads go up whole as one file whenever they've changed since the last save.
      const threadsJson = JSON.stringify(threads, null, 2);
      if (threads.length && threadsJson !== localStorage.getItem("beep:threads-saved")) sending["threads.json"] = Files.toBase64(new TextEncoder().encode(threadsJson + "\n"));
      // Turns saved from another browser come in first, so this save never writes over them.
      if (!replying() && (await GH.pull(ghEnv, history, packets, () => !replying()))) {
        saveChat();
        renderLog();
        renderSidebar();
      }
      await GH.sync(ghEnv, history, packets, new Date(), sending);
      for (const k of Object.keys(sending)) delete unsavedFiles[k];
      if (sending["threads.json"]) localStorage.setItem("beep:threads-saved", threadsJson);
      ghSaved = new Date();
      renderGitHub();
    } catch (err) {
      const msg = `Couldn't save to GitHub: ${err instanceof Error ? err.message : String(err)}`;
      renderGitHub(msg);
      setStatus(msg);
    }
  });
}

// ---------- Sidebar ----------

const narrow = matchMedia("(max-width: 760px)");
function setSidebar(open: boolean) {
  app.classList.toggle("side-open", open);
  sidebar.classList.toggle("open", open);
  scrim.hidden = !(open && narrow.matches);
  $("open-side").setAttribute("aria-expanded", String(open));
  if (!narrow.matches) localStorage.setItem("beep:sidebar", open ? "1" : "");
  if (open) renderSidebar();
}
$("open-side").addEventListener("click", () => setSidebar(!app.classList.contains("side-open")));
$("close-side").addEventListener("click", () => setSidebar(false));
scrim.addEventListener("click", () => setSidebar(false));

for (const tab of ["topics", "data"]) {
  $(`tab-${tab}`).addEventListener("click", () => {
    for (const t of ["topics", "data"]) {
      $(`tab-${t}`).setAttribute("aria-selected", String(t === tab));
      $(`panel-${t}`).hidden = t !== tab;
    }
  });
}

function renderSidebar() {
  // Topics
  const chips = $("topics");
  const found = topics(history);
  chips.replaceChildren(...found.map(({ word, count }) => {
    const b = btn("", word);
    b.append(el("span", "", String(count)));
    b.addEventListener("click", () => {
      search.value = word;
      renderResults();
    });
    return b;
  }));
  if (!found.length) chips.append(el("p", "hint", "Topics show up here once you've chatted a bit."));
  renderResults();

  // Data
  const messages = history.reduce((n, s) => n + s.turns.length, 0);
  const bytes = ["beep:history", "beep:packets", FILES_KEY].reduce((n, k) => n + (localStorage.getItem(k)?.length ?? 0), 0);
  $("stats").replaceChildren(stat(messages, "messages"), stat(history.length, "days"), stat(`${bytes ? Math.max(1, Math.round(bytes / 1024)) : 0} KB`, "stored"));
  renderCost();
  $("days").replaceChildren(...[...history].reverse().map((s) => {
    const li = el("li");
    const go = btn("go", dayName(s.id));
    go.append(el("small", "", ` · ${s.turns.length} messages`));
    go.addEventListener("click", () => jumpTo(keyOf(s.id, 0)));
    const del = btn("icon");
    del.setAttribute("aria-label", `Delete ${dayName(s.id)}`);
    del.innerHTML = `<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>`;
    del.addEventListener("click", () => {
      if (!confirm(`Delete everything from ${dayName(s.id)}? This can't be undone.`)) return;
      history.splice(history.indexOf(s), 1);
      GH.skipDays(ghEnv, [s.id]);
      for (const k of Object.keys(packets)) if (k.startsWith(`${s.id}#`)) delete packets[k];
      saveChat();
      GH.resend(ghEnv);
      renderLog();
      renderSidebar();
    });
    li.append(go, del);
    return li;
  }));
}

/** Beep's real bill since the meter started, next to a classic chat that resends everything, at both cache lifetimes. */
function renderCost() {
  const turns: CostTurn[] = history.flatMap((s) =>
    s.turns.flatMap((t, i) => {
      if (t.role !== "user") return [];
      const p = packets[keyOf(s.id, i)];
      return [{ model: p?.model, message: t.content, answer: s.turns[i + 1]?.content, context: p?.context, calls: p?.calls }];
    }),
  );
  const short = compareCost(turns, { ttl: 5 * MINUTE });
  const long = compareCost(turns, { ttl: 60 * MINUTE });
  if (!short.turns) return $("cost").replaceChildren(el("p", "hint", "Starts counting with your next message: what it really costs here, next to what a classic chat that resends everything would."));
  const top = Math.max(short.beep, short.classic, long.classic);
  const row = (label: string, usd: number, us = false) => {
    const r = el("div", `row${us ? " us" : ""}`);
    const bar = el("div", "bar");
    bar.style.width = `${Math.max(1, (usd / top) * 100)}%`;
    r.append(el("span", "", label), el("b", "", `$${usd < 1 ? usd.toFixed(3) : usd.toFixed(2)}`), bar);
    return r;
  };
  const models = [...new Set(turns.filter((t) => t.calls?.length).map((t) => priceOf(t.model ?? "").name))].join(" and ");
  const times = short.classic / (short.beep || Infinity);
  $("cost").replaceChildren(
    row("Beep", short.beep, true),
    row("Classic chat, 5-minute cache", short.classic),
    row("Classic chat, 1-hour cache", long.classic),
    el("p", "hint", `${short.turns} ${short.turns === 1 ? "turn" : "turns"} counted, at ${models} prices.${times >= 1.05 ? ` A classic chat costs ${times.toFixed(1)}x as much here:` : ""} it resends the whole chat every turn (up to ${Math.round(short.peak / 1000)}K tokens), reading it from cache when the last message was recent and paying to cache it again when not.${short.compactions ? ` It would have compacted ${short.compactions} ${short.compactions === 1 ? "time" : "times"}.` : ""}`),
  );
}

const stat = (value: string | number, label: string) => {
  const d = el("div");
  d.append(el("b", "", String(value)), el("span", "", label));
  return d;
};

function renderResults() {
  const q = search.value.trim().toLowerCase();
  const list = $("results");
  list.replaceChildren();
  if (!q) return;
  const hits: { key: string; day: string; text: string }[] = [];
  for (const s of history) s.turns.forEach((t, i) => t.content.toLowerCase().includes(q) && hits.push({ key: keyOf(s.id, i), day: `${dayName(s.id)} · ${t.role === "user" ? "you" : "Beep"}`, text: t.content }));
  if (!hits.length) list.append(el("li", "hint", "Nothing yet."));
  for (const h of hits.slice(-30).reverse()) {
    const b = btn();
    b.append(el("small", "", h.day), snippet(h.text, q));
    b.addEventListener("click", () => jumpTo(h.key));
    const li = el("li");
    li.append(b);
    list.append(li);
  }
}
search.addEventListener("input", renderResults);

function snippet(text: string, q: string) {
  const at = text.toLowerCase().indexOf(q);
  const start = Math.max(0, at - 40);
  const span = el("span", "", (start ? "…" : "") + text.slice(start, at));
  span.append(el("mark", "", text.slice(at, at + q.length)), text.slice(at + q.length, at + q.length + 60) + (at + q.length + 60 < text.length ? "…" : ""));
  return span;
}

function jumpTo(key: string) {
  const row = log.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
  if (!row) return;
  if (narrow.matches) setSidebar(false);
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.add("flash");
  setTimeout(() => row.classList.remove("flash"), 1600);
}

$("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ history, packets, files: load(FILES_KEY, {}) }, null, 2)], { type: "application/json" });
  const a = el("a") as HTMLAnchorElement;
  a.href = URL.createObjectURL(blob);
  a.download = `beep-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$<HTMLInputElement>("import").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    // Only the shape the chat reads gets in; anything else is refused.
    const ok =
      Array.isArray(data?.history) &&
      data.history.every((s: Session) => typeof s?.id === "string" && Array.isArray(s.turns) && s.turns.every((t) => (t?.role === "user" || t?.role === "assistant") && typeof t.content === "string"));
    if (!ok) throw new Error("That file isn't a Beep export.");
    if (history.length && !confirm("Replace the chat in this browser with the imported one?")) return;
    history.splice(0, history.length, ...data.history);
    for (const k of Object.keys(packets)) delete packets[k];
    Object.assign(packets, typeof data.packets === "object" && data.packets ? data.packets : {});
    const files = data.files && typeof data.files === "object" ? Object.entries(data.files).filter(([p, c]) => p.startsWith("/home/") && typeof c === "string") : [];
    localStorage.setItem(FILES_KEY, JSON.stringify(Object.fromEntries(files)));
    resetShell();
    saveChat();
    GH.resend(ghEnv);
    saveToGitHub();
    renderLog();
    renderSidebar();
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err));
  }
});

$("clear").addEventListener("click", () => {
  if (!confirm("Delete the whole chat and its files from this browser? This can't be undone. Export first if you want a copy.")) return;
  GH.skipDays(ghEnv, history.map((s) => s.id));
  history.length = 0;
  localStorage.removeItem(FILES_KEY);
  resetShell();
  for (const k of Object.keys(packets)) delete packets[k];
  saveChat();
  GH.resend(ghEnv);
  renderLog();
  renderSidebar();
});

// ---------- Chat ----------

function el(tag: string, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

const btn = (className = "", text = "") => Object.assign(el("button", className, text), { type: "button" }) as HTMLButtonElement;

/** Plain text with **bold** and `code`, built as DOM so nothing in a message can inject markup. */
function richText(text: string) {
  const frag = document.createDocumentFragment();
  for (const part of text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/)) {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) frag.append(el("strong", "", part.slice(2, -2)));
    else if (part.startsWith("`") && part.endsWith("`") && part.length > 2) frag.append(el("code", "", part.slice(1, -1)));
    else if (part) frag.append(part);
  }
  return frag;
}

let lastDay = "";
let lastRow: HTMLElement | null = null;

function addTurn(sessionId: string, turn: number, role: "user" | "assistant", content: string, animate: boolean) {
  log.querySelector(".empty")?.remove();
  if (sessionId !== lastDay) {
    log.append(el("div", "day", dayName(sessionId)));
    lastDay = sessionId;
    lastRow = null;
  }
  // Consecutive bubbles from one side group like a text thread: only the last keeps its tail.
  if (lastRow?.classList.contains(role)) lastRow.querySelector(".bubble")?.classList.remove("last");
  const row = el("div", `row ${role}`);
  row.dataset.key = keyOf(sessionId, turn);
  const bubble = el("div", `bubble last${animate ? "" : " still"}`);
  bubble.append(richText(content.replace(ATTACHED, "")));
  row.append(bubble);
  if (ATTACHED.test(content)) showSavedFiles(row, row.dataset.key);
  const packet = packets[keyOf(sessionId, role === "user" ? turn : turn - 1)];
  if (packet && role === "user") {
    row.append(...peek(`<path d="M21 16V8l-9-5-9 5v8l9 5 9-5zM3.3 7L12 12l8.7-5M12 22V12"/>`, GH.packetLabel(packet), packet.text || "Nothing older matched, so no packet went to the model, only today's latest turns and your message."));
  }
  if (packet?.steps?.length && role === "assistant") {
    const n = packet.steps.length;
    const text = packet.steps.map((s) => (s.output === undefined ? s.label : `${s.label}\n${s.output}`)).join("\n\n");
    row.append(...peek(`<path d="M4 17l6-5-6-5M12 19h8"/>`, `${n} tool ${n === 1 ? "call" : "calls"}`, text));
  }
  // A rule the packet will pin from now on says so under the message, with undo, so a stray "always" can't stick unseen.
  if (role === "user") for (const rule of extractRules(content)) row.append(ruleChip(rule));
  const branches = threads.filter((t) => t.parent === row.dataset.key && t.turns.length);
  for (const t of branches) {
    const chip = btn("replies", `${t.turns.length / 2} ${t.turns.length === 2 ? "reply" : "replies"} · ${t.title}`);
    chip.addEventListener("click", () => showThread(t));
    row.append(chip);
  }
  log.append(row);
  lastRow = row;
  for (const t of threads.filter((t) => t.wrap && t.after === row.dataset.key)) {
    log.append(recordCard(t));
    lastRow = null;
  }
}

function ruleChip(rule: string) {
  const chip = btn("replies");
  const show = () => (chip.textContent = mutedRules.includes(rule) ? "Not a standing rule · Pin it" : "Pinned as a standing rule · Undo");
  chip.addEventListener("click", () => {
    const i = mutedRules.indexOf(rule);
    if (i >= 0) mutedRules.splice(i, 1);
    else mutedRules.push(rule);
    saveMuted();
    show();
  });
  show();
  return chip;
}

/** A small chip under a bubble that opens a monospace box. */
function peek(icon: string, label: string, text: string) {
  const chip = btn("packet-chip");
  chip.setAttribute("aria-expanded", "false");
  chip.innerHTML = `<svg viewBox="0 0 24 24">${icon}</svg>`;
  chip.append(label);
  const box = el("div", "packet", text);
  box.hidden = true;
  chip.addEventListener("click", () => {
    box.hidden = !box.hidden;
    chip.setAttribute("aria-expanded", String(!box.hidden));
  });
  return [chip, box];
}

function renderLog() {
  log.replaceChildren();
  lastDay = "";
  lastRow = null;
  if (!history.length) {
    const empty = el("div", "empty");
    empty.append(el("div", "avatar", "B"), el("h1", "", "One chat, forever"), el("p", "", "Text like you would a friend. Every reply gets a fresh packet of what matters from everything you've said, and you can peek at it under each message."));
    log.append(empty);
  }
  for (const s of history) s.turns.forEach((t, i) => addTurn(s.id, i, t.role, t.content, false));
  log.scrollTop = log.scrollHeight;
}

function setStatus(text: string) {
  status.textContent = text;
}

function showTyping(on: boolean) {
  presence.textContent = on ? "typing…" : "remembers everything";
  presence.classList.toggle("typing", on);
  log.querySelector(".typing-row")?.remove();
  if (!on) return;
  const row = el("div", "row assistant typing-row");
  const bubble = el("div", "bubble last");
  bubble.setAttribute("aria-label", "Beep is typing");
  bubble.append(el("span", "typing-dots"));
  bubble.firstElementChild!.append(el("i"), el("i"), el("i"));
  row.append(bubble);
  log.append(row);
  log.scrollTop = log.scrollHeight;
}

const sync = () => {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
  const typed = !!input.value.trim() || mainFiles.files.length > 0;
  // An empty box offers a call; the first character swaps in send. A call in progress keeps its hang-up button.
  callButton.hidden = !Voice.canCall || (typed && !hangUp);
  send.hidden = !callButton.hidden;
  input.closest(".pill")!.classList.toggle("typed", typed && !hangUp);
  send.disabled = !typed;
};

/**
 * Sends run one after another, so the box never blocks: a message sent during a reply shows right away and goes out
 * when the reply before it is done. If one fails, the ones queued behind it come back to the box instead of going out
 * without it.
 */
function lane() {
  let tail: Promise<unknown> = Promise.resolve();
  const state = { waiting: 0, failed: false };
  const run = <T>(job: () => Promise<T>): Promise<T> => {
    state.waiting++;
    const done = tail.then(job).finally(() => {
      if (!--state.waiting) state.failed = false;
    });
    tail = done.catch(() => {});
    return done;
  };
  return { run, state };
}
const mainLane = lane();
/** A reply is on its way or queued, so a pull must not change the chat under it. */
const replying = () => mainLane.state.waiting > 0;
/** Puts a message that didn't go out back in a box, after anything already there. */
const putBack = (box: HTMLTextAreaElement, message: string) => (box.value = box.value.trim() ? `${box.value}\n\n${message}` : message);
input.addEventListener("input", sync);
input.addEventListener("keydown", (event) => {
  // Enter sends on a keyboard; on phones the return key adds a line and the button sends.
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !narrow.matches) {
    event.preventDefault();
    form.requestSubmit();
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void ask(input.value.trim());
});

/** Sends one message and shows the reply. Returns the reply, or null when nothing was sent or it failed. */
async function ask(message: string, voice = false): Promise<string | null> {
  const files = voice ? [] : mainFiles.files.slice();
  if (!message && !files.length) return null;
  const apiKey = keyInput.value.trim();
  if (!apiKey) {
    setStatus("Add your Anthropic API key in Settings first.");
    settings.showModal();
    return null;
  }
  setStatus("");
  if (!voice) input.value = "";
  sync();
  // The message shows right away like a sent text; it's only saved once the reply is back.
  if (!voice) mainFiles.clear();
  const pending = el("div", "row user pending");
  pending.append(el("div", "bubble last", message || "(attached)"));
  if (files.length) pending.append(fileStrip(files));
  log.querySelector(".empty")?.remove();
  log.append(pending);
  log.scrollTop = log.scrollHeight;
  return mainLane.run(() => reply(message, files, voice, apiKey, pending));
}

async function reply(message: string, files: Attachment[], voice: boolean, apiKey: string, pending: HTMLElement): Promise<string | null> {
  if (mainLane.state.failed) {
    pending.remove();
    putBack(input, message);
    mainFiles.restore([...mainFiles.files, ...files]);
    sync();
    return null;
  }
  // A reply that just landed goes above this message, which waited below it.
  log.append(pending);
  showTyping(true);
  try {
    const onStep = (label: string) => (presence.textContent = label.length > 40 ? label.slice(0, 39) + "…" : label);
    const model = modelSelect.value;
    const today = dayLabel(new Date());
    const result = await sendTurn(history, message, {
      apiKey, model, voice, rawTurns: Number(rawSelect.value), onStep, embed: await embedder(),
      permissions: perms, approve: approver(log), spend,
      extraSessions: T.threadSessions(threads), note: T.threadsNote(threads, today),
      attachments: files, mutedRules,
    });
    if (files.length) await keepFiles(keyOf(result.sessionId, result.turn), files, result.sessionId, result.turn);
    packets[keyOf(result.sessionId, result.turn)] = { text: result.packet, tokens: result.packetTokens, model, raw: result.rawTurns, ...(result.steps.length ? { steps: result.steps } : {}), calls: result.calls, context: result.context };
    saveChat();
    if (!voice) saveToGitHub(); // A call saves once the reply has been spoken.
    pending.remove();
    showTyping(false);
    addTurn(result.sessionId, result.turn, "user", message + attachedNote(files), false);
    addTurn(result.sessionId, result.turn + 1, "assistant", result.answer, true);
    log.scrollTop = log.scrollHeight;
    if (app.classList.contains("side-open")) renderSidebar();
    return result.answer;
  } catch (err) {
    pending.remove();
    showTyping(false);
    // Put the message and its files back so nothing is lost.
    mainLane.state.failed = true;
    putBack(input, message);
    mainFiles.restore([...mainFiles.files, ...files]);
    setStatus(err instanceof Error ? err.message : String(err));
    return null;
  } finally {
    sync();
  }
}

// ---------- Attachments ----------

/** Thumbnails for images, a name tile for PDFs. */
function fileStrip(files: Attachment[]) {
  const strip = el("div", "files");
  for (const f of files) strip.append(fileTile(f));
  return strip;
}
function fileTile(f: Attachment) {
  if (f.type === "application/pdf") return el("div", "doc", `PDF\n${f.name}`);
  const img = el("img", "thumb") as HTMLImageElement;
  img.src = Files.dataUrl(f);
  img.alt = f.name;
  return img;
}

/** Keeps a message's files in this browser, and queues them for the GitHub repo. */
async function keepFiles(key: string, files: Attachment[], sessionId: string, turn: number) {
  await Files.saveFiles(key, files).catch(() => setStatus("Couldn't keep the files in this browser; they were still sent."));
  for (const f of files) unsavedFiles[GH.attachmentPath(sessionId, turn, f.name)] = f.data;
}

/** A composer's "+" button, paste and tray. */
function attacher(text: HTMLTextAreaElement, picker: HTMLInputElement, tray: HTMLElement, onChange: () => void, report: (msg: string) => void) {
  const files: Attachment[] = [];
  const render = () => {
    tray.hidden = !files.length;
    tray.replaceChildren(...files.map((f, i) => {
      const box = el("div", "file");
      const x = btn("", "✕");
      x.setAttribute("aria-label", `Remove ${f.name}`);
      x.addEventListener("click", () => (files.splice(i, 1), render()));
      box.append(fileTile(f), x);
      return box;
    }));
    onChange();
  };
  const add = async (list: Iterable<File>) => {
    for (const file of list) {
      try {
        files.push(await Files.prepare(file));
      } catch (err) {
        report(errText(err));
      }
    }
    render();
  };
  picker.addEventListener("change", () => {
    void add([...(picker.files ?? [])]);
    picker.value = "";
  });
  text.addEventListener("paste", (e) => {
    const pasted = [...(e.clipboardData?.files ?? [])];
    if (!pasted.length) return;
    e.preventDefault();
    void add(pasted);
  });
  return {
    files,
    clear: () => (files.splice(0), render()),
    restore: (back: Attachment[]) => (files.splice(0, files.length, ...back), render()),
  };
}
const mainFiles = attacher(input, $<HTMLInputElement>("files"), $("tray"), () => sync(), setStatus);

/** Fills in a saved message's files once they're read back from IndexedDB. */
function showSavedFiles(row: HTMLElement, key: string) {
  Files.loadFiles(key).then((files) => files?.length && row.querySelector(".bubble")!.after(fileStrip(files)), () => {});
}

// ---------- Side threads ----------

const threadPanel = $("thread");
const threadLog = $("thread-log");
const threadForm = $<HTMLFormElement>("thread-form");
const threadInput = $<HTMLTextAreaElement>("thread-input");
const threadSend = $<HTMLButtonElement>("thread-send");
const threadWrap = $<HTMLButtonElement>("thread-wrap");
const threadStatus = $("thread-status");
const threadPresence = $("thread-presence");
let openThread: T.Thread | null = null;
let threadBusy = false;
const threadFiles = attacher(threadInput, $<HTMLInputElement>("thread-files"), $("thread-tray"), () => threadSync(), (m) => (threadStatus.textContent = m));
const threadSync = () => {
  threadInput.style.height = "auto";
  threadInput.style.height = `${threadInput.scrollHeight}px`;
  threadSend.disabled = !threadInput.value.trim() && !threadFiles.files.length;
  threadWrap.disabled = threadBusy || !openThread?.turns.length;
};
threadInput.addEventListener("input", threadSync);
threadInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !narrow.matches) {
    event.preventDefault();
    threadForm.requestSubmit();
  }
});
const saveThreads = () => saveChat();

function showThread(t: T.Thread) {
  openThread = t;
  threadPanel.hidden = false;
  threadStatus.textContent = "";
  threadPresence.textContent = t.wrap ? "wrapped up" : t.title || "off one message";
  threadLog.replaceChildren();
  const parent = el("div", "parent");
  parent.append(el("b", "", t.parentRole === "user" ? "You said" : "Beep said"), t.parentText);
  threadLog.append(parent);
  t.turns.forEach((turn, i) => addThreadTurn(t, i, false));
  if (t.wrap) threadLog.append(recordCard(t, false));
  threadLog.scrollTop = threadLog.scrollHeight;
  threadSync();
  threadInput.focus();
}

function addThreadTurn(t: T.Thread, i: number, animate: boolean) {
  const turn = t.turns[i]!;
  const row = el("div", `row ${turn.role}`);
  const bubble = el("div", `bubble last${animate ? "" : " still"}`);
  bubble.append(richText(turn.content.replace(ATTACHED, "")));
  row.append(bubble);
  if (ATTACHED.test(turn.content)) showSavedFiles(row, `${t.id}#${i}`);
  const steps = turn.role === "assistant" ? t.steps?.[i - 1] : undefined;
  if (steps?.length) row.append(...peek(`<path d="M4 17l6-5-6-5M12 19h8"/>`, `${steps.length} tool ${steps.length === 1 ? "call" : "calls"}`, steps.map((s) => (s.output === undefined ? s.label : `${s.label}\n${s.output}`)).join("\n\n")));
  threadLog.append(row);
}

function closeThread() {
  threadPanel.hidden = true;
  openThread = null;
}
$("thread-close").addEventListener("click", closeThread);

threadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const t = openThread;
  const message = threadInput.value.trim();
  const files = threadFiles.files.slice();
  if (!t || (!message && !files.length)) return;
  const apiKey = keyInput.value.trim();
  if (!apiKey) return settings.showModal();
  threadBusy = true;
  threadStatus.textContent = "";
  threadInput.value = "";
  threadFiles.clear();
  threadSync();
  const pending = el("div", "row user pending");
  pending.append(el("div", "bubble last", message || "(attached)"));
  if (files.length) pending.append(fileStrip(files));
  threadLog.append(pending);
  threadLog.scrollTop = threadLog.scrollHeight;
  await threadLane.run(() => threadReply(t, message, files, apiKey, pending));
});

const threadLane = lane();
async function threadReply(t: T.Thread, message: string, files: Attachment[], apiKey: string, pending: HTMLElement) {
  const shown = () => openThread === t;
  if (threadLane.state.failed) {
    pending.remove();
    if (shown()) putBack(threadInput, message), threadFiles.restore([...threadFiles.files, ...files]);
    return;
  }
  if (shown()) threadLog.append(pending), (threadPresence.textContent = "typing…");
  try {
    const wasWrapped = !!t.wrap;
    await T.sendThreadTurn(t, history, threads, message, {
      apiKey, model: modelSelect.value, permissions: perms, approve: approver(threadLog), spend, attachments: files, mutedRules, embed: await embedder(),
      onStep: (label) => (threadPresence.textContent = label.length > 40 ? label.slice(0, 39) + "…" : label),
    });
    if (!threads.includes(t)) threads.push(t);
    if (files.length) {
      await Files.saveFiles(`${t.id}#${t.turns.length - 2}`, files).catch(() => {});
      for (const f of files) unsavedFiles[`attachments/threads/${t.id}/${f.name.replace(/[^\w.-]+/g, "-")}`] = f.data;
    }
    saveThreads();
    pending.remove();
    // The person may have opened another thread while this one waited; its log isn't on screen then.
    if (shown() && wasWrapped) showThread(t);
    else if (shown()) {
      addThreadTurn(t, t.turns.length - 2, false);
      addThreadTurn(t, t.turns.length - 1, true);
    }
    if (shown()) (threadPresence.textContent = t.title), (threadLog.scrollTop = threadLog.scrollHeight);
    renderLog();
  } catch (err) {
    threadLane.state.failed = true;
    pending.remove();
    if (shown()) {
      putBack(threadInput, message);
      threadFiles.restore([...threadFiles.files, ...files]);
      threadStatus.textContent = errText(err);
      threadPresence.textContent = t.title || "off one message";
    }
  } finally {
    threadBusy = threadLane.state.waiting > 1;
    threadSync();
  }
}

threadWrap.addEventListener("click", async () => {
  const t = openThread;
  if (!t?.turns.length || threadBusy) return;
  const apiKey = keyInput.value.trim();
  if (!apiKey) return settings.showModal();
  threadBusy = true;
  threadSync();
  threadPresence.textContent = "wrapping up…";
  try {
    const last = history.at(-1);
    const after = last?.turns.length ? keyOf(last.id, last.turns.length - 1) : t.parent;
    await T.wrapUp(t, after, { apiKey, model: modelSelect.value, permissions: perms, spend });
    saveThreads();
    renderLog();
    showThread(t);
    saveToGitHub();
  } catch (err) {
    threadStatus.textContent = errText(err);
    threadPresence.textContent = t.title;
  } finally {
    threadBusy = false;
    threadSync();
  }
});

/** The record a wrapped thread leaves in the main chat; a tap opens the thread. */
function recordCard(t: T.Thread, opens = true) {
  const card = btn("record");
  card.append(el("b", "", `Side thread wrapped up: ${t.title}`), t.wrap ?? "");
  if (opens) card.addEventListener("click", () => showThread(t));
  else card.disabled = true;
  return card;
}

// Voice calls: tap the mic to start, tap again to hang up. Talking over a reply stops it.
const callButton = $<HTMLButtonElement>("call");
const voiceSelect = $<HTMLSelectElement>("voice");
for (const [id, name] of Object.entries(Voice.VOICES)) voiceSelect.append(new Option(name, id));
voiceSelect.value = localStorage.getItem("beep:voice") ?? "af_heart";
voiceSelect.addEventListener("change", () => localStorage.setItem("beep:voice", voiceSelect.value));
let hangUp: (() => void) | null = null;
const CALL_STATES = { loading: "getting ready…", listening: "listening…", thinking: "thinking…", speaking: "speaking…" };
function endCall() {
  hangUp?.();
  hangUp = null;
  callButton.setAttribute("aria-pressed", "false");
  callButton.setAttribute("aria-label", "Start a voice call");
  showTyping(false);
  input.value = "";
  sync();
}

// The mic in the box types what you say; it doesn't send.
const dictateButton = $<HTMLButtonElement>("dictate");
dictateButton.hidden = !Voice.canDictate;
let stopDictating: (() => void) | null = null;
dictateButton.addEventListener("click", () => {
  if (stopDictating) return stopDictating();
  const before = input.value.trimEnd();
  dictateButton.setAttribute("aria-pressed", "true");
  stopDictating = Voice.dictate(
    (text) => {
      input.value = before ? `${before} ${text}` : text;
      sync();
    },
    () => {
      stopDictating = null;
      dictateButton.setAttribute("aria-pressed", "false");
      input.focus();
    },
  );
});
// Long-press a message (right-click on a computer) for its menu. A "Branch from here" item can join it later.
const menu = $("menu");
const reader = $("reader");
const readerState = $("reader-state");
const readerPause = $<HTMLButtonElement>("reader-pause");
let menuText = "";
let menuRow: HTMLElement | null = null;
let reading: Voice.Reader | null = null;
function openMenu(bubble: HTMLElement, x: number, y: number) {
  menuText = bubble.innerText;
  menuRow = bubble.closest<HTMLElement>(".row");
  menu.hidden = false;
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
  (menu.querySelector("button") as HTMLButtonElement).focus();
}
const closeMenu = () => (menu.hidden = true);
let press: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | undefined;
log.addEventListener("pointerdown", (e) => {
  const bubble = (e.target as HTMLElement).closest<HTMLElement>(".row:not(.typing-row) .bubble");
  if (!bubble || e.pointerType === "mouse") return;
  press = { x: e.clientX, y: e.clientY, timer: setTimeout(() => openMenu(bubble, e.clientX, e.clientY), 500) };
});
const cancelPress = () => press && clearTimeout(press.timer);
log.addEventListener("pointerup", cancelPress);
log.addEventListener("pointercancel", cancelPress);
log.addEventListener("pointermove", (e) => press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10 && cancelPress());
log.addEventListener("contextmenu", (e) => {
  const bubble = (e.target as HTMLElement).closest<HTMLElement>(".row:not(.typing-row) .bubble");
  if (!bubble) return;
  e.preventDefault();
  openMenu(bubble, e.clientX, e.clientY);
});
document.addEventListener("pointerdown", (e) => !menu.contains(e.target as Node) && closeMenu());
document.addEventListener("keydown", (e) => e.key === "Escape" && closeMenu());
log.addEventListener("scroll", closeMenu);
menu.addEventListener("click", (e) => {
  const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
  closeMenu();
  if (act === "branch" && menuRow?.dataset.key) {
    const key = menuRow.dataset.key;
    // Opens an existing open branch off this message, or starts a new one (kept once its first reply is back).
    showThread(threads.find((t) => t.parent === key && !t.wrap) ?? T.newThread(key, menuRow.classList.contains("user") ? "user" : "assistant", menuText));
  }
  if (act === "copy") void navigator.clipboard.writeText(menuText);
  if (act === "read") {
    if (hangUp) endCall();
    reading = Voice.readAloud(menuText, voiceSelect.value, (s) => {
      reader.hidden = s === "done";
      readerState.textContent = s === "loading" ? "Loading the voice…" : s === "paused" ? "Paused" : "Reading aloud";
      reader.classList.toggle("paused", s === "paused");
      reader.classList.toggle("loading", s === "loading");
      readerPause.setAttribute("aria-label", s === "paused" ? "Resume" : "Pause");
      if (s === "playing" && Voice.voiceError && voiceSelect.value !== "builtin") setStatus(`Using this device's voice; Kokoro didn't load: ${Voice.voiceError}`);
    });
  }
});
readerPause.addEventListener("click", () => (reader.classList.contains("paused") ? reading?.resume() : reading?.pause()));
$("reader-restart").addEventListener("click", () => reading?.restart());
$("reader-stop").addEventListener("click", () => reading?.stop());

callButton.addEventListener("click", () => {
  if (hangUp) return endCall();
  if (!keyInput.value.trim()) {
    setStatus("Add your Anthropic API key in Settings first.");
    return settings.showModal();
  }
  callButton.setAttribute("aria-pressed", "true");
  callButton.setAttribute("aria-label", "Hang up");
  let note = "";
  hangUp = Voice.startCall({
    voice: () => voiceSelect.value,
    ask: (text) => {
      // A reply that was talked over stays whole; the note on this message says where they stopped hearing it.
      const message = note ? `${note}\n\n${text}` : text;
      note = "";
      return ask(message, true);
    },
    interrupted: (n) => (note = n),
    spoken: () => saveToGitHub(),
    heard: (text) => {
      input.value = text;
      sync();
    },
    state: (s, detail) => {
      presence.textContent = detail ? `${CALL_STATES[s]} ${detail}` : CALL_STATES[s];
      presence.classList.add("typing");
      if (s === "listening") input.value = "";
    },
  });
});

// The composers float over their logs; the logs' bottom padding follows their height.
for (const f of document.querySelectorAll<HTMLElement>(".composer"))
  new ResizeObserver(() => f.parentElement!.style.setProperty("--composer-h", `${f.offsetHeight}px`)).observe(f);
renderRules();
renderSpent();
sync();
renderLog();
renderGitHub();
if (GH.signedIn(ghEnv) && !GH.savedRepo(ghEnv)) setUpRepo();
saveToGitHub(); // Anything a failed save left behind, after pulling what other browsers saved.
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && saveToGitHub());
setSidebar(!narrow.matches && !!localStorage.getItem("beep:sidebar"));
if (!keyInput.value) settings.showModal();
else input.focus();
