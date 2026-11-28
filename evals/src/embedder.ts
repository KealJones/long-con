// Loads a model2vec model fetched by evals/scripts/fetch-embedders.sh from disk, with a per-text cache, since the
// evals embed the same units over and over.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { staticEmbedder, type Embed, type Profile } from "@beep/core";

export const MODELS = join(dirname(fileURLToPath(import.meta.url)), "../data/models");

const loaded = new Map<string, Embed>();
const warned = new Set<string>();

export function loadEmbedder(name: string): Embed {
  const have = loaded.get(name);
  if (have) return have;
  const dir = join(MODELS, name);
  const embed = staticEmbedder(JSON.parse(readFileSync(join(dir, "tokenizer.json"), "utf8")), readFileSync(join(dir, "model.safetensors")));
  const cache = new Map<string, Float32Array>();
  const cached: Embed = (text) => {
    let v = cache.get(text);
    if (!v) cache.set(text, (v = embed(text)));
    return v;
  };
  loaded.set(name, cached);
  return cached;
}

/** The embedder a profile's embedding gate was tuned with, or undefined (with a warning) when its files aren't fetched. */
export function embedderFor(profile: Profile): Embed | undefined {
  if (!profile.embedModel || !profile.embedSim) return undefined;
  if (!existsSync(join(MODELS, profile.embedModel, "model.safetensors"))) {
    if (!warned.has(profile.embedModel)) console.error(`No ${profile.embedModel} under ${MODELS}; run evals/scripts/fetch-embedders.sh. Packets skip the embedding gate.`);
    warned.add(profile.embedModel);
    return undefined;
  }
  return loadEmbedder(profile.embedModel);
}
