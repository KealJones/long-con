# Memory benchmarks

Which long-term memory benchmarks Long Con should try to beat with one message and a packet: the answering model sees only the packet plus the question, never the full history. Surveyed 2026-11-25.

**Read every score below as self-reported unless it says otherwise.** Vendors use different reader models, judges and prompts, so cross-vendor numbers rarely compare. Where an independent rerun exists, it's listed.

## Targets, in order

1. **LongMemEval_S, then _M.** The number everyone quotes, and its protocol already is "build a context, then answer once". Report it with gpt-4o as reader and the official judge so it compares; the reproduced bar is about 84-87%. _M (about 1.5M tokens per question) is where a packet should clearly beat full context.
2. **BEAM, 100K to 1M, then 10M.** Histories longer than any window, so the packet is the whole point. Its abilities (instruction following, preference following, contradiction resolution, knowledge update, abstention) map straight onto pinned rules and registers. Fewer vendors, less gamed, cheap per question.
3. **LoCoMo with the audited answer key, abstention scored, plus LoCoMo-Plus.** Reviewers expect LoCoMo and it's cheap (10 conversations). LoCoMo-Plus tests implicit constraints whose cue doesn't look like the question, at a low ceiling.

ConvoMem is the alternative third pick for a "beats full context while full context is still cheap" claim.

None of these test the resolver ("multiply it by 32", "the other one"). That needs our own eval; see [Gaps](#gaps).

## The main three

### LongMemEval (ICLR 2025)

| | |
| --- | --- |
| Tests | 500 questions, 7 types: single-session-user, single-session-assistant, single-session-preference, multi-session, knowledge-update, temporal-reasoning, abstention (30 false-premise) |
| Size | _S: ~115K tokens, ~50 sessions per question. _M: ~500 sessions, ~1.5M tokens per question. Oracle: evidence sessions only. Each question has its own haystack, so memory is rebuilt 500 times (~57M tokens of ingest for _S) |
| Get it | MIT. HF `xiaowu0162/longmemeval` (`longmemeval_s.json`, `_m.json`, `_oracle.json`). Code: [xiaowu0162/LongMemEval](https://github.com/xiaowu0162/LongMemEval). [Paper](https://arxiv.org/abs/2410.10813) |
| Judge | GPT-4o-2024-08-06, type-specific prompts, binary. Over 97% agreement with humans per the paper |
| Paper baselines | GPT-4o full context on _S 60.6% (64.0% with Chain-of-Note). Oracle 87.0% (92.4%) |

Top scores on _S:

| System | Reader | Score | Who measured |
| --- | --- | --- | --- |
| Mastra Observational Memory | gpt-5-mini | 94.87% | [Mastra](https://mastra.ai/research/observational-memory), Feb 2026 |
| Mastra Observational Memory | gpt-4o | 84.23% | Mastra; **reproduced at 84.2% by Redis** |
| Redis hybrid memory | gpt-4o | 86.5% | [Redis](https://redis.io/agent-memory-benchmark-report/), Sep 2026 (a vendor) |
| Oracle Agent Memory | gpt-4o | 86.0% (claimed 93.8%) | Redis rerun |
| Mem0 (new algorithm) | not stated | 93.4-94.4% claimed, 73.8% in a rerun | [Mem0](https://mem0.ai/blog/ai-memory-benchmarks), Apr 2026; rerun by [Maximem](https://dev.to/gaurav_dadhich/the-state-of-ai-memory-in-2026-claimed-vs-observed-1n94) (a vendor) |
| Supermemory | various | 81.6-94.0% claimed; 58.4% in MemOS's run | [Supermemory](https://supermemory.ai/research), [MemOS eval](https://huggingface.co/datasets/MemTensor/MemOS_eval_result/blob/main/README.md) |
| Hindsight | gemini-3-pro | 91.4% | [Vectorize](https://github.com/vectorize-io/hindsight-benchmarks) |
| Backboard | not stated | 91.2-93.4% | [Backboard](https://backboard.io/blog/backboard-io-becomes-first-ai-platform-to-lead-both-major-memory-benchmarks); judge and harness undisclosed |
| EverMemOS | GPT-4.1-mini | 83.0% | [arXiv 2601.02163](https://arxiv.org/abs/2601.02163) |
| Zep | gpt-4o | 71.2% | third-party table |
| Full context | gpt-4o | 60.2-60.6% | paper |

Fits "packet + one message": **yes.** Sessions arrive in order and the question comes once after them. Rules to keep: ingest must not see the question, pass `question_date`, keep assistant turns in the log (single-session-assistant questions ask about them), and treat oracle as an upper bound and ablation, never as a claimed score.

Flaws: _S fits in a modern window, so critics call it a context test more than a memory test. [StateMemBench](https://arxiv.org/abs/2608.19652) finds knowledge-update questions only partly check that a stale value was replaced. Top scores are near the ceiling.

### BEAM, "Beyond a Million Tokens" (ICLR 2026)

| | |
| --- | --- |
| Tests | 10 abilities: abstention, contradiction resolution, event ordering, information extraction, instruction following, knowledge update, multi-hop, preference following, summarization, temporal reasoning |
| Size | 100 conversations, 100K to 10M tokens. 2,000 questions (20 per conversation, 2 per ability). Ingest once, ask 20 |
| Get it | CC BY-SA 4.0. HF `Mohammadta/BEAM` (10M split not in the viewer). Code: [mohammadtavakoli78/BEAM](https://github.com/mohammadtavakoli78/BEAM). [Paper](https://arxiv.org/abs/2510.27246) |
| Scoring | Nugget-based, 0 / 0.5 / 1 per nugget from an LLM judge; event ordering by Kendall tau-b. Judge model not confirmed |
| Paper baselines | Best long-context 0.280 at 100K, 0.133 at 10M. The paper's LIGHT system 0.358 / 0.266 (Llama-4-Maverick) |

| System | 100K | 500K | 1M | 10M | Source |
| --- | --- | --- | --- | --- | --- |
| Hindsight | 73.4 | 71.1 | 73.9 | 64.1 | [Vectorize](https://hindsight.vectorize.io/blog/2026/04/02/beam-sota), Apr 2026 |
| Supermemory | 71.2 | 69.2 | 68.9 | | Supermemory |
| Honcho | 63.0 | 64.9 | 63.1 | 40.6 | vendor |
| Mem0 | | | 64.1 | 48.6 | Mem0, Apr 2026 |

Fits: **ideal.** The history can't fit, the abilities are what the registers are for, and the board is less crowded.

### LoCoMo (ACL 2024)

| | |
| --- | --- |
| Tests | Single-hop, multi-hop, temporal, open-domain, adversarial (category 5, abstention) |
| Size | Common release `locomo10.json`: 10 conversations, ~1,986 QA (~1,540 without category 5), ~9K-26K tokens and ~19 sessions each. Two personas talk, not a user and an assistant, so speakers need mapping |
| Get it | CC BY-NC(-SA) 4.0. [snap-research.github.io/locomo](https://snap-research.github.io/locomo) |
| Scoring | Paper used F1. Industry uses an LLM-judge "J" score with gpt-4o-mini |

Scores: EverMemOS 93.05; claimed Zep 94.7, Supermemory 93.0, Mem0 92.5, Backboard 90.0; full context with gpt-4o-mini 72.9 ([Zep's run](https://www.getzep.com/blog/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/)). A plain file plus grep in Letta scored 74.0% ([Letta](https://www.letta.com/blog/benchmarking-ai-agent-memory)).

Flaws, serious: [an audit](https://penfieldlabs.substack.com/p/we-audited-locomo-64-of-the-answer) found 6.4% of the answer key wrong (real ceiling ~93.6%, so higher claims are suspect) and the gpt-4o-mini judge accepts 62.8% of vague but on-topic wrong answers. Scripts: [dial481/locomo-audit](https://github.com/dial481/locomo-audit). The standard harness drops category 5, so abstention goes untested. Histories fit in context, so full context is a strong baseline.

Fits: mechanically yes, but a weak claim on its own. Use the corrected key, score category 5, and pair it with LoCoMo-Plus.

## Others worth knowing

| Benchmark | What it is | Get it | Top / note |
| --- | --- | --- | --- |
| **ConvoMem** ([arXiv 2511.10523](https://arxiv.org/abs/2511.10523)) | 75,336 QA over user facts, assistant facts, abstention, preferences, changing facts, implicit connections; history 2-300 conversations | HF `Salesforce/ConvoMem`, CC BY-NC 4.0, 27.5 GB | Full context 70-82%, ~65% at 300 conversations; Mem0 30-45% under 150. No leaderboard |
| **LoCoMo-Plus** ([arXiv 2602.10715](https://arxiv.org/abs/2602.10715)) | "Cognitive" questions (causal, state, goal, value) where the cue doesn't match the query | [xjtuleeyf/Locomo-Plus](https://github.com/xjtuleeyf/Locomo-Plus) | Gemini-2.5-pro 26.06, A-Mem 17.2, Mem0 15.8. Low ceiling; inherits LoCoMo key errors |
| **SCALE-QA** ([arXiv 2608.25655](https://arxiv.org/abs/2608.25655)) | Long flat threads with interleaved topics and no session breaks | paper | The closest match to one endless chat. Segmentation + hierarchical index beats RAG and long context by 5.6-17.6 pts |
| **StateMemBench** ([arXiv 2608.19652](https://arxiv.org/abs/2608.19652)) | 234 scenarios, 322 probes, gold answers computed by program | release not confirmed | Mem0 0.15-0.18, long context 0.149. Best fit for register correctness |
| **MemoryAgentBench** ([arXiv 2507.05257](https://arxiv.org/abs/2507.05257)) | Retrieval, test-time learning, long-range understanding, selective forgetting; 2,071 Q over 103K-1.44M tokens | HF `ai-hyz/MemoryAgentBench`, CC BY 4.0 | Best 49.6 (Claude 3.7 Sonnet long context). Mostly documents, not chat |
| **PersonaMem** ([arXiv 2504.14225](https://arxiv.org/abs/2504.14225)) | ~6K multiple-choice questions on evolving preferences, 32K-1M token histories | [bowen-upenn/PersonaMem](https://github.com/bowen-upenn/PersonaMem) | ~52% top. No judge needed, cheap |
| **LongMemEval-V2** ([arXiv 2605.12493](https://arxiv.org/abs/2605.12493)) | Web-agent trajectories, up to 115M tokens | paper | Protocol is literally Insert/Query returning a bounded context to a fixed reader. Agent experience, not chat |
| **EverMemBench** ([arXiv 2602.01313](https://arxiv.org/abs/2602.01313)) | Multi-party group chat, 2,400 QA | [EverMind-AI/EverMemBench](https://github.com/EverMind-AI/EverMemBench) | MemOS 42.6. Not one-on-one |
| **FrontierMemory** (Letta, Oct 2026) | 15 agent memory tasks | [write-up](https://thenewstack.io/letta-frontiermemory-agent-harness-benchmark/) | Letta 73.3%, OpenAI Agents SDK 40%, Claude Managed Agents 33.3%. Tiny, vendor-run |

Skipped as off target or legacy: MSC and DuLeMon (response generation, no QA), PerLTQA and MemSim (Chinese, generated), MemBench (synthetic multiple choice), MemoryBench (learning from feedback), Mem-Gallery (multimodal), EngramaBench (150 queries). Long-context tests like RULER, NoLiMa, HELMET and LongBench v2 aren't memory benchmarks, but NoLiMa (needles with no word overlap) is a good diagnostic for the retrieval step.

## Making the claim hold up

"We got this benchmark with one message and a packet" only lands if the run is clean:

- State the packet's token cap and report tokens per question next to accuracy.
- Name reader and judge models; use the official judge for the headline number.
- Ingest never sees the question. No benchmark-specific prompts (the main criticism of Mem0's numbers).
- Several runs with standard deviation.
- Report full context and oracle with the same reader, so the packet sits between a floor and a ceiling.
- Publish the harness so it can be rerun.

## Gaps

No public benchmark tests deterministic reference resolution: "multiply it by 32" meaning the last numeric result, "the second one" in a list from twenty turns ago, "go" meaning the last proposed action. Those come from our own pain-mined and canary sets in [evals](../../evals). SCALE-QA and StateMemBench are the nearest public ones (interleaved topics, state that must be updated, not appended).

## Not verified

BEAM's judge model; the judge for ConvoMem's main scores; exact LoCoMo QA counts (secondary sources); whether StateMemBench is released; Supermemory and Mem0 run details; an Exabase BEAM claim whose page wouldn't load. Facts on the skipped benchmarks come from earlier knowledge, not a fresh read.
