import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMBED_FILES } from "@beep/core";

test("the evals' model sums match core's pins, so both entry points load the same files", () => {
  const sums = Object.fromEntries(readFileSync(new URL("../scripts/embedders.sha256", import.meta.url), "utf8").trim().split("\n").map((l) => l.split(/\s+/).reverse()));
  for (const [name, { sha256 }] of Object.entries(EMBED_FILES))
    for (const [f, sha] of Object.entries(sha256)) assert.equal(sums[`${name}--${f}`], sha, `${name}/${f}`);
});
