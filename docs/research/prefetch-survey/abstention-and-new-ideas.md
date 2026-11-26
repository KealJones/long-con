# Slice E: knowing when to put nothing in the packet, plus ideas nobody listed

Researched 2026-11-26 for Long Con. This builds on `docs/research/prefetch.md` and doesn't repeat it: Adaptive-RAG, ADAPT-LLM, WiTQA, CODEFILTER and SWE-ContextBench are already there. The question here is narrower: **how does the builder know a unit is actually relevant, and when should the packet be empty?** Part 2 collects newer ideas the other slices probably won't cover.

## The problem in one paragraph

Today a unit's "confidence" is its BM25 score divided by the best score for that query (`packet.ts`, `search()`), and anything under 0.3 is dropped. That's a *relative* cutoff: the best match always scores 1.0 by definition, so **the packet is never empty unless no content word matches anywhere**. In a 140K-token LongMemEval haystack nearly every question shares a word with something. So the current builder's empty-packet rate on questions that should get nothing is close to 0% (my estimate; it can be measured with no model calls, see the proposal). The gate (`contentWords(message).length > 0`) only catches messages like "thanks". To abstain, the builder needs a score that means the same thing from one query to the next: an **absolute** relevance signal.

---

# Part 1: relevance thresholds, calibration and abstention

## 1. Why wrong context costs more than no context

| Finding | Number | Source |
| --- | --- | --- |
| Insufficient context turns abstention into hallucination | Gemma's wrong answers went from **10.2% with no context to 66.1% with insufficient context**. Big models (Gemini, GPT, Claude) answer well with enough context but rarely abstain without it | [Sufficient Context, Google, ICLR 2025](https://arxiv.org/abs/2411.06037), [Google blog](https://research.google/blog/deeper-insights-into-retrieval-augmented-generation-the-role-of-sufficient-context/) |
| Hard distractors hurt much more than random ones | One hard distractor next to the gold passage costs 6-11 points (Qwen-2.5-3B 80.9 → 69.4; weak distractor 75.5). Llama-3.3-70B still drops 81.1 → 75.2 | [The Distracting Effect, 2025](https://arxiv.org/abs/2505.06914) |
| Better retrievers make worse distractors | Irrelevant results from stronger retrievers and rerankers are *more* distracting, because what survives a good ranker looks right | same |
| Distractors fill the top of real result lists | Over 60% of queries have at least one hard distractor in a dense retriever's top 10. Reordering passages to beat "lost in the middle" doesn't beat random order | [Do RAG Systems Really Suffer From Positional Bias?, 2025](https://arxiv.org/abs/2505.15561) |
| Small models are hurt by *any* context | On questions they already answer right, adding retrieved text dropped exact match to 36-49% (1.5B-7B). Oracle and noisy context hurt about the same below 7B: "the presence of any context, not its quality, drives the distraction effect." No retrieval beat every retrieval method in the pilot | [Can Small Language Models Use What They Retrieve?, 2026](https://arxiv.org/abs/2603.11513) |
| Retrieval raised hallucination in CRAG | GPT-4 Turbo hallucinated 13.5% with no retrieval and 25-30% with straightforward RAG | [CRAG, Meta, 2024](https://arxiv.org/abs/2406.04744) |
| Even one distractor hurts, more as input grows | All 18 models tested. On LongMemEval, a ~300-token focused prompt beat the ~113K full one for every family. Claude abstained most when unsure; GPT hallucinated most | [Chroma, Context Rot, 2025](https://trychroma.com/research/context-rot) |
| Negative rejection is weak | With only noise passages, ChatGPT declined 45% of the time; 6-7B models 17-41% | [RGB, AAAI 2024](https://arxiv.org/abs/2309.01431) |
| Reasoning training makes abstention worse | Reasoning fine-tuning lowered abstention by 24% on average; scale (8B → 405B) barely helped; a system prompt saying when not to answer did help | [AbstentionBench, NeurIPS 2025](https://arxiv.org/abs/2506.09038) |

**What this means for Long Con.** The plan already says "I'd rather have nothing than incorrect stuff", and the evidence backs it hard, especially for small-local. Two points matter most:

1. **The dangerous unit is the near-miss, not the random one.** A segment about the user's *table tennis* league when they ask about *tennis* is far worse than a segment about cooking. Better ranking makes this worse, not better, since it pushes near-misses to the top. So "improve recall" and "improve abstention" are separate jobs, and abstention needs its own metric.
2. **For a 1.7B reader, the default should be empty.** Below 7B, the harm comes from context being there at all. Small-local should need much stronger evidence to include anything than the Claude profile does. Chat-history questions are the exception: the model can't already know what was said last week, so the "already knew it" harm doesn't apply. But general-knowledge and new-topic messages should get no history at all.

## 2. Relative vs absolute thresholds, and making scores mean something

**Plain English.** A relative cutoff says "keep anything at least 30% as good as the best match." It always keeps the best match, however bad. An absolute cutoff says "keep anything with at least a 70% chance of being relevant." Only an absolute cutoff can return nothing. The catch: raw BM25 scores aren't comparable across queries. A three-word query with rare words scores 25; a ten-word query with common words scores 12, and neither number says "relevant."

**Ways to make a score absolute, cheapest first:**

| Method | What it does | Cost | Needs labels? |
| --- | --- | --- | --- |
| **BM25 ceiling normalization** | Divide the top score by the most that query *could* score: the sum over its terms of idf × (k1+1). Gives 0-1, comparable across queries | Free, a few lines | No |
| **IDF-mass coverage** | Share of the query's total IDF weight that the unit matches. "Matched the rare word" vs "matched only the common ones" | Free | No |
| **Anchor-term check** | Did the unit match the query's rarest term, and every name, number or quoted string? A cheap guard against the near-miss trap | Free | No |
| **Platt scaling** | Fit a logistic curve from score features to "is this unit evidence?" | Trains in milliseconds, runs in microseconds | Yes, a few hundred labeled pairs (we have them, see the proposal) |
| **Isotonic regression** | Same job, any increasing curve. Needs more data and overfits on small sets | Same | Yes, more |
| **Bayesian BM25** | A prior from term frequency and document length plus a base rate turns BM25 into a probability. Ranking unchanged. Reported calibration error fell 68-78% with no labels, and to about 0.01 with a fit | Small library (Apache 2.0, Python) or a port | Optional ([bayesian-bm25](https://pypi.org/project/bayesian-bm25/)) |
| **Score-gap cutoff** | Sort scores, cut at the biggest drop (Adaptive-k). Matches or beats fixed top-k on factoid QA with up to 99% fewer tokens than full context | Free | No ([Adaptive-k, 2025](https://arxiv.org/abs/2506.08479)) |
| **Learned truncation** | A small transformer reads the score list and picks where to cut (Choppy, AttnCut) | Small model | Yes ([Choppy](https://arxiv.org/abs/2004.13012), [AttnCut](https://arxiv.org/abs/2102.12793)) |

Notes:
- **Embedding cosine has the same problem, worse.** Embeddings sit in a narrow cone, so unrelated text often scores 0.6-0.8 and the "no match" floor differs by model. Fixed cosine thresholds (0.5 in one study) gave coverage that "varied widely across queries" ([conformal context engineering, 2025](https://arxiv.org/abs/2511.17908)). When embeddings land, calibrate them the same way rather than picking a number.
- **Score-gap cutoff alone doesn't abstain.** It always keeps the units above the biggest gap. It decides *how many*, not *whether*. Pair it with an absolute floor.
- **Cross-encoder rerankers give the best absolute scores,** since they read query and unit together. A ~22M MiniLM cross-encoder runs in the browser via transformers.js or on Workers AI (bge-reranker-base), roughly tens of ms for 20 pairs on WebGPU. That belongs to the rerank slice; for this slice the point is that its output also needs a fit before it means "probability."

## 3. Query performance prediction: guessing whether the search worked

**Plain English.** Query performance prediction (QPP) estimates how good a search result list is *without knowing the right answer*. It's an old IR field, and it's exactly a "should we use what we found?" signal.

- **Pre-retrieval predictors** look only at the query: average or max IDF ("does the query contain rare, specific words?"), SCQ (similarity to the collection), how many content words survive. Basically free.
- **Post-retrieval predictors** look at the score list. **NQC**: spread of the top scores (a sharp spike means one unit clearly wins; a flat list means nothing stands out). **WIG**: how far the top scores sit above the corpus average. **SMV**: a mix of the two. **Clarity**: how different the top results' language is from the whole collection. **Ranking agreement (REF)**: do two different rankers agree on the top results?

**How well it works for RAG decisions (2026).** [Dado, Carmel and Kurland](https://arxiv.org/abs/2604.07985) tested predicting the *gain* from RAG per question on NQ, HotpotQA and TriviaQA:

| Predictor | Correlation with actual RAG gain |
| --- | --- |
| Pre-retrieval (IDF, SCQ, VAR) | ~0 to 0.1, useless |
| NQC, WIG, SMV | ~0.1 to 0.2 |
| REF (two rankers agreeing) | ~0.25 to 0.30, best unsupervised |
| Small supervised BERT on query + passages | ~0.45 to 0.50 |
| Uncertainty gap (needs two LLM runs) | ~0.35 to 0.55 |
| Supervised BERT on query, passages and both answers | ~0.71 to 0.89, but needs two generations |

Three takeaways for Long Con:
1. **Unsupervised QPP is weak alone.** It's a feature, not a gate.
2. **Ranking agreement is the best cheap signal, and Long Con already computes two rankings** (all words and user words). How much their top 5 overlap is free to add.
3. **A small supervised model on query + candidate text roughly doubles the signal.** That's the step after a logistic gate.

A caution from [The Fusion Tax (2026)](https://arxiv.org/abs/2610.30612): RRF fusion ranked relevant documents lower than the better single retriever on 15-33% of queries, and per-query routing on cheap QPP features never beat a static per-corpus choice (held-out AUC 0.59-0.63). Long Con's RRF fuses two BM25 views rather than BM25 and dense, so the numbers don't transfer directly. But it's a reason to check the fused ranking against each half on the dev slice, and not to build a per-query fusion router.

## 4. Conformal prediction: thresholds with a guarantee

**Plain English.** Conformal prediction sets a threshold from a held-out calibration set so a promise holds on new data, like "at least 90% of truly relevant units get kept," with no assumptions about the model. You score calibration examples, take a quantile, done. **Conformal risk control** extends it to any bounded loss, such as "false inclusions on should-be-empty prompts stay under 10%."

[Principled Context Engineering for RAG (JHU, 2025)](https://arxiv.org/abs/2511.17908) did this on retrieved snippets: an embedding-similarity scorer with a conformal threshold cut context by 2-3x, kept coverage on target, and at α=0.05-0.10 slightly *raised* answer F1 (0.69 → 0.70-0.72). Fixed top-k and fixed cosine thresholds had no coverage control.

**Fit for Long Con:** good, and nearly free at run time (one comparison). The catch is calibration size. The guarantee comes in steps of 1/(n+1), so 3 abstention questions are useless and about 100 should-be-empty prompts are the floor for a meaningful 90-95% promise. The evidence-ablation trick in the proposal supplies those for free. One more caveat: the guarantee assumes calibration and real use look alike. LongMemEval chats aren't real Long Con chats, so recalibrate on pain-mined real data before trusting the promise.

## 5. Selective and adaptive retrieval: who decides to retrieve

| Method | Signal | Needs | Fit for Long Con |
| --- | --- | --- | --- |
| [Self-RAG](https://arxiv.org/abs/2310.11511) | Fine-tuned reflection tokens: retrieve? relevant? supported? | A specially trained reader | No for Claude; maybe a far-future small model |
| [SKR](https://arxiv.org/abs/2310.05002) | Nearest neighbours among past questions where retrieval helped | Labeled history | **Yes, later:** Long Con's own logs supply "retrieval helped here" labels |
| [FLARE](https://arxiv.org/abs/2305.06983), [DRAGIN](https://arxiv.org/abs/2403.10081) | Retrieve when token probability or entropy drops mid-answer | Token logits during generation | Small-local only (logits are local); Claude's API doesn't expose them |
| [SeaKR](https://arxiv.org/abs/2406.19215), [UAR](https://arxiv.org/abs/2406.12534) | Classifiers on the model's hidden states (intent, known, time-sensitive, self-aware) | Hidden states | Small-local only, and only if the WebGPU runtime exposes them |
| [Adaptive-RAG](https://arxiv.org/abs/2403.14403) | Small classifier on question complexity | ~T5-size model | Covered in prefetch.md |
| [Adaptive retrieval without self-knowledge? (ACL 2025)](https://arxiv.org/abs/2501.12835) | 35 methods compared: plain uncertainty estimates match complex pipelines on accuracy and beat them on efficiency | — | Supports cheap signals over elaborate controllers |

The key constraint: **Long Con's gate runs before the model sees anything, and the Claude profile has no logits or hidden states.** So for Claude, the gate has to come from the query and the retrieval scores (QPP, calibrated scores, maybe a small classifier). Small-local has more options because the model runs locally; a one-forward-pass check is possible (Part 2, idea 5).

One design lesson worth taking: [TAPS (2026)](https://arxiv.org/abs/2610.16318) found that training a model to abstain mostly made it answer better, not abstain better. Training for accuracy and then putting a separate, tunable confidence threshold on top did as well or better, and gave a dial for the risk-coverage trade-off. For Long Con: **keep the ranker and the gate separate.** Tune the ranker for recall, then fit a gate with one threshold per profile. Don't fold abstention into ranking weights.

## 6. Unanswerable questions in benchmarks

- **LongMemEval** has 30 abstention questions of 500, false-premise rewrites of answerable ones ([paper](https://arxiv.org/abs/2410.10813)). Because they come from answerable questions, **their haystacks usually hold closely related text**. That makes them near-miss tests, the hardest kind. Three are in Long Con's dev 50 (`60bf93ed_abs`, `2311e44b_abs`, `0862e8bf_abs`). Strong readers already do well: Opus scored 25-27 of 30 and DeepSeek V4 Pro 29 of 30 in a [2026 audit](https://arxiv.org/abs/2609.38021), which also found judges disagree on "fix the premise, then answer" replies. So score abstention strictly and look at those answers by hand.
- **RGB's negative rejection** (noise-only context) and **CRAG's scoring** (+1 correct, 0 missing, −1 wrong) both treat a wrong answer as worse than none.
- **Knowledge-gap canaries** ([2026](https://arxiv.org/abs/2608.26385)): questions whose answers are known to be absent from the corpus. Any answer, even a correct one from the model's own knowledge, counts as a grounding failure. Canary violation rates ranged from **16.7% to 98.1%** across commercial RAG systems with near-identical accuracy. The paper's penalty-aware score Q = P(correct) − 4·P(wrong) reversed rankings. (The authors work for one of the products tested, and the canary set is small.)

## 7. NLI checks and the "lexical overlap is not relevance" trap

- **NLI filter** ([Yoran et al., ICLR 2024](https://arxiv.org/abs/2310.01558)): a natural-language-inference model drops passages that don't entail a question-answer pair. It stopped irrelevant context from hurting, but also threw away relevant passages and cost accuracy when they mattered. Also, it needs a candidate answer, which a prefetcher doesn't have. **Not a good per-turn filter for Long Con.**
- **The trap itself.** BM25 rewards shared words, so the worst units share the *topic words* and differ on the *one word that matters*: "my cat" vs "my dog", "the March trip" vs "the May trip", tennis vs table tennis. Similarity measures topic, not evidence ([Memory Retrieval for Changing Preferences, 2026](https://arxiv.org/abs/2606.02976)). That paper scored memory turns by how much each one changes a small model's (Qwen3.5-0.8B) likelihood of the answer, and beat embedding-labeled training by 2.4 points on average and 8.8 on the hardest set.
- **Cheap guards against the trap:**
  - **Anchor terms:** the rarest query term, names, numbers and quoted strings must appear in the unit.
  - **Meta-word stoplist:** "remember", "mentioned", "told", "earlier", "chat", "conversation", "last time", "you said" carry no topic and match half the history. Drop them before scoring; keep them as a signal that the message is about history.
  - **Superseded and rejected units** already get masked by the registers; extend that to "a later unit about the same entity contradicts this one", the knowledge-update case.

## 8. Metrics for abstention

All of these but the last two run with no model calls, so they belong in `eval recall`:

| Metric | Definition | Target |
| --- | --- | --- |
| **Empty-packet rate on should-be-empty prompts** | Share of prompts with no right answer in history where the packet retrieved nothing | High. Current builder ≈ 0% (estimate) |
| **False-inclusion rate** | Units included on should-be-empty prompts, per prompt or as "any included" | Low |
| **Precision@packet** | Share of included units holding labeled evidence (answerable prompts) | Higher at equal recall |
| **Recall** (existing) | All evidence in packet | Within 2 points of today |
| **Risk-coverage curve and AURC** | Sweep the gate threshold. X: share of prompts given a non-empty packet. Y: share of non-empty packets with no evidence. AURC is the area under it; lower is better. One number for "how well does the score separate good packets from bad" | Lower |
| **AUROC of the gate score** | Packet holds evidence vs not | Higher |
| **Harm rate** (existing, paid) | Passes with packet off, fails with it on | Low |
| **Penalty-aware score** (paid) | Correct − k·wrong, with abstain = 0, k = 1, 2, 4 | Report beside accuracy |

---

# The proposal: an absolute relevance gate for Long Con

### What it computes

Per query, after the existing BM25 search, for each candidate unit in the top 20. All of it is arithmetic on numbers the code already has, well under a millisecond:

| # | Feature | Kind |
| --- | --- | --- |
| f1 | **Ceiling-normalized score:** unit score ÷ Σ over query terms of idf·(k1+1), for the all-words ranking | Absolute |
| f2 | Same for the user-words ranking | Absolute |
| f3 | **IDF coverage:** Σ idf of matched terms ÷ Σ idf of all query terms | Absolute |
| f4 | **Anchor hit:** 1 if the unit matches the query's highest-IDF term and every number, name or quoted string, else 0 | Absolute |
| f5 | **Spike:** (top score − mean of ranks 2-20) ÷ their spread (NQC-style), per query | Query-level |
| f6 | **Agreement:** overlap of the two rankings' top 5 | Query-level |
| f7 | **Query specificity:** max IDF over query terms, and content-word count after the meta-word stoplist | Query-level |
| f8 | **History reference:** message has "I/my/we", "you said", "earlier", or a name from the names index | Query-level |
| f9 | Existing relative confidence (score ÷ top) | Relative |

A logistic regression (ten weights) maps these to **P(unit holds evidence)**. That *is* Platt scaling; no extra step. Include a unit when P ≥ τ for the profile, and keep the existing 0.3 relative cutoff as a second filter. If nothing passes, the packet has no retrieved history, only the history notice (and, as a separate test, an explicit "searched, nothing found" line, Part 2 idea 6).

### Free labels and free should-be-empty prompts

- **Positive and negative units:** the 47 answerable dev questions. Every top-20 candidate is labeled by whether it overlaps a `has_answer` turn. That gives about 940 labeled pairs with ~100 positives, enough for ten weights. Fit with leave-one-question-type-out cross-validation so it isn't tuned to one type, and **never touch held-out** (the existing `eval recall` rule).
- **Should-be-empty set, four tiers, hardest last:**
  1. **Off-history messages (easy):** 30-50 hand-written general-knowledge and new-topic messages ("what's the capital of Peru", "write a haiku about rain", "explain BM25") run against dev haystacks. Correct packet: empty.
  2. **Cross-haystack (easy-medium):** question A against question B's haystack. Random distractors.
  3. **Evidence-ablated (hard, the main one):** each answerable dev question against its own haystack with its `answer_session_ids` chats removed. The haystack still holds every near-miss and topical neighbour, but the answer is gone, so the correct packet is empty. That's **47 realistic hard negatives for free**, using labels the loader already keeps apart.
  4. **LongMemEval `_abs` (hard):** the 3 in dev, as a sanity check. Too few to tune on.

Optional fifth tier for the trap specifically: entity-swapped questions (change "dog" to "cat"), hand-made, about 20.

### How to pick τ

Per profile, take the largest empty rate on tiers 1-3 such that all-evidence recall on the answerable 47 drops no more than a set budget:

- **Claude:** at most 2 points of recall lost. Claude abstains well when context is thin (Chroma), so a missing unit costs more than a dubious one. τ will land low.
- **Small-local:** up to 5 points of recall for a large cut in false inclusions, since small models hallucinate when given insufficient context (Gemma 10% → 66%) and are distracted by any context at all. τ will land high.

Once tiers 1-3 reach about 100 prompts, swap the hand-picked τ for conformal risk control: choose τ so false inclusions on should-be-empty prompts stay under α (say 10%) with a stated confidence. Recalibrate on real pain-mined prompts before trusting it on real chats.

### What to report

One new table in `results/longmemeval-s-dev50-recall.md`: per profile, current builder vs gate, with empty rate per tier, false-inclusion rate, precision@packet, all-evidence recall, mean packet tokens, AURC and gate AUROC. Then one paid dev run of `packet` vs `bare` on tiers 3 and 4 plus the answerable set, to check that the empty packets turn into "I don't know" and not into guesses.

### What I expect (hypotheses, not results)

- Current builder: empty rate ≈ 0% on every tier (by construction).
- Gate: high empty rate on tiers 1-2 (they share few rare words with the haystack), partial on tier 3, low on tier 4 and the entity-swap set without f4. **f4 (anchor hit) should matter most on the near-miss tiers.**
- Precision@packet goes up noticeably at the same recall, since the weakest-matching tail units go first.
- The paid run shows the Claude reader rarely hurt by today's packets on `_abs` (it abstains well), and the small-local reader hurt much more. The gate's value is mostly on small-local.

**Not verified:** I couldn't download LongMemEval in this session (the proxy refused huggingface.co), so none of the score distributions above are measured. The evidence-ablation tier and the features are a plan to test, not a result.

---

# Part 2: ideas nobody listed

These are things the BM25/embedding, fusion/rerank, graph/memory and code/URL/intent slices probably won't cover.

### 1. The reader's citations are free relevance labels
Every Claude answer can end with the packet item ids it used (`[p2, p5]`, a few output tokens). Combined with signals the plan already logs (a tool call right after the packet = miss; re-fetching something already in the packet = ignored), every real turn yields a labeled (query, unit, used?) triple at no extra cost. That data refits the gate's ten weights per user. Evidence that traces turn into training labels: [Navigation-Informed Embeddings (2026)](https://arxiv.org/abs/2608.15956) adapted a retriever from agent search traces alone, with no new labels, raising recall@20 from 72.2 to 78.0 even though 26% of the "stop here" labels were wrong. Caveat: models cite inconsistently, so treat citations as noisy positives and test the citation instruction for harm.

### 2. Utility-weighted ranking
Units that helped before get a small prior boost; units that preceded a "no, that's wrong" get a penalty. This is the "outcome-aware retrieval" pattern from an [AI Engineer talk](https://ai.engineer/talks/Jx4ZFEAq6bY-user-signal-die-at-retrieval-boundary) (its numbers are self-reported and unverifiable), and it ties into the existing rejected-answer labels. Cheap; risk is rich-get-richer, so cap the boost.

### 3. A bandit learns each user's threshold
[Learning Personalized Memory Gating from Delayed One-Sided Feedback (2026)](https://arxiv.org/abs/2610.23812) treats "store this fact or not" as a contextual bandit with labels that come late and only for stored facts, the same shape as "include this unit or not" when you only see whether included units got used. A warm-started UCB beat a shared rule by 2.5-5.4 points. For Long Con: start every user at the dev-fitted τ, then let one-sided feedback (citations, misses) move it. One step further: arms of empty, pointer-only and full units per turn type, rewarded by answer accepted minus tokens minus misses.

### 4. Pointers as the middle ground between "include" and "nothing"
Anthropic's [context engineering post](https://anthropic.com/engineering/effective-context-engineering-for-ai-agents) recommends lightweight references loaded just in time; Manus's [lessons](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) say compression should be reversible (keep the URL, drop the page). Apply that to confidence tiers: **high P → whole unit; medium P → a one-line pointer** ("2024-05-12: a chat about Squiggle's WebGPU fallback; search 'webgpu fallback' to open it", ~25 tokens); **low P → nothing.** A pointer can't be misread as evidence the way a near-miss unit can, so hard distractors become cheap leads instead of traps, and recall survives through the tools. This fits the plan's "every packet source is also a tool." Test it as a third arm.

### 5. Small-local: one forward pass as a relevance check
Two ways to use the local model's own internals:
- **Distracting-effect probe:** [The Distracting Effect](https://arxiv.org/abs/2505.06914) scores a passage as 1 − P(model outputs "NO-RESPONSE" given query + passage), one forward pass, no generation. Run it over the 3-6 surviving units while the user types (speculative prefetch). Cost: prefill of ~400 tokens per unit; feasible in the browser but measure WebGPU timing first.
- **Retrieval heads:** [QRHead (2025)](https://arxiv.org/abs/2506.09944) finds the 1-2% of attention heads that look at relevant passages, using about **70 LongMemEval examples**. It then reranks with those heads' attention, needs no generation, and with Llama-3.2-3B beat a MiniLM cross-encoder on BEIR (48.6 vs 48.0). It subtracts a null-query score, a built-in calibration. Only possible where attention weights are exposed, so small-local only, and untested below 3B.

### 6. Say "searched, found nothing" explicitly
An empty packet and a missing packet aren't the same signal. A line like "Searched past chats for 'tennis league': nothing relevant" tells the model the builder looked, which may push it toward "we never talked about that" instead of guessing. Sufficient Context shows models hallucinate when they *don't know* the context is insufficient; AbstentionBench shows a prompt about when not to answer helps. Test on/off like the trust note, scored on tiers 3-4.

### 7. Penalty-aware scoring and canaries in the evals
Add the CRAG / Kalai-style score (correct − k·wrong, abstain = 0, k = 1, 2, 4) next to accuracy, and add knowledge-gap canaries to the canary set: questions whose answer is absent from the replayed history. Any specific answer is a grounding violation. This makes "I'd rather have nothing" a number.

### 8. Cached KV for the stable parts (small-local, speed)
[Cartridges (Stanford, ICLR 2026)](https://hazyresearch.stanford.edu/blog/2025-06-08-cartridges) train a small KV cache offline that stands in for a long corpus: 38.6x less memory at matching quality, and composable. [CacheBlend](https://arxiv.org/abs/2405.16444) reuses precomputed KV for retrieved chunks even when they aren't a prefix. For small-local, precomputing KV for frequently retrieved segments and the registers would cut time to first token. Speed only, no accuracy claim, and a WebGPU runtime has to support it. Research-grade.

### 9. Don't trust coherent haystacks
Chroma found every model did better on *shuffled* haystacks than coherent ones, and order of retrieved passages barely matters (positional-bias study). So the oldest-first order is fine as is; spend effort on fewer, better units rather than ordering.

### 10. Watch, don't adopt yet
- **[TTT-E2E (2025)](https://arxiv.org/abs/2512.23675):** a 3B model keeps learning from its context at test time, scaling like full attention with constant latency (2.7x faster at 128K). Interesting for a far-future small model; no retrieval comparison yet.
- **[MEM1](https://arxiv.org/abs/2506.15841) and [Memory-R1](https://arxiv.org/abs/2508.19828):** RL-trained memory. Memory-R1's answer agent first filters 60 retrieved memories before answering, trained from 152 QA pairs: an argument for a learned post-retrieval filter, but it costs a model pass per turn.
- **[ACE (ICLR 2026)](https://arxiv.org/abs/2510.04618):** evolving "playbooks" updated by small deltas instead of rewrites, to avoid "context collapse." Relevant to the registers and rules, not the packet gate.
- **Format matters for retrieval loops:** an unfamiliar compact format (TOON) cost Claude up to 740% more tokens than YAML in file-based retrieval ([via Simon Willison, 2026](https://simonwillison.net/2026/Feb/9/structured-context-engineering-for-file-native-agentic-systems/)). Keep packet items in plain, familiar text.

---

# Cost, latency and fit at a glance

| Technique | Run-time cost | Browser | Cloudflare | Gain: claude | Gain: small-local |
| --- | --- | --- | --- | --- | --- |
| Ceiling-normalized BM25, IDF coverage, anchor check | <1 ms | Yes | Yes | Medium (fewer junk units, smaller packets) | High |
| Logistic gate on 9 features (Platt) | <1 ms; train offline on dev | Yes | Yes | Medium | High |
| Evidence-ablated should-be-empty eval | Free, no model calls | — | — | Measurement | Measurement |
| Conformal threshold | One comparison; needs ~100 calibration prompts | Yes | Yes | Low-medium (a guarantee, not a gain) | Medium |
| QPP features (spike, agreement) | <1 ms | Yes | Yes | Low alone | Low alone |
| Score-gap cutoff | <1 ms | Yes | Yes | Low (decides how many, not whether) | Low-medium |
| Cross-encoder probability (rerank slice) | Tens of ms for 20 pairs | WebGPU | Workers AI | Medium | High |
| Pointer tier | Free | Yes | Yes | Medium (keeps recall, cuts tokens) | High |
| Citation labels + per-user refit | A few output tokens | Yes | Yes | Grows with use | Grows with use |
| Distracting-effect probe / QRHead | 1-3 s prefill (unmeasured) | Only with model internals | No | — | Medium-high, untested |
| NLI filter | A model pass, needs a candidate answer | Poor | Poor | Low | Low |

---

# Top ideas for Long Con from this slice

1. **Measure the zero first.** Add should-be-empty tiers 1-3 (off-history, cross-haystack, evidence-ablated) to `eval recall`. *Hypothesis:* today's builder returns a non-empty packet on about 100% of them, because the cutoff is relative. Free, and it turns "I'd rather have nothing" into a tracked number.
2. **Ceiling-normalized BM25 plus IDF coverage as an absolute floor.** *Hypothesis:* a single threshold on normalized top score × coverage raises the empty rate on tiers 1-2 above 70% while costing under 2 points of all-evidence recall on the answerable 47.
3. **Anchor-term check against near-misses.** *Hypothesis:* requiring the rarest query term (and any name or number) cuts false inclusions on evidence-ablated and entity-swapped prompts by at least a third more than features 1-3 alone.
4. **A ten-weight logistic gate (Platt) fitted on the dev slice, τ per profile.** *Hypothesis:* at equal recall, precision@packet rises and mean packet tokens fall by at least 20% on claude; on small-local, accept up to 5 points of recall for a halving of false inclusions. Report AURC and gate AUROC.
5. **Pointer tier for medium-confidence units.** *Hypothesis:* whole units for high P, one-line pointers for medium, nothing for low keeps recall within a point (via tools) while cutting small-local's harm rate versus whole units, in a paid dev run.
6. **Explicit "searched, nothing found" line.** *Hypothesis:* on tiers 3-4, it raises correct abstention for both readers versus a silent empty packet, without lowering accuracy on answerable questions. Test on and off, like the trust note.
7. **Penalty-aware score and knowledge-gap canaries.** *Hypothesis:* the gate's gain is invisible in plain accuracy on Claude and clear under k=4 scoring, and clearer still on small-local.
8. **Ranking agreement as a free feature.** *Hypothesis:* top-5 overlap between the all-words and user-words rankings predicts "packet holds evidence" better than the spike (NQC) feature, matching the 2026 QPP result where agreement was the best unsupervised signal. Also check the RRF fusion against each half alone (Fusion Tax).
9. **Citations as labels, then a per-user refit.** *Hypothesis:* after a few hundred real turns, refitting the gate on cited/uncited units plus post-packet tool calls raises precision@packet on pain-mined prompts over the dev-fitted gate. Needs real use; design the logging now.
10. **Conformal τ once the should-be-empty set reaches ~100.** *Hypothesis:* a conformal threshold holds false inclusions under the chosen α on held-out should-be-empty prompts, where the hand-picked τ drifts. Recalibrate on real chats before trusting it.

## Not verified

- No measurements: LongMemEval couldn't be downloaded here (proxy 403 on huggingface.co), so every expected number above is a hypothesis.
- Several 2026 papers (QPP gain prediction, Fusion Tax, personalized gating, Memory Retrieval for Changing Preferences, knowledge-gap canaries, small-model retrieval utilization) were read through abstracts and summaries, not in full.
- Self-RAG, SKR, FLARE, DRAGIN, SeaKR and UAR are described from prior knowledge, not re-read.
- Browser timings for cross-encoders and forward-pass probes are rough, not measured.
