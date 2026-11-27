import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { PROFILES } from "@long-con/core";
import { loadEmbedder } from "../src/embedder.ts";

const dir = new URL("../../../evals/data/models/potion-base-8M/", import.meta.url);
const have = existsSync(new URL("model.safetensors", dir));
const serve = (tamper = false) =>
  (async (url: string) => {
    const bytes = readFileSync(new URL(String(url).split("/").at(-1)!, dir));
    if (tamper) bytes[0] ^= 1;
    return new Response(bytes);
  }) as unknown as typeof fetch;

test("the web chat loads the evals' embedder and checks its files", { skip: !have && "run evals/scripts/fetch-embedders.sh" }, async () => {
  const embed = await loadEmbedder(PROFILES.claude, serve());
  assert.ok(embed);
  assert.equal(embed("hello there").length, embed("secret").length);
  await assert.rejects(loadEmbedder(PROFILES.claude, serve(true)), /checksum/);
});
