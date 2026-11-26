// What ends up in the packet for a given chat and message. These tests read the packet the way
// the model would, by its words, and don't care how it's laid out or built.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPacket, PROFILES, type Session } from "../src/index.ts";
import { filler } from "./fixtures.ts";

const chat = (s: Session): Session => s;

const profile = PROFILES.claude;
const packetFor = (history: Session[], message: string, currentSessionId?: string) =>
  buildPacket({ history, message, profile, currentSessionId });

test("a fact said weeks ago comes back for a sloppy question about it", () => {
  const history = [
    ...filler.slice(0, 2),
    chat({
      id: "family",
      date: "2026/03/06 (Fri) 21:15",
      turns: [
        { role: "user", content: "my sister priya just told me shes moving to denver in april, kinda bummed" },
        { role: "assistant", content: "That's a big change. Denver is a short flight from Phoenix, so visits stay easy." },
      ],
    }),
    ...filler.slice(2),
  ];
  const packet = packetFor(history, "wait when is priya moving again");
  assert.match(packet.text, /moving to denver in april/);
  assert.match(packet.text, /2026\/03\/06/, "the date it was said comes with it");
  assert.doesNotMatch(packet.text, /rigatoni/, "an unrelated chat stays out");
});

test("a question asked long ago brings its answer, not just the question", () => {
  const history = [
    ...filler,
    chat({
      id: "vite",
      date: "2026/03/20 (Fri) 11:00",
      turns: [
        { role: "user", content: "what port does vite use by default" },
        { role: "assistant", content: "Vite's dev server defaults to port 5173." },
      ],
    }),
  ];
  assert.match(packetFor(history, "remind me the vite port?").text, /5173/);
});

test("'multiply that by 32' carries the number it refers to", () => {
  const history = [
    ...filler,
    chat({
      id: "math",
      date: "2026/03/21 (Sat) 09:00",
      turns: [
        { role: "user", content: "whats 128 times 4" },
        { role: "assistant", content: "128 × 4 = 512." },
      ],
    }),
  ];
  const packet = packetFor(history, "ok now multiply that by 32", "math");
  assert.match(packet.text, /512/);
  assert.equal(packet.resolution.status, "resolved");
});

test("'multiply it by 32' with no earlier number says it's unsure instead of guessing", () => {
  const history = [...filler, { id: "now", turns: [{ role: "user" as const, content: "hey" }, { role: "assistant" as const, content: "Hey! What's up?" }] }];
  const packet = packetFor(history, "multiply it by 32", "now");
  assert.equal(packet.resolution.status, "unsure");
  assert.match(packet.text, /unclear/i);
});

test("a shot-down answer stays out, and the fix that replaced it comes in", () => {
  const history = [
    ...filler,
    chat({
      id: "deploy",
      date: "2026/03/22 (Sun) 16:40",
      turns: [
        { role: "user", content: "how do i deploy the site again" },
        { role: "assistant", content: "Run npm run deploy:legacy from the repo root." },
        { role: "user", content: "no that didnt work, says the script doesnt exist" },
        { role: "assistant", content: "It was renamed. Run npm run ship to deploy." },
      ],
    }),
  ];
  const packet = packetFor(history, "what was the command to deploy the site");
  assert.match(packet.text, /npm run ship/);
  assert.doesNotMatch(packet.text, /deploy:legacy/);
});

test("a standing rule rides along even when the message has nothing to do with it", () => {
  const history = [
    chat({
      id: "rules",
      date: "2026/02/01 (Sun) 12:00",
      turns: [
        { role: "user", content: "ugh. from now on never put semicolons in js examples, i hate them" },
        { role: "assistant", content: "Got it, no semicolons." },
      ],
    }),
    ...filler,
  ];
  const packet = packetFor(history, "how do i read a json file in node");
  assert.match(packet.text, /never put semicolons in js examples/);
});

test("'the second one' is read from the list the assistant just gave", () => {
  const history = [
    ...filler,
    chat({
      id: "names",
      turns: [
        { role: "user", content: "give me some goofy names for a chat app" },
        { role: "assistant", content: "Some ideas:\n1. Pail\n2. Long Con\n3. Waffle" },
      ],
    }),
  ];
  const packet = packetFor(history, "i kinda like the second one", "names");
  assert.match(packet.text, /Long Con/);
});

test("'the other one' with three options to choose from isn't guessed", () => {
  const history = [
    ...filler,
    chat({
      id: "names",
      turns: [
        { role: "user", content: "give me some goofy names for a chat app" },
        { role: "assistant", content: "Some ideas:\n1. Pail\n2. Long Con\n3. Waffle" },
      ],
    }),
  ];
  const packet = packetFor(history, "nah the other one", "names");
  assert.equal(packet.resolution.status, "unsure");
});

test("a thank-you doesn't drag old history in", () => {
  const packet = packetFor(filler, "thanks!!");
  assert.doesNotMatch(packet.text, /rigatoni|flexbox|tomatoes|san diego/i);
});

test("the packet stays inside the profile's budget even when lots of history matches", () => {
  const history = Array.from({ length: 40 }, (_, i) => ({
    id: `deploy-${i}`,
    date: `2026/01/${String((i % 28) + 1).padStart(2, "0")}`,
    turns: [
      { role: "user" as const, content: `deploy notes ${i}: ${"the deploy pipeline needs the staging token and a cache bust. ".repeat(20)}` },
      { role: "assistant" as const, content: `Deploy step ${i} done. ${"Staging looks healthy after the cache bust. ".repeat(20)}` },
    ],
  }));
  const packet = buildPacket({ history, message: "what did we say about the deploy pipeline", profile: { ...profile, packetTokens: 2000 } });
  assert.ok(packet.tokens <= 2000, `packet was ${packet.tokens} tokens`);
  assert.match(packet.text, /deploy pipeline/);
});

test("turns already riding along raw aren't repeated in the packet", () => {
  const session = {
    id: "live",
    turns: [
      { role: "user" as const, content: "the zebra deployment keeps timing out" },
      { role: "assistant" as const, content: "Bump the zebra healthcheck timeout to 30 seconds." },
    ],
  };
  const packet = packetFor([...filler, session], "did the zebra fix work?", "live");
  assert.match(packet.recentTurns.map((t) => t.content).join(" "), /zebra healthcheck/);
  assert.doesNotMatch(packet.text, /zebra healthcheck/);
});
