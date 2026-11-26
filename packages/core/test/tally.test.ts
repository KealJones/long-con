// Tally mode: counting questions get one small piece from each chat instead of a few whole segments.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPacket, PROFILES, type Session } from "../src/index.ts";
import { isTallyQuestion } from "../src/tally.ts";
import { filler } from "./fixtures.ts";

test("counting and aggregation questions are told apart from spans, ages and plain lookups", () => {
  for (const m of ["How many weddings have I attended this year?", "what's the total I spent on gifts", "list all the books I mentioned", "How much did I pay for each mug?"])
    assert.ok(isTallyQuestion(m), m);
  for (const m of ["How many days ago did I fix the bike?", "How many years older is my grandma than me?", "Where did I get my guitar serviced?", "hi there"])
    assert.ok(!isTallyQuestion(m), m);
});

const long = (topic: string) => `Here is a long answer about ${topic}. `.repeat(60);
const chatAbout = (id: string, day: string, said: string): Session => ({
  id,
  date: `2026/0${day} 10:00`,
  turns: [
    { role: "user", content: said },
    { role: "assistant", content: long("wedding venues") },
  ],
});

test("a counting question brings one piece from every turn that holds one, dated, without the long answers", () => {
  const history = [
    chatAbout("a", "1/10 (Sat)", "I went to my cousin's concert at a vineyard last weekend, it was lovely."),
    ...filler,
    chatAbout("b", "2/14 (Sat)", "Just got back from Emily and Sarah's concert at the beach."),
    chatAbout("c", "3/21 (Sat)", "My college roommate's concert was yesterday, we danced all night."),
  ];
  const packet = buildPacket({ history, message: "how many concerts have I been to this year?", profile: PROFILES.smallLocal });
  for (const s of ["cousin's concert at a vineyard", "Emily and Sarah's concert", "roommate's concert was yesterday", "2026/01/10", "2026/03/21"]) assert.ok(packet.text.includes(s), s);
  assert.doesNotMatch(packet.text, /long answer about wedding venues/);
  assert.equal(new Set(packet.segments.map((s) => s.sessionId)).size, packet.segments.length, "one piece per turn");
});

test("a long user turn comes in as its best sentence and its neighbours, marked as part of a longer turn", () => {
  const said = `${"I like hiking and camping in the desert. ".repeat(30)}Also I attended my friend's concert in Ohio. Then we drove home.`;
  const packet = buildPacket({ history: [...filler, chatAbout("a", "1/10 (Sat)", said)], message: "how many concerts did I attend in total", profile: PROFILES.claude });
  assert.match(packet.text, /I attended my friend's concert in Ohio\. Then we drove home\./);
  assert.match(packet.text, /part of a longer turn/);
  assert.ok(packet.tokens < 400);
});

test("a message that isn't a count builds the same packet as before", () => {
  const history = [...filler, chatAbout("a", "1/10 (Sat)", "I went to my cousin's wedding at a vineyard.")];
  const packet = buildPacket({ history, message: "where was my cousin's wedding?", profile: PROFILES.claude });
  assert.match(packet.text, /long answer about wedding venues/, "whole segments, answers included");
});
