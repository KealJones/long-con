// The static embedder (model2vec format) and the dense channel's one hard rule: it never fills a packet on its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPacket, PROFILES, readSafetensor, staticEmbedder, WordPiece, type Embed, type Session, type WordPieceJson } from "../src/index.ts";
import { filler } from "./fixtures.ts";

const vocab = ["[PAD]", "[UNK]", "cafe", "muller", "!", "play", "##ing", "it", "'", "s", "un", "##aff"];
const tokenizer: WordPieceJson = {
  normalizer: { type: "BertNormalizer", lowercase: true, strip_accents: null, clean_text: true, handle_chinese_chars: true },
  pre_tokenizer: { type: "BertPreTokenizer" },
  model: { type: "WordPiece", vocab: Object.fromEntries(vocab.map((t, i) => [t, i])), unk_token: "[UNK]", continuing_subword_prefix: "##" },
};

test("WordPiece lowercases, strips accents, splits punctuation and takes the longest piece first", () => {
  const wp = new WordPiece(tokenizer);
  assert.deepEqual(wp.encode("Café MÜLLER!! playing"), [2, 3, 4, 4, 5, 6]);
  assert.deepEqual(wp.encode("it's unaffordable"), [7, 8, 9, 1], "a word with an unmatched piece is one unknown token");
});

test("readSafetensor reads the header and widens f16", () => {
  const header = new TextEncoder().encode(JSON.stringify({ embeddings: { dtype: "F16", shape: [2, 2], data_offsets: [0, 8] } }));
  const bytes = new Uint8Array(8 + header.length + 8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(header.length), true);
  bytes.set(header, 8);
  const data = new DataView(bytes.buffer, 8 + header.length);
  [0x3c00, 0xc000, 0x3800, 0x0000].forEach((h, i) => data.setUint16(i * 2, h, true)); // 1, -2, 0.5, 0
  assert.deepEqual([...readSafetensor(bytes, "embeddings").data], [1, -2, 0.5, 0]);
});

test("the embedding is the mean of known token rows, normalized", () => {
  const rows = vocab.map((_, i) => [i === 2 ? 3 : 0, i === 3 ? 4 : 0]);
  const embed = staticEmbedder(tokenizer, { shape: [vocab.length, 2], data: new Float32Array(rows.flat()) });
  assert.deepEqual([...embed("cafe muller zzz")].map((x) => +x.toFixed(4)), [0.6, 0.8], "unknown tokens are dropped, not averaged in");
  assert.deepEqual([...embed("")], [0, 0]);
});

// A fake embedder: one axis per topic, so "relocating to colorado" sits next to "moving" with no shared word.
const topics = [/mov|relocat|colorado|denver|bike/, /priya|sister/];
const fake: Embed = (text) => {
  const v = new Float32Array([...topics.map((t) => (t.test(text.toLowerCase()) ? 1 : 0)), 0.05]);
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};

test("the dense channel adds a unit only when the lexical side already let one in", () => {
  const history: Session[] = [
    ...filler,
    { id: "family", date: "2026/03/06 (Fri) 21:15", turns: [{ role: "user", content: "my sister priya just told me shes moving to denver in april" }, { role: "assistant", content: "That's a big change." }] },
    { id: "boxes", date: "2026/03/18 (Wed) 09:00", turns: [{ role: "user", content: "she asked me to help with relocating to colorado, need boxes" }, { role: "assistant", content: "Liquor stores give them away free." }] },
  ];
  const profile = { ...PROFILES.claude, pointerGate: 0, dense: { floor: 0.6, weight: 1, unit: "message" as const } };
  const lexical = buildPacket({ history, message: "when is priya moving again", profile });
  assert.doesNotMatch(lexical.text, /boxes/);
  const dense = buildPacket({ history, message: "when is priya moving again", profile, embed: fake });
  assert.match(dense.text, /moving to denver/);
  assert.match(dense.text, /relocating to colorado/, "in by meaning, with no shared word");
  assert.ok(dense.segments.some((s) => s.why === "similar in meaning"));
  // Close in meaning to the moving chats, but nothing lexical clears the bar: the packet stays empty.
  const empty = buildPacket({ history, message: "my bike", profile, embed: fake });
  assert.equal(empty.segments.length, 0);
  // A veto over every cosine drops the lexical units, and then nothing lexical is in, so no dense unit may be added either.
  const vetoed = buildPacket({ history, message: "when is priya moving again", profile: { ...profile, dense: { ...profile.dense, veto: 2 } }, embed: fake });
  assert.equal(vetoed.segments.length, 0);
});
