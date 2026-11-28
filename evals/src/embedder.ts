// Loads a model2vec model fetched by evals/scripts/fetch-embedders.sh from disk (files checked against the sums in
// embedders.sha256, which a test keeps equal to core's EMBED_FILES).

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { embedModelOf, fileEmbedder, type Embed, type Profile } from "@beep/core";

export const MODELS = join(dirname(fileURLToPath(import.meta.url)), "../data/models");

const loaded = new Map<string, Embed>();
const warned = new Set<string>();

export function loadEmbedder(name: string): Embed {
  const have = loaded.get(name);
  if (have) return have;
  const dir = join(MODELS, name);
  // core's fileEmbedder, the same one the web chat builds from the same pinned files (EMBED_FILES).
  const embed = fileEmbedder(readFileSync(join(dir, "tokenizer.json")), readFileSync(join(dir, "model.safetensors")));
  loaded.set(name, embed);
  return embed;
}

/** The embedder a profile's embedding gate was tuned with, or undefined (with a warning) when its files aren't fetched. */
export function embedderFor(profile: Profile): Embed | undefined {
  const name = embedModelOf(profile);
  if (!name) return undefined;
  if (!existsSync(join(MODELS, name, "model.safetensors"))) {
    if (!warned.has(name)) console.error(`No ${name} under ${MODELS}; run evals/scripts/fetch-embedders.sh. Packets skip the embedding gate.`);
    warned.add(name);
    return undefined;
  }
  return loadEmbedder(name);
}
