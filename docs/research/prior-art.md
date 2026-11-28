# Prior art

Who has already tried rebuilding context each turn, assembling packets, or giving long chats a memory. Deep pass 2026-11-25; benchmarks are in [memory-benchmarks.md](memory-benchmarks.md).

## Short answer

**Nobody has shipped or published the whole idea:** a fresh, self-contained packet every turn, built from a lossless log with typed registers, plus a deterministic resolver for "it", "that one" and "multiply it by 32". The pieces all exist separately:

- **Closest design: Threader** (paper, [close read](threader.md)). Raw turns as memory, topic segments, hybrid retrieval, zero LLM calls to build memory, 90.6% on LongMemEval. No registers, no reference resolver, no per-turn rebuild of rules or state.
- **Closest product: Supermemory Infinite Chat.** A proxy that prunes and backfills the prompt per conversation. No reference handling, no published accuracy for that mode.
- **Closest open-source assembler: LlamaIndex Memory.** Tagged memory blocks merged into each turn's prompt with priority-based truncation, pinned blocks never dropped. Still sits on top of a normal chat buffer.
- **Closest reference resolution: SMCalFlow and ReALM.** Typed resolution over earlier computed values and candidate lists. Task dialogue, not open chat.
- **Strongest argument for rebuilding at all: "LLMs Get Lost in Multi-Turn Conversation".** Same task fed piece by piece across turns loses 39%; consolidated into one fresh prompt it keeps ~95%.

## Is retrieval actually bad, or were those retrievers bad?

Mostly the retrievers and the setups. The "full context wins" results compare against weak builds:

- **ConvoMem** (full context 70-82% vs 30-45%) tested one memory system, Mem0, with no settings reported and no plain chunk-RAG, BM25, hybrid or reranker baseline. "Full context beats RAG" there means "full context beats Mem0".
- **Mem0's own paper** lists full context first (72.9 on LoCoMo), but its "best RAG" baseline is 2 chunks of 256 tokens.
- **Same system, different hands:** Zep went from 65.99 to 75.14 when set up correctly. Mem0 went from ~67 to a claimed 92.5 after changing retrieval and extraction. Supermemory's LongMemEval scores range 58-94% depending on who ran them. A plain file plus grep in Letta scored 74% on LoCoMo, above Mem0's original number.
- **Retriever choice alone moves results:** SeCom found BM25 beats a dense retriever by up to 12 points on LoCoMo. RMM gained ~5 points swapping Contriever for GTE and ~7 more from a reranker, and still sat 17 points under perfect retrieval.
- **Rewriting memory loses information:** LongMemEval found breaking turns into extracted facts lowers QA. Threader's no-rewrite memory beats every rewriting system. A 2026 study of six explicit memory systems ([arXiv 2610.24671](https://arxiv.org/abs/2610.24671)) found only local gains over strong raw-history RAG, with retrieval "a major bottleneck".
- **Packets beat full context when built well:** SeCom beats full history at ~4-28% of the tokens; LightMem beats full text at up to 38x fewer tokens, and plain RAG tied it on one model. LongMemEval's own oracle (evidence only) nearly doubles small-model accuracy: Llama 3.1 8B goes from 0.454 to 0.710.

That matches our own experiments: hand-built packets 12/12, automated small-model packets 1-3/12. The gap is retrieval and packet layout, not the idea. Small models also make query expansion worse (LongMemEval, Llama 3.1 8B) and get hurt by fancier reading prompts, which argues for a deterministic resolver and builder rather than asking the 1.7B model to do it.

## Papers: context construction and long-chat memory

| Paper | What it does | Key result | Relevance |
| --- | --- | --- | --- |
| **Threader** ([arXiv 2609.33226](https://arxiv.org/abs/2609.33226), Sep 2026) | Raw turns kept as memory; tiny BERT segments topics as turns arrive; indexes user-only, assistant-only and full text; dense + BM25 + cross-encoder; returns whole segments | LongMemEval 90.6% (GPT-5-mini) vs EverMemOS 84.8, HippoRAG2 75.0, Mem0 57.2. R@12 93.4. 0 LLM calls to build vs 48 (Mem0) and 1,415 (A-Mem) per 100K tokens | Closest design. No full-context baseline, weaker on preferences spread over turns, no link back to older threads |
| **SeCom** ([arXiv 2502.05589](https://arxiv.org/abs/2502.05589), ICLR 2025) | Topic segments, compressed with LLMLingua-2 | LoCoMo 71.6 vs full history 54.2 at ~3.7K vs 13.3K tokens; Long-MT-Bench+ 88.8 vs 63.9 at 820 vs 19.3K tokens | "Topic window + raw spans" in paper form |
| **LongMemEval** ([arXiv 2410.10813](https://arxiv.org/abs/2410.10813), ICLR 2025) | Benchmark plus memory design study | Fact-augmented keys +9.4% recall, +5.4% QA; time-aware query expansion +7-11% temporal recall with GPT-4o, slightly worse with Llama 3.1 8B | Index whole rounds, add facts as keys, don't replace turns with facts |
| **ConvoMem** ([arXiv 2511.10523](https://arxiv.org/abs/2511.10523), Salesforce) | Full context vs Mem0 across 2-300 conversations | Full context 70-82% vs Mem0 30-45%; full context cost rises to ~$0.09 per query and ~23 s at 300 conversations | Sets the bar: match full context while it's cheap, beat it on cost and length |
| **RMM** ([arXiv 2503.08026](https://arxiv.org/abs/2503.08026), ACL 2025) | Multi-granularity memory, RL-trained reranker from what the model cites | LongMemEval 70.4-73.8% vs long context 57.4%, plain RAG 58.8-63.6%, perfect retrieval 90.2% | Reranking is worth points |
| **LightMem** ([arXiv 2510.18866](https://arxiv.org/abs/2510.18866), ICLR 2026) | Filter, group by topic, consolidate offline | LongMemEval 68.6-73.2% vs full text 36.7-56.8%, up to 117x fewer tokens at answer time | Plain RAG tied it on GLM-4.6 |
| **LLMs Get Lost in Multi-Turn Conversation** ([arXiv 2505.06120](https://arxiv.org/abs/2505.06120)) | Same task sharded across turns vs one prompt | -39% average when sharded; GPT-4o 93.0 one prompt vs 59.1 sharded; recap at end 76.6 | Direct support for a fresh self-contained prompt each turn |
| **Context Rot** ([Chroma](https://www.trychroma.com/research/context-rot), Jul 2025) | 18 models on growing inputs | Focused ~300-token prompts beat ~113K full prompts on LongMemEval; distractors hurt | Why the packet stays small |
| **SCALE-QA / TSIM** ([arXiv 2608.25655](https://arxiv.org/abs/2608.25655)) | Long flat threads with interleaved topics, no session breaks | Segmentation + hierarchical index beats RAG and long context by 5.6-17.6 pts | Matches the one-endless-chat setting; also an eval |
| **Explicit memory vs raw RAG** ([arXiv 2610.24671](https://arxiv.org/abs/2610.24671), Oct 2026) | Six memory systems vs strong raw-history RAG on LongMemEval-S and BEAM-100K | Only localized gains; failures are lossy building or failed retrieval | Backs raw spans over rewritten memory |
| **Mem0** ([arXiv 2504.19413](https://arxiv.org/abs/2504.19413)) | LLM extracts facts per message pair, then ADD/UPDATE/DELETE/NOOP | LoCoMo 66.9 vs full context 72.9 at 1.8K vs 26K tokens | Rewriting approach; see the dispute below |
| **MemTree** ([arXiv 2410.14052](https://arxiv.org/abs/2410.14052)) | Tree of summaries updated per turn | Loses to full context on 15-round chats, wins on 200-round | The crossover depends on length |
| **HippoRAG 2** ([arXiv 2502.14802](https://arxiv.org/abs/2502.14802), ICML 2025) | Knowledge graph + PageRank | ~7% over best embedding model on associative tasks | Associative hops for lists and references |
| **MemAgent** ([arXiv 2507.02259](https://arxiv.org/abs/2507.02259), ICLR 2026) | RL-trained fixed-size memory overwritten while reading | Under 5% loss out to 3.5M tokens | Same "rebuilt fixed budget" idea, for documents |
| **Memory-R1** ([arXiv 2508.19828](https://arxiv.org/abs/2508.19828)) | RL-trained memory manager and reader from 152 QA pairs | LoCoMo 62.7 with Llama 3.1 8B vs Mem0 45.7 (table looks inconsistent, check before citing) | A small model can learn the builder job later |
| **BEAM / LIGHT** ([arXiv 2510.27246](https://arxiv.org/abs/2510.27246)) | Episodic + working memory + scratchpad | +3.5-12.7% over best baselines up to 10M tokens | Benchmark and baseline |
| **Conversation disentanglement** ([arXiv 2112.05346](https://arxiv.org/abs/2112.05346)) | Link prediction ("what does this turn reply to?") then clustering, mostly on IRC | Established area | Linking a turn back to an older thread |

Older work (MemoryBank, RecurrentGPT, Think-in-Memory, MemGPT, recursive summarization, Lost in the Middle) doesn't report beating a strong full-context baseline. [Summary-only memory underperforms](https://proceedings.iclr.cc/paper_files/paper/2025/file/e56f394bbd4f0ec81393d767caa5a31b-Paper-Conference.pdf) on long-term conversation benchmarks.

## Papers: references with nothing to point at

The "no-reference references" problem is called conversational query rewriting, incomplete utterance rewriting, or reference resolution.

| Work | How | Result | Takeaway |
| --- | --- | --- | --- |
| **CANARD, QReCC, TREC CAsT** | Human-written standalone rewrites; the standard data and eval | ~40K rewrites (CANARD), ~14K dialogs (QReCC) | Ready-made test data for a resolver |
| **T5QR** ([arXiv 2004.01909](https://arxiv.org/abs/2004.01909)) | T5 fine-tuned on CANARD | QReCC dense MRR ~34.5 | The usual model-based baseline |
| **InfoCQR** ([arXiv 2310.09716](https://arxiv.org/abs/2310.09716)) | ChatGPT rewrites, distilled into T5 | QReCC BM25 MRR 49.4 vs 39.8 for human rewrites | Adding retrieval-friendly terms beats just resolving the reference |
| **LLM4CS** ([arXiv 2303.06573](https://arxiv.org/abs/2303.06573)) | Several LLM rewrites + hypothetical answers, embeddings averaged | Beats human rewrites on CAsT-19/20/21 | Expensive but strong |
| **CHIQ** ([arXiv 2406.05013](https://arxiv.org/abs/2406.05013), EMNLP 2024) | 7B model cleans history first: resolve ambiguity, expand last answer, detect topic switch, summarize; then rewrite | TopiOCQA MRR 38.0 vs LLM4CS 27.7; removing topic-switch detection drops 33.2 to 20.0 | Topic segmentation is the biggest single lever |
| **RUN** ([arXiv 2009.13166](https://arxiv.org/abs/2009.13166)) | Predicts word-level edits that copy spans from history | ~4x faster than seq2seq | Constrained model, closer to deterministic |
| **MuDoCo** (LREC 2020) | 8,429 dialogs with cross-task references | Data | Another resolver test set |
| **ReALM** ([arXiv 2403.20329](https://arxiv.org/abs/2403.20329), Apple) | Tiny model picks from a candidate list (on-screen, conversation, background), list items carry position | 80M model 96.7 vs GPT-4 97.0 on conversational refs | Deterministic candidates + small picker = our registers |
| **SMCalFlow / dataflow dialogue** ([arXiv 2009.11423](https://arxiv.org/abs/2009.11423)) | Each utterance is a program over a graph of earlier computations; `refer` and `revise` reuse nodes | Stock seq2seq matches purpose-built state trackers on MultiWOZ | The published form of "it = the last numeric result" |

No fully deterministic resolver is competitive on open-domain rewrite benchmarks. The strongest pattern is a hybrid: a deterministic step builds typed candidates (registers), a small model or rule picks one. Every product that resolves references today does it with an LLM rewrite before retrieval (LlamaIndex condense-plus-context, LangChain history-aware retriever, EverMemOS).

## Products and open source

| System | What it does each turn | How close | References? | Reported results |
| --- | --- | --- | --- | --- |
| **Supermemory** ([Infinite Chat](https://supermemory.ai/blog/faster-smarter-reliable-infinite-chat-supermemory-is-context-engineering/), [router docs](https://supermemory.ai/docs/memory-router/overview.md)) | Infinite Chat: proxy prunes context and backfills with a summary of done work, a pending diff, stored tool calls and relevant chunks. Current SDK: searches memories from each raw user message and attaches them | Infinite Chat is the nearest product; the SDK is add-on memory | No; searches on the raw message | LongMemEval-S claimed 81.6-94.0%; a 97% figure looks like Recall@20; MemOS's run 58.4% |
| **Mem0** ([dispute](https://www.getzep.com/blog/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/), [2026 claims](https://mem0.ai/blog/ai-memory-benchmarks)) | Extract facts, update store, inject top memories | Add-on | No | LoCoMo 66.9 (2025), claimed 92.5 (2026); LongMemEval claimed 94.4, rerun 73.8; BEAM-1M 64.1 |
| **Zep / Graphiti** ([arXiv 2501.13956](https://arxiv.org/abs/2501.13956)) | Temporal knowledge graph | Add-on | No | LongMemEval 71.2% (third party); LoCoMo 75.1 per Zep's corrected run |
| **Letta / MemGPT** ([memory](https://www.letta.com/blog/agent-memory)) | Pinned editable core blocks + recent buffer; ~70% evicted with recursive summary when full; agent pages archival memory with tools | Pinned blocks are like our rules and registers, but the agent chooses what to page in | No | LoCoMo 74.0% with plain files + grep; FrontierMemory 73.3% (own benchmark) |
| **Mastra Observational Memory** ([research](https://mastra.ai/research/observational-memory)) | Background agents rewrite history into an observation log that replaces it; avoids per-turn retrieval to keep the prefix cacheable | Opposite philosophy (summary) | No | LongMemEval-S 84.2% gpt-4o (reproduced by Redis), 94.9% gpt-5-mini |
| **Hindsight** ([arXiv 2512.12818](https://arxiv.org/abs/2512.12818)) | Facts, experiences, entity summaries, beliefs; retain, recall, reflect | Agentic retrieval | No | LongMemEval 91.4%, BEAM 64-74 (self-reported) |
| **EverMemOS** ([arXiv 2601.02163](https://arxiv.org/abs/2601.02163)) | MemCells and MemScenes; agentic recall with sufficiency checks | Agentic retrieval | Yes, LLM query rewriting | LoCoMo 93.05, LongMemEval 83.0 (self-reported) |
| **MIRIX-2.0** ([arXiv 2611.12068](https://arxiv.org/abs/2611.12068)) | Six typed memory agents + provenance hypergraph | Typed memory, agentic | Not stated | LongMemEval-S 72.6, LoCoMo 91.4 |
| **MemOS, Memobase, Backboard, Honcho, Cognee, A-Mem** | Various add-on memory stores | Add-on | No | Mostly self-reported; Backboard and MemOS don't name judges |
| **LlamaIndex Memory** ([docs](https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/memory/)) | FIFO buffer; overflow flushed to static, fact and vector blocks merged into tagged sections, truncated by priority | Closest open-source assembler | Separate condense-plus-context engine rewrites with an LLM | None |
| **OpenAI Agents SDK sessions** ([cookbook](https://developers.openai.com/cookbook/examples/agents_sdk/session_memory)) | Trim to last N turns, or summary + last N | Compaction | No | None; warns constraints and IDs can vanish |
| **ChatGPT memory** ([reverse-engineered](https://llmrefs.com/blog/reverse-engineering-chatgpt-memory)) | Saved memories + summaries of ~15 recent chats + current session, trimmed first | Add-on, no per-query retrieval over past chats | No | None |
| **Claude memory** ([write-up](https://simonwillison.net/2025/Sep/12/claude-memory/)), **context editing + memory tool** ([Anthropic](https://claude.com/blog/context-management)) | Search tools over raw past chats; context editing clears stale tool results; memory files outside the window | Add-on and pruning | No | +39% with both on internal evals, 84% fewer tokens on a 100-turn task |
| **Claude Code compaction** ([unofficial](https://finisky.github.io/en/claude-code-context-compaction)) | Near the limit, swaps history for a maintained notes file (state, spec, errors, worklog) plus recent tail, re-reads recent files | Structurally the most packet-like shipped thing, but only at the limit | No | None |
| **llama.cpp #27713** ([discussion](https://github.com/ggml-org/llama.cpp/discussions/27713), Aug 2026) | Proposal: compact older content into structured summaries near the limit, keep full history, retrieve on demand | Compaction + retrieval idea | No | No replies |
| **Dots (OpenAI), Grok Bot (xAI)** | Always-on agents | You still name or juggle threads; vendor-held memory | | |

## What to borrow

- **From Threader:** raw spans, incremental topic segmentation with a tiny classifier, three indexes (user, assistant, both), dense + BM25 + cross-encoder, return whole segments.
- **From CHIQ:** topic-switch detection is worth more than any rewrite trick.
- **From LongMemEval:** facts as extra index keys, not replacements; time-aware expansion only with a strong model.
- **From ReALM and SMCalFlow:** registers as typed candidate lists with positions; resolve "it" to a node, not a string.
- **From LlamaIndex:** priority-ordered sections, pinned ones never truncated.
- **From the disputes:** publish the harness and settings, or the numbers won't be believed.

**Beep's own part:** one thread forever that sorts itself, full-detail recall from a lossless log you own, deterministic references, and resurfacing what you forgot.

## Not verified

Most product numbers are vendor-reported. Not re-read this pass: Gemini memory, LangMem, Memary, LangGraph memory, LLM4CS and RUN full tables, MuDoCo baselines, RMM's reader model, Context Rot's exact LongMemEval figures. Memory-R1's table looks internally inconsistent.
