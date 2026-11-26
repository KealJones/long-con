// Time phrases resolve to day ranges, and a named time lifts units from those days (P07).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPacket, PROFILES, type Session } from "../src/index.ts";
import { dayOf, timeRanges } from "../src/dates.ts";
import { filler } from "./fixtures.ts";

const iso = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
const resolve = (text: string, on: string) => timeRanges(text, dayOf(on)!).map((r) => `${iso(r.from)}..${iso(r.to)}`);

test("relative and named dates resolve against the reference day", () => {
  assert.deepEqual(resolve("the music event last Saturday", "2023/04/22 (Sat) 08:01"), ["2023-04-15..2023-04-15"]);
  assert.deepEqual(resolve("what did I do two weeks ago", "2023/05/05 (Fri) 16:42"), ["2023-04-18..2023-04-24"]);
  assert.deepEqual(resolve("trips in the past three months", "2023/06/01"), ["2023-03-03..2023-06-01"]);
  assert.deepEqual(resolve("I planted them yesterday", "2023/04/21"), ["2023-04-20..2023-04-20"]);
  assert.deepEqual(resolve("we went last week", "2023/04/19 (Wed)"), ["2023-04-10..2023-04-16"]);
  assert.deepEqual(resolve("back in March", "2023/04/19"), ["2023-03-01..2023-03-31"]);
  assert.deepEqual(resolve("on December 3rd", "2023/04/19"), ["2022-12-03..2022-12-03"]);
  // "may" the verb, and questions about elapsed time, name no range.
  assert.deepEqual(resolve("may I ask how many days ago I fixed the bike?", "2023/04/19"), []);
});

const chat = (id: string, date: string, said: string): Session => ({ id, date, turns: [{ role: "user", content: said }, { role: "assistant", content: "Sounds fun." }] });

test("a named time picks the unit from that day over a stronger keyword match from another", () => {
  const history = [
    chat("a", "2023/04/08 (Sat) 10:00", "Saw a great jazz concert with my sister, the concert hall was packed for the concert."),
    ...filler,
    chat("b", "2023/04/15 (Sat) 10:00", "Just got back from a concert with my parents."),
  ];
  const message = "who did I go to the concert with last Saturday?";
  const profile = { ...PROFILES.smallLocal, minConfidence: 0.9, unitGate: 0, minScore: 0 };
  const off = buildPacket({ history, message, profile: { ...profile, timeBoost: 0 }, now: "2023/04/22 (Sat) 08:00" });
  const on = buildPacket({ history, message, profile: { ...profile, timeBoost: 1 }, now: "2023/04/22 (Sat) 08:00" });
  assert.deepEqual(off.segments.map((s) => s.sessionId), ["a"]);
  assert.ok(on.segments.some((s) => s.sessionId === "b"));
  // An event a user turn dates counts too: said on Sunday, "yesterday" is last Saturday.
  const told = [history[0]!, ...filler, chat("c", "2023/04/16 (Sun) 10:00", "Went to a concert yesterday with my cousin.")];
  assert.ok(buildPacket({ history: told, message, profile: { ...profile, timeBoost: 1 }, now: "2023/04/22 (Sat) 08:00" }).segments.some((s) => s.sessionId === "c"));
  // No date, no boost.
  assert.deepEqual(buildPacket({ history, message, profile: { ...profile, timeBoost: 1 } }).segments.map((s) => s.sessionId), ["a"]);
});
