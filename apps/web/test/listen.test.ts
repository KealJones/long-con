import assert from "node:assert/strict";
import { test } from "node:test";

// A stand-in for Safari's recognizer: each instance is one browser session that the test ends at will.
const sessions: FakeRec[] = [];
class FakeRec {
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() {
    sessions.push(this);
  }
  start() {}
  stop() {
    this.onend?.();
  }
  abort() {
    this.onend?.();
  }
  say(...results: [string, boolean][]) {
    this.onresult?.({ results: results.map(([t, isFinal]) => Object.assign([{ transcript: t }], { isFinal })) });
  }
}
(globalThis as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRec;
const { dictate, pauseMs } = await import("../src/voice.ts");

test("dictation keeps going when Safari ends its own session mid-sentence, and keeps what it heard", async () => {
  const seen: string[] = [];
  let ended = false;
  const stop = dictate((t) => seen.push(t), () => (ended = true));
  sessions.at(-1)!.say(["I'm going to Goodwill", true], ["dropping off", false]);
  sessions.at(-1)!.stop(); // Safari gives up on its own
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(!ended, "still listening");
  sessions.at(-1)!.say(["some old clothes", false]);
  assert.equal(seen.at(-1), "I'm going to Goodwill dropping off some old clothes");
  stop();
  assert.ok(ended);
});

test("a call waits longer after a word a sentence rarely ends on, or an um", () => {
  assert.equal(pauseMs("I might go home and play the", false), 3500);
  assert.equal(pauseMs("No but do you have like", false), 3500);
  assert.equal(pauseMs("so I actually want", true), 3500);
  assert.equal(pauseMs("it was um", false), 3500);
  assert.equal(pauseMs("I'm gonna play Switch Sports with Dash", true), 2200);
  assert.equal(pauseMs("My time zone is Phoenix time", false), 1200);
});
