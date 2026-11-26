import assert from "node:assert/strict";
import { test } from "node:test";
import { PROFILES, searchHistory, type Session } from "../src/index.ts";

const history: Session[] = [
  { id: "a", date: "2024/01/02", turns: [{ role: "user", content: "My favorite BBQ sauce is Kansas City Masterpiece, smoky and sweet." }, { role: "assistant", content: "Great pick for ribs." }] },
  { id: "b", date: "2024/02/03", turns: [{ role: "user", content: "I repotted the fern on the balcony today." }, { role: "assistant", content: "Ferns like shade." }] },
];

test("search_history shares the packet's search and marks weak hits instead of dropping them", () => {
  const strong = searchHistory(history, "Which BBQ sauce do I like?", PROFILES.claude);
  assert.match(strong, /Kansas City Masterpiece/);
  assert.doesNotMatch(strong.split("\n")[0]!, /low confidence/);
  const weak = searchHistory(history, "Did I mention the balcony door lock?", PROFILES.claude);
  assert.match(weak, /balcony/);
  assert.match(weak, /low confidence/);
  assert.equal(searchHistory(history, "quantum chromodynamics", PROFILES.claude), "No matches.");
});
