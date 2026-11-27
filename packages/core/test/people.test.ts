// Person index (P24): clear wording only, no guessed merges, abstain on unknown or ambiguous, pointers only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPacket, buildPersonIndex, peopleIn, personCard, PROFILES, type Session } from "../src/index.ts";
import { filler } from "./fixtures.ts";

const history: Session[] = [
  ...filler,
  {
    id: "grad",
    date: "2026/03/10 (Tue) 18:00",
    turns: [
      { role: "user", content: "my sister Emma is graduating in may, what do i get her for a gift" },
      { role: "assistant", content: "A nice pen or a framed print of her campus." },
    ],
  },
  {
    id: "party",
    date: "2026/03/20 (Fri) 18:00",
    turns: [
      { role: "user", content: "booked the venue for my sister's graduation party, the rooftop place downtown" },
      { role: "user", content: "also my boss Sam wants the report friday and my friend Sam is visiting, ugh" },
      { role: "user", content: "my mom had surgery last week so i'm driving her to the hospital checkup" },
      { role: "user", content: "my friend Priya lent me her tent" },
    ],
  },
];
const index = buildPersonIndex(history);
const names = (message: string) => peopleIn(message, index).map((p) => p.label);

test("a stated name joins its relation, and bare mentions of that relation point at the same person", () => {
  assert.deepEqual(names("what did I book for my sister's party?"), ["my sister Emma"]);
  assert.deepEqual(names("what gift did I pick for Emma?"), ["my sister Emma"]);
  const card = personCard(peopleIn("where is my sister's graduation party?", index)[0]!, "where is my sister's graduation party?", index)!;
  assert.equal(card.mentions, 2);
  assert.deepEqual(card.pointers[0], { sessionId: "party", turn: 0, date: "2026/03/20 (Fri) 18:00", query: card.pointers[0]!.query });
});

test("abstains on unknown people, many-person relations and a name tied to two kinds of person", () => {
  assert.deepEqual(names("what did my uncle Bartholomew say?"), []);
  assert.deepEqual(names("remind me what my friend said"), []);
  assert.deepEqual(names("when is Sam coming?"), []);
  assert.deepEqual(names("Will it rain tomorrow?"), []);
  assert.deepEqual(names("what did my friend Priya lend me?"), ["my friend Priya"]);
});

test("private words stay off the card", () => {
  const card = personCard(peopleIn("how is my mom doing?", index)[0]!, "how is my mom doing?", index)!;
  assert.match(card.line, /^- my mother, 1 mention: 2026\/03\/20 "mom /);
  assert.doesNotMatch(card.line, /surgery|hospital/);
});

test("packets are unchanged without the index and carry a card with it", () => {
  const message = "what did I book for my sister's party?";
  const plain = buildPacket({ history, message, profile: PROFILES.claude });
  const withCards = buildPacket({ history, message, profile: PROFILES.claude, people: index });
  assert.deepEqual(plain.people, []);
  assert.equal(withCards.people.length, 1);
  assert.ok(withCards.text.includes(plain.text.split("\n")[0]!));
  assert.match(withCards.text, /People the message names/);
  assert.equal(buildPacket({ history, message: "what's a good pasta recipe?", profile: PROFILES.claude, people: index }).text,
    buildPacket({ history, message: "what's a good pasta recipe?", profile: PROFILES.claude }).text);
});
