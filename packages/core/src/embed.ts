// Static (model2vec) embedder in plain TypeScript: WordPiece tokens, the mean of their rows in one embedding matrix, then
// L2-normalized, the way model2vec's StaticModel.encode does it. No node-only imports: the caller reads the model files
// (tokenizer.json and model.safetensors) and passes them in, so this also runs in the browser.

export type Embed = (text: string) => Float32Array;

interface TokenizerJson {
  normalizer?: { type?: string; lowercase?: boolean; strip_accents?: boolean | null; clean_text?: boolean; handle_chinese_chars?: boolean } | null;
  model: { type: string; vocab: Record<string, number>; unk_token: string; continuing_subword_prefix?: string; max_input_chars_per_word?: number };
}

/** model2vec.encode's default: at most this many tokens per text. */
const MAX_TOKENS = 512;

// BertPreTokenizer isolates Unicode punctuation and all ASCII punctuation (which includes symbols like $, +, <, |).
const PUNCT = /[\p{P}!-/:-@[-`{-~]/u;
const CJK = /[一-鿿㐀-䶿\u{20000}-\u{2A6DF}\u{2A700}-\u{2B73F}\u{2B740}-\u{2B81F}\u{2B820}-\u{2CEAF}豈-﫿\u{2F800}-\u{2FA1F}]/u;

/** WordPiece over a BertNormalizer and BertPreTokenizer, as in the BERT-family tokenizer.json files model2vec ships. */
export function wordPiece(tokenizer: TokenizerJson) {
  const { model } = tokenizer;
  if (model.type !== "WordPiece") throw new Error(`Only WordPiece tokenizers are supported, not ${model.type}`);
  const vocab = new Map(Object.entries(model.vocab));
  const unk = vocab.get(model.unk_token);
  const prefix = model.continuing_subword_prefix ?? "##";
  const maxChars = model.max_input_chars_per_word ?? 100;
  const norm = tokenizer.normalizer ?? {};
  if (norm.type && norm.type !== "BertNormalizer") throw new Error(`Only the BertNormalizer is supported, not ${norm.type}`);
  const lowercase = norm.lowercase ?? true;
  // HF semantics: strip_accents null follows lowercase.
  const stripAccents = norm.strip_accents ?? lowercase;

  const normalize = (text: string): string => {
    let out = "";
    for (const ch of text) {
      const c = ch.codePointAt(0)!;
      if (norm.clean_text !== false) {
        if (c === 0 || c === 0xfffd || (/[\p{Cc}\p{Cf}]/u.test(ch) && !"\t\n\r".includes(ch))) continue;
        if (/\s/u.test(ch)) {
          out += " ";
          continue;
        }
      }
      out += norm.handle_chinese_chars !== false && CJK.test(ch) ? ` ${ch} ` : ch;
    }
    if (stripAccents) out = out.normalize("NFD").replace(/\p{Mn}/gu, "");
    return lowercase ? out.toLowerCase() : out;
  };

  const piece = (word: string, ids: number[]) => {
    const chars = [...word];
    if (chars.length > maxChars) return void (unk !== undefined && ids.push(unk));
    const found: number[] = [];
    for (let start = 0; start < chars.length; ) {
      let end = chars.length;
      let id: number | undefined;
      for (; end > start; end--) {
        id = vocab.get((start > 0 ? prefix : "") + chars.slice(start, end).join(""));
        if (id !== undefined) break;
      }
      // One piece with no match makes the whole word unknown.
      if (id === undefined) return void (unk !== undefined && ids.push(unk));
      found.push(id);
      start = end;
    }
    ids.push(...found);
  };

  /** Token ids, no special tokens. */
  return (text: string): number[] => {
    const ids: number[] = [];
    for (const chunk of normalize(text).split(" ")) {
      let word = "";
      for (const ch of chunk) {
        if (!PUNCT.test(ch)) {
          word += ch;
          continue;
        }
        if (word) piece(word, ids);
        word = "";
        piece(ch, ids);
      }
      if (word) piece(word, ids);
    }
    return ids;
  };
}

/** The first tensor of a safetensors file as a float32 row-major matrix. F32, F16 and BF16 are read; others throw. */
export function readSafetensors(bytes: Uint8Array): { rows: number; dim: number; data: Float32Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = Number(view.getBigUint64(0, true));
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLength))) as Record<string, { dtype: string; shape: number[]; data_offsets: [number, number] }>;
  const name = Object.keys(header).find((k) => k !== "__metadata__");
  if (!name) throw new Error("No tensor in the safetensors file");
  const { dtype, shape, data_offsets } = header[name]!;
  if (shape.length !== 2) throw new Error(`Expected a 2-D embedding matrix, got shape [${shape}]`);
  const [rows, dim] = shape as [number, number];
  const start = 8 + headerLength + data_offsets[0];
  const n = rows * dim;
  const data = new Float32Array(n);
  if (dtype === "F32") for (let i = 0; i < n; i++) data[i] = view.getFloat32(start + 4 * i, true);
  else if (dtype === "F16") for (let i = 0; i < n; i++) data[i] = half(view.getUint16(start + 2 * i, true));
  else if (dtype === "BF16") {
    const f = new DataView(new ArrayBuffer(4));
    for (let i = 0; i < n; i++) {
      f.setUint32(0, view.getUint16(start + 2 * i, true) << 16);
      data[i] = f.getFloat32(0);
    }
  } else throw new Error(`Unsupported dtype ${dtype}`);
  return { rows, dim, data };
}

function half(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return sign * 2 ** -14 * (frac / 1024);
  if (exp === 31) return frac ? NaN : sign * Infinity;
  return sign * 2 ** (exp - 15) * (1 + frac / 1024);
}

/** A model2vec embedder: unknown tokens dropped, first 512 tokens, mean of their rows, L2-normalized (zeros for no tokens). */
export function staticEmbedder(tokenizer: TokenizerJson, safetensors: Uint8Array): Embed {
  const tokenize = wordPiece(tokenizer);
  const unk = tokenizer.model.vocab[tokenizer.model.unk_token];
  const { rows, dim, data } = readSafetensors(safetensors);
  return (text) => {
    const out = new Float32Array(dim);
    const ids = tokenize(text).filter((id) => id !== unk && id < rows).slice(0, MAX_TOKENS);
    for (const id of ids) for (let j = 0, o = id * dim; j < dim; j++) out[j] += data[o + j]!;
    let norm = 0;
    for (let j = 0; j < dim; j++) norm += out[j]! * out[j]!;
    norm = Math.sqrt(norm);
    if (norm > 0) for (let j = 0; j < dim; j++) out[j] /= norm;
    return out;
  };
}

/** Dot product; the cosine for normalized vectors. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/**
 * The model files every entry point loads, pinned to the revision the evals were tuned on. The evals read them from
 * disk (evals/scripts/fetch-embedders.sh, whose embedders.sha256 a test keeps equal to this), the web chat fetches
 * them from Hugging Face; both check these sums and build the embedder with fileEmbedder.
 */
export const EMBED_FILES: Record<string, { revision: string; sha256: Record<"tokenizer.json" | "model.safetensors", string> }> = {
  "potion-base-8M": {
    revision: "bf8b056651a2c21b8d2565580b8569da283cab23",
    sha256: {
      "tokenizer.json": "e67e803f624fb4d67dea1c730d06e1067e1b14d830e2c2202569e3ef0f70bb50",
      "model.safetensors": "f65d0f325faadc1e121c319e2faa41170d3fa07d8c89abd48ca5358d9a223de2",
    },
  },
};

/** The model a profile's embedding veto runs on, or undefined when the profile has none. */
export const embedModelOf = (p: { embedModel?: string; embedSim?: unknown }) => (p.embedModel && p.embedSim ? p.embedModel : undefined);

/** The embedder every entry point uses: model2vec from the model's two files, cached per text since units repeat. */
export function fileEmbedder(tokenizerJson: Uint8Array, safetensors: Uint8Array): Embed {
  const embed = staticEmbedder(JSON.parse(new TextDecoder().decode(tokenizerJson)), safetensors);
  const cache = new Map<string, Float32Array>();
  return (text) => {
    let v = cache.get(text);
    if (!v) cache.set(text, (v = embed(text)));
    return v;
  };
}
