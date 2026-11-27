import { test } from "node:test";
import assert from "node:assert/strict";
import { messagePrompt, PROFILES, type Session } from "../src/index.ts";

const history: Session[] = [{ id: "2026/01/02", date: "2026/01/02", turns: [{ role: "user", content: "My landlord Bob fixed the boiler." }, { role: "assistant", content: "Good to hear." }] }];
const profile = { ...PROFILES.claude, embedSim: undefined };

test("messagePrompt sends the packet ahead of the message when it found something", () => {
  const { sent, prompt } = messagePrompt({ system: "S", history, message: "Who fixed the boiler?", sendAs: "Today: x\n\nWho fixed the boiler?", profile });
  assert.ok(sent.includes("Bob"));
  assert.equal(prompt.messages[0]!.content, `<packet>\n${sent}\n</packet>`);
  assert.equal(prompt.messages.at(-1)!.content, "Today: x\n\nWho fixed the boiler?");
});

test("messagePrompt leaves out a packet that found nothing older", () => {
  const { sent, prompt } = messagePrompt({ system: "S", history, message: "Recommend a sci-fi novel", profile });
  assert.equal(sent, "");
  assert.deepEqual(prompt.messages, [{ role: "user", content: "Recommend a sci-fi novel" }]);
});
