// Static embedder (backlog P10/P11): a model2vec model is one matrix with a row per WordPiece token; a text's embedding is
// the mean of its token rows, L2-normalized. No model runs, so it costs a table lookup per token. Pure code, browser-safe:
// the caller reads the files (evals/src/embedders.ts on node) and hands the bytes in.

/** Text to a unit vector. Callers cache by text: history messages embed once, at write time in a real chat. */
export type Embed = (text: string) => Float32Array;

/** The parts of a Hugging Face tokenizer.json a BERT WordPiece model needs. */
export interface WordPieceJson {
  normalizer?: { type: string; lowercase?: boolean; strip_accents?: boolean | null; clean_text?: boolean; handle_chinese_chars?: boolean } | null;
  pre_tokenizer?: { type: string } | null;
  model: { type: string; vocab: Record<string, number>; unk_token: string; continuing_subword_prefix?: string; max_input_chars_per_word?: number };
}

/** One tensor out of a .safetensors file, widened to f32. */
export function readSafetensor(bytes: Uint8Array, name: string): { shape: number[]; data: Float32Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = Number(view.getBigUint64(0, true));
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLength))) as Record<string, { dtype: string; shape: number[]; data_offsets: [number, number] }>;
  const t = header[name];
  if (!t) throw new Error(`No tensor ${name} in safetensors (has ${Object.keys(header).join(", ")})`);
  const [from, to] = t.data_offsets.map((o) => o + 8 + headerLength) as [number, number];
  const n = t.shape.reduce((a, b) => a * b, 1);
  const data = new Float32Array(n);
  if (t.dtype === "F32") for (let i = 0; i < n; i++) data[i] = view.getFloat32(from + i * 4, true);
  else if (t.dtype === "F16") for (let i = 0; i < n; i++) data[i] = half(view.getUint16(from + i * 2, true));
  else if (t.dtype === "BF16") for (let i = 0; i < n; i++) data[i] = new Float32Array(new Uint32Array([view.getUint16(from + i * 2, true) << 16]).buffer)[0]!;
  else throw new Error(`Unsupported safetensors dtype ${t.dtype}`);
  if (to - from !== n * (t.dtype === "F32" ? 4 : 2)) throw new Error(`Tensor ${name} size doesn't match its shape`);
  return { shape: t.shape, data };
}

function half(h: number): number {
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  const v = e === 0 ? m * 2 ** -24 : e === 31 ? (m ? NaN : Infinity) : (1 + m / 1024) * 2 ** (e - 15);
  return h & 0x8000 ? -v : v;
}

// BERT's punctuation: every ASCII symbol plus Unicode punctuation, each its own pre-token.
const PUNCT = /[!-/:-@[-`{-~]|\p{P}/u;
const CJK = /[一-鿿㐀-䶿\u{20000}-\u{2a6df}\u{2a700}-\u{2b73f}\u{2b740}-\u{2b81f}\u{2b820}-\u{2ceaf}豈-﫿\u{2f800}-\u{2fa1f}]/u;

/** BERT WordPiece, as tokenizer.json describes it: BertNormalizer, BertPreTokenizer, greedy longest-match pieces. */
export class WordPiece {
  private vocab: Map<string, number>;
  readonly unk: number;
  private prefix: string;
  private maxChars: number;
  private lower: boolean;
  private stripAccents: boolean;
  private clean: boolean;
  private chinese: boolean;

  constructor(json: WordPieceJson) {
    if (json.model.type !== "WordPiece") throw new Error(`Expected a WordPiece tokenizer, got ${json.model.type}`);
    if (json.pre_tokenizer && json.pre_tokenizer.type !== "BertPreTokenizer") throw new Error(`Unsupported pre-tokenizer ${json.pre_tokenizer.type}`);
    const n = json.normalizer;
    if (n && n.type !== "BertNormalizer") throw new Error(`Unsupported normalizer ${n.type}`);
    this.vocab = new Map(Object.entries(json.model.vocab));
    this.unk = this.vocab.get(json.model.unk_token) ?? -1;
    this.prefix = json.model.continuing_subword_prefix ?? "##";
    this.maxChars = json.model.max_input_chars_per_word ?? 100;
    this.lower = n?.lowercase ?? false;
    // BertNormalizer: strip_accents null follows lowercase.
    this.stripAccents = n ? (n.strip_accents ?? this.lower) : false;
    this.clean = n?.clean_text ?? false;
    this.chinese = n?.handle_chinese_chars ?? false;
  }

  /** Token ids, no special tokens; unknown words come back as the unk id. */
  // shortcut: added special tokens ("[CLS]" typed in a message) aren't matched as one token; chat text rarely holds them.
  encode(text: string): number[] {
    let s = text;
    if (this.clean) s = s.replace(/[\0�]|[\p{Cc}\p{Cf}]/gu, (c) => (c === "\t" || c === "\n" || c === "\r" ? " " : ""));
    if (this.chinese) s = s.replace(new RegExp(CJK.source, "gu"), " $& ");
    if (this.stripAccents) s = s.normalize("NFD").replace(/\p{Mn}/gu, "");
    if (this.lower) s = s.toLowerCase();
    const ids: number[] = [];
    for (const chunk of s.split(/\s+/)) {
      let word = "";
      for (const c of chunk) {
        if (PUNCT.test(c)) {
          if (word) this.piece(word, ids);
          this.piece(c, ids);
          word = "";
        } else word += c;
      }
      if (word) this.piece(word, ids);
    }
    return ids;
  }

  private piece(word: string, out: number[]): void {
    const chars = [...word];
    if (chars.length > this.maxChars) return void out.push(this.unk);
    const ids: number[] = [];
    for (let start = 0; start < chars.length; ) {
      let end = chars.length;
      let id: number | undefined;
      for (; end > start; end--) {
        id = this.vocab.get((start ? this.prefix : "") + chars.slice(start, end).join(""));
        if (id !== undefined) break;
      }
      if (id === undefined) return void out.push(this.unk);
      ids.push(id);
      start = end;
    }
    out.push(...ids);
  }
}

/**
 * A model2vec StaticModel: mean of the token rows (unknown tokens dropped, the first maxTokens kept, as model2vec's
 * encode does), then L2-normalized when the config says normalize. An empty text gives the zero vector.
 */
export function staticEmbedder(tokenizer: WordPieceJson, matrix: { shape: number[]; data: Float32Array }, opts: { normalize?: boolean; maxTokens?: number } = {}): Embed {
  const wp = new WordPiece(tokenizer);
  const [rows, dim] = matrix.shape as [number, number];
  const { normalize = true, maxTokens = 512 } = opts;
  return (text) => {
    const out = new Float32Array(dim);
    const ids = wp.encode(text).filter((id) => id !== wp.unk && id < rows).slice(0, maxTokens);
    if (!ids.length) return out;
    for (const id of ids) {
      const row = id * dim;
      for (let j = 0; j < dim; j++) out[j]! += matrix.data[row + j]!;
    }
    let norm = 0;
    for (let j = 0; j < dim; j++) norm += (out[j]! /= ids.length) ** 2;
    if (normalize && norm > 0) for (let j = 0, k = Math.sqrt(norm); j < dim; j++) out[j]! /= k;
    return out;
  };
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}
