// Loads the profile's static embedder in the browser: the exact files the evals use (evals/scripts/embedders.sha256),
// fetched from Hugging Face at the revision the repo's mirror release records, and checked by sha256 before use.

import { staticEmbedder, type Embed, type Profile } from "@long-con/core";

const FILES: Record<string, { revision: string; sha256: Record<string, string> }> = {
  "potion-base-8M": {
    revision: "bf8b056651a2c21b8d2565580b8569da283cab23",
    sha256: {
      "tokenizer.json": "e67e803f624fb4d67dea1c730d06e1067e1b14d830e2c2202569e3ef0f70bb50",
      "model.safetensors": "f65d0f325faadc1e121c319e2faa41170d3fa07d8c89abd48ca5358d9a223de2",
    },
  },
};

async function file(name: string, f: string, doFetch: typeof fetch): Promise<Uint8Array> {
  const { revision, sha256 } = FILES[name]!;
  const res = await doFetch(`https://huggingface.co/minishlab/${name}/resolve/${revision}/${f}`);
  if (!res.ok) throw new Error(`${name}/${f}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const hex = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex !== sha256[f]) throw new Error(`${name}/${f}: checksum doesn't match the evals' copy`);
  return bytes;
}

/** The embedder the profile was tuned with, cached per text like the evals' loader; undefined when the profile has none. */
export async function loadEmbedder(profile: Profile, doFetch: typeof fetch = fetch): Promise<Embed | undefined> {
  if (!profile.embedModel || !profile.embedSim) return undefined;
  if (!FILES[profile.embedModel]) throw new Error(`no pinned files for ${profile.embedModel}`);
  const [tokenizer, model] = await Promise.all([file(profile.embedModel, "tokenizer.json", doFetch), file(profile.embedModel, "model.safetensors", doFetch)]);
  const embed = staticEmbedder(JSON.parse(new TextDecoder().decode(tokenizer)), model);
  const cache = new Map<string, Float32Array>();
  return (text) => {
    let v = cache.get(text);
    if (!v) cache.set(text, (v = embed(text)));
    return v;
  };
}
