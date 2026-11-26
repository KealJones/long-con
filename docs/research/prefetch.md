# Doing the model's lookups before it asks

Long Con's packet isn't only memory. The model has tools to search the chat, read memory and open files, and the packet builder runs the lookups the model would most likely make, at compute speed with no model deciding, so the model starts with the exact past answer, file line or earlier result already in hand. This doc collects the research on that idea, what scored well, which benchmarks can be run as one message plus a packet, and where the evidence pushes back on the plan. Researched 2026-11-25.

## Top three findings

1. **Pre-running predictable lookups works, and nobody needs a model to pick them.** PASTE mined common tool-call patterns and ran them ahead of time with no model in the loop, cutting task time by about half. Sleep-time compute did the thinking before the question arrived and needed about five times less compute when the question was predictable.
2. **A cheap one-pass retriever finds the right file about as well as an agent, for a few percent of the cost, but it rarely finds the right line.** SweRank matched an agent's file accuracy at about a cent per task. Line-level accuracy is poor everywhere, so the packet should only quote a line when the user named it, and should otherwise hand over whole functions or blocks plus pointers.
3. **Wrong or always-on context hurts more than no context.** Retrieving on every question scored below never retrieving in one well-known study, and past context an agent picked for itself lowered success. So the packet needs a gate, a packet-off comparison, and a harm rate measured alongside the work it saves.

## What this is called elsewhere

The idea shows up under several names, none of which covers the whole thing:

- **Speculative tool execution:** run a tool call before the model asks for it.
- **Sleep-time or offline compute:** do the work between turns.
- **Adaptive retrieval:** decide per question whether to retrieve at all.
- **Code localization and repository context:** find the files and lines a coding task needs.
- **Context pruning and observation masking:** shrink what goes in.
- **Conversational query rewriting and reference resolution:** turn "multiply it by 32" into a standalone request.
- **Entity linking and alias expansion:** "my repo" or a misspelled name to the right thing.

Nobody has put these together into a per-turn packet for an endless chat. [prior-art.md](prior-art.md) covers the memory side.

## Running tools before the model asks

| Work | What it does | Result |
| --- | --- | --- |
| [PASTE](https://arxiv.org/abs/2603.18897) | Mines frequent tool-call patterns, pre-runs them with no model in the loop | 48.5% lower completion time. **Closest analogue to the packet builder** |
| [Speculative Actions](https://arxiv.org/abs/2510.04371) | A small model guesses the next action | Guesses right about 55% of the time, latency down about 20% |
| [AOSpec](https://arxiv.org/abs/2608.00881) | Speculates several steps ahead | Accuracy falls from 23.7% to 7.7% at ten steps ahead. **Only the first hop is predictable** |
| [Speculative Interaction Agents](https://arxiv.org/abs/2605.13360) | Fires lookups on partial input while the user is still typing | 1.3-1.7x faster. Read-only lookups only, never writes |
| [DSP](https://arxiv.org/abs/2509.01920) | Tracks what wrong guesses cost | 60% of speculative cost was unnecessary before tuning |
| [Sherlock](https://arxiv.org/abs/2511.00330) | Injects a result first, verifies it in the background | Fast path plus a correction path |
| [LLMCompiler](https://arxiv.org/abs/2312.04511) | Plans tool calls up front and runs them in parallel | Up to 3.7x lower latency |
| [Sleep-time compute](https://arxiv.org/abs/2504.13171) | Pre-computes over context before the question arrives | About 5x less test-time compute; gains grow with how predictable the question is |
| [Agentic plan caching](https://arxiv.org/abs/2506.14852) | Reuses plans from similar past tasks | About 50% lower cost |
| [Don't Break the Cache](https://arxiv.org/abs/2601.06007) | Prompt caching in agents | 41-80% lower cost, 13-31% faster first token, as long as changing content goes last |

The pattern: deterministic or mined prefetch is cheap and safe for read-only lookups one step ahead. Guesses further out mostly miss.

## When context helps and when it hurts

- **[Adaptive-RAG](https://arxiv.org/abs/2403.14403):** with GPT-3.5, always retrieving scored F1 46.99, below never retrieving at 48.56. A small classifier that chose per question scored 50.91 at about one retrieval step.
- **[ADAPT-LLM](https://arxiv.org/abs/2404.19705):** adding context to questions the model already knows costs 5-7 points.
- **[WiTQA](https://arxiv.org/abs/2402.13492):** retrieval hurts on popular facts the model already holds and helps on rare ones.
- **[CODEFILTER](https://arxiv.org/abs/2508.05970):** of the top ten retrieved code chunks, about 15% help and 5.6% hurt; about 20% of tasks get at least one harmful chunk. Filtering gained 3 points of exact match with 80% less context.
- **[SWE-ContextBench](https://arxiv.org/abs/2602.08316):** a correct short summary of a related past task raised the resolve rate from 26.3% to 34.3%. Past context the agent picked for itself dropped it to 22.2%, below having none.

For Long Con's own history these numbers are softer, since a model never "already knows" what was said last week. But they apply directly to files, general facts and stale or wrong pulls.

## Files and lines

| Work | Finding |
| --- | --- |
| [LocAgent](https://arxiv.org/abs/2503.09089), SWE-bench Lite file accuracy in the top 5 | BM25 61.7, embeddings 80.3, CodeRankEmbed 84.7, agent on Qwen 32B 92.7 ($0.09), agent on Claude 3.5 94.2 ($0.66) |
| [SweRank](https://arxiv.org/abs/2505.07849) | One pass of embed plus rerank: file 94.2, function accuracy in the top 10 88.7, at $0.011-0.015 per task. **Matches the agent for a few percent of the cost** |
| [Agentless](https://arxiv.org/abs/2407.01489) | Fixed pipeline, no agent loop: 32% on SWE-bench Lite |
| [SWE-Fixer](https://arxiv.org/abs/2501.05040) | BM25 alone gets the right file in the top 3 56.7% of the time and the top 30 86.7%, with 2 model calls instead of 29 or more |
| [ContextBench](https://arxiv.org/abs/2602.05892) | 1,136 tasks with gold context marked at file, block and line. File recall 0.68-0.73, line F1 only 0.13-0.38. Agents found the gold context and then dropped it about 43% of the time |
| Vector index vs grep ([2608.01507](https://arxiv.org/abs/2608.01507)) | Agent with a vector index 65.2% vs grep 46.2%, using 34K vs 761K tokens |
| Line inline vs location only ([2608.13568](https://arxiv.org/abs/2608.13568)) | Returning the matching line itself raised pass rate 67% to 83% and cut file reads from 15.2 to 3.2. Tiny sample |
| Per-file summaries ([2607.11046](https://arxiv.org/abs/2607.11046)) | A one-line role per file raised top-5 hits by 40% |
| [Long Code Arena](https://arxiv.org/abs/2406.11612) | The nearest files in the folder tree raised exact match by 53% on project lines |

Practice is split. Claude Code chose agentic search over an index because indexes drift and raise security questions. Cursor reports grep plus semantic search beat either alone by 12.5%.

## Shrinking what goes in

| Method | SWE-bench success |
| --- | --- |
| No pruning ([SWE-Pruner](https://arxiv.org/abs/2601.16746) baseline) | 62% |
| LLMLingua-2 token compression | 54% |
| RAG chunks | 50% |
| Model-written summary | 56% |
| SWE-Pruner, keeps whole lines, guided by the goal | 64% at 0.67M tokens |

- **[Squeez](https://arxiv.org/abs/2604.04979):** a 2B line selector kept 86% of the needed lines at 92% compression, against 22% for BM25 and 14% for "first 10%".
- **[The Complexity Trap](https://arxiv.org/abs/2508.21433):** hiding old tool outputs and leaving a placeholder roughly halves cost and matches summarization, and summaries made runs 15% longer.
- **[ACON](https://arxiv.org/abs/2510.00615)** and **[Provence](https://arxiv.org/abs/2501.16214)** (a 0.4B pruner removing 50-80% with no loss) point the same way.

Whole lines and blocks beat token-level compression and summaries. Masking plus a pointer beats rewriting.

## Resolving references and rewriting the turn

- **[MTRAG](https://arxiv.org/abs/2501.03468)** (IBM, 110 conversations, 842 tasks): a standalone rewrite beat both the last turn alone and the full history as the search query, for every retriever. Later turns are much harder: top-5 recall 0.89 on first turns vs 0.47 later.
- **[CORAL](https://github.com/Ariya12138/CORAL)** (8K conversations): compressing history from 2,226 to 478 tokens cost little in answer quality and improved citations. About four turns of history was best; eight made it worse. A fine-tuned 1.5B rewriter beat a GPT-3.5 one.
- **[ConvSearch-R1](https://arxiv.org/abs/2505.15776):** a 3B rewriter trained by reinforcement learning on whether the gold passage ranks high is the current best. On QReCC with BM25 it scores MRR@3 56.5, while **perfect human rewrites score only 39.8**. Faithful resolution isn't the same as the best search query.
- **[DiSCo](https://arxiv.org/abs/2410.14609):** an encoder that reads the whole conversation, with no rewrite step, takes about 350 ms against 550 ms for a T5 rewriter and 2.5-4.6 s for an LLM rewriter. It wins in-domain and loses out of domain.
- **[QuReTeC](https://arxiv.org/abs/2005.11723):** a small classifier picks which earlier terms to add to the query. Cheap and learnable from relevance labels.
- **[CREAD](https://arxiv.org/abs/2105.09914)** (Apple, about 148M parameters): coreference and rewriting together, reference match 82.0 vs 63.2 for a seq2seq baseline. Code and data released.
- **[ReALM](https://arxiv.org/abs/2403.20329)** (Apple) picks the referenced entity from a typed list of candidates:

| Model | Conversational | From a list | On screen | Unseen domain |
| --- | --- | --- | --- | --- |
| MARRS, classical non-LLM | 92.1 | 99.4 | 83.5 | 84.5 |
| ReALM 80M | 96.7 | 99.5 | 88.9 | 99.3 |
| GPT-4 | 97.0 | 58.7 | 90.1 | 98.4 |

- **[Alexa slot carryover](https://arxiv.org/abs/1806.01773):** rules were precise (91.8%) but caught only 67.1% of carry-overs. A small LSTM caught 94.7%. Copying the last turn scored F1 28.7.

## Names and aliases

- **[Personal entity linking](https://arxiv.org/abs/2206.07836):** spotting "my X" by rule scores F1 0.90. Linking it to the right thing scores only 0.59-0.66, even with a coreference model.
- **Garbled names** ([Amazon, EMNLP Industry 2024](https://aclanthology.org/2024.emnlp-industry.1.pdf)): off-the-shelf embeddings found the right entity for misheard names only 7.5% of the time (MRR); a fine-tuned matcher reached 47.7%. Aliases were built offline, adding 0.07-0.4 ms at run time, and cut failures 10-14%.
- **[Character plus phoneme retrieval](https://aclanthology.org/D19-3011/)** for person names raised accuracy 40.8% in production.
- **Fuzzy name matching** on records: edit distance alone scores F1 about 0.73 ([SGER](https://arxiv.org/html/2605.23597v1)); fine-tuned small models reach 0.99.

## Benchmarks that run as one message plus a packet

| Benchmark | What it tests | Fit |
| --- | --- | --- |
| [BFCL v4](https://gorilla.cs.berkeley.edu/leaderboard.html) memory category | Memory already filled in, no chat history, the model must use it. Best scores 54% (key-value), 64% (vector), 68% (summary) | **Best direct packet test.** Swap the memory backend for the packet builder |
| [ContextBench](https://arxiv.org/abs/2602.05892) | Gold file, block and line context for coding tasks | **Best packet-scoring test for files.** Score the packet's file, block and line recall directly, no agent run needed |
| SWE-bench Lite and Loc-Bench | File and function localization | Score packet file accuracy against SweRank and LocAgent |
| [MTRAG](https://github.com/ibm/mt-rag-benchmark) | Multi-turn retrieval, already "turn plus context" | Tests the resolver's standalone query |
| [QReCC](https://github.com/apple/ml-qrecc), [TopiOCQA](https://arxiv.org/abs/2110.00768), CORAL | Rewrite quality and retrieval MRR | Score the resolver's output against human rewrites. CORAL already compares history-compression strategies |
| MuDoCo and CREAD data | Coreference in six assistant domains | Tests the resolver head-on |
| [τ²-bench](https://github.com/sierra-research/tau2-bench) (MIT) | Customer-service agent tasks with tools | Count tool calls saved at equal success |
| MCPMark, MCP-Bench, MCP-Universe | Real MCP tool use; MCPMark averages 16.2 turns and 17.4 calls per task | Turns and calls per task are published, so work saved is easy to show |
| [HAL](https://arxiv.org/abs/2510.11977) logs | Published agent traces | Replay offline to see which calls the packet would have pre-run |

The memory benchmarks in [memory-benchmarks.md](memory-benchmarks.md) (LongMemEval, BEAM, LoCoMo) remain the headline targets. These add the "work saved" and "reference resolved" sides.

## Work-saved metrics

Report these next to accuracy, against a packet-off run of the same tasks:

- **Tool calls avoided** and **turns saved** per task.
- **Packet precision and recall:** of what the model ended up using, how much was already in the packet, and how much of the packet it used.
- **Redundant re-fetches:** the model calls a tool for something already in the packet.
- **Wasted prefetch cost:** lookups run that nothing used.
- **Harm rate:** tasks that pass with the packet off and fail with it on.
- **Tokens, cache hit rate and time to first token.**
- **Cost-of-pass** ([Efficient Agents](https://arxiv.org/abs/2508.02694), [Cost-of-Pass](https://arxiv.org/abs/2504.13359)): cost per correct answer, and pass^k for consistency.

## Against Long Con's pieces

| Piece | What the evidence says | Verdict |
| --- | --- | --- |
| **Deterministic resolver** | Rules are precise but miss about a third of carry-overs (Alexa). An 80M trained model beat the classical resolver everywhere (ReALM) | Keep rules first, but let the resolver say "unresolved" instead of guessing, and test a tiny trained resolver (CREAD or ReALM-80M size) against it |
| **Registers** | Picking from a typed list is nearly solved (99% in ReALM); free-form linking is not (0.59-0.66) | **Strongly supported.** Registers turn hard linking into list picking |
| **Retrieval order** | A standalone query beats raw history (MTRAG); retrieval-tuned queries beat faithful ones (ConvSearch-R1) | Keep resolve-then-search, but expand the search query with aliases and terms from history rather than searching the resolved sentence alone |
| **Retrieval every turn** | Always retrieving can score below never retrieving (Adaptive-RAG); harmful chunks show up in 20% of code tasks | **Challenged.** Add a cheap gate and a relevance cutoff, so a turn can carry no retrieved spans at all |
| **Trim to hit messages plus a neighbor** | Whole lines and blocks beat fragments (SWE-Pruner); Threader lost 4.8 points returning messages instead of whole segments | **Challenged.** Keep whole segments, functions or blocks, and drop whole ones to fit |
| **Files with path:line** | File finding is cheap and good; line finding is poor (ContextBench); the matching line inline saves reads | Quote a line only when the user typed the path:line or a symbol resolves to it exactly. Otherwise hand over whole blocks plus pointers. Re-read from disk every turn and check a hash, since files change |
| **Names index** | Generic embeddings fail on misspelled names (7.5%); offline aliases cost nothing at run time | Phonetic keys, character n-grams and aliases learned from past misses, built offline |
| **URL fetch** | Read-only prefetch is safe; writes never are (Speculative Interaction Agents) | Fetch only URLs in the new message, read-only, one hop, and fit them to budget |
| **Pointers and masking** | Masking old tool output plus a placeholder matches summaries at half the cost | **Supported.** Pointers over summaries |
| **Matching tools and the history notice** | Agents drop gold context they already had (43%) and re-fetch | Supported. Count re-fetches of what the packet held as their own metric |
| **Prompt caching** | Changing content first breaks the cache | Supported by the current order: rules first, changing parts last |
| **Lean ~3K packet** | Context past about four turns made rewriting worse (CORAL), but Threader needed 12 segments | Still open. Report accuracy against packet size |
| **Prefetch depth** | Prediction falls fast past one step (AOSpec) | Pre-run only the first hop. Anything deeper is the model's job |

## Challenges to the plan

1. **Add a packet-off arm to the evals.** Every positive result here was measured against no prefetch. The three current arms all give the model history; a fourth arm with only the message and the tools would show what the packet actually saves and when it hurts.
2. **Gate retrieval.** "Retrieval every turn" conflicts with the adaptive-retrieval results. A turn that needs nothing should get nothing but rules and the topic window.
3. **Return whole units.** The current "hit messages plus a neighbor or two" trim goes against both the code-pruning and Threader results.
4. **Line quotes need proof.** Only a typed path:line, or an exact symbol match, earns a quoted line. Everything else is a block plus a pointer, re-read fresh with a hash check.
5. **The resolver needs an "I'm not sure" answer** and probably a tiny trained model behind the rules, since a silent miss leaves out what the model needed.
6. **Track harm, not just recall.** A wrong pull costs more than a missing one, so the evals need a harm rate and wasted-prefetch cost next to packet recall.

## Not verified

- Several 2026 papers above were read through search results and abstracts, not in full.
- TopiOCQA and CANARD sizes and licenses, and the TREC iKAT 2024 numbers, weren't checked against the primary sources.
- No latency figures were published for ReALM.
- The Claude Code and Cursor positions come from public posts, not papers.
