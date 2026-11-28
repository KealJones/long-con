# Agent benchmarks for the packet

Which public coding-agent, code-search and web-lookup benchmarks are worth pulling down to test the packet, and how to run them so each run says two things: the normal benchmark score (the agent still wins with its own tools when the packet misses), and the share of tasks solved with **zero tool calls** because the packet already held what was needed. Surveyed 2026-11-28. Builds on [prefetch-evals.md](prefetch-evals.md) and [prefetch.md](prefetch.md) and doesn't repeat them.

## Bottom line

Pull down three, in this order:

1. **ContextBench (Verified, 500 tasks).** Free. Gold context is marked at file and line, so the packet's code source can be scored with no model at all: did the packet hold the lines the fix needed?
2. **SWE-QA-Pro (260 questions, 26 Python repos).** The paired agent test for code lookup. Read-only questions ("where does X flow", "what subclasses Y"), filtered so a model can't answer them from memory, with gold answers that cite `file: line` spans. Report the score, the zero-tool solve rate with and without the packet, tool calls and tokens.
3. **BrowseComp-Plus (830 questions, fixed 100K-page corpus).** The web-lookup test. The corpus is frozen, so both arms see the same "web", and evidence documents are labeled, so packet retrieval is scoreable for free. Its agent runs only make sense once the packet prefetches web results.

Skip SWE-bench Verified and Pro, Terminal-Bench 2.0 and the long-horizon terminal sets for now: each task arrives fresh with no history, so a packet has nothing to bring, and they cost $45 to $1,000 a pass. They answer "is the agent loop any good", not "does the packet save work".

The planned work-saved eval ([prefetch-evals.md, section 5](prefetch-evals.md#5-work-saved-paired-with-and-without-the-packet)) is still the better test of the packet's own claim: no public benchmark tests a stale read, a fact only said in chat, or a turn that should get an empty packet. The public sets add outside credibility for code and web lookup. Its plan to drive `claude -p` has to change, though (see [Same code](#same-code-as-the-product)).

## What every run reports

| Number | Meaning |
| --- | --- |
| Score | The benchmark's own metric, packet arm and no-packet arm. The packet must never lower it |
| Zero-tool solve rate | Share of tasks solved with no tool call at all. Reported for **both** arms; the packet's credit is the difference, because Claude answers some questions from training (Code-QA-Bench: Opus 4.6 closed-book 0.56 on code questions; LiveBrowseComp found agents answer up to 44.5% of BrowseComp-Plus closed-book) |
| Tool calls by kind | Reads, greps, shell, searches, fetches, per task, paired |
| Tokens | Input, output and cache, per task, paired, plus packet tokens on their own |
| Wall time | Per task, paired |
| Harm | Tasks that pass without the packet and fail with it |
| Packet-only recall | Where gold locations exist: share of gold files, blocks and lines (or evidence documents) in the packet, scored before any model runs |

Paired the same way as prefetch-evals.md: same model, prompt, tools and caps; arm order alternated; bootstrap interval on each paired difference.

## Same code as the product

Every entry point runs the same code, so the harness can't use Claude Code, Harbor's Terminus or a benchmark's own LangGraph agent. It drives Long Con's own loop:

- The agent loop and tools (`bash` on just-bash, `search_history`, web search and fetch) live in `apps/web/src/chat.ts` and `tools.ts` on the web chat branch. They move into `packages/core` so the web chat, the CLI and the harness call one function.
- A benchmark repo is loaded into the same virtual file system the web chat uses for `/home` (the browser keeps it locally; OPFS is the natural home for a whole repo). The packet's symbol index (`packages/core/src/symbols.ts`) is built over it exactly as it would be for a repo pulled into the chat.
- The harness only swaps the outside world for a frozen copy: a repo at a pinned commit, or BrowseComp-Plus's corpus standing in for web search. Both arms get the same copy.
- prefetch-evals.md section 5 planned to run `claude -p`. That tests a loop the product doesn't run, so it moves onto the shared loop too.

SWE-bench-style tasks that must run a test suite need a real shell, which just-bash can't give. That would mean a CLI tool backend in a container, which the product doesn't have yet. Another reason to start with read-only question sets.

## The three picks

| | ContextBench Verified | SWE-QA-Pro | BrowseComp-Plus |
| --- | --- | --- | --- |
| What it tests | Finding the code an issue fix needs | Answering questions about a repo | Multi-hop web research |
| Size | 500 issues (SWE-bench Verified), Python, 12 repos. Full set 1,136 in 8 languages | 260 questions, 26 long-tail Python repos at pinned commits | 830 questions; 100,195 documents, ~5K words each |
| Gold | `gold_context`: file, start and end line, content | Long-form answer that cites `file: line` spans; LLM judge on five 1-10 axes | Evidence and gold document ids as TREC qrels; answer judged by an LLM |
| Free, no-model score | Packet file, block and line recall against gold | Packet recall of the files and lines the gold answer cites (parse the citations) | Packet recall of evidence documents (Recall@k, nDCG@10 with the qrels) |
| Paired agent run | Possible, but scoring a fix needs the test suite (a real shell) | Yes, read-only tools only, so it runs on just-bash | Yes, once the packet does web prefetch; search calls are already counted per run |
| Zero-tool headline | n/a (packet-only) | Strong fit: questions a model answered without the repo were filtered out at build time, so the no-packet zero-tool rate starts low (Sonnet 4.5 direct 27.69 vs agent 40.67 of 50) | Weak until the packet searches the web; the corpus also leaks into training, so the no-packet baseline matters |
| Licence | Apache-2.0 (code) | MIT | MIT |
| Get it | GitHub `EuniAI/ContextBench`, `data/contextbench_verified.parquet` (also HF `Contextbench/ContextBench`) | HF `TIGER-Lab/SWE-QA-Pro-Bench` (292 KB); code `TIGER-AI-Lab/SWE-QA-Pro`, repos via `eval/clone_repos.sh` | GitHub `texttron/BrowseComp-Plus` (qrels in `topics-qrels/`); HF `Tevatron/browsecomp-plus` (2.8 GB, encrypted) and `Tevatron/browsecomp-plus-corpus` (1.8 GB) |
| Sources | [paper](https://arxiv.org/abs/2602.05892) | [paper](https://aclanthology.org/2026.findings-acl.837.pdf) | [paper](https://arxiv.org/abs/2508.06600), [repo](https://github.com/texttron/BrowseComp-Plus) |

Fit notes:

- **ContextBench** issue texts rarely name a symbol exactly, and the packet's code source only fires on exact identifiers today (P13 in the [iteration log](iteration-log.md)). Expect low recall at first. That's the point: it measures the plain-language lookup the code source can't do yet, on gold nobody on this project wrote. Agents themselves only reach file recall 0.68-0.73 and line F1 0.13-0.38 on it.
- **SWE-QA-Pro**'s answers need several files (its parent set averages 3.2 files and 8.7 functions per answer), so a whole-answer packet is unlikely. The zero-tool rate will come from "where is X" questions; the rest shows tool calls and tokens saved. Its published scores use an OpenAI or DeepSeek judge; a Claude judge makes our numbers internal only.
- **BrowseComp-Plus** is hard (Sonnet 4 36.8% with a good retriever, 14.3% with BM25; gpt-4.1 reaches 93.5% when handed the gold documents). That oracle gap is exactly what a perfect packet would close, which makes it the right long-term web target. Indexing 100K long pages in the packet's own BM25 is heavy, so start with a slice and its gold plus negative documents.

### Rough cost per run

From published token counts times the prices in `evals/src/model.ts` (Haiku 5.5 $0.10/$0.50 per million under 100K input, $0.50/$2.50 above; Sonnet 5.5 $2/$10; Opus 5.5 $4/$20), ignoring prompt caching. Estimates, not measured.

| Run | Haiku 5.5 | Sonnet 5.5 | Opus 5.5 |
| --- | --- | --- | --- |
| ContextBench packet recall, 500 tasks | $0 | $0 | $0 |
| SWE-QA-Pro, 50-question slice, paired (2 arms), ~87K in / 2K out per question | ~$1 | ~$19 | ~$38 |
| SWE-QA-Pro, all 260, paired | ~$5 | ~$100 | ~$200 |
| Judge for SWE-QA-Pro, 3 scorings per answer (~9K in), per 100 answers | ~$0.15 | ~$3 | ~$5 |
| BrowseComp-Plus retrieval recall, 830 queries | $0 | $0 | $0 |
| BrowseComp-Plus, 50-question slice, paired, ~150K in / 5K out per question (assumed) | ~$9 | ~$35 | ~$70 |
| BrowseComp-Plus, all 830, paired | ~$145 | ~$580 | ~$1,160 |

Every paid row is at or over the $1 standing limit (the Haiku SWE-QA-Pro slice with its judge lands right on it), so each needs a yes first. The BrowseComp-Plus repo itself puts a full o3 run near $1,000. The big headline eval stays on hold.

## Also looked at

| Benchmark | What it is | Why not now |
| --- | --- | --- |
| [SWE-bench Verified](https://www.vals.ai/benchmarks/swebench) / Pro | 500 (Verified) or 731 public (Pro) issue fixes, Docker, test-scored. Verified's top Claude scores are near 95-97% on Vals; ~$0.7-2.4 per task | No history, so the packet only helps through code lookup, which ContextBench scores for free on the same issues. Needs a real shell. Vals has archived Verified |
| [Terminal-Bench 2.0](https://www.vals.ai/benchmarks/terminal-bench-2) | 89 terminal tasks, Harbor and Docker, Apache-2.0. Claude Opus 4.8 70.0%, ~$0.88 and ~416K tokens per task | Single-shot tasks that require doing things, so zero tool calls is impossible. A fine check of the agent loop itself later, ~$45-90 per pass |
| [LHTB](https://github.com/zli12321/LHTB) | 46 long-horizon terminal tasks, Apache-2.0 | $11-73 per task |
| [Multi-step SWE](https://arxiv.org/abs/2611.07166) | 69 chains of 5-15 dependent steps on one codebase, Harbor. Opus 5.5 leads at 18.5% | Builds on its own earlier work, the closest to an endless session, but 10-60 hours of agent time per task |
| [SWE-Bench-CL](https://arxiv.org/abs/2507.00014) | 273 Verified issues in 8 per-repo sequences, memory on vs off | Right shape for "earlier tasks in the same repo", but no published results and needs the test-suite shell. Revisit after the shell backend |
| [SWE-ContextBench](https://arxiv.org/abs/2602.08316) | Reusing past solved tasks: oracle summaries lifted Sonnet 4.5 from 26.3% to 34.3%; free-picked context didn't help | No release found |
| [CompactionBench](https://www.microsoft.com/en-us/research/wp-content/uploads/2026/10/CompactionBench_preprint.pdf) | Compaction strategies over long coding sessions (Microsoft, Oct 2026) | Exactly the "packet vs compaction" comparison, but 8 tasks, no release found, ~$15-22 per run on GPT-5.6. Watch it |
| [LoCoBench-Agent](https://arxiv.org/abs/2511.13998) | ~8,000 interactive long-context scenarios, has a multi-session memory metric (0.32-0.37 for every model) | Own framework and tools; heavy. Its memory metric is the one to borrow if it gets used |
| [MemGym](https://arxiv.org/abs/2605.20833) | Paired with-memory vs no-memory deltas across SWE-Gym, τ²-bench, WebArena; summary memory gave Sonnet 4.5 +0 on SWE-Gym, Haiku 4.5 +8.7 on τ² | The paired "memory-isolated" method matches ours. No release found; ~$2.10 per SWE-Gym episode |
| [Letta Context-Bench](https://letta.com/blog/context-bench) | Multi-hop lookups across files about made-up entities (open and grep tools) | Contamination-proof file lookup, a good fit, but task count and licence aren't stated. Check its repo before relying on it |
| [When2Tool](https://arxiv.org/abs/2605.09252) | 2,700 tasks on whether a tool call was needed; cutting calls 48% cost 1.7% accuracy | Its method needs open-weight hidden states; release unclear. The tool-call accounting is worth copying |
| [LiveBrowseComp](https://arxiv.org/abs/2605.28721) | 335 questions on facts from the last 90 days, live web | Live web can't be paired fairly. Its main finding is the warning above about closed-book answers |
| SWE-QA, Code-QA-Bench, DeepRepoQA | Earlier or overlapping repo-QA sets | SWE-QA-Pro supersedes SWE-QA for this use (it removes memorizable questions); Code-QA-Bench has no release URL |

## Download check, 2026-11-28

- `EuniAI/ContextBench` clones from GitHub (305 MB); `data/contextbench_verified.parquet` reads as 500 rows with `gold_context` spans.
- `texttron/BrowseComp-Plus` clones (7.2 MB); qrels are there (5,064 evidence and 2,407 gold lines).
- `TIGER-AI-Lab/SWE-QA-Pro` clones (27 MB). Its questions are on Hugging Face only.
- Hugging Face downloads are refused from this sandbox, as before. The SWE-QA-Pro and BrowseComp-Plus data would come down in GitHub Actions or an HF Job, the way the Potion models did.
- No harness built and nothing paid run.

## Not verified

Token counts per SWE-QA-Pro and BrowseComp-Plus task for Claude (costs above borrow SWE-QA's OpenHands figure and an assumed 150K); whether SWE-QA-Pro's cited line numbers are exact enough for line-level packet scoring; Letta Context-Bench's size and licence; LoCoBench-Agent's repo; the conflicting SWE-bench Verified leaderboards (Vals shows Claude in the 80s-90s, swebench.com's bash-only board tops out at 76.8%).
