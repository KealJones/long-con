// Interest notes (P31): explicit wording becomes a dated note, newest value wins, and notes only ride behind the gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPacket, PROFILES, type Session } from "../src/index.ts";
import { extractNotes, groupNotes, notesFromTurn, renderGroup } from "../src/notes.ts";
import { filler } from "./fixtures.ts";

const ref = { sessionId: "s", turn: 0 };

test("explicit interest wording becomes a note; passing remarks, questions and relative clauses don't", () => {
  const value = (said: string) => notesFromTurn(said, ref).map((n) => n.value);
  assert.deepEqual(value("I need more of my favorite BBQ sauce, Sweet Baby Ray's, for the ribs."), ["Sweet Baby Ray's"]);
  assert.deepEqual(value("ok so I'm currently obsessed with Kansas City Masterpiece BBQ sauce on my ribs"), ["Kansas City Masterpiece BBQ sauce on my ribs"]);
  assert.deepEqual(value("I've been really into Latin music lately, especially salsa."), ["Latin music"]);
  assert.deepEqual(value("I switched to oat milk last month."), ["oat milk last month"]);
  for (const said of ["I had sushi today.", "Do you think I'm into jazz?", "I'm looking into flights.", "I'm selling some CDs I no longer listen to.", "I prefer not to say."])
    assert.deepEqual(value(said), [], said);
});

test("health and other special categories stay out of automatic notes", () => {
  assert.deepEqual(notesFromTurn("I switched to my new meds last week.", ref), []);
});

test("a later note on the same topic supersedes the earlier one, which stays as history", () => {
  const history: Session[] = [
    { id: "a", date: "2023/04/16 (Sun) 02:28", turns: [{ role: "user", content: "Stocking up on my favorite BBQ sauce, Sweet Baby Ray's." }] },
    { id: "b", date: "2023/06/30 (Fri) 05:15", turns: [{ role: "user", content: "I'm currently obsessed with Kansas City Masterpiece BBQ sauce." }] },
  ];
  const [group, ...rest] = groupNotes(extractNotes(history));
  assert.equal(rest.length, 0);
  assert.equal(
    renderGroup(group!),
    "- BBQ sauce: Kansas City Masterpiece BBQ sauce (obsessed with, 2023/06/30); earlier: Sweet Baby Ray's (favorite, 2023/04/16)",
  );
});

test("a matching note rides in before retrieved history; an off-topic message gets no notes", () => {
  const history: Session[] = [...filler, { id: "bbq", date: "2023/06/30 (Fri) 05:15", turns: [{ role: "user", content: "I'm currently obsessed with Kansas City Masterpiece BBQ sauce on my ribs." }, { role: "assistant", content: "Nice pick." }] }];
  const hit = buildPacket({ history, message: "what BBQ sauce am I obsessed with lately?", profile: PROFILES.claude });
  assert.equal(hit.notes.length, 1);
  assert.ok(hit.text.indexOf("Notes on what the user said") < hit.text.indexOf("Retrieved history"));
  assert.match(hit.text, /Kansas City Masterpiece BBQ sauce on my ribs \(obsessed with, 2023\/06\/30\)/);
  for (const message of ["what's the capital of Mongolia?", "obsessed!"]) {
    const off = buildPacket({ history, message, profile: PROFILES.claude });
    assert.equal(off.notes.length, 0, message);
    assert.doesNotMatch(off.text, /Notes on what/);
  }
});
