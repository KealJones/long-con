// Loads the profile's embedder in the browser: core's pinned files (EMBED_FILES), fetched from Hugging Face at their
// revision, checked by sha256, then built by core's fileEmbedder, the same function the evals use.

import { EMBED_FILES, embedModelOf, fileEmbedder, type Embed, type Profile } from "@long-con/core";

async function file(name: string, f: "tokenizer.json" | "model.safetensors", doFetch: typeof fetch): Promise<Uint8Array> {
  const { revision, sha256 } = EMBED_FILES[name]!;
  const res = await doFetch(`https://huggingface.co/minishlab/${name}/resolve/${revision}/${f}`);
  if (!res.ok) throw new Error(`${name}/${f}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const hex = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex !== sha256[f]) throw new Error(`${name}/${f}: checksum doesn't match the evals' copy`);
  return bytes;
}

/** The embedder the profile was tuned with; undefined when the profile has none. */
export async function loadEmbedder(profile: Profile, doFetch: typeof fetch = fetch): Promise<Embed | undefined> {
  const name = embedModelOf(profile);
  if (!name) return undefined;
  if (!EMBED_FILES[name]) throw new Error(`no pinned files for ${name}`);
  const [tokenizer, model] = await Promise.all([file(name, "tokenizer.json", doFetch), file(name, "model.safetensors", doFetch)]);
  return fileEmbedder(tokenizer, model);
}
