// The page: a texting-style chat, a settings dialog, and a sidebar for topics and your data.

import type { Session } from "@long-con/core";
import { MODELS, sendTurn } from "./chat.ts";
import * as GH from "./github.ts";
import { FILES_KEY, resetShell } from "./tools.ts";
import { dayName, topics } from "./topics.ts";

/** Per user turn: the packet it went with, the model, and the tools the answer used. */
type Packets = GH.Packets;

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
    localStorage.setItem("long-con:history", JSON.stringify(history));
    localStorage.setItem("long-con:packets", JSON.stringify(packets));
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

const history: Session[] = load("long-con:history", []);
const packets: Packets = load("long-con:packets", {});
const keyOf = (sessionId: string, turn: number) => `${sessionId}#${turn}`;

// ---------- Settings ----------

keyInput.value = localStorage.getItem("long-con:key") ?? "";
keyInput.addEventListener("input", () => localStorage.setItem("long-con:key", keyInput.value.trim()));
for (const m of MODELS) modelSelect.add(new Option(m, m));
modelSelect.value = localStorage.getItem("long-con:model") ?? MODELS[0]!;
modelSelect.addEventListener("change", () => localStorage.setItem("long-con:model", modelSelect.value));
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
    show(hint(`No chats repo yet. Long Con saves to a private repo of yours named ${GH.REPO_NAME}.`), actions(action(`Create ${GH.REPO_NAME}`, createRepo, true), action("Use another repo", pickRepo)));
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
      hint("GitHub didn't let Long Con make it, so it's two quick steps on GitHub:"),
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
      await GH.sync(ghEnv, history, packets);
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
  if (!narrow.matches) localStorage.setItem("long-con:sidebar", open ? "1" : "");
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
  const bytes = ["long-con:history", "long-con:packets", FILES_KEY].reduce((n, k) => n + (localStorage.getItem(k)?.length ?? 0), 0);
  $("stats").replaceChildren(stat(messages, "messages"), stat(history.length, "days"), stat(`${bytes ? Math.max(1, Math.round(bytes / 1024)) : 0} KB`, "stored"));
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
  for (const s of history) s.turns.forEach((t, i) => t.content.toLowerCase().includes(q) && hits.push({ key: keyOf(s.id, i), day: `${dayName(s.id)} · ${t.role === "user" ? "you" : "Long Con"}`, text: t.content }));
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
  a.download = `long-con-${new Date().toISOString().slice(0, 10)}.json`;
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
    if (!ok) throw new Error("That file isn't a Long Con export.");
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
  bubble.append(richText(content));
  row.append(bubble);
  const packet = packets[keyOf(sessionId, role === "user" ? turn : turn - 1)];
  if (packet && role === "user") {
    row.append(...peek(`<path d="M21 16V8l-9-5-9 5v8l9 5 9-5zM3.3 7L12 12l8.7-5M12 22V12"/>`, GH.packetLabel(packet), packet.text));
  }
  if (packet?.steps?.length && role === "assistant") {
    const n = packet.steps.length;
    const text = packet.steps.map((s) => (s.output === undefined ? s.label : `${s.label}\n${s.output}`)).join("\n\n");
    row.append(...peek(`<path d="M4 17l6-5-6-5M12 19h8"/>`, `${n} tool ${n === 1 ? "call" : "calls"}`, text));
  }
  log.append(row);
  lastRow = row;
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
    empty.append(el("div", "avatar", "LC"), el("h1", "", "One chat, forever"), el("p", "", "Text like you would a friend. Every reply gets a fresh packet of what matters from everything you've said, and you can peek at it under each message."));
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
  bubble.setAttribute("aria-label", "Long Con is typing");
  bubble.append(el("span", "typing-dots"));
  bubble.firstElementChild!.append(el("i"), el("i"), el("i"));
  row.append(bubble);
  log.append(row);
  log.scrollTop = log.scrollHeight;
}

const sync = () => {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
  send.disabled = busy || !input.value.trim();
};
let busy = false;
input.addEventListener("input", sync);
input.addEventListener("keydown", (event) => {
  // Enter sends on a keyboard; on phones the return key adds a line and the button sends.
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !narrow.matches) {
    event.preventDefault();
    form.requestSubmit();
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || busy) return;
  const apiKey = keyInput.value.trim();
  if (!apiKey) {
    setStatus("Add your Anthropic API key in Settings first.");
    settings.showModal();
    return;
  }
  busy = true;
  setStatus("");
  input.value = "";
  sync();
  // The message shows right away like a sent text; it's only saved once the reply is back.
  const pending = el("div", "row user pending");
  pending.append(el("div", "bubble last", message));
  log.querySelector(".empty")?.remove();
  log.append(pending);
  showTyping(true);
  try {
    const onStep = (label: string) => (presence.textContent = label.length > 40 ? label.slice(0, 39) + "…" : label);
    const model = modelSelect.value;
    const result = await sendTurn(history, message, { apiKey, model, onStep });
    packets[keyOf(result.sessionId, result.turn)] = { text: result.packet, tokens: result.packetTokens, model, raw: result.rawTurns, ...(result.steps.length ? { steps: result.steps } : {}) };
    saveChat();
    saveToGitHub();
    pending.remove();
    showTyping(false);
    addTurn(result.sessionId, result.turn, "user", message, false);
    addTurn(result.sessionId, result.turn + 1, "assistant", result.answer, true);
    log.scrollTop = log.scrollHeight;
    if (app.classList.contains("side-open")) renderSidebar();
  } catch (err) {
    pending.remove();
    showTyping(false);
    // Put the message back so nothing is lost.
    input.value = message;
    setStatus(err instanceof Error ? err.message : String(err));
  } finally {
    busy = false;
    sync();
  }
});

renderLog();
renderGitHub();
if (GH.signedIn(ghEnv) && !GH.savedRepo(ghEnv)) setUpRepo();
saveToGitHub(); // Anything a failed save left behind.
setSidebar(!narrow.matches && !!localStorage.getItem("long-con:sidebar"));
if (!keyInput.value) settings.showModal();
else input.focus();
