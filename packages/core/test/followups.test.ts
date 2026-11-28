// Follow-ups that lean on what was just said: "go", "do all that", "multiply it by 32", "the second one", "thanks!!",
// "you forgot", "it's actually the 24th". Most of these need no search, only the write-time registers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPacket, PROFILES, type Session, type Turn } from "../src/index.ts";
import { buildRegisters, extractRules } from "../src/registers.ts";
import { filler } from "./fixtures.ts";

const profile = PROFILES.claude;
const today = (turns: Turn[]): Session => ({ id: "today", date: "2026/04/02 (Thu) 09:00", turns });
const ask = (turns: Turn[], message: string, extra: Partial<Parameters<typeof buildPacket>[0]> = {}) =>
  buildPacket({ history: [...filler, today(turns)], message, profile, currentSessionId: "today", ...extra });
const u = (content: string): Turn => ({ role: "user", content });
const a = (content: string): Turn => ({ role: "assistant", content });

test("'go' takes up the offer the last reply made", () => {
  const p = ask([u("my landlord still hasn't fixed the heater"), a("That's past the 7 days your lease allows. Want me to draft a short email to your landlord citing that clause?")], "go");
  assert.equal(p.resolution.status, "resolved");
  assert.match(p.text, /takes up your offer: "[^"]*draft a short email/);
});

test("'yes' after a reply with two offers asks which instead of guessing", () => {
  const p = ask([u("plan my saturday"), a("Want me to book the 10am climbing slot? I can also find a lunch spot near the gym.")], "yes");
  assert.equal(p.resolution.status, "unsure");
  assert.match(p.text, /climbing/);
  assert.match(p.text, /lunch spot/);
});

test("'now do all that' covers every open offer, including one talked over in voice", () => {
  const p = ask(
    [
      u("the shard upload keeps failing"),
      a("It's the 64 MB limit. Should I write a script that splits the files?"),
      u("hm ok"),
      a("Also, want me to add a retry with backoff to the uploader?"),
      u("[The user interrupted you; they heard up to \"Also\".]\n\nwait what about the logs"),
      a("The logs rotate daily. Shall I add a size cap to them too?"),
    ],
    "now do all that",
  );
  assert.equal(p.resolution.status, "resolved");
  for (const offer of [/splits the files/, /retry with backoff/, /size cap/]) assert.match(p.text, offer);
  assert.match(p.text, /retry with backoff[^)]*\(talked over, never heard\)/);
});

test("'multiply it by 2' uses the headline of the last answer, not its last number", () => {
  const p = ask([u("how much is in my hysa now"), a("About $5,500: $5,400 in deposits plus roughly $100 in interest.")], "multiply it by 2");
  assert.equal(p.resolution.status, "resolved");
  assert.match(p.text, /'it' read as \$5,500/);
  const rent = ask([u("what's 60% of my rent"), a("60% of $2,900 is $1,740 a month.")], "and double that");
  assert.match(rent.text, /'it' read as \$1,740/);
});

test("numbers in a list aren't a result", () => {
  const p = ask([u("what plans are there"), a("Two options:\n1. Basic, $20 a month\n2. Pro, $35 a month")], "double it");
  assert.equal(p.resolution.status, "unsure");
  assert.match(p.text, /no earlier number/);
});

test("'the second one' finds a list that scrolled out of the raw window", () => {
  const chatter = Array.from({ length: 4 }, (_, i) => [u(`side question ${i} about knots`), a(`Answer ${i} about knots.`)]).flat();
  const p = ask([u("give me hike ideas"), a("1. Mount Si\n2. Rattlesnake Ledge\n3. Poo Poo Point"), ...chatter], "tell me more about the second one");
  assert.equal(p.resolution.status, "resolved");
  assert.match(p.text, /Rattlesnake Ledge/);
});

test("a rule said mid-sentence is kept whole with its scope; pasted advice isn't a rule", () => {
  assert.deepEqual(extractRules("ok so for the tilde repo from now on always write typescript, never suggest python for it."), [
    "ok so for the tilde repo from now on always write typescript, never suggest python for it.",
  ]);
  assert.deepEqual(extractRules("Remember to be patient with yourself. Remember to drink water."), []);
  assert.deepEqual(extractRules("never mind, that's fine"), []);
});

test("a muted rule leaves the packet", () => {
  const rule = "Always answer in metric.";
  const turns = [u(rule), a("Will do."), u("how tall is denali")];
  assert.match(ask(turns, "and k2?").text, /Always answer in metric/);
  assert.doesNotMatch(ask(turns, "and k2?", { mutedRules: [rule] }).text, /Always answer in metric/);
});

test("'thanks!!' builds no packet and claims no unclear reference", () => {
  const p = ask([u("fix my regex"), a("Use ^\\d{3}-\\d{4}$.")], "thanks!!");
  assert.equal(p.retrieved, false);
  assert.doesNotMatch(p.text, /Reference unclear/);
  assert.equal(p.segments.length, 0);
});

test("'you forgot the tax' marks the answer before it as rejected", () => {
  const history: Session[] = [today([u("total for 3 shirts at $20"), a("That's $60."), u("you forgot the tax")])];
  const regs = buildRegisters(history, 2);
  assert.ok(regs.rejected.has("today#1"), [...regs.rejected].join(","));
});

test("'it's actually the 24th' is linked to the date it replaces, so the old one reads as changed", () => {
  const history: Session[] = [
    ...filler,
    { id: "march", date: "2026/03/01 (Sun) 10:00", turns: [u("my dentist appointment is on the 22nd"), a("Noted, the 22nd.")] },
    { id: "later", date: "2026/03/10 (Tue) 10:00", turns: [u("the dentist moved it, it's actually the 24th now"), a("Got it, the 24th.")] },
  ];
  const p = buildPacket({ history, message: "when is my dentist appointment", profile });
  assert.match(p.text, /on the 22nd \[changed later \(said 2026\/03\/10[^\]]*24th/);
});

test("an old answer about prices carries a check-before-repeating note", () => {
  const history: Session[] = [
    ...filler,
    { id: "models", date: "2025/12/01 (Mon) 10:00", turns: [u("which hosted models have a free tier for my side project"), a("GitHub Models has a free tier with rate limits per day.")] },
  ];
  const p = buildPacket({ history, message: "which hosted models had a free tier for my side project", profile });
  assert.match(p.text, /may have changed: check before repeating/);
});

test("a search that finds nothing says so, when the profile asks for it", () => {
  const off = ask([], "what did I name my sourdough starter");
  assert.doesNotMatch(off.text, /nothing relevant found/);
  const on = buildPacket({ history: [...filler, today([])], message: "what did I name my sourdough starter", profile: { ...profile, notFound: true }, currentSessionId: "today" });
  assert.equal(on.segments.length, 0);
  assert.match(on.text, /Searched past chats for "[^"]*sourdough[^"]*": nothing relevant found\./);
  const general = buildPacket({ history: [...filler, today([])], message: "write me a sourdough schedule", profile: { ...profile, notFound: true }, currentSessionId: "today" });
  assert.doesNotMatch(general.text, /nothing relevant found/, "a request that isn't about the past gets no line");
});

test("a hit on a question brings the answer that sits in the next unit", () => {
  const question = `whats the cheapest way to get from boston to lisbon in may? ${"I can fly any weekday and carry on only, and I don't mind one stop if it saves real money. ".repeat(5)}`;
  const answer = `${"Fares move a lot week to week, so treat this as a snapshot of what the search showed. ".repeat(14)}Best I see: TAP nonstop at $412 round trip.`;
  const history: Session[] = [...filler, { id: "trip", date: "2026/02/01 (Sun) 10:00", turns: [u(question), a(answer)] }];
  const p = buildPacket({ history, message: "what was the cheapest way from boston to lisbon you found", profile: { ...profile, answerFollows: true } });
  assert.match(p.text, /\$412/);
});

test("the topic window carries earlier same-topic turns raw, and stops where the topic changed", () => {
  const turns = [
    u("what should I name my new kitten"),
    a("Miso, Biscuit or Pepper are popular kitten names."),
    ...Array.from({ length: 4 }, (_, i) => [u(`my sourdough starter smells sour, day ${i}`), a(`A sour sourdough starter on day ${i} is normal; feed it.`)]).flat(),
  ];
  const wide = ask(turns, "should I feed the sourdough starter again", { profile: { ...profile, topicTokens: 2000 } });
  assert.equal(wide.recentTurns.length, 8, "all four sourdough exchanges ride along");
  assert.equal(ask(turns, "should I feed the sourdough starter again").recentTurns.length, profile.rawTurns);
});
