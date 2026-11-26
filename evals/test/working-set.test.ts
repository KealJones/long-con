import { test } from "node:test";
import assert from "node:assert/strict";
import { listedPaths, sectionOf } from "../loop/working-set.ts";
import { WORKING_SET } from "@long-con/core";

test("the working-set scorer reads every path a section claims, root and truncated lines included", () => {
  const text = `head\n\n${WORKING_SET}\n./: docs/ *README.md\npackages/core/src/: *packet.ts text.ts +12 more\n\nRetrieved history, oldest first:`;
  assert.deepEqual(listedPaths(sectionOf(text)), ["/", "docs/", "README.md", "packages/core/src/", "packages/core/src/packet.ts", "packages/core/src/text.ts"]);
  assert.equal(sectionOf("no section here"), "");
});
