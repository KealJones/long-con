# Survey C: structure and memory systems

Slice: graphs, temporal indexes, memory products, profiles and people, aggregation, superseded facts. Surveyed 2026-11-26. Builds on [prior-art.md](../prior-art.md) and [memory-benchmarks.md](/home/user/beep/docs/research/memory-benchmarks.md) and does not repeat them: Threader, SeCom, LightMem, Mem0's base numbers, the Zep/Mem0 dispute, Hindsight, EverMemOS's headline, MIRIX-2.0 and the "explicit memory vs raw RAG" result are covered there.

**Read every vendor number as self-reported unless marked otherwise.** "Seen" means I read the page; "abstract only" means I saw only the abstract or a summary page.

## Short answer

1. **The structure that wins on LongMemEval is a hybrid: raw spans plus a thin layer of extracted facts used as keys or as a compact view, never as a replacement.** Every system that replaced raw turns with facts collapsed on single-session-assistant (Mem0 26.8%, Memobase 23.2% in MemOS's run), and Engram reports "facts alone lose recall". That matches Beep's lossless-log bet.
2. **Our three weak types each have a cheap, mostly deterministic fix in the literature:**
   - **Multi-session** is an aggregation problem: retrieve one hit per session for the counted thing and hand the reader a compact tally, not whole segments (TallyMem: ledger 93.8% vs reading 82.8% vs long context 49.3% on counting).
   - **Temporal** needs event dates, not just session dates, resolved at index time with a rule parser, plus date arithmetic done by code (TSM, SodaMem, TReMu).
   - **Preference** fails because the question shares no words with the evidence (preference hit@1 0.367 vs 0.810 overall in one LongMemEval study). Profile-extracting systems score 80-97% there.
3. **Full knowledge graphs (GraphRAG, LightRAG, Graphiti, Mem0g) are a bad trade for Beep.** They cost 0.3-0.65M tokens to index a 56K-token book, tie or lose on simple lookups, and help multi-hop mainly with 7B+ readers. Mem0g scored *below* plain Mem0 on LoCoMo multi-hop. Graphiti's entity merging wiped every fact about departed group members (0.00 in SocialMemBench). The parts worth stealing are cheap: a deterministic noun-phrase graph (LazyGraphRAG), a subject (person) index, and live/dead marks on superseded facts.
4. **For superseded facts, coarse live/dead is enough.** A controlled 2026 study found that fine-grained revision typing adds about +0.02 (inside noise). Most of the apparent gain comes from how the facts are *rendered* to the reader (+0.16). What matters is keeping the old value visible and dated for "what was it before?" questions.
5. **Prefetch computation, not only text.** The strongest small-model wins come from doing the reader's arithmetic in advance: date deltas and counts. This fits Beep's "deterministic compute before the turn" bet better than any graph.

---

## 1. Entity and knowledge graphs

| Technique | Plain English | Index cost | Query cost | Browser / Cloudflare | Verdict for Beep |
| --- | --- | --- | --- | --- | --- |
| **Microsoft GraphRAG** | An LLM reads every chunk and pulls out entities and relations. The graph is clustered into "communities" (Leiden), and an LLM writes a summary report for each community. "Global" questions are answered map-reduce style over those reports | Highest: ~655K tokens and ~292 s for a 56K-token book (GraphRAG-Bench) | Global search ~331K prompt tokens per query on the same book | D1 can hold the tables, but the LLM bill makes it a non-starter per chat | No. Built for "summarize this corpus" questions, which a chat log rarely gets |
| **LazyGraphRAG** (Microsoft, Nov 2024) | No LLM at index time. Noun phrases and their co-occurrence form a concept graph with communities from graph statistics. LLM work is deferred to query time and capped by a "relevance test budget" | ~ vector RAG; ~0.1% of GraphRAG | Configurable; claims GraphRAG-global quality at >700x lower query cost | Index side is pure JS/SQL: fits browser and D1 | **Steal the index half.** A deterministic phrase graph is a cheap second retrieval channel |
| **LightRAG** | LLM extracts entities and relations per chunk and stores a key-value profile for each. At query time an LLM pulls "low-level" (entity) and "high-level" (theme) keywords and matches them to graph keys, then walks neighbours. Supports incremental inserts | ~474K tokens, ~710 s for the 56K-token book | ~100K prompt tokens per query (GraphRAG-Bench) | Prompt sizes alone rule out small-local | No |
| **HippoRAG 2** (ICML 2025) | An LLM extracts open triples, and passages become nodes linked to their phrases, with synonym edges. A query is matched to triples, an LLM filters them ("recognition memory"), and Personalized PageRank spreads from the surviving phrases to rank passages | ~330K tokens for the 56K-token book (Llama-3.3-70B used in the paper) | ~1K prompt tokens, so lean; one LLM filter call | PPR is ~50 lines of JS. The OpenIE step is the cost | **Steal PPR, drop LLM OpenIE.** Seed PPR from deterministic phrases instead |

What the evidence says about when graphs help:

- **GraphRAG-Bench** ([arXiv 2506.05690](https://arxiv.org/pdf/2506.05690), seen):
  - **Simple fact lookup:** RAG with a reranker is as good or better (Novel 60.9 vs HippoRAG2 60.1, LightRAG 58.6, MS-GraphRAG 49.3).
  - **Complex reasoning and summarization:** graphs win (HippoRAG2 53.4 vs RAG 42.9 on Novel).
  - **Scale:** as the corpus grew 56K→1.1M tokens, RAG's complex-reasoning score fell 58.6→43.2 while HippoRAG2 held.
  - **Reader size:** smaller readers gain less; the authors suggest about 7B as a practical floor. That is bad news for a 1.7B reader.
- **HippoRAG 2** ([arXiv 2502.14802](https://arxiv.org/html/2502.14802), seen): +2.8 F1 on average over NV-Embed-v2, and +9.5 on 2Wiki multi-hop. Gains on simple QA are tiny (NQ +1.4). Threader's table puts it at 75.0 on LongMemEval vs Threader's 90.6.
- **Mem0g vs Mem0 on LoCoMo** ([arXiv 2504.19413](https://arxiv.org/html/2504.19413v1), seen, table partly garbled):
  - Graph *lost* on multi-hop (47.2 vs 51.2) and single-hop (65.7 vs 67.1).
  - Graph won on temporal (58.1 vs 55.5) and open-domain (75.7 vs 72.9).
  - Mem0g's main claim is temporal, through invalidated rather than deleted relations.
- **Survey of graph memory** ([arXiv 2602.05665](https://arxiv.org/pdf/2602.05665), seen, truncated): graphs struggle with fuzzy information and are costly to update; vectors stay better for fuzzy recall. No numbers.

**Expected gain for Beep:**
- **Full LLM-built KG:** negative on cost for both profiles. Unclear on recall: likely + on multi-session, 0 or − on single-session types.
- **Deterministic phrase graph + PPR, gated to multi-session and "what do I know about X" queries:** guess +0 to +8 points on multi-session all-evidence recall for claude, less for small-local. Low confidence: no published chat-memory result tests exactly this.

**KG extraction cost on our stack:** ingesting LongMemEval_S once is ~57M tokens (memory-benchmarks.md). At GraphRAG-Bench ratios (6-12x tokens per source token), an LLM-built KG would cost 0.3-0.7B tokens per full benchmark pass. That is out of scope on credits and impossible on Workers AI free quotas. Anything graph-shaped must be built without per-chunk LLM calls, or built only by sleep-time jobs on real chats, which are far smaller than the benchmark.

## 2. Temporal indexes and bitemporal facts

| System / technique | Plain English | What it adds | Cost | Browser / CF | Gain guess |
| --- | --- | --- | --- | --- | --- |
| **Zep / Graphiti** ([arXiv 2501.13956](https://arxiv.org/html/2501.13956), seen) | Facts are graph edges with two clocks: when the fact was true (t_valid / t_invalid) and when the system learned or retired it (t'created / t'expired). Each message carries a reference time, and an LLM resolves "two weeks ago" against it. A new contradicting edge closes the old edge's validity instead of deleting it | Event time separate from mention time. Superseded facts kept but closed | gpt-4o-mini calls per message: extraction, reflection, entity resolution, dedup, invalidation. Call count not stated | Neo4j in the paper; D1 can store edges, but ingest needs an LLM | See per-type table below |
| **TSM, Temporal Semantic Memory** ([arXiv 2601.07468](https://arxiv.org/pdf/2601.07468), seen) | Builds a "semantic timeline" keyed on when events happen, not when they were discussed. Dates are parsed by **spaCy rules**, not an LLM ("last weekend" with query date 2023-05-30 → 05-22..05-28). At query time it parses the question's own time constraint and retrieves by event time. Monthly clusters get LLM persona summaries | Deterministic date parsing at both index and query time | LLM extraction per turn plus monthly consolidation; date parsing free | Date parsing ports to JS (chrono-node) | LongMemEval_S gpt-4o-mini: temporal 69.9 vs A-MEM 47.4; multi-session 69.2 vs 48.9; overall 74.8 |
| **SodaMem** ([arXiv 2608.08055](https://arxiv.org/pdf/2608.08055), seen) | Typed facts in SQLite with three times: mention, occurrence, validity. Relative phrases resolve to timestamps, or are marked "unresolved". The query's time window gives a **ranking bonus, not a filter**, so misremembered dates still hit. Every fact must quote text that literally appears in its source turn | Soft time windows; provenance check; raw turns kept | Planner + reader ~14-18K tokens per question; ingest cost not reported | SQLite design maps directly onto D1 | 92.8% LongMemEval_S best of 3, 90.6% median; **self-graded** (same Flash model reads and judges) |
| **TReMu** ([arXiv 2502.01630](https://arxiv.org/html/2502.01630v2), ACL Findings 2025, seen) | Summarizes each session into a timeline with inferred event dates. To answer, the model writes Python that does the date arithmetic, and the code is run | Arithmetic done by code, not by the model | One timeline summary per session plus a code call per question | Code execution: JS in browser or Worker | Its own MCQ benchmark: GPT-4o 61.7 (CoT) → 77.7; gpt-4o-mini 45.7 → 51.2; GPT-3.5 25.8 → 33.7. Weaker models gain less |
| **LongMemEval time-aware expansion** ([arXiv 2410.10813](https://arxiv.org/html/2410.10813v2), seen) | Index values by the dates of events they mention. An LLM extracts a time range from the question and filters on it | Already noted in prior-art: +7-11% temporal recall with GPT-4o, worse with Llama 3.1 8B | One LLM call per question | — | Our variant replaces the LLM with a rule parser (below) |
| **Engram** ([arXiv 2606.09900](https://arxiv.org/pdf/2606.09900), seen) | Raw episodes plus bitemporal subject-predicate-object facts, each pointing at the fact it replaces. Fast write path with no LLM; consolidation by rules first, LLM only for ambiguous conflicts. "As-of" filter plus abstention gate. Packet = facts + top raw chunks + session summaries | Proof that a cheap-first write path can still help | <50 ms writes; LLM only on ambiguity | Design is SQLite-shaped | LongMemEval_S 83.6% at ~9.6K tokens vs full context 73.2% at ~79K (single run, one reader). Temporal 81.1, multi-session 79.3, preference 73.3 |

**Zep's LongMemEval per-type numbers** (gpt-4o, full context → Zep):

| Type | Full context | Zep | Change |
| --- | --- | --- | --- |
| temporal-reasoning | 45.1 | 62.4 | +17.3 |
| multi-session | 44.3 | 57.9 | +13.6 |
| single-session-preference | 20.0 | 56.7 | +36.7 |
| knowledge-update | 78.2 | 83.3 | +5.1 |
| single-session-assistant | 94.6 | 80.4 | **−14.2** |

The gains are measured against a weak full-context baseline (60.2% overall). The drop on single-session-assistant comes from extracting only user facts.

**Why our temporal recall is 77/69%.** LongMemEval temporal questions are mostly date arithmetic: about 70% in one reader's 10-question sample ([dev.to](https://dev.to/preeti_2528/what-temporal-reasoning-actually-means-in-longmemeval-1llh), seen, directional only). The rest are "the X I did in window W". Arithmetic questions usually need **two** events retrieved: "how many days between buying A and B". BM25 on the whole question favours whichever event shares more words with it. Two fixes:

1. **Split the question into its event phrases and give each phrase its own quota.**
2. **Index event dates so a time window can boost the right session.**

**Date normalization at index time, concretely.** [chrono-node](https://socket.dev/npm/package/chrono-node/overview/2.8.3) (seen; MIT licence and browser support from earlier knowledge) parses "last Friday", "5 days ago" and date ranges against a reference instant and timezone. It runs in the browser and in a Worker with no model, and its cost per turn is microseconds. Each segment would store:

- `said_at`: the session time.
- `about[]`: resolved event dates with the source phrase, plus an `unresolved` flag for things like "back in college".

The packet item label then reads "said 2023-05-20; refers to 2023-05-13 ('last Saturday')".

## 3. Memory systems

What each stores and how it retrieves. Numbers are LongMemEval_S unless marked.

| System | Stores | Retrieves | Reported numbers | Trust |
| --- | --- | --- | --- | --- |
| **Mem0** | Extracted facts, with ADD/UPDATE/DELETE/NOOP decided by an LLM per candidate | Vector top-k | 66.4% (MemOS run): preference 90.0, single-session-assistant **26.8**, multi-session 63.2, temporal 72.2 | MemOS's run, reader and judge unstated ([HF table](https://huggingface.co/datasets/MemTensor/MemOS_eval_result/blob/main/README.md), seen) |
| **Mem0g** | Neo4j triples; conflicting relations marked invalid, not deleted | Vector + graph | LoCoMo per-type above; slower than Mem0 | Own paper |
| **Zep / Graphiti** | Episodes + entity edges with bitemporal validity + communities | Cosine, BM25, BFS; rerankers RRF, MMR, mention count, node distance, cross-encoder | 71.2% gpt-4o, 1.6K tokens, 2.6 s (own); 63.8% in MemOS's run | Own paper vs vendor rival; dispute in prior-art |
| **MemOS** | "MemCubes" of plaintext / activation / parameter memory | Hybrid | 77.8% at 1,432 tokens: preference **96.7**, temporal 77.4, multi-session 70.7 | Self-run, judge unstated |
| **Memobase** ([README](https://raw.githubusercontent.com/memodb-io/memobase/main/readme.md), seen) | **Profile slots** (topic / sub_topic / content, such as interest, work) + event timeline with gists. Raw blobs deleted by default | SQL lookups (<100 ms claimed) + embedding search | 72.4% (MemOS run): KU 89.7, preference 80.0, single-session-assistant **23.2** | Vendor rival's run |
| **Supermemory** ([research page](https://supermemory.ai/research/longmembench.md), seen) | Atomic memories with the source chunk kept as evidence; relations *updates / extends / derives*; documentDate vs eventDate | Semantic search on memories, then inject source chunk | "97%" with per-type 95-100 is **Recall@20 with aggregation**, not QA; QA 84.6-85.2% with gpt-5 / gemini-3-pro; 58.4% in MemOS's run | Wide spread, read with care |
| **Letta / MemGPT sleep-time** ([blog](https://letta.com/blog/sleep-time-compute), seen) | Core memory blocks edited by a separate background agent; the primary agent can't edit them | Agent pages memory via tools | Sleep-time compute paper ([arXiv 2504.13171](https://arxiv.org/html/2504.13171v1), seen): same accuracy at ~5x less test-time compute; up to +13% / +18% with more sleep compute; 2.5x cheaper per query with 10 queries per context; **bigger gain when queries are predictable** | Math benchmarks, not chat memory |
| **Anthropic "dreaming"** ([components of agent memory](https://anthropic.com/engineering/components-of-agent-memory), Nov 2026, seen) | Transcripts → notes → wikis → injected context; offline consolidation checks notes against transcripts | Search + wiki | Wiki + search 61% vs search alone 53%. **A shared fact table kept 41/57 contract facts (72%); per-entity pages quoting terms verbatim kept 57/57** | First-party, varied tasks, not LongMemEval |
| **A-MEM** | Zettelkasten notes with LLM-written links and "evolution" | Vector + links | 62.6% gpt-4o-mini (TSM's table). Build cost: >1.2M tokens per LongMemEval_S history (LeanMem); 74 calls per trajectory (TallyMem); 1,415 calls per 100K tokens (Threader) | Third party |
| **Nemori** ([arXiv 2508.03341](https://arxiv.org/html/2508.03341v3), method seen, results not reached) | LLM-detected episode boundaries → third-person narratives; semantic facts distilled only from what a "predict" step failed to anticipate (predict-calibrate) | k=10 episodes + m=20 facts | Claims to beat prior systems; I didn't see the tables | Not verified |
| **EverMemOS** ([summary](https://www.emergentmind.com/papers/2601.02163), seen) | MemCells (episode, atomic facts, **Foresight** = plans and temporary states with validity intervals), MemScenes, user profile | Dense + BM25 over atomic facts with RRF, then agentic scene-guided recall | Headline in prior-art. **Adding the consolidated profile to episodes: +9.32 on PersonaMem v2** | Self-reported |
| **LeanMem** ([arXiv 2608.03463](https://arxiv.org/pdf/2608.03463), seen) | Routes each topic segment to **profile** (attribute-value), **event** (topic, time anchor, state) or **record** (gist + GLiNER keywords + pointer to raw turns); filler dropped by rules | An LLM planner picks memory types and per-type top-k; typed rerank | 91.8% gpt-4.1-mini at 3.6K tokens; **77.4% with Qwen3-8B**. Ablations: unified summaries instead of typed stores 71.0; no retrieval planning 81.2; no event evolution 81.2 | Self-reported; build ~118K tokens per history |
| **MemoryOS** (BAI-LAB, [arXiv 2506.06326](https://arxiv.org/pdf/2506.06326), abstract only) | Short / mid / long-term tiers with heat-based promotion; user persona module | Tiered | LoCoMo gains over baselines claimed | Abstract only |
| **MIRIX** | Six typed memory agents | Agentic | 43.5% in MemOS's run vs 72.6 claimed for 2.0 (prior-art) | Huge spread |

**What the system table says, read across:**

- **Preference is won by extraction.** MemOS 96.7, Mem0 90, Supermemory 90, Memobase 80, against Zep 53 and MIRIX 53. The extract-a-profile systems all beat the graph-of-edges systems.
- **Single-session-assistant is lost by extraction.** Mem0 26.8, Memobase 23.2, MemU 19.6: these systems mostly extract only from user turns.
- **Typed stores beat one blob of summaries.** LeanMem lost 21 points when its typed routing was replaced by unified summaries. Anthropic's per-entity verbatim pages kept 100% where a shared table kept 72%.
- **Benchmark trust is low across the board:**
  - **Judge prompt:** one product spans 58-95 on LoCoMo, re-judging the same answers with another prompt moved the score 26 points, and full context with a cheap 2026 reader hit 80.7% ([braindetox write-up](https://braindetox.kr/en/posts/memory_benchmark_scores_reliability_2026.html), seen; one vendor's experiments).
  - **Reader:** an audit of a LongMemEval_S run ([arXiv 2609.38021](https://arxiv.org/pdf/2609.38021), seen) found readers on *identical packets* ranging from 93 to 479 correct out of 500, and re-judging flipped labels.
  - **Holdout:** it recommends a frozen holdout and per-question verdicts. Our dev50 split already does the first; publishing per-question results would do the second.
- **Length changes the ranking** ([arXiv 2607.21962](https://arxiv.org/pdf/2607.21962), seen):
  - **Short histories:** full history ties or beats every memory system.
  - **Week 3:** a budgeted "curated map" led.
  - **Week 9:** the map had evicted early content (early recall 96%→72%), and graph and hybrid stores led.
  - An endless chat is the long-tenure case, so any lossy summary layer will rot. Raw spans plus an index won't.

## 4. Profiles, preferences, people and relationships

**Why preference fails for BM25.** A preference question is a request ("any tips for my weekend?"), and the evidence is an offhand statement many sessions earlier ("I've gotten really into bouldering"). There is no word overlap. One LongMemEval study ([Entity-Collision, arXiv 2605.29630](https://arxiv.org/pdf/2605.29630), seen) measured session hit@1 of **0.367 on single-session-preference vs 0.810 overall**. Intent-style tags got no lift from character-hash features, and some lift from bigger embedders. Its entity-expansion trick was net negative on LongMemEval (hit@1 −0.022).

**What works:**

1. **Extract preferences into a store keyed by category, not by words.** Every high preference score above comes from a profile or fact layer. Memobase uses topic / sub_topic slots; LeanMem uses attribute-value profile memory with no extra LLM call beyond routing.
2. **Profile alongside episodes, never instead of them.** EverMemOS: +9.32 on PersonaMem v2 from adding the consolidated profile to episodes.
3. **Implicit preferences are much harder than explicit ones** ([AlpsBench, arXiv 2603.26680](https://arxiv.org/html/2603.26680), seen; 2,500 real WildChat dialogues). Extraction recall is much lower for implicit memories, and update F1 plateaus at 0.75-0.78 for top models.

**Our dev numbers on preference are 3 questions.** 67% vs 0% is one question vs none and tells us almost nothing. Any preference work should be scored on all 30 LongMemEval_S preference questions (accepting the holdout cost for this type), or on PersonaMem / AlpsBench.

**People and relationships.** [SocialMemBench (arXiv 2605.17789)](https://arxiv.org/html/2605.17789) (seen; synthetic group chats with friends, family and communities):

- Mem0, LangMem, Graphiti and Cognee scored **0.12-0.18 overall**, below plain uncompressed retrieval (0.345) and full context (0.369).
- On **attribution** (who said what about whom), the frameworks scored 0.25-0.46. A **subject-indexed** variant got 0.78, and raw retrieval 0.82.
- **Graphiti scored 0.00 on facts about departed members**, apparently because entity merging overwrote them.
- Theory of mind and preference change over time were the weakest categories for everyone, about 0.3 even with full context.

The lesson is direct: **index raw spans by who they are about, and never merge or overwrite people.**

**What a packet should prefetch for "family stuff" or advice prompts.** This is design synthesis from the above, not a measured result:

| Block | Content | How it's found | Size |
| --- | --- | --- | --- |
| **Person card** | Name, relation to user, aliases ("Emmy", "my wife", "she" in context), first and last mention dates | Alias table (seeded from the user's own memory/profile and kinship terms) → postings list | ~40 tokens |
| **Recent dated mentions** | Last 2-3 raw sentences about that person, each dated and pointed | Subject postings sorted by date | ~100-200 tokens |
| **Stated preferences and constraints** | Sentences that match a first-person preference pattern and name the person ("Dash hates loud places") | Preference detector ∩ subject postings | ~60 tokens |
| **Earlier advice and how it landed** | Assistant advice spans about this person, plus the user's next reply, carrying the existing negative-reply mark ("tried that, didn't work") | Subject postings ∩ assistant turns, joined to the next user turn | ~100 tokens |
| **Open loops about them** | From the existing open-loops register | Existing | — |

Anthropic's result (per-entity pages that quote verbatim beat a shared fact table, 57/57 vs 41/57) argues the card should **quote and point**, not paraphrase. That is the same as Beep's "registers point at spans" rule.

## 5. Aggregation and multi-session ("how many", "list all")

**The problem.** LongMemEval multi-session questions are mostly counts and totals over 2-6 sessions: "how many X did I…", "total spent on…". Our 400-token segments ranked by BM25 fill the budget with the 2-3 most lexically similar sessions and miss the rest. Hence 66% of evidence turns found, but only 45% of questions with *all* evidence.

**What works:**

- **TallyMem** ([arXiv 2610.19474](https://arxiv.org/pdf/2610.19474), seen) separates *access* (did every step reach the reader) from *aggregation* (did it count right). Its plain verbatim view ("Trajectory Memory") uses **zero model calls**. TallyMem adds a one-row-per-event ledger, plus a small typed query plan written by a model and run by a deterministic executor.
  - **Controlled counting probe:** ledger 93.8%, a fixed group-by counter 89.9%, verbatim view 82.8%, long-context reading 49.3%.
  - **"How often" phrasings:** the verbatim view fell to 8.3-46.7%, while the ledger stayed at 97-100%.
  - **Free-form Python** scored lower than the typed plan (62.1 vs 66.0).
  - **Full benchmark:** the gain shrinks to +1.3 points. The ledger matters most at high load.
- **LongMemEval paper:** summaries and facts usually *hurt* QA, but **fact decomposition consistently helps multi-session**, the one exception.
- **TSM and Engram** report multi-session at 69.2 and 79.3, both using event-level facts.
- **xmemory** ([arXiv 2604.27906](https://arxiv.org/abs/2604.27906), abstract only) argues aggregation needs stateful computation over validated stored entries, not re-reading retrieved text.

**Implication.** For a "how many" question, the packet shouldn't hold four whole 400-token segments. It should hold **one dated sentence per session that mentions the counted thing**, across as many sessions as match, deduplicated: a tally block. A count register that increments at write time is the TallyMem ledger in its simplest form. That needs typed events, which Beep only has for results and lists today.

## 6. Knowledge updates and superseded facts

| Approach | Who | Behaviour |
| --- | --- | --- |
| Delete on contradiction | Mem0 (DELETE op) | Loses "what was it before?" |
| Close validity, keep edge | Zep/Graphiti, Mem0g, Engram, SodaMem | Old fact excluded from "current" queries, kept for history |
| Typed relations | Supermemory (updates / extends / derives) | Version chain |
| Validity window for temporary states | EverMemOS Foresight | Plans and "this week I'm…" expire on their own |

**Evidence on what actually matters:**

- **Render confound** ([HF page for arXiv 2607.16019](https://huggingface.co/papers/2607.16019.md), seen). On revert-of-a-revert questions, a fine revision ledger beat a flat baseline by +0.18.
  - **Render:** +0.159 came from the *render*: a time-ordered layout the reader can follow.
  - **Fine typing:** +0.025, inside noise.
  - **Coarse invalidation:** a real +0.087.
  - **Keeping closed edges:** for "what held just before?", a coarse store that **keeps** closed edges scored 0.604, against 0.243 when it discards them.
  - **Heavy rendering:** a heavy layout *hurt* the reader in deployment.
  - Their advice: "deploy the coarsest retained state that covers the query mix".
- **EvalMem** ([arXiv 2609.22231](https://arxiv.org/pdf/2609.22231), seen) found retrieval defects dominate (LoCoMo: retrieval 22.1%, encoding 7.7%, generation 6.5%). Systems "keep outdated evidence after state changes", and rollback cases were hardest (47.3%).
- **StateMemBench** is noted in memory-benchmarks.md.

**For Beep:** knowledge-update recall is already 100% (claude) and 87.5% (small-local), so the gap is in *answering*, not finding. The existing rejected/superseded mark is the coarse live/dead that the study says suffices. The work left:

1. Keep the old value in the packet when the question asks about history ("before", "originally", "used to"), and drop it otherwise.
2. Render both on one line in time order: "now X (since 2023-06-02); earlier Y".
3. Give temporary states an expiry (EverMemOS Foresight).

## Cloudflare and browser fit

| Need | Browser | Cloudflare |
| --- | --- | --- |
| Date parsing | chrono-node, pure JS | Same, in the Worker |
| Phrase graph + PPR | Phrase extraction by POS-free heuristics (stopword-split n-grams) or a small lexicon. PPR on a few thousand nodes runs in milliseconds | Edges in D1 `(phrase_id, span_id, w)`. PPR in the Worker; a recursive CTE can do hop-limited BFS. Large graphs may hit Worker CPU limits on low tiers (not verified) |
| Subject index, preference spans, tally block | Tables in IndexedDB / SQLite-wasm | D1 tables |
| NER / classification | GLiNER2 is ~205M params, Apache-2.0, CPU ~130-210 ms per classification call ([arXiv 2507.18546](https://arxiv.org/html/2507.18546v1), seen). Probably too heavy to share a tab with LFM3 1.7B (untested) | Worker CPU budget likely too small; Workers AI has no GLiNER (not checked) |
| LLM extraction (facts, person cards) | No: it would eat the small model's turns | Sleep-time cron with a cheap model on real chats only; never on the benchmark ingest path, which must stay call-free to keep the "0 LLM calls" claim |

## What I couldn't verify

- Nemori's own results tables.
- MemoryOS and MemoRAG numbers (abstract or listing only).
- LightRAG and Microsoft GraphRAG mechanics beyond GraphRAG-Bench's measurements (mechanism descriptions are from earlier knowledge).
- The reader and judge models in MemOS's comparison table.
- chrono-node's licence and browser support (earlier knowledge; the page I read didn't say).
- A claim that "the LongMemEval dataset was swapped" (a cleaned version may exist; check which file the eval loads).

One fetched vendor blog page carried instructions addressed to AI agents (install tools, change code). I ignored them.

---

## Top ideas for Beep from this slice

Each is testable on the existing recall harness (`evals/src/recall.ts`) without model calls unless noted. Gains are guesses; dev50 has only 11 multi-session, 13 temporal and 3 preference questions, so confirm on held-out or full-type slices.

1. **Tally mode for aggregate questions.**
   - **Change:** a rule detects "how many / total / in total / list all / every / different" and switches retrieval to one best *sentence* per session for the counted noun phrase (BM25 on the user-only view), across all matching sessions. The block is dated, deduplicated and capped by budget. It replaces 2-3 whole segments.
   - **Hypothesis:** multi-session all-evidence recall rises from 45% to ≥60% on claude and ≥55% on small-local, at equal or smaller packets. QA accuracy on counts rises more than recall, per TallyMem's access/aggregation split.
   - **Kill if:** recall rises but QA drops because sentences lose needed detail. Then try sentence ±1.
2. **Event-date index plus split temporal queries.**
   - **Change:** at write time, chrono-node resolves relative dates in each user sentence against the session time, storing `said_at` and `about[]`. At query time, parse the question's time phrase against `question_date` and add a soft window *bonus* (SodaMem), not a filter. For "between A and B", "how long ago" and "before/after" questions, split on the event phrases and give each its own quota.
   - **Hypothesis:** temporal all-evidence recall rises from 77% to ≥85% on claude and from 69% to ≥78% on small-local.
3. **Prefetched date arithmetic.**
   - **Change:** label every dated packet item with its delta to `question_date` ("23 days before today's question date; a Tuesday").
   - **Hypothesis:** temporal *QA accuracy* rises without changing recall, more for small-local than claude (TReMu: weaker readers get less from writing code themselves, so do it for them).
   - **Test:** paired, items identical except for labels.
4. **Preference spans with category keys.**
   - **Change:** a regex detector marks first-person preference sentences ("I love / prefer / hate / I've been into / my favourite / I usually / I've been using") and tags each with a coarse category from a small lexicon or embedding nearest-neighbour. An intent rule ("recommend / suggest / tips / ideas / what should I") pulls the top 3-5 preference sentences for the question's category as ~30-token cards, beside normal retrieval.
   - **Hypothesis:** on all 30 LongMemEval_S preference questions, all-evidence recall rises by ≥20 points on small-local, where whole segments don't fit, and ≥10 on claude. Other types move by ≤1 point.
5. **Subject index and person cards.**
   - **Change:** an alias table (from the user's memory, kinship terms and capitalized names, with user-confirmed merges only and never automatic overwrites) points at span postings. Person-centric prompts get the card in section 4.
   - **Hypothesis:** on a new person-centric canary set (advice about a family member, "what did I say about X", "did that advice work"), packet-miss tool calls fall by half against plain retrieval. Score SocialMemBench's attribution category as an outside check (raw retrieval 0.82 and subject index 0.78 are the bars).
6. **Deterministic phrase graph + PPR as a gated third channel.**
   - **Change:** noun-phrase ↔ span bipartite graph (LazyGraphRAG index, HippoRAG retrieval without the LLM), seeded by query phrases, fused by RRF. Use it only for multi-session, aggregate and "what do I know about X" queries.
   - **Hypothesis:** +3-8 points multi-session recall on claude on top of idea 1, ~0 elsewhere.
   - **Kill if:** single-session types drop (GraphRAG-Bench says graphs add noise on lookups).
7. **Coarse supersession render, with history kept.**
   - **Change:** when a question asks about history ("before / originally / used to / first / changed"), include the superseded value on the same line as the current one, in time order. Otherwise drop it.
   - **Hypothesis:** KU QA accuracy goes up a few points with no recall change.
   - **Must have:** a render-matched control (same layout, no marks), because the render effect is 6x the mechanism effect in the one controlled study.
8. **Sleep-time fact keys, real chats only.**
   - **Change:** a Cloudflare cron job with a cheap model writes 1-3 "user fact" strings per user turn as *extra BM25 keys* (LongMemEval: +9.4% recall, best on multi-session), and drafts person cards. Every fact must quote its source span verbatim or be dropped (SodaMem).
   - **Hypothesis:** real-chat packet-miss rate drops. On LongMemEval, run it only as a labelled ablation, never in the headline "0 LLM calls" number.
