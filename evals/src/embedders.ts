// Loads a model2vec static embedder from evals/data/models/<name> (fetched by evals/scripts/fetch-embedders.sh) and caches
// embeddings by text, so a message shared by many dev histories embeds once per process.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readSafetensor, staticEmbedder, type Embed } from "@long-con/core";

export const MODELS = join(dirname(fileURLToPath(import.meta.url)), "../data/models");

export function loadEmbedder(name: string, dir = join(MODELS, name)): Embed & { stats: { calls: number; misses: number; ms: number } } {
  const config = JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) as { normalize?: boolean };
  const tokenizer = JSON.parse(readFileSync(join(dir, "tokenizer.json"), "utf8"));
  const embed = staticEmbedder(tokenizer, readSafetensor(readFileSync(join(dir, "model.safetensors")), "embeddings"), { normalize: config.normalize ?? true });
  const cache = new Map<string, Float32Array>();
  const stats = { calls: 0, misses: 0, ms: 0 };
  return Object.assign((text: string) => {
    stats.calls++;
    let v = cache.get(text);
    if (!v) {
      const t = performance.now();
      v = embed(text);
      stats.ms += performance.now() - t;
      stats.misses++;
      cache.set(text, v);
    }
    return v;
  }, { stats });
}
