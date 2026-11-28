# Survey A: lexical, semantic, learned-sparse and late-interaction retrieval

For Beep's packet builder. Written 2026-11-26. Scope: how to rank segments of the log against the current message. Rerankers, query rewriting, gating and set selection belong to other slices, but they come up where they change the answer here.

**Where Beep stands today.** BM25 (k1 1.2, b 0.75, no stemming) over about 400-token segments. Two rankings, all words and user words only, fused with RRF. Relative cutoff 0.3. Dev slice (LongMemEval_S, 47 answerable questions): all evidence in packet 78.7% for claude at 8K, 70.2% for small-local at 2.5K. Weakest types: multi-session (45.5% on both profiles), single-session-preference (66.7% claude, **0%** small-local), temporal (76.9% / 69.2%). One question is 2.1 points, so any change under about 4 points on this slice is noise.

**Scale.** A LongMemEval_S question is about 140K tokens, which is about 350 segments. A year of heavy real use might be 5-20M tokens, so 12K-50K segments. Even the high end is small for search. Everything below is judged at that scale, not web scale.

**Legend.** "Abstract only" means I saw only a search snippet or abstract. Every other number was read from the page linked next to it.

---

## 1. What the evidence on conversational memory actually says

This is the most important section, because general benchmarks (BEIR, MTEB) mislead here. Chat logs are full of the user's own exact words, and the question usually repeats them.

| Source | Benchmark | BM25 | Dense | Hybrid | Notes |
| --- | --- | --- | --- | --- | --- |
| [LongMemEval paper, Table 9](https://arxiv.org/pdf/2410.10813) | LongMemEval_M, session R@5 | 0.634 | Contriever 0.723, Stella V5 1.5B 0.720 | n/a | Paper says dense "clearly outperforms" BM25 |
| same, round (turn) R@5 | LongMemEval_M | 0.472 | Contriever 0.589, Stella 0.660 | n/a | Turn level is where dense helps most |
| same, keys = value + extracted user facts | LongMemEval_M, session R@5 | 0.683 | Contriever 0.762, Stella 0.732 | n/a | "Fact-augmented key expansion": +5 to +8 points for every retriever |
| [SelRoute (arXiv 2604.02431)](https://arxiv.org/pdf/2604.02431) | LongMemEval_M, session Ra@5 | SQLite FTS5: **0.745** | n/a | bge-small routed 0.786, MiniLM routed 0.785, bge-base 0.800 | A well-tuned FTS5 beat published Stella and Contriever. Authors warn the gap to the paper's BM25 is partly implementation |
| [AgentIR (arXiv 2605.25092)](https://arxiv.org/pdf/2605.25092) | LongMemEval (500 q), R@5 | **0.909** | BGE-small 0.886 | RRF 0.929 | BM25 0.4 ms, dense query encode 52 ms. Dense alone loses to BM25 |
| same | LoCoMo, Hit@10 | **0.945** | 0.789 | RRF 0.923 | On short LoCoMo turns BM25 is the best single system |
| [Lysenstøen, Training-Free Lexical-Dense Fusion (arXiv 2606.04194)](https://arxiv.org/pdf/2606.04194) | LoCoMo, session Hit@1 (e5-large-v2) | 0.640 | mean-pool 0.427, **turn max-sim 0.664** | BM25 + max-sim **0.752** | Scoring a session by its best-matching turn beats averaging, for all 6 encoders |
| same | LongMemEval_S hard subset (n=150, MiniLM), R@5 | 0.948 | early 0.920, late 0.953 | 0.959 | Gains over BM25 not significant. "BM25 is already strong" here |

Per question type, SelRoute's FTS5 vs routed numbers on LongMemEval_M are the closest map to Beep's weak spots:

| Type | FTS5 Ra@5 | Best route | Routed Ra@5 |
| --- | --- | --- | --- |
| single-session-assistant | 0.804 | embeddings only | 0.964 |
| multi-session | 0.661 | FTS5 + embeddings (RRF), enriched | 0.716 |
| single-session-preference | 0.500 | embeddings only | 0.533 |
| knowledge-update | 0.868 | enriched FTS5 | 0.882 |
| temporal-reasoning | 0.729 | hybrid | 0.741 |
| single-session-user | 0.859 | plain FTS5 | 0.859 |

**What I take from this.**

1. On LongMemEval_S specifically, BM25 is a strong baseline and dense alone is not better. A hybrid adds about 1-3 points of session recall. Most published "dense beats BM25" results are on the harder LongMemEval_M or at turn level.
2. Dense earns its keep on the types where the question and the evidence share few words: preference ("recommend me a…" when the evidence is "I love hiking"), assistant-said questions, and multi-session aggregation. Those are exactly Beep's weakest types.
3. Granularity matters more than model size. Turn-level max-sim inside a session beats one vector per session, and a 22M MiniLM routed well is within 1.5 points of a 109M model.
4. Index-time key expansion (appending extracted facts to what gets indexed) helped every retriever by 5-8 points. That is a write-time cost, not a query-time cost, which suits Beep.
5. Beep's own metric (every evidence turn inside a token budget) is harsher than R@5. [Where Did the Evidence Go? (arXiv 2611.10170)](https://arxiv.org/pdf/2611.10170) shows complete-evidence rates far below any-hit rates on multi-hop (LoCoMo/REALTALK: 50/108 complete in a top-60, 36/108 in the final top-10, oracle 60/108). The bottleneck there was choosing a set, not ranking single items. Better single-item ranking will only partly fix multi-session.

---

## 2. Lexical retrieval

### 2.1 BM25 variants (BM25+, BM25L, BM25F) and parameters

**Plain English.** BM25 scores a segment by adding up, for each query word it contains, "how rare is this word" (IDF) times "how often it appears, with diminishing returns" (k1), adjusted for segment length (b). BM25+ adds a small floor so any match counts for something even in a long segment. BM25L reduces the penalty on long documents. BM25F treats a document as named fields (say user text, assistant text, title) with their own weights and length normalizations, then combines term frequencies before saturation.

**What it adds over Beep's BM25.** Very little on the variant itself: [Kamphuis et al., "Which BM25 Do You Mean?"](https://cs.uwaterloo.ca/~jimmylin/publications/978-3-030-45442-5_4.pdf) compared Robertson, Lucene, ATIRE, BM25L, BM25+, BM25-adpt and a log-TF variant and found **no significant difference** on any collection (AP spread about 0.005 on Robust04). Parameters and fields are where the movement is. Their runs use k1 0.9, b 0.4 (Anserini's defaults), against Beep's 1.2/0.75. With fixed 400-token segments, b matters less than usual, since lengths are similar. BM25F is the principled form of what Beep already does with two rankings (all words, user words): one ranking with a user field and an assistant field, weighted, instead of two rankings fused by rank.

| Item | Value |
| --- | --- |
| Cost / latency | Zero. A parameter or a few lines in `bm25.ts` |
| Browser | Yes |
| Cloudflare | Yes (D1's FTS5 `bm25()` takes per-column weights, see 2.3) |
| Expected gain, claude | 0-2 points. Probably noise on n=47 |
| Expected gain, small-local | 0-3 points. A tighter budget rewards better ordering a bit more |

### 2.2 Stemming, lemmatization, fuzzy and character n-grams, phonetic keys

**Plain English.** Stemming chops words to a crude root ("hiking", "hiked" → "hike") so different forms match; Porter is the classic English stemmer. Lemmatization does the same with a dictionary, so "better" → "good"; it's slower and needs a word list. Fuzzy matching allows a few typos (edit distance). Character n-grams index overlapping 3-letter chunks ("kea", "eal"), so misspellings and partial names still share most chunks. Phonetic keys (Soundex, Double Metaphone) map words to how they sound, so "Macie" and "Mackie" collide.

**What it adds.** Stemming is a standard small win in English recall, at some cost in precision. Beep does no stemming today, so "recommend" vs "recommendation" or "moved" vs "moving" miss. Character n-grams and phonetic keys matter for names, slang and misspellings, which casual speech produces. The repo's own prefetch notes already cite an Amazon result where off-the-shelf embeddings found misheard names only 7.5% of the time. Lexical fuzziness is the cheap fix there, not embeddings.

**Precision risk.** Fuzzy and n-gram matching raise false matches. Use them as a separate low-weight ranking fused by RRF, or only for words not in the vocabulary (names, typos), never as the main ranking.

| Item | Value |
| --- | --- |
| Cost | Porter stemmer is about 200 lines or one small npm package. Trigram index is about 3x the postings |
| Browser | Yes |
| Cloudflare | Yes: FTS5 has `porter` and `trigram` tokenizers ([sqlite.org/fts5](https://sqlite.org/fts5.html)). Trigram needs substrings of 3+ characters |
| Expected gain, claude | Stemming 1-3 points (guess). n-grams/phonetic: ~0 on LongMemEval, which has clean spelling; real value is on the trick set and real chats |
| Expected gain, small-local | Same |

Sources: [SQLite FTS5](https://sqlite.org/fts5.html). No phonetic-key source read for this survey.

### 2.3 Inverted indexes, SQLite FTS5 and D1

**Plain English.** An inverted index is a map from each word to the list of segments containing it, so a query touches only segments that share a word with it. Beep's `Bm25` class scans every document for every query term, which is fine at 350 segments and still fine at 50K (milliseconds), but an inverted index is the standard shape once it persists.

**D1.** FTS5 is enabled in D1 with no opt-in, per a field report ([dev.to, FTS5 on D1](https://dev.to/riversea/fts5-on-cloudflare-d1-cut-my-korean-keyword-search-from-220ms-to-22ms-heres-what-almost-broke-it-3l9p)): about 390K rows, P50 22 ms, P95 under 45 ms. Gotchas from that post: `bm25()` returns negative numbers where lower is better; an external-content table needs triggers to stay in sync. FTS5 gives tokenizers (unicode61, porter, trigram), per-column weights in `bm25()` (a light BM25F), prefix indexes, `snippet()`/`highlight()`, and an `fts5vocab` table for reading term statistics ([sqlite.org/fts5](https://sqlite.org/fts5.html)). k1 and b are fixed.

SelRoute's strongest zero-ML baseline was literally SQLite FTS5 (0.745 session Ra@5 on LongMemEval_M, above Stella and Contriever), so FTS5 is not a downgrade from the hand-rolled scorer.

| Item | Value |
| --- | --- |
| Cost | Free inside D1 limits; ~20-45 ms per query including the network hop inside Cloudflare |
| Browser | SQLite WASM can include FTS5; or keep the TS index in memory |
| Cloudflare | Yes, D1 |
| Expected gain | None on recall by itself. It's how the same BM25 persists server-side |

### 2.4 JS search libraries

| Library | Scoring | Fuzzy / prefix | Vectors | Notes | Source |
| --- | --- | --- | --- | --- | --- |
| MiniSearch | **BM25+** since v5; v6 exposes the k, b, d parameters | Yes (fuzzy as a fraction of term length), prefix, per-field boost, auto-suggest | No | Designed for memory-constrained browsers | [GitHub](https://github.com/lucaong/minisearch), [changelog](https://cdn.jsdelivr.net/npm/minisearch@7.2.0/CHANGELOG.md) |
| FlexSearch | Its own "relevance", simpler than BM25 | Prefix; no built-in fuzzy (per the comparison below) | No | Fastest of the group; ~6 KB | [pkgpulse comparison](https://www.pkgpulse.com/guides/fusejs-vs-flexsearch-vs-orama-client-side-search-2026) |
| Orama | Not stated in what I read | Yes (`tolerance`) | Vector mode via plugin | ~22 KB | same |
| Fuse.js | Bitap fuzzy score, no document-frequency ranking | Excellent fuzzy | No | Slow: ~800 ms at 10K docs. Wrong tool for ranking | same |
| wink-bm25 | BM25 with field weights | No | No | Not checked for this survey | none |

The pkgpulse numbers are approximate ("based on library documentation and community benchmarks").

**Verdict.** None of these beats the 47-line `Bm25` class on ranking. MiniSearch is the one worth considering, for BM25+ with fields plus fuzzy and prefix in one tested package, if Beep wants fuzzy matching without writing it. FlexSearch's ranking isn't BM25, which would break the current cutoff logic.

---

## 3. Dense (semantic) retrieval

### 3.1 How embeddings work

An embedding model reads a piece of text and outputs a fixed list of numbers (say 384 or 768) that act as coordinates for its meaning. It's trained on millions of (question, matching passage) pairs so that texts that answer each other land close together, even with no words in common ("what should I cook for my vegan friend" lands near "I stopped eating meat last year"). Search is then: embed every segment once, embed the query, and rank by cosine similarity (the angle between the two lists). Most retrieval models want a prefix that says which side is which, such as EmbeddingGemma's `task: search result | query: ` and `title: none | text: ` ([HF blog](https://huggingface.co/blog/embeddinggemma)).

**What it adds over BM25:** paraphrase, synonyms, and topic-level matching. **What it loses:** exact rare tokens (names, IDs, numbers), and **abstention**. BM25 gives a zero score when nothing shares a word; cosine similarity always returns a top-k with plausible-looking scores. Beep's relative cutoff (0.3 of the top score) has no meaning for an unrelated query under dense, since the top score is itself noise. A dense channel needs an absolute floor calibrated per model, or it should only be allowed to add items when BM25 or the gate already says the turn needs retrieval.

### 3.2 Small embedders that run locally

| Model | Params | Dims (Matryoshka) | Max tokens | Retrieval quality | Browser fit | Source |
| --- | --- | --- | --- | --- | --- | --- |
| potion-retrieval-32M (Model2Vec static) | 32M (a lookup table, no transformer) | MRL 32-512 in training | any | MTEB retrieval 35.06 (MiniLM-L6 42.92 on the same card) | **Excellent**: ~1 ms per 500-token text on one CPU core in JS via [@yaks/model2vec](https://jsr.io/@yaks/model2vec/0.2.23/README.md); no GPU | [HF card](https://huggingface.co/minishlab/potion-retrieval-32M) |
| all-MiniLM-L6-v2 | 22M | 384 | 256 trained | MTEB retrieval 41.95 | Good. WebGPU 42 ms vs WASM 358 ms per 512-token text on one Mac (8x) | [arctic card](https://huggingface.co/Snowflake/snowflake-arctic-embed-m), [WebGPU bench](https://huggingface.co/spaces/Xenova/webgpu-embedding-benchmark/discussions/18) |
| snowflake-arctic-embed-xs | 22M | 384 | 512 | MTEB retrieval 50.15 | Good, MiniLM-sized | [HF card](https://huggingface.co/Snowflake/snowflake-arctic-embed-m) |
| bge-small-en-v1.5 | 33M | 384 | 512 | MTEB retrieval 51.68 (v1) / 53.9 (MTEB-v2 retrieval, per Granite card) | Good | [arctic card](https://huggingface.co/Snowflake/snowflake-arctic-embed-m), [granite card](https://huggingface.co/ibm-granite/granite-embedding-small-english-r2) |
| snowflake-arctic-embed-s | 33M | 384 | 512 | MTEB retrieval 51.98 | Good | same |
| granite-embedding-small-english-r2 | 47M | 384 | 8192 | BEIR 50.9, MTEB-v2 retrieval 53.9; Apache 2.0 | Good (ModernBERT base); long context helps whole segments | [HF card](https://huggingface.co/ibm-granite/granite-embedding-small-english-r2) |
| nomic-embed-text-v1.5 | 137M | 768 (MRL) | 8192 | MTEB retrieval ~53.0-53.3 | OK | [arctic card](https://huggingface.co/Snowflake/snowflake-arctic-embed-m) |
| snowflake-arctic-embed-m | 110M | 768 | 512 | MTEB retrieval 54.90 | OK | same |
| EmbeddingGemma-300m | 308M | 768 (MRL 512/256/128) | 2K | Best text model under 500M on MMTEB at launch (numbers only in charts); MIRIAD NDCG@10 0.834 vs Qwen3-0.6B 0.849 | ONNX q8/q4 in transformers.js; under 200 MB RAM quantized; under 22 ms on EdgeTPU | [HF blog](https://huggingface.co/blog/embeddinggemma), [Google docs](https://ai.google.dev/gemma/docs/embeddinggemma) |
| EmbeddingGemma 2 | 740M total, 270M text | 768 (MRL) | 8192 | Not read | Multimodal; larger | [Google docs](https://ai.google.dev/gemma/docs/embeddinggemma) |
| Qwen3-Embedding-0.6B | 0.6B, 28 layers | 1024 (MRL 32-1024) | 32K | MTEB-en v2 mean 70.70, **retrieval 61.83** | Heavy for a browser that already runs LFM3 1.7B; ONNX exists | [HF card](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B), [ONNX](https://huggingface.co/Qdrant/Qwen3-Embedding-0.6B-onnx) |

Not covered in detail: jina-embeddings v3/v4 (larger, non-commercial licenses at the time I last knew them), gte-small/gte-modernbert, nomic v2 MoE.

**Read MTEB numbers with care.** The chat-memory evidence in section 1 shows that a 22M model routed well sits within 1.5 points of a 109M one, and that a top-MTEB 1.5B model (Stella) lost to a 110M Contriever on LongMemEval_M sessions. Model size is not the lever here; granularity and fusion are.

**Latency in the browser.** Measured on one Mac, MiniLM-L6 at 512 tokens: 42 ms per text on WebGPU, 358 ms on WASM. Batches of 32 took 1.5 s on WebGPU ([benchmark](https://huggingface.co/spaces/Xenova/webgpu-embedding-benchmark/discussions/18)). Beep embeds each segment once, at write time, so per-turn cost is one query embedding. The real browser problem is that small-local already runs LFM3 1.7B on WebGPU in about 6K context; a second WebGPU model competes for GPU memory and queue time. That makes static embeddings (no GPU, ~1 ms on CPU) unusually attractive for small-local, despite their lower quality.

### 3.3 Cloudflare Workers AI embeddings and Vectorize

**Workers AI embedding models listed** ([models index](https://developers.cloudflare.com/workers-ai/models/index.md), [April 2026 changelog](https://developers.cloudflare.com/changelog/post/2026-04-09-new-workers-ai-models/)):

| Model id | Dims | Input tokens | Price |
| --- | --- | --- | --- |
| `@cf/baai/bge-small-en-v1.5` | 384 | not shown | not shown |
| `@cf/baai/bge-base-en-v1.5` | 768 | not shown | not shown |
| `@cf/baai/bge-large-en-v1.5` | 1024 | not shown | not shown |
| `@cf/baai/bge-m3` | not shown | 60,000 context | $0.0118 / M input tokens ([page](https://developers.cloudflare.com/workers-ai/models/bge-m3/)) |
| `@cf/google/embeddinggemma-300m` | 768 | 512 | not shown |
| `@cf/qwen/qwen3-embedding-0.6b` | 1024 | 4,096 (changelog) / 8,192 (model page) | $0.0118 / M input tokens ([page](https://developers.cloudflare.com/workers-ai/models/qwen3-embedding-0.6b/index.md)) |
| embeddinggemma-2 (multimodal) | 768 | not shown | not shown |
| `bge-reranker-base` (reranker) | n/a | not shown | not shown |

At $0.0118 per million tokens, embedding a 10M-token history once with Qwen3-Embedding-0.6B costs about 12 cents. This is effectively free for the claude profile. The EmbeddingGemma endpoint's 512-token input limit fits 400-token segments but not whole long turns.

**Vectorize** ([limits](https://developers.cloudflare.com/vectorize/platform/limits), [pricing](https://developers.cloudflare.com/vectorize/platform/pricing/)): up to 1536 dims, float32, 20M vectors per index, topK 100 (50 when returning metadata or values), 10 KiB metadata per vector, 50,000 namespaces per index on paid (one namespace per user or per chat works). Pricing: paid plan includes 50M queried dims/month and 10M stored dims; beyond that $0.01 per million queried and $0.05 per 100M stored. 25K segments at 768 dims is 19M stored dims, about $0.005/month over the allowance. Cost is not a factor.

**Do you even need Vectorize?** See 3.5. At Beep's scale, a brute-force scan inside the Worker or the browser is fast enough and keeps everything in one place. Vectorize is the easy path if vectors should live server-side across devices.

### 3.4 Matryoshka and quantized vectors

**Plain English.** Matryoshka (MRL) models are trained so the first 128 or 256 numbers of the vector already work as a smaller embedding; you can cut the tail off and lose a little quality. Quantization stores each number in fewer bits: int8 (1 byte) or binary (1 bit, just the sign). Binary vectors compare with XOR plus bit-count, which is extremely fast. The usual trick is "rescoring": find candidates with binary vectors, then re-rank the top few with full-precision vectors.

**Numbers** ([HF embedding quantization blog](https://huggingface.co/blog/embedding-quantization)): binary with rescoring keeps about 96% of retrieval quality (about 92.5% without), at 32x less memory and up to about 45x faster search; int8 keeps about 97-99%, at 4x less memory. It varies a lot by model: e5-base-v2 kept only 74.8% under binary, nomic v1.5 87.7%, MiniLM-L6 93.8%. Test the chosen model. Jina reports cutting ColBERT token vectors from 128 to 64 dims had "insignificant impact" ([jina-colbert-v2](https://huggingface.co/jinaai/jina-colbert-v2)). Google says EmbeddingGemma 2's MRL cuts storage up to 6x "with minimal quality loss" ([docs](https://ai.google.dev/gemma/docs/embeddinggemma)).

**Measured here** (Node, one core, scalar JS, random vectors; a throwaway script, not committed):

| Segments | Dims | float32 flat scan | float32 memory | binary Hamming scan | binary memory |
| --- | --- | --- | --- | --- | --- |
| 5,000 | 384 | 2.8 ms | 8 MB | 2.2 ms | 0.2 MB |
| 100,000 | 384 | 52.9 ms | 154 MB | 2.4 ms | 4.8 MB |
| 100,000 | 768 | 85.1 ms | 307 MB | 5.9 ms | 9.6 MB |
| 200,000 | 256 | 68.3 ms | 205 MB | 3.5 ms | 6.4 MB |

So binary-then-rescore keeps a 100K-segment index under 10 MB and a few milliseconds, small enough for a browser tab next to LFM3 or a Worker's 128 MB memory.

### 3.5 HNSW vs flat brute force

**Plain English.** HNSW is a layered "small world" graph over the vectors. A query hops from far-apart nodes toward closer ones, visiting a tiny fraction of the index. It's approximate (it can miss the true nearest neighbour), uses extra memory for the graph, and needs building and updating. Flat search just compares the query to every vector, and it's exact.

**For Beep.** At 350 segments per LongMemEval question, and even at 50K-100K for years of chat, flat search costs 3-90 ms in plain JS (table above), and a few ms in binary. HNSW only pays off past roughly a million vectors. Flat is also exact, which matters for a recall-first eval (no ANN misses to debug), and append-only, which matches the log. **Recommendation: no HNSW.** Vectorize's internal index is fine if used, but it's not needed.

### 3.6 Expected gain from adding a dense channel

| | claude (8K) | small-local (2.5K) |
| --- | --- | --- |
| Best guess | +2 to +6 points all-evidence | +3 to +10 points |
| Where | preference, assistant-said, multi-session | preference first (0% today), then multi-session |
| Why so uncertain | On LongMemEval_S, BM25 is already at 0.91 session R@5 and fusion added ~2 points (AgentIR), not significant in a second study. But Beep's metric is turn-level all-evidence, where the LongMemEval paper shows the largest dense gains (round R@5 0.472 → 0.589-0.660 on _M) | Tight budgets reward better ordering. Preference questions are the textbook lexical failure. The 0% is 3 questions, so 1 question = 33 points of that row |
| Risk | Dense noise displacing BM25 hits at the bottom of the budget; harm on abstention questions | Same, plus GPU contention if the embedder runs on WebGPU |

---

## 4. Learned sparse retrieval (SPLADE and inference-free variants)

**Plain English.** SPLADE runs a BERT-style model over a text and outputs a weight for every word in its 30K-word vocabulary, keeping only a few hundred non-zero. The trick is that it also gives weight to words that *aren't* in the text but are implied ("vegan" gets weight on "meat", "plant", "diet"). The result still looks like a keyword index: an inverted index, a dot product, and a zero score when nothing overlaps. **Inference-free (doc-only) models** run the model only on documents at index time. The query side is just the tokenizer plus a per-token weight table (IDF), so querying costs the same as BM25.

**Numbers.**

| Model | BEIR avg nDCG@10 | Query cost | Source |
| --- | --- | --- | --- |
| SPLADE-v3 | 51.7 (13 datasets) | BERT forward pass | [SPLADE-v3](https://arxiv.org/html/2403.06789v1) |
| SPLADE-v3-DistilBERT | 50.0 | smaller forward pass | same |
| SPLADE-v3-Doc (doc-only) | 47.0 | none | same |
| opensearch doc-v2-mini | 49.7 (14 datasets) | tokenizer + IDF lookup | [HF card](https://huggingface.co/opensearch-project/opensearch-neural-sparse-encoding-doc-v3-gte) |
| opensearch doc-v3-distill (67M) | 51.7 | tokenizer + IDF lookup | same |
| **opensearch doc-v3-gte (133M)** | **54.6** | tokenizer + IDF lookup | same; Apache 2.0 |
| BM25 (jina's table, BEIR) | 44.0 | none | [jina-colbert-v2](https://huggingface.co/jinaai/jina-colbert-v2) |

The opensearch and SPLADE averages use different dataset subsets, so don't compare across rows from different sources too closely. SPLADE-v3 was significantly better than BM25 on most of 44 query sets, with losses on Touché and TREC-MQ. AgentIR measured SPLADE++ at 158-167 ms per document and 17-150 ms per query on CPU, and did not test it on chat memory. Related abstracts I saw only as snippets: [Towards Competitive Search Relevance for Inference-Free Learned Sparse Retrievers](https://arxiv.org/pdf/2411.04403) and [ℓ0 sparsification for inference-free sparse retrievers](https://arxiv.org/pdf/2504.14839) (abstract only).

**Why it fits Beep unusually well.** A doc-only model keeps every property Beep likes about BM25: an exact zero when nothing matches (abstention), a score that scales like BM25 (so the relative cutoff still makes sense), no model at query time, and an index that drops straight into the existing `Bm25` shape (term → weight). It adds expansion terms on the document side, which is the same idea as LongMemEval's fact-augmented keys, but without an LLM call.

| Item | Value |
| --- | --- |
| Cost | Index time: one 67-133M encoder pass per segment (about 150 ms on CPU per AgentIR's SPLADE++ number; less on GPU). Query: microseconds |
| Browser | Index side: possible via ONNX in transformers.js, but the card lists no ONNX files, so an export is needed (unverified). Query side: trivial |
| Cloudflare | Not in Workers AI. Encode offline or in a container; the sparse index lives in D1/R2 or memory |
| Expected gain, claude | 0-4 points. Untested on chat memory anywhere I found |
| Expected gain, small-local | 0-5 points, with no runtime cost at query time and no second model on the GPU per turn |

---

## 5. Late interaction (ColBERT family) and the cheap version that matters

**Plain English.** A normal embedder squashes a whole passage into one vector. ColBERT keeps one small vector per token (for example 96 or 128 numbers each). To score, every query token finds its best-matching token in the passage, and those best scores are summed ("MaxSim"). This keeps fine detail, such as a single name in a long passage, that one vector would blur. The cost is storage: hundreds of vectors per passage. PLAID is the engine that makes ColBERTv2 fast with centroid compression; MUVERA turns the multi-vector set into one fixed-length vector so ordinary single-vector search can find candidates, then re-scores with exact MaxSim.

**Numbers.**

| Model | Params | BEIR avg | Notes | Source |
| --- | --- | --- | --- | --- |
| answerai-colbert-small-v1 | 33M | 53.79 | Beats bge-small (51.68) and arctic-embed-s (51.99) at the same size; runs on CPU | [Answer.AI post](https://answer.ai/posts/2024-08-13-small-but-mighty-colbert.html) |
| ColBERTv2 | 110M | 50.02 | | same |
| jina-colbert-v2 | 0.6B | 53.1 | 128/96/64-dim token vectors; 8K context; **CC-BY-NC** | [HF card](https://huggingface.co/jinaai/jina-colbert-v2) |
| MUVERA | n/a | ~10% higher recall than PLAID, ~90% lower latency, 32x memory cut with PQ | | [Google Research blog](https://research.google/blog/muvera-making-multi-vector-retrieval-as-fast-as-single-vector-search/) |

**Storage at Beep's scale** (my arithmetic): a 400-token segment at 128 dims in fp16 is about 100 KB. 350 segments (one LongMemEval question) is 36 MB, fine. 25K segments is 2.5 GB, too big for a browser; int8 at 64 dims brings that to about 640 MB, still heavy. ColBERTv2-style residual compression would cut it further, but that's engineering Beep doesn't need yet.

**The cheap version that matters: turn-level max-sim.** [Lysenstøen (arXiv 2606.04194)](https://arxiv.org/pdf/2606.04194) applies the late-interaction idea at the *message* level: embed each turn with an ordinary single-vector model, and score a session by its best-matching turn instead of one averaged vector. On LoCoMo this beat mean pooling for all six encoders (+13.5 to +23.7 points Hit@1), and fusing it with BM25 reached 0.752 Hit@1 vs BM25's 0.640. A web-trained cross-encoder reranker *hurt* by 6.9 points. Top-3 pooling matched max; log-sum-exp collapsed for half the encoders. Beep's 400-token segments hold several messages, so this maps directly: one vector per message, segment score = max over its messages. Storage is one vector per message, not per token.

| Item | Full ColBERT | Turn-level max-sim |
| --- | --- | --- |
| Cost | Large storage; custom MaxSim scorer | Same as single-vector, about 3-6x more vectors than per-segment |
| Browser | answerai-colbert-small is BERT-small sized, so likely runs via ONNX (not verified); storage is the limit | Yes |
| Cloudflare | Not in Workers AI; bge-m3 on Workers AI is a multi-vector-capable model, but the page doesn't say whether its ColBERT output is exposed | Yes (any Workers AI embedder) |
| Expected gain, claude | Unknown; probably not worth it over turn-level max-sim | +1 to +4 points over a per-segment dense channel (LoCoMo effect large, LongMemEval_S effect small and not significant) |
| Expected gain, small-local | Same | Same |

---

## 6. Summary table

| Technique | Adds over current BM25 | Query latency | Browser | Cloudflare | Gain claude | Gain small-local | Confidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BM25 variant (BM25+/L) | ~nothing | 0 | yes | yes | 0 | 0 | high (Kamphuis) |
| BM25F fields, k1/b tuning | Principled user/assistant weighting | 0 | yes | FTS5 column weights | 0-2 | 0-3 | low |
| Porter stemming | Word-form matches | 0 | yes | FTS5 `porter` | 1-3 | 1-3 | low |
| Trigram / phonetic names channel | Typos, slang, names | <1 ms | yes | FTS5 `trigram` | ~0 on LME; real chats more | same | medium on direction, low on size |
| Dense, per segment | Paraphrase, preference | 1 ms (static) to 50 ms (BGE-small CPU) | yes | Workers AI + Vectorize or flat scan | 2-6 | 3-10 | low-medium |
| Dense, turn-level max-sim | Above, plus fine detail | same | yes | yes | +1-4 on top | same | medium (LoCoMo), low (LME_S) |
| Binary + rescore, flat | Memory and speed only | 2-6 ms at 100K | yes | yes | -0 to -1 | same | medium |
| Doc-only learned sparse | Expansion terms, keeps BM25 abstention | ~0 | index side needs ONNX export | offline encode | 0-4 | 0-5 | low (no chat-memory data) |
| Full ColBERT | Token detail | ms | storage-bound | no | unknown | unknown | low |
| Fact-augmented keys (LLM, write time) | Facts as extra index terms | 0 | yes (needs writer model) | yes | +3-8 (LME_M, all retrievers) | same, if facts are short | medium |

---

## Top ideas for Beep from this slice

Each is one eval run on the existing dev slice (and the trick set, once it exists), scored on all-evidence recall, mean packet tokens, and the harm rate on the 3 abstention questions. With n=47, treat a change under ~4 points as noise and confirm on a second slice.

1. **Add a dense channel at message level, scored by max-sim, as a third RRF ranking.** Embed each message once at write time; a segment's dense score is its best message. Fuse with the two BM25 rankings by RRF. *Hypothesis:* all-evidence rises at least 3 points at 8K and 2.5K, almost all of it in single-session-preference, single-session-assistant and multi-session, with knowledge-update and single-session-user unchanged. *Control:* the same model with one vector per segment, to isolate the max-sim effect.

2. **Static embeddings for small-local.** Run potion-retrieval-32M through @yaks/model2vec (CPU, ~1 ms per text, no GPU) against arctic-embed-xs or bge-small in transformers.js, and against EmbeddingGemma q4. *Hypothesis:* the static model gets at least half of the transformer embedder's recall gain at under 5% of its latency and zero WebGPU contention with LFM3, making it the right default for small-local.

3. **Dense can add, never decide alone, and never fill an empty packet.** Give dense its own absolute cosine floor, calibrated on the dev slice's score distribution, and only admit dense-only hits when BM25 found something or the gate fired. *Hypothesis:* the harm rate on abstention and trick questions stays at the BM25-only level while recall keeps at least 80% of idea 1's gain. A plain unfloored hybrid will put irrelevant segments into packets that should be empty.

4. **Confidence-triggered cascade (AgentIR's idea).** Skip the dense query when BM25's top score and its margin over the second are high. *Hypothesis:* dense is needed on under half the turns with no recall loss, which matters for small-local latency and for claude-profile Workers AI calls.

5. **Doc-only learned sparse instead of (or before) dense.** Encode segments offline with opensearch doc-v3-gte (Apache 2.0), score queries with its tokenizer and IDF table, and swap it in for the all-words BM25 ranking. *Hypothesis:* it closes part of the preference and paraphrase gap while keeping BM25's exact-zero abstention and the meaning of the 0.3 relative cutoff, at no query-time model cost. Risk: no chat-memory results exist for it, and the browser index side needs an ONNX export.

6. **Write-time key expansion.** On each turn, have the reply call (claude) or a tiny model emit 1-3 short user facts ("user is vegan", "user moved to Phoenix in 2019"), and index them alongside the segment, in the BM25 user-words field and the dense channel. *Hypothesis:* following LongMemEval's +5-8 points for every retriever, multi-session and temporal all-evidence rise at least 4 points at no query-time cost. Facts are index keys only; the packet still carries the original segment, so a wrong fact can cost precision but can't put invented text in front of the model.

7. **Cheap lexical hygiene in one run:** Porter stemming, BM25F-style user and assistant fields in one ranking (instead of two rankings plus RRF), and k1/b tried at 0.9/0.4. *Hypothesis:* together at most +2 points; if none moves the needle, freeze the lexical side and spend effort on 1-6. A separate trigram/phonetic channel for out-of-vocabulary tokens gets tested on the trick set's misnamed and misspelled entities, where it should win clearly, rather than on LongMemEval.

8. **Flat binary vectors with float rescoring, no ANN.** Store 256-dim MRL vectors as 1-bit for candidates (top 50) and int8 for rescoring, scanned brute-force in the browser and the Worker. *Hypothesis:* within 1 point of float32 recall at 1/32 the memory (measured: 100K × 384 scans in 2.4 ms), which makes Vectorize optional and keeps the browser and Cloudflare paths identical.
