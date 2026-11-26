// The page: one input box plus history, with each turn's packet behind a toggle.

import type { Session } from "@long-con/core";
import { MODELS, sendTurn } from "./chat.ts";

type Packets = Record<string, { text: string; tokens: number }>;

// shortcut: localStorage caps out around 5 MB; move to IndexedDB once a chat gets near that.
const load = <T>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, value: unknown) => localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = $<HTMLElement>("log");
const form = $<HTMLFormElement>("form");
const input = $<HTMLTextAreaElement>("input");
const send = $<HTMLButtonElement>("send");
const status = $<HTMLElement>("status");
const keyInput = $<HTMLInputElement>("key");
const modelSelect = $<HTMLSelectElement>("model");

const history: Session[] = load("long-con:history", []);
const packets: Packets = load("long-con:packets", {});

keyInput.value = localStorage.getItem("long-con:key") ?? "";
keyInput.addEventListener("change", () => save("long-con:key", keyInput.value.trim()));
for (const m of MODELS) modelSelect.add(new Option(m, m));
modelSelect.value = localStorage.getItem("long-con:model") ?? MODELS[0]!;
modelSelect.addEventListener("change", () => save("long-con:model", modelSelect.value));
if (!keyInput.value) $<HTMLDetailsElement>("settings").open = true;

$<HTMLButtonElement>("clear").addEventListener("click", () => {
  if (!confirm("Delete the whole chat from this browser? This can't be undone.")) return;
  history.length = 0;
  for (const k of Object.keys(packets)) delete packets[k];
  save("long-con:history", history);
  save("long-con:packets", packets);
  render();
});

function render() {
  log.replaceChildren();
  if (!history.length) log.append(el("p", "empty", "No messages yet. Everything you say here stays in one endless chat."));
  for (const session of history) {
    session.turns.forEach((turn, i) => {
      log.append(el("p", `msg ${turn.role}`, turn.content));
      const packet = turn.role === "user" ? packets[`${session.id}#${i}`] : undefined;
      if (packet) {
        const details = el("details", "packet");
        details.append(el("summary", "", `Packet · ${packet.tokens} tokens`), el("pre", "", packet.text));
        log.append(details);
      }
    });
  }
  window.scrollTo(0, document.body.scrollHeight);
}

function el(tag: string, className: string, text = "") {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function setStatus(text: string, error = false) {
  status.textContent = text;
  status.classList.toggle("error", error);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || send.disabled) return;
  const apiKey = keyInput.value.trim();
  if (!apiKey) {
    $<HTMLDetailsElement>("settings").open = true;
    setStatus("Add your Anthropic API key in Settings first.", true);
    return;
  }
  send.disabled = true;
  setStatus("Thinking…");
  try {
    const result = await sendTurn(history, message, { apiKey, model: modelSelect.value });
    packets[`${result.sessionId}#${result.turn}`] = { text: result.packet, tokens: result.packetTokens };
    save("long-con:history", history);
    save("long-con:packets", packets);
    input.value = "";
    setStatus("");
    render();
  } catch (err) {
    // The message stays in the box so nothing is lost.
    setStatus(err instanceof Error ? err.message : String(err), true);
  } finally {
    send.disabled = false;
  }
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});

render();
