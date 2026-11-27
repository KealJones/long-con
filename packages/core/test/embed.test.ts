import assert from "node:assert/strict";
import test from "node:test";
import { cosine, readSafetensors, staticEmbedder, wordPiece } from "../src/embed.ts";
import { buildPacket } from "../src/packet.ts";
import { PROFILES } from "../src/profiles.ts";

test("the embedding veto drops a unit the gate kept when its cosine to the message is under the floor", () => {
  const message = "when does priya move to denver";
  const history = (content: string) => [{ id: "s", date: "2026/03/06", turns: [{ role: "user" as const, content }] }];
  // A fake embedder: a unit points the message's way only when it mentions april.
  const embed = (t: string) => new Float32Array(t.includes("april") || t === message ? [1, 0] : [0, 1]);
  const profile = { ...PROFILES.claude, embedSim: "maxsim" as const, embedFloor: 0.5 };
  assert.equal(buildPacket({ history: history("my sister priya moves to denver in april"), message, profile, embed }).segments.length, 1);
  assert.equal(buildPacket({ history: history("my sister priya moves to denver in may"), message, profile, embed }).segments.length, 0);
  assert.equal(buildPacket({ history: history("my sister priya moves to denver in may"), message, profile: { ...profile, embedFloor: 0 }, embed }).segments.length, 1);
});

test("embedRatio drops a gate-kept unit whose cosine is under that share of the best kept unit's", () => {
  const message = "when does priya move to denver";
  const history = [
    { id: "s", date: "2026/03/06", turns: [{ role: "user" as const, content: "priya moves to denver in april" }] },
    { id: "t", date: "2026/03/07", turns: [{ role: "user" as const, content: "priya said denver in may maybe" }] },
  ];
  // April points the message's way (cosine 1); may sits at 0.6.
  const embed = (t: string) => new Float32Array(t.includes("april") || t === message ? [1, 0] : t.includes("may") ? [0.6, 0.8] : [0, 1]);
  const profile = { ...PROFILES.claude, unitGate: 0, pointerGate: 0, embedSim: "maxsim" as const, embedFloor: 0.1 };
  const ids = (embedRatio: number) => buildPacket({ history, message, profile: { ...profile, embedRatio }, embed }).segments.map((s) => s.sessionId).sort();
  assert.deepEqual(ids(0), ["s", "t"]);
  assert.deepEqual(ids(0.5), ["s", "t"]);
  assert.deepEqual(ids(0.7), ["s"]);
});

const vocab = { "[UNK]": 0, hello: 1, world: 2, play: 3, "##ing": 4, ",": 5, cafe: 6 };
const tokenizer = { normalizer: { type: "BertNormalizer", lowercase: true, strip_accents: null }, model: { type: "WordPiece", vocab, unk_token: "[UNK]" } };

function safetensors(rows: number[][], dtype: "F32" | "F16" = "F32"): Uint8Array {
  const flat = rows.flat();
  const size = dtype === "F32" ? 4 : 2;
  const header = new TextEncoder().encode(JSON.stringify({ embeddings: { dtype, shape: [rows.length, rows[0]!.length], data_offsets: [0, flat.length * size] } }));
  const bytes = new Uint8Array(8 + header.length + flat.length * size);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, BigInt(header.length), true);
  bytes.set(header, 8);
  // F16 test values are exact halves: 1 is 0x3c00, 0 is 0, 2 is 0x4000.
  const f16 = (v: number) => (v === 0 ? 0 : v === 1 ? 0x3c00 : v === 2 ? 0x4000 : NaN);
  flat.forEach((v, i) => (dtype === "F32" ? view.setFloat32(8 + header.length + 4 * i, v, true) : view.setUint16(8 + header.length + 2 * i, f16(v), true)));
  return bytes;
}

test("wordPiece lowercases, strips accents, splits punctuation and subwords, and marks unknown words", () => {
  assert.deepEqual(wordPiece(tokenizer)("Hello, PLAYING Café xyz"), [1, 5, 3, 4, 6, 0]);
});

test("readSafetensors reads F32 and F16 matrices", () => {
  const rows = [[0, 1], [2, 0]];
  for (const dtype of ["F32", "F16"] as const) assert.deepEqual([...readSafetensors(safetensors(rows, dtype)).data], [0, 1, 2, 0]);
});

test("staticEmbedder averages known token rows, drops unknowns and normalizes", () => {
  const rows = [[9, 9], [1, 0], [0, 1], [1, 1], [0, 0], [0, 0], [0, 0]];
  const embed = staticEmbedder(tokenizer, safetensors(rows));
  const v = embed("hello world zzz");
  assert.ok(Math.abs(v[0]! - Math.SQRT1_2) < 1e-6 && Math.abs(v[1]! - Math.SQRT1_2) < 1e-6);
  assert.ok(Math.abs(cosine(embed("hello"), embed("world"))) < 1e-9);
  assert.deepEqual([...embed("zzz")], [0, 0]);
});
