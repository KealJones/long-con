# Survey slice B: fusion, reranking, query-side techniques, compression

Researched 2026-11-26 for Long Con. Scope: what happens after "find candidates" (fuse, rerank, cut) and before it (reshape the query or the index), plus shrinking what's kept. Conversational rewriting and the general prefetch picture are in `docs/research/prefetch.md` in the repo; this extends it and doesn't repeat it.

**How sources were read.** Most pages were read through a fetch tool that summarizes the page, so the numbers below come from those summaries and from the pages' own tables. Where only the abstract or part of a page came through, it says so. Nothing here was re-run.

## Where Long Con stands today (from the code)

- `packages/core/src/packet.ts` `search()`: two BM25 indexes over ~400-token segments (all words; user words only), fused by RRF with k=60.
- Confidence is a unit's best score **as a share of the top score in either list**, and units below 0.3 are dropped.
- **One consequence matters for everything below.** Because the cutoff is relative, the top hit of each list always scores 1.0 and always passes. Once the gate is open, the packet can't come back empty from search. Only the gate can make it empty. Every "abstain" idea in this doc needs an **absolute** signal, and BM25 doesn't give a comparable one across queries.
- Dev recall (all evidence in packet): claude 78.7% at 5.7K mean tokens, small-local 70.2% at 2.3K. The weak spots are multi-session (45.5% on both profiles), temporal (76.9% / 69.2%), and preference on small-local (0 of 3).
- At 8K, claude already finds 86% of evidence turns. Small-local finds 80% at 2.5K. Much of the small-local gap is **ranking order under a tight budget**, not candidates that were never found. A ~2.5K packet holds about five or six 400-token segments.

## Key findings in one screen

1. **On LongMemEval-style data, BM25 is already near the ceiling for finding candidates. The win is in ordering.** A June 2026 study found BM25 alone gets R@5 0.948 on a LongMemEval-S subset, and fusing with dense adds a non-significant +0.67 pp. SmartSearch (March 2026) found a cross-encoder moved the first gold passage from **mean rank 47 to rank 2** on LongMemEval-S, and from 195 to 8 on LoCoMo. That is exactly what a 2.5K budget needs.
2. **A bad reranker hurts.** The same June 2026 study saw ms-marco-MiniLM-L-6-v2 *lower* LoCoMo Hit@1 by 6.9 pp. SmartSearch got its gains from mxbai-rerank-large-v1 (435M). Reranker quality matters more than whether you rerank.
3. **Rule-based pseudo-relevance feedback is the best zero-model query trick in conversational memory.** SmartSearch's PRF (content words found in at least 2 of the top 10 passages, one more pass at half weight) added +6.0 pp on LongMemEval-S, and +9.2 pp combined with entity discovery. The largest gain, +12.8 pp, was on temporal questions. No model is involved.
4. **Model-per-turn query expansion (HyDE, query2doc, multi-query) is weak value for Long Con.** It needs a capable LLM: query2doc with a 1.3B model barely beat BM25. Its recall gains get "largely neutralized after re-ranking and truncation" in a 2026 enterprise study. It adds 0.9-2 s per turn. Skip it for small-local, and treat it as optional for claude.
5. **Expanding the index, not the query, moves the model cost off the hot path.** LongMemEval's own paper: keys = segment text plus extracted facts gave +9.4% recall@k and +5.4% accuracy on average. Doc2Query-- (generate questions per passage, then filter out bad ones) gives up to +16% over unfiltered doc2query. Anthropic's contextual BM25 (a 50-100 token prefix per chunk) cut top-20 failures 49%, and 67% with reranking. All of this is done once, at write time.
6. **Score fusion beats RRF when the two retrievers aren't balanced. RRF wins when they are.** Bruch et al.: convex combination beats RRF and needs only a handful of labeled queries to tune. The 2026 "fusion tax" paper: RRF's net change was negative on 5 of 7 BEIR sets when dense clearly led. Elastic found k=20 beat 60 for its model. Weaviate's min-max score fusion gave about 6% more recall than RRF on FIQA.
7. **Compress the key, not the value.** SeCom (ICLR 2025) ran LLMLingua-2 over memory segments before indexing. Removing that step cost 9.5 GPT4Score points on LoCoMo with MPNet. Token-level compression of what the *reader* sees costs accuracy elsewhere (prefetch.md's SWE-Pruner table). The two fit together: denoise the copy you index, and hand the reader the whole segment.

---

## 1. Hybrid fusion

### 1a. Reciprocal rank fusion (RRF) and its k

**What it is.** Each list contributes 1/(k + rank) for every item, and the sums decide the order. It ignores raw scores entirely, so lists with different score scales combine without tuning. k damps the top: k=60 makes rank 1 and rank 10 differ by only about 13%, while small k makes the top few ranks count much more.

**What it adds.** Robust, parameter-light fusion. Items both lists agree on rise.

**Evidence.**
- Weaviate used 1/(rank+60) by default until v1.24, then switched its default to relative score fusion after about +6% recall on FIQA ([Weaviate blog](https://weaviate.io/blog/hybrid-search-fusion-algorithms)).
- Elastic found **k=20** best for its dense model, and also found that a tuned linear combination beat RRF ([Elastic](https://www.elastic.co/blog/improving-information-retrieval-elastic-stack-hybrid)). RRF over BM25 plus ELSER gained 1.4% over ELSER and 18% over BM25. Linear fusion gained 6% and 24%.
- "The Fusion Tax" ([arXiv 2610.30612](https://arxiv.org/pdf/2610.30612)): with k=60 untuned, RRF hurt 15-33% of queries against dense-only and was net negative on 5 of 7 BEIR corpora. It helped only where BM25 and dense were about equally strong (TREC-COVID +0.135 nDCG@10). A 0.7/0.3 weighted RRF closed 25-73% of the gap to score interpolation.
- Cloudflare AI Search's hybrid mode defaults to `fusion_method: "rrf"` and also offers `"max"` ([CF hybrid docs](https://developers.cloudflare.com/ai-search/configuration/indexing/hybrid-search/)).

**Cost.** Microseconds. Runs anywhere.

**For Long Con.** Today's two lists are **two BM25 views of the same text**, so they are highly correlated. RRF over them mostly breaks ties in favor of units that match in the user's own words. That's a sensible prior for LongMemEval, where 94% of evidence sits in user turns, and the eval table shows it helped small-local most (59.6% → 70.2%, though the cutoff contributes to that too). Two cheap things to try:
- **A k sweep (10, 20, 60).** Small k sharpens the top, which matters more at 2.5K than at 8K.
- **Weighted RRF.**

Expected gain is small (0-2 pp) and uncertain, but it costs a parameter sweep.

### 1b. Convex (weighted) score fusion with normalization

**What it is.** Normalize each retriever's scores to a common range, then take `α·a + (1−α)·b`. The usual normalizations:
- min-max, which squeezes each list into 0..1;
- z-score, which subtracts the mean and divides by the standard deviation;
- "theoretical min-max", which uses the score's floor, 0 for BM25 and -1 for cosine, instead of the observed minimum;
- distribution-based, which scales by the mean ± 3 standard deviations, as in LlamaIndex's "relative score dist fusion".

Unlike RRF, how far apart two scores are carries information.

**Evidence.**
- Bruch, Gai and Ingber ([arXiv 2210.11934](https://arxiv.org/abs/2210.11934), read via ar5iv; the results tables didn't come through): convex combination beats RRF both in and out of domain. The choice of normalization barely matters, since linear normalizations are rank-equivalent once α is retuned. α needs only a handful of labeled queries.
- Elastic: about 40 labeled queries were enough to beat RRF on ArguAna.
- The Fusion Tax recommends α≈0.6-0.7 toward the stronger retriever, and RRF or α≈0.5 when the two are balanced. It also found that per-query routing on cheap features didn't pay (AUC 0.59).

**For Long Con.** This matters once embeddings land. LongMemEval-S is a "lexical regime": BM25 R@5 0.948 against dense max-sim 0.953 and dense mean-pooled 0.920 ([arXiv 2606.04194](https://arxiv.org/html/2606.04194)). So the two will be close on the benchmark and possibly not on real chat. Tune α on the dev slice per profile, and keep "BM25 only" as an arm. One more option within BM25: **BM25F**, a single BM25 with weighted fields (user words weighted higher), is the principled form of what the two-list RRF approximates. It's worth one comparison.

### 1c. Relative score fusion and "max" fusion

**What it is.** Weaviate's relative score fusion is min-max normalization per list, then a weighted sum. Cloudflare's `max` takes the higher of the two normalized scores, which suits cases where one retriever usually wins outright.

**For Long Con.** The current "confidence" is already a relative score in this sense, a per-list share of the top. It works as a **within-query** filter, but it can't say "nothing here is relevant" (see "Where Long Con stands"). Fusion and abstention want different signals: rank or score fusion to order the units, and a calibrated absolute score (section 2f) to decide whether to include any at all.

### 1d. When hybrid beats either alone: conversational-memory numbers

| Data | BM25 | Dense | Hybrid | Source |
| --- | --- | --- | --- | --- |
| LoCoMo, session Hit@1 (e5-large-v2) | 0.640 | 0.427 mean-pool / 0.664 max-sim | **0.752** weighted (RRF 0.718) | [2606.04194](https://arxiv.org/html/2606.04194) |
| LongMemEval-S subset, session R@5 (MiniLM) | 0.948 | 0.920 / 0.953 | 0.956 RRF, 0.959 weighted | same |
| Anthropic codebase, docs, papers: top-20 failure | 5.7% (embeddings) | | 2.9% with contextual BM25 added | [Anthropic](https://www.anthropic.com/engineering/contextual-retrieval) |
| Cursor agent QA | grep only | | +12.5% accuracy (6.5-23.5%) with semantic search added | [Cursor](https://cursor.com/blog/semsearch) |

Three readings:
- Hybrid helps a lot where the dense signal is good and different from the lexical one (LoCoMo, with late-interaction dense).
- It barely helps on LongMemEval-S, where BM25 is already near the ceiling at session level.
- Weighted score fusion beat RRF in the conversational study.

**Expected for Long Con.** Embeddings plus fusion should lift the **preference** and paraphrase-heavy cases, the ones BM25 structurally misses ("what should I cook" against an earlier chat about being vegetarian). Small-local's preference score of 0/3 is the obvious target. The headline LongMemEval number may move only 1-3 pp. Real chats with paraphrase will probably gain more, but that's untested.

---

## 2. Rerankers

**What a cross-encoder is.** A model that reads the query and one candidate *together* and outputs a relevance score. That's far more accurate than comparing two separately made vectors or counting shared words, but it costs one model pass per candidate. So it runs only over the top 30-150 candidates from the cheap first stage. A **listwise LLM reranker** instead reads the query and many candidates in one prompt and outputs an ordering.

### 2a. Model menu

| Model | Size | Quality (higher is better) | Where | Notes |
| --- | --- | --- | --- | --- |
| ms-marco-MiniLM-L-6-v2 | 23M | BEIR 48.64 | Browser (Xenova ONNX, transformers.js), CPU | About 1 ms per pair on M4 Max CPU (derived from about 30 ms per 30 pairs, [Qdrant](https://qdrant.tech/blog/oxidizing-cross-encoders/)). 512-token limit. **Hurt LoCoMo Hit@1 by 6.9 pp** in one study |
| jina-reranker-v1-tiny-en | 33M, 4 layers | BEIR 48.54 | Browser (has a transformers.js example) | 8K-token input; about 5x faster than v1-base ([Jina](https://jina.ai/news/smaller-faster-cheaper-jina-rerankers-turbo-and-tiny)) |
| jina-reranker-v1-turbo-en | 38M | BEIR 49.60 | Browser | |
| bge-reranker-base | ~278M | (older BGE) | **Cloudflare Workers AI** `@cf/baai/bge-reranker-base`, $0.00311 per M input tokens ([CF](https://developers.cloudflare.com/workers-ai/models/bge-reranker-base)) | Scores map to 0..1 with a sigmoid. The only reranker on the Workers AI catalog today ([model list](https://developers.cloudflare.com/workers-ai/models/index.md)) |
| jina-reranker-v2-base-multilingual | 278M | BEIR 57.06 (Jina's own table) | Browser (ONNX weights uploaded), CPU about 4.4 ms per pair | |
| bge-reranker-v2-m3 | 568M | BEIR 53.94 (mixedbread table) / 56.51 (Jina table); MTEB-R 57.03 | GPU or CPU; heavy for a browser | 3.05 s per query on an A100 in mixedbread's test; about 1.6 s per query for top 30 in the fusion-tax paper |
| mxbai-rerank-base-v2 | 0.5B (Qwen2.5) | BEIR 55.57; 0.67 s per query on A100 | Apache 2.0 ([mixedbread](https://mixedbread.com/blog/mxbai-rerank-v2)) | |
| mxbai-rerank-large-v1 | 435M (DeBERTaV3) | | CPU | **What SmartSearch used** for its LongMemEval and LoCoMo gains |
| Qwen3-Reranker-0.6B | 0.6B | MTEB-R 65.80 ([Qwen3 report](https://arxiv.org/html/2506.05176v3)); BEIR 56.28 (Jina table) | **Browser via transformers.js v4, q4 or q8, WebGPU** ([ONNX](https://huggingface.co/onnx-community/Qwen3-Reranker-0.6B-ONNX)) | Score = P(yes) / (P(yes) + P(no)), a natural 0..1 relevance. Takes a 1-5 word instruction worth +1-5% |
| jina-reranker-v3 | 0.6B, listwise | BEIR 61.94 | GPU | Up to 64 docs in one pass ([Jina](https://jina.ai/news/jina-reranker-v3-0-6b-listwise-reranker-for-sota-multilingual-retrieval/)) |
| Qwen3-Reranker-4B | 4B | MTEB-R 69.76 | Server GPU | |

BEIR numbers from different vendors use different first stages, so compare within one table, not across tables. bge-reranker-v2-m3 scores 53.94 in one and 56.51 in the other.

### 2b. LLM listwise rerankers (RankGPT, RankZephyr, FIRST)

**What it is.** A 7B+ LLM is shown 20 passages and outputs their order. FIRST reads the order off the logits of the *first* output token instead of generating the whole permutation.

**Evidence.** The FIRST reproduction ([arXiv 2411.05508](https://arxiv.org/html/2411.05508v2)) found it 21-42% faster than full generation. Only 7-8B models were tested. RankZephyr with full generation reaches DL19 0.776 nDCG@10.

**Fit.** Wrong size for both profiles: seconds per turn on a server GPU, not available on Workers AI as a ranking model, and far too big for the browser. **Skip.** Listed for completeness.

### 2c. Cost and latency per profile

- **claude on Cloudflare.** bge-reranker-base over 50 candidates × ~420 tokens ≈ 21K tokens ≈ **$0.00007 per turn**. Latency is unpublished; a few hundred ms is a plausible guess, so measure it. Qwen3-Reranker-0.6B isn't on Workers AI. Running it would need another host or a container, so start with bge-reranker-base.
- **small-local in the browser.** The reranker competes with LFM3 for the GPU and memory. Estimates, not measurements:
  - jina-tiny or MiniLM over 30 candidates at ~400 tokens: maybe 100-400 ms on WASM, faster on WebGPU. The ~1 ms per pair CPU figure was for short pairs on a 14-core M4 Max, and a phone will be several times slower.
  - Qwen3-Reranker-0.6B q4 on WebGPU over 30 candidates: likely 1-3 s on a laptop GPU. Possibly fine as a background pass while the user is still typing (prefetch.md's "speculative interaction" pattern), too slow inline on a phone.
- **Truncating candidates.** MiniLM's 512-token window fits a 400-token segment plus a short query. Longer units need jina (8K) or Qwen3.

### 2d. Expected gain

- **small-local: the biggest upside in this slice.** Evidence turns found is 80%, but all evidence in the packet is only 70.2%, and a 2.5K budget is about 6 slots. Moving gold units from rank 8-15 into the top 6 is what SmartSearch's reranker did (mean first-gold rank 47 → 2). **Guess: +5 to +12 pp all-evidence**, if the reranker is a good one. The MiniLM negative result says the tiny models may give ~0 or even negative. **Test jina-tiny, MiniLM and Qwen3-0.6B head to head.**
- **claude: +2 to +5 pp.** 8K already holds ~16-20 segments, so ordering matters less. The main win is letting the *adaptive* packet stop earlier (fewer tokens at equal recall) and abstain better.

### 2e. Rerank multi-session questions carefully

A cross-encoder scores each candidate alone. Multi-session questions ("how many X total") need several moderately relevant pieces, and a reranker can push the second and third pieces below a confident first one. SmartSearch found MMR diversity reranking added nothing, and cumulative-score pruning cost 2.3 pp. So keep a floor of the top BM25 units even after reranking, and judge by the multi-session row specifically.

### 2f. Rerank score as a calibrated signal for abstention

**What it is.** A cross-encoder outputs a relevance probability (bge via sigmoid, Qwen3 via P(yes)), and unlike BM25 it means roughly the same thing across queries. So "best candidate scored 0.08" is a usable "nothing here" signal. That's the absolute signal Long Con's packet currently lacks.

**Evidence.**
- "Towards Trustworthy Reranking" ([arXiv 2402.12997](https://arxiv.org/html/2402.12997v5), read through the method section; results tables not reached). Reference-free confidence features computed from the score list: the max, the standard deviation, and the gap between the top two. A small linear regression on the sorted scores, fit on a labeled reference set, beat those heuristics at no inference cost. MIT code.
- SmartSearch uses τ = α·max(CE) with α=0.03, inside a 4,000-word ceiling. That gave worst-case recall 0.945 at an average 2,891 tokens. It's a *relative* threshold on top of reranker scores, the same shape as Long Con's 0.3 cutoff but on a better score.
- A practitioner post argues fixed 0.5 cutoffs fail across queries ([dev.to](https://dev.to/ji_ai/cross-encoder-reranker-score-calibration-why-05-cutoffs-fail-1k9b); title seen in search results only, not read).

**For Long Con.** Use two thresholds:
1. **Absolute**: drop everything if the max reranker probability is below τ_abs. Fit τ_abs on dev turns that should get nothing: abstention questions, small talk, off-topic. This is what makes an empty packet possible after the gate.
2. **Relative**: keep units with score ≥ α·max.

Report the harm rate (prefetch.md) next to recall.

---

## 3. Query-side techniques

The question for each technique: does it need a model **per turn** (expensive on small-local) or only **at index time**, which can run in the background between turns, on Workers AI, or overnight?

| Technique | Model at query time? | Model at index time? | Evidence of gain | Fit |
| --- | --- | --- | --- | --- |
| RM3 / Rocchio PRF (rule-based) | No | No | +6.0 pp LME-S (SmartSearch); BM25+RM3 R@20 28.8 → 30.7 across MS MARCO and BEIR | **Both profiles** |
| Entity discovery, second hop | No (spaCy-like NER, or the existing names index) | No | +1.4 pp LME-S | Both |
| Time-aware filtering | Rules: no. LLM: yes | No | +6.8 to +11.3% recall on temporal questions with GPT-4o; Llama 8B failed | **Rules version for both** |
| Synonym and alias expansion | No | Lexicon built offline | prefetch.md: aliases cut failures 10-14% | Both |
| Contextual chunk prefix (Anthropic) | No | LLM per chunk (or deterministic, see below) | −35% failures (embeddings), −49% (+ BM25), −67% (+ rerank) | Both; the LLM version runs in the background |
| Fact-augmented keys (LongMemEval) | No | LLM per session | +9.4% recall@k, +5.4% accuracy averaged | Both; the LLM version runs in the background |
| doc2query / doc2query-- | No | Generator + filter per unit | Up to +16% over doc2query; doc2query itself is a strong BM25 booster | Both, background |
| LLMLingua-2 "denoised" keys (SeCom) | No | 355M token classifier per unit | −9.46 GPT4Score when removed (LoCoMo, MPNet) | Both, background |
| HyDE | Yes, LLM writes a fake answer | No | BM25 R@20 28.8 → 34.0 with HyDE+Rocchio (Qwen2.5-7B) | claude only, maybe |
| query2doc | Yes | No | BM25 DL19 51.2 → 66.2 with davinci-003; with a 1.3B model only 52.0 | claude only, maybe |
| Multi-query / RAG-Fusion | Yes | No | Recall up, but "largely neutralized after re-ranking and truncation" | Skip |
| Step-back prompting | Yes | No | Not checked this session | Skip for now |

### 3a. Pseudo-relevance feedback (RM3, Rocchio, and the SmartSearch rule)

**What it is.** Search once, assume the top few results are relevant, take the words that recur in them, add those words to the query with a lower weight, and search again. RM3 is the classic probabilistic version for BM25. Rocchio is the vector version: move the query toward the centroid of the top hits.

**Evidence.**
- SmartSearch on LongMemEval-S: content nouns found in ≥2 of the top 10 passages, re-searched at weight 0.5, gave **+6.0 pp**. With entity discovery (names from retrieved passages fed into the next hop at weight 2.5), +9.2 pp combined, and **+12.8 pp on temporal questions**. On LoCoMo it was neutral (±0.3 pp). Morphological expansion was tried and rejected as noisy. ([arXiv 2603.15599](https://arxiv.org/html/2603.15599))
- "Revisiting Feedback Models for HyDE" ([arXiv 2511.19349](https://arxiv.org/html/2511.19349v1)): BM25+RM3 Recall@20 28.8 → 30.7 averaged over MS MARCO, TREC DL and BEIR.

**Cost.** One extra BM25 pass, about a millisecond at chat-history scale. **Runs in the browser and on Cloudflare** (in a Worker, or as a second FTS5 query on D1; D1 supports FTS5 per the [CF SQL docs](https://developers.cloudflare.com/d1/reference/sql-statements)).

**Risk.** Drift: if the first pass is off-topic, PRF amplifies it. So gate it. Run PRF only when the first pass's top confidence clears a bar, or only when the top results agree with each other.

**Expected.** claude +2-5 pp, small-local +2-6 pp, concentrated in multi-session and temporal. That's an educated guess from SmartSearch; their candidates came from substring matching, not BM25.

### 3b. Time-aware query expansion

**What it is.** Find the time expression in the question ("last month", "in May", "two weeks before my trip"), turn it into a date range, then boost or filter units by session date.

**Evidence.** LongMemEval paper ([arXiv 2410.10813](https://arxiv.org/html/2410.10813v2)): with GPT-4o extracting the range, recall rose ~11.3% (rounds) and ~6.8% (sessions) on the temporal subset. Llama 3.1 8B "struggles to generate accurate time ranges."

**For Long Con.** An LLM extractor is out for small-local, but **explicit and relative dates are a solved rules problem** (chrono-style parsers). Session dates are already in the packet and sort order. Boost in-range units rather than hard-filtering, since "before my trip" style anchors are relative to an event, not a date. Temporal is the biggest question type on the dev slice (13 of 47), so even a partial win shows.

### 3c. Contextual chunk prefixes (Anthropic "contextual retrieval")

**What it is.** Before indexing a chunk, an LLM writes 50-100 tokens placing it in its document ("This is from the Q2 report, section on revenue…"). Both the embedding and the BM25 index see the prefix.

**Evidence** ([Anthropic](https://www.anthropic.com/engineering/contextual-retrieval)):
- top-20 failure 5.7% → 3.7% with contextual embeddings;
- → 2.9% adding contextual BM25;
- → **1.9%** reranking 150 candidates down to 20.

That's about $1.02 per M document tokens with Claude 3 Haiku and prompt caching. The fusion method isn't specified ("rank fusion techniques").

**For Long Con.** Segments of a chat lose their context worse than document chunks do: "yeah do that one" means nothing alone. A **zero-model prefix** gets much of the benefit:
- session date;
- the session's topic label;
- the user's opening question in that session or topic;
- names from the names index;
- for an assistant-heavy segment, the user line it answers.

The LLM-written version can run in the background on Workers AI for claude, or as LFM3 "sleep-time" work for small-local. Index the prefix; whether to *show* it to the reader is a separate choice, since it costs packet tokens.

### 3d. Fact-augmented keys (LongMemEval) and doc2query / doc2query--

**What it is.** Index each unit under extra text that says what it's about. LongMemEval extracts the user facts in a session ("user adopted a cat named Miso") and indexes the session under *its text plus those facts*. Doc2query generates questions the passage would answer and appends them. Doc2query-- then throws away generated questions that a relevance model scores low.

**Evidence.**
- LongMemEval-M, round values: K=V R@5 0.582 → **0.644** with K=V+fact. Top-5 QA with GPT-4o 0.600 → 0.638. Keyphrase-only keys were bad (0.282), so **add** to the text, never replace it. Facts helped multi-session reasoning most. Averaged: +9.4% recall@k, +5.4% accuracy.
- Doc2Query-- ([arXiv 2301.03266](https://ar5iv.labs.arxiv.org/html/2301.03266)): MS MARCO RR@10 0.279 → 0.323 when keeping the best 30% of 80 generated queries, with a 33% smaller index and faster queries. Unfiltered doc2query needed about 2.9x the GPU time to match.

**Cost.** One small-LLM call per segment at write time, zero at query time. On Cloudflare that's a Workers AI text model run from a queue after each turn. In the browser, LFM3 can do it while idle, but it competes with chat. A 20-40 token fact line per segment is cheap.

**Expected.** Multi-session is Long Con's weakest type, and it's the type facts helped most. **Guess +3-8 pp on multi-session**, smaller overall. Watch for hallucinated facts: index them, but never show them as if the user said them. They are keys, not values.

### 3e. HyDE, query2doc, multi-query (model per turn)

**What they are.**
- **HyDE**: an LLM writes a fake answer, and you search with *that*, since a fake answer looks more like the real passage than the question does.
- **query2doc**: same idea, appended to the query (repeated 5x so the original words keep their weight).
- **Multi-query / RAG-Fusion**: an LLM writes several rewordings, you search each, and fuse with RRF.

**Evidence.**
- query2doc ([arXiv 2303.07678](https://ar5iv.labs.arxiv.org/html/2303.07678)): BM25 DL19 51.2 → 66.2 with davinci-003, but babbage (1.3B) gave 52.0. The LLM call was >2 s, and the longer query made BM25 11x slower (16 → 177 ms).
- HyDE + Rocchio feedback ([2511.19349](https://arxiv.org/html/2511.19349v1)) beats concatenation by up to 1.4 points R@20.
- RAG-Fusion in production ([arXiv 2603.02153](https://arxiv.org/html/2603.02153v1)): raw recall up, but gains "largely neutralized after re-ranking and truncation". Hit@10 51.3% baseline against 47.8% fused, and +0.89 s for query generation. Small synthetic set (115 queries).

**Fit.**
- **small-local: no.** A 1.7B model's fake answers about *your* chat history are guesses, and the query2doc size curve says small generators add little.
- **claude: low priority.** For personal history, HyDE writes plausible-but-invented details, and BM25 then matches the invented words. If tried, use a cheap Workers AI model and only on turns where the first pass scored low: an "expand on miss" path, not every turn.

### 3f. "Alternate phrasing" search without a model

This was asked for specifically. The zero-model versions are:
- **embeddings**, the real answer for paraphrase, coming in the hybrid step;
- **PRF** (3a), which learns the chat's own vocabulary for a topic from its top hits;
- **index-time expansion** (3c and 3d), which puts other phrasings into the index ahead of time;
- **an alias and synonym lexicon** mined from the chat itself, covered in prefetch.md.

The model-per-turn version (multi-query) has the weakest evidence of the lot.

---

## 4. Compression and extractive selection

**What these are.**
- **LLMLingua** family: delete low-information *tokens* from the context, using a small LM's perplexity (LLMLingua, LongLLMLingua) or a trained token classifier (LLMLingua-2, 355M xlm-roberta-large or 110M mBERT).
- **RECOMP**: picks sentences (extractive) or writes a short summary (abstractive), and may output nothing.
- **Provence**: a 0.4B DeBERTa cross-encoder that labels each token relevant or not for *this question*, drops sentences that are mostly irrelevant, and can keep zero sentences. It can be the same model as the reranker.

| Method | Granularity | Question-aware | Numbers | Source |
| --- | --- | --- | --- | --- |
| LLMLingua-2 | Token | No | 2-5x compression, 1.6-2.9x end-to-end speedup. On LongBench at 2K tokens 39.1 vs LongLLMLingua 48.0 | [2403.12968](https://arxiv.org/html/2403.12968v2) |
| LongLLMLingua | Token + document | Yes | Beats LLMLingua-2 on LongBench (above) | same |
| RECOMP extractive | Sentence | Yes | NQ: 660 → 37 tokens, EM 39.4 → 36.6. HotpotQA: 684 → 75, EM 32.8 → 30.4 | [2310.04408](https://arxiv.org/html/2310.04408v1) |
| RECOMP abstractive | Summary, may be empty | Yes | Cut copying of wrong answers from 85% (GPT-3.5 summaries) to 39%; 4-25% empty summaries in training | same |
| Provence | Sentence, via token labels | Yes | "Little-to-no drop" (numbers in figures only); zero sentences allowed | [HF blog](https://huggingface.co/blog/nadiinchi/provence) |
| XProvence | Sentence, inside the bge-reranker-v2-m3 pass | Yes | 40-60% compression at equal QA on MKQA and TyDiQA; reranking held (MIRACL nDCG@10 74.5 → 74.3) | [2601.18886](https://arxiv.org/html/2601.18886v1) |
| SeCom | LLMLingua-2 on **index keys** only | No | LoCoMo GPT4Score 69.33 → 59.87 without it (MPNet). Also helped BM25 recall above 50% compression | [2502.05589](https://arxiv.org/html/2502.05589v2) |

### When compression hurts and when whole units win

- prefetch.md already has the SWE-Pruner table: LLMLingua-2 dropped SWE-bench success 62% → 54%, while whole-line selection lifted it to 64%. Long Con's "whole units" rule stands for what the **reader** sees.
- RECOMP's own numbers show the cost: EM drops 2-3 points at ~6% of tokens. That's a fine trade for a 20B reader with no budget pressure, and a bad one when the recall target is "all evidence in packet".
- Two places compression *does* fit Long Con:
  1. **Denoising the index (SeCom).** Compress the copy that BM25 and embeddings see, keep the original as what the reader gets. Fillers like "yeah, totally, haha" dilute BM25's length normalization and embedding means. This is a pure retrieval change with no reader-side loss. Zero cost per turn: LLMLingua-2 small (110M) at write time in the browser or a Worker. An even cheaper first try: a stopword and filler strip before indexing, which BM25 `contentWords` partly does already.
  2. **Fitting one more segment on small-local.** With a 2.5K budget, a Provence-style pruner that removes the obviously unrelated half of a 400-token segment could make room for one or two more segments. That's directly the multi-session failure mode. It's a gamble against the whole-unit evidence, so test it only as "prune within segment *only* to admit another segment that would otherwise be cut", and score multi-session. The safer cousin is **smaller units** (the current 400 already beat bigger ones).

---

## 5. Evidence specific to conversational memory (LongMemEval, LoCoMo, MTRAG, CORAL)

| Finding | Data | Source |
| --- | --- | --- |
| BM25 near the ceiling for session finding; fusion +0.67 pp, not significant | LME-S subset | [2606.04194](https://arxiv.org/html/2606.04194) |
| Weighted score fusion beat RRF (Hit@1 0.752 vs 0.718); adding BM25 to dense +8.8 to +17.2 pp Hit@1 | LoCoMo | same |
| MiniLM web reranker on the fused top 10 lowered Hit@1 by 6.9 pp | LoCoMo | same |
| Cross-encoder moved mean first-gold rank 47 → 2 (LME-S), 195 → 8 (LoCoMo). Bigger reranker +3.9 to +6.0 pp. CE+ColBERT RRF (0.7/0.3) +1.2 pp | LME-S, LoCoMo | [SmartSearch 2603.15599](https://arxiv.org/html/2603.15599) |
| Rule PRF +6.0 pp, entity hop +1.4 pp, temporal +12.8 pp; LoCoMo neutral | LME-S | same |
| 88.4% QA at ~3.4K tokens vs 65.6% for full context (~115K) | LME-S | same |
| "Only 22.5% of gold evidence survives truncation to the token budget" on LoCoMo: ranking and budget fitting, not finding, is the bottleneck | LoCoMo | same |
| Fact-augmented keys +9.4% recall@k; time-aware expansion +6.8 to 11.3% recall on temporal | LME-M | [LongMemEval](https://arxiv.org/html/2410.10813v2) |
| Segment units beat turn and session units for both BM25 and MPNet; LLMLingua-2 index denoising matters | LoCoMo, Long-MT-Bench+ | [SeCom](https://arxiv.org/html/2502.05589v2) |
| Rewrites beat raw history as the query; ~4 turns of history best (CORAL) | MTRAG, CORAL | covered in prefetch.md |

The striking agreement: two independent 2026 systems that use **no LLM in the retrieval loop** reach LongMemEval-S evidence recall in the high 0.9s at 3-4K tokens. They get there with lexical candidates, a good reranker and rule-based expansion. That's Long Con's architecture plus a reranker and PRF.

**Caveat.** SmartSearch's labels are passage-level, derived from turn labels, and its recall is "evidence in the compiled context" in a slightly different sense from Long Con's "all evidence turns in packet". Treat its numbers as direction, not a target.

---

## Runs-where summary

| Technique | Browser (small-local) | Cloudflare (claude) | Per-turn cost |
| --- | --- | --- | --- |
| RRF k / weighted RRF / score fusion / BM25F | Yes | Yes (Worker, or D1 FTS5 + Vectorize; AI Search has `rrf` and `max`) | ~0 |
| Rule PRF, entity hop, date rules | Yes | Yes | ~1 ms |
| Deterministic contextual prefix | Yes | Yes | 0 (index time) |
| LLM prefix, facts, doc2query-- | LFM3 while idle (competes with chat) | Workers AI text model from a queue | 0 at query time |
| LLMLingua-2-small index denoise | transformers.js, 110M (porting effort unverified) | Worker + model host (not on Workers AI) | 0 at query time |
| Cross-encoder rerank | jina-tiny / MiniLM (WASM); Qwen3-Reranker-0.6B q4 (WebGPU) | `@cf/baai/bge-reranker-base` | ~$0.00007 / turn on CF; 0.1-3 s in browser (estimate) |
| HyDE, query2doc, multi-query | Not worth it | Possible, ~1 s + cost | 1 LLM call |
| Provence / XProvence pruning | Heavy (0.4-0.6B) | No hosted model on Workers AI | 1 pass per candidate |
| Listwise LLM rerank | No | No | Seconds |

---

## Top ideas for Long Con from this slice

Each is a dev-slice experiment against the current builder, reporting all-evidence %, mean tokens, per-type rows (multi-session, temporal, preference) and, where it applies, a harm or empty-packet rate.

1. **Add a cross-encoder reranker over the top 40-60 fused units, then fit.**
   - *Hypothesis:* small-local all-evidence 70.2% → 77-82%; claude +2-5 pp at the same or fewer tokens.
   - *Arms:* bge-reranker-base (Workers AI), jina-reranker-v1-tiny and ms-marco-MiniLM-L-6-v2 (browser), Qwen3-Reranker-0.6B (browser, WebGPU). Keep the top 2 BM25 units as a floor so multi-session doesn't lose its second piece.
   - *Falsified if:* tiny rerankers score ≤ the no-rerank baseline, as MiniLM did on LoCoMo. Then small-local needs Qwen3-0.6B or nothing.
2. **Rule-based PRF plus an entity second hop (SmartSearch recipe), gated on first-pass agreement.** Content words in ≥2 of the top 10 units re-searched at weight 0.5; names from the names index found in the top hits at higher weight.
   - *Hypothesis:* +2-6 pp all-evidence, mostly temporal and multi-session, at zero model cost.
   - *Risk to measure:* drift on turns whose first pass was wrong.
3. **Deterministic time-range boost.** Parse explicit and relative dates in the resolved query (rules, no LLM) and multiply the scores of in-range segments.
   - *Hypothesis:* temporal all-evidence 76.9% → 82%+ (claude) and 69.2% → 75%+ (small), with no change elsewhere. LongMemEval saw +6.8-11.3% with a GPT-4o extractor.
4. **Zero-model contextual prefix in the index.** Prepend date, topic label, the session's opening user question and linked names to each segment's *indexed* text (not the rendered text).
   - *Hypothesis:* multi-session +3-6 pp, since segments lose their "what is this about" context worst. This is Anthropic's −49% failure result, minus the LLM.
   - *Follow-up:* an LLM-written prefix or fact line from Workers AI in the background, compared on the same slice.
5. **Fact-augmented keys and filtered predicted questions at write time** (LongMemEval K=V+fact, Doc2Query--). After each session, a small model writes 1-3 user-fact lines and 2-3 likely questions per segment. A reranker or BM25 self-check drops the weak ones. All of it is indexed, none of it shown.
   - *Hypothesis:* +9% relative recall (the paper's average), concentrated in multi-session, at zero query-time cost. That matters most for small-local, where per-turn calls are off the table.
6. **Make "nothing" possible: an absolute abstention threshold from reranker probability.** Keep the relative cutoff for ordering, but drop all retrieved history when max P(relevant) < τ_abs, fit on dev turns that should get nothing (the 3 abstention questions plus a set of small-talk and off-topic turns).
   - *Hypothesis:* empty-packet rate on those turns goes from ~0% to >60%, with <2 pp recall loss on answerable ones. Today, an open gate always passes at least the top hit.
7. **Fusion hygiene, before and after embeddings.**
   - Now: sweep RRF k ∈ {10, 20, 60}, try 0.7/0.3 weighted RRF, and try BM25F with up-weighted user words.
   - After embeddings: tune α for min-max score fusion per profile on ~40 dev queries, keep a BM25-only arm, and check the preference row.
   - *Hypothesis:* 0-2 pp from the sweep alone. Embeddings plus tuned score fusion should beat RRF on preference and paraphrase turns. LongMemEval overall moves ≤3 pp because it's lexical.
8. **Denoise the keys, not the values (SeCom).** Strip filler and low-information tokens (start with rules, then LLMLingua-2-small) from the text that BM25 and embeddings index, while rendering the original segment.
   - *Hypothesis:* small positive for BM25 (+1-3 pp), larger for embeddings, which SeCom found lose 9.5 points without it.
   - *Don't:* compress what the reader sees. Whole units stay whole.

**Not recommended from this slice:** model-per-turn HyDE, query2doc and multi-query (weak once reranked, need big models), and listwise LLM rerankers (too slow for either profile).

## Not verified

- Every paper above was read through a page-summarizing fetch. For Bruch et al., Provence and "Towards Trustworthy Reranking", the results tables didn't come through, so only their method and stated conclusions are used.
- Browser reranker latencies are estimates extrapolated from an M4 Max CPU benchmark, not measured on a phone.
- Workers AI bge-reranker-base latency and its input length limit weren't found.
- SmartSearch's and the June 2026 study's LongMemEval numbers use their own labels and subsets, so they aren't directly comparable to Long Con's metric.
- Step-back prompting, RankGPT and RankZephyr's original papers, and Cormack's original RRF paper weren't opened this session.
