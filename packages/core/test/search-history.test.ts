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

test("search_history marks a hit low confidence when the packet's embedding veto would drop it", () => {
  const query = "Which BBQ sauce do I like?";
  // Fake embedders: `near` points text naming Kansas the query's way, `far` points every unit away.
  const near = (t: string) => new Float32Array(t.includes("Kansas") || t === query ? [1, 0] : [0, 1]);
  const far = (t: string) => new Float32Array(t === query ? [1, 0] : [0, 1]);
  const profile = { ...PROFILES.claude, embedSim: "maxsim" as const, embedFloor: 0.5 };
  assert.doesNotMatch(searchHistory(history, query, profile, near).split("\n")[0]!, /low confidence/);
  assert.match(searchHistory(history, query, profile, far).split("\n")[0]!, /low confidence/);
  assert.doesNotMatch(searchHistory(history, query, { ...profile, embedFloor: 0 }, far).split("\n")[0]!, /low confidence/);
  assert.equal(searchHistory(history, query, profile), searchHistory(history, query, { ...profile, embedFloor: 0 }, far), "no embedder, no veto");
});
