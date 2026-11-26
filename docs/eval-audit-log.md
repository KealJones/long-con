# Eval audit log

Every change made in response to the outside audits of the phase 1 eval harness, keyed by finding id. Each audit round is run by a fresh reviewer with no context and no list of earlier findings, and a second fresh reviewer checks each original finding against the code.

Scope: audits judge whether the test measures correctly and fairly. The packet's own format, sections, ordering and content are out of scope, even when they hand the reader the answer, as long as the packet is built only from what a real chat would have. Findings about packet design are sorted as **design notes, non-blocking**.

## Round 0: the first audit (16 findings)

Commits: `aac8fe4` (first fixes), `4ad3090` (the rest).

| Id | Sorted as | File | What changed | Why | Commit |
| --- | --- | --- | --- | --- | --- |
| H1 | Blocking | evals/src/longmemeval.ts, packages/core/src/packet.ts | The loader renames every chat `chat-N` in shuffled order and packets show no ids at all. A test uses a real-looking `answer_…` id and checks it never reaches a reader. | LongMemEval names every evidence chat `answer_…`, and packet headers printed those ids raw, so the packet arm's reader could see which chats held the answer. The ids come from the benchmark; printing them was the bug. | aac8fe4 |
| H2 | Blocking | evals/src/arms.ts, evals/src/run.ts | Every arm but classic `compaction` gets the same search tool and round count. A new `compaction-search` arm is the summary plus the tool. Reader input tokens (every reader call, tool results included) is the headline token column. Each arm is paired against `bare`. | `full` and `compaction` had no tool while `packet` and `bare` did, and the context-tokens column hid that the packet reader took in more than compaction once it searched. | aac8fe4, 4ad3090 |
| M1 | Blocking | evals/src/arms.ts | The last round keeps the tool defined with `tool_choice: none`, so earlier tool turns stay valid and the reader can only answer. Not yet confirmed against the real API. | Dropping tools on the last round after tool turns likely made the API refuse the call, scored as a wrong answer. | aac8fe4 |
| M2 | Blocking | evals/src/longmemeval.ts, evals/src/cli.ts | Held-out leaves out any question sharing evidence with dev: `_abs` twins and questions whose evidence chat is word for word a dev question's (union-find over sha256 of the turns). 438 held out, 12 left out of both. `eval recall` refuses held-out. | `X` and `X_abs` siblings and identical evidence chats crossed the split, so tuning on dev leaked into held-out. | aac8fe4, 4ad3090 |
| M3 | Blocking | evals/src/run.ts, evals/src/cli.ts, .github/workflows/evals.yml | `--repeats` (also a workflow input), a seeded 95% bootstrap interval over questions with repeats averaged per question, and a paired difference against `bare` with its own interval. | 50 questions, one run and no intervals couldn't tell a real gap from noise. | 4ad3090 |
| M4 | Blocking | evals/src/model.ts, evals/src/arms.ts, evals/src/run.ts | `max_tokens` and refusal stops throw. A failed answer keeps the cost and tokens of calls made before it failed. An errors column in the summary. Output cap 16K for every arm and the summarizer. 6 retries on the API client. | Errors dropped their cost, and a truncated answer was scored as if complete. Remaining risk: the full arm's 140K-token calls at concurrency 4 may still hit rate limits; retries cover it. | aac8fe4, 4ad3090 |
| M5 | Blocking | evals/src/estimate.ts, evals/src/cli.ts | The estimate assumes every allowed search is used, so it is a ceiling. Every estimate and run header carries the cost caveats: Haiku's over-100K price, caching not modeled, compaction summaries paid per question. | The estimate and framing favored the packet. Compaction summaries still count per question; that is disclosed, not changed. | 4ad3090 |
| M6 | Blocking | evals/test/run.test.ts, evals/test/longmemeval.test.ts | The stand-in model bills by prompt size, not a flat 100 tokens. The false "compaction costs more than full" assertion is gone; the test now checks summarizer calls are billed to compaction. New tests: classic compaction has no tools while every other arm does; with no tools `bare` fails where `packet` passes; failed answers keep their summarizer cost; repeats are each judged; the bootstrap narrows with more questions; held-out excludes twins and shared evidence. Real-looking benchmark ids. | Some tests passed without testing their claim, and fake ids couldn't catch the H1 leak. | 4ad3090 |
| L1 | Blocking | packages/core/src/segments.ts, packages/core/src/profiles.ts | Segments are hard-capped per profile (400 tokens), splitting long turns at paragraph breaks. | `segmentTokens` wasn't a cap. | aac8fe4 |
| L2 | Design note, non-blocking | packages/core/src/packet.ts | Retrieved history is ordered by date, with the earliest-date notice. | Packet ordering is design. Fixed anyway since the header said "oldest first". | aac8fe4 |
| L3 | Blocking | packages/core/src/packet.ts | The packet never passes its budget. | Packets slightly overshot. | aac8fe4 |
| L4 | Blocking | evals/src/cli.ts, evals/src/longmemeval.ts | `--limit n` takes a stratified pick, now validated as a whole number. | A plain head of the list wasn't representative. | aac8fe4, 4ad3090 |
| L5 | Blocking | evals/src/cli.ts, evals/results/longmemeval-s-dev50-recall.md | A plain BM25 top-k baseline over the same segments, filled to the same ceiling, sits next to each profile in the recall table. Recall's other limits are noted in the report. | Recall had nothing to compare against. | 4ad3090 |
| L6 | Blocking | evals/src/judge.ts | A verdict passes only if the reply opens with "yes". | "no, but yes…" could pass. | aac8fe4 |
| L7 | Design note, non-blocking | evals/src/cli.ts | No builder change; the BM25 baseline measures how much the builder adds over plain search. | A builder shaped by the benchmark is design; the baseline and held-out split cover the generalization worry. | 4ad3090 |
| L8 | Design note, non-blocking | packages/core/src/packet.ts | The register only takes answers from the current session. | A packet-only register is design. Uses no information a real chat wouldn't have. | aac8fe4 |

Also fixed along the way: the subagent backend's "pending" state was misread as an error and printed 0% summaries (`4ad3090`); `--arms` and `--repeats` are validated so a typo can't silently run nothing (`4ad3090`).

### Recall on the 50-question dev slice

| Setting | All evidence in packet | Packet tokens |
| --- | --- | --- |
| Before (first builder, fixed 8K budget) | 72.3% | 8,000 |
| claude profile, ceiling 8K | 78.7% | 5,701 |
| Plain BM25 top-k, same ceiling | 76.6% | 7,886 |
| small-local profile, ceiling 2.5K | 70.2% | 2,276 |
| Plain BM25 top-k, same ceiling | 59.6% | 2,474 |

### Subagent smoke run (12 dev questions, no tools, judged by subagents)

| Track | packet | bare | Paired difference |
| --- | --- | --- | --- |
| claude profile, Sonnet reader | 83.3% | 8.3% | +75.0 (+50.0 to +91.7) |
| small-local profile, Haiku reader | 58.3% | 8.3% | +50.0 (+25.0 to +75.0) |

Smoke runs use estimated tokens, unpinned subagent models and a small sample. They show the pipeline works end to end, not a headline result.
