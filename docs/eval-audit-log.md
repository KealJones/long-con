# Eval audit log

Every change made in response to the outside audits of the phase 1 eval harness, keyed by finding id. Each audit round is run by a fresh reviewer with no context and no list of earlier findings, and a second fresh reviewer checks each original finding against the code.

Scope: audits judge whether the test measures correctly and fairly. The packet's own format, sections, ordering and content are out of scope, even when they hand the reader the answer, as long as the packet is built only from what a real chat would have. Findings about packet design are sorted as **design notes, non-blocking**.

## Round 0: the first audit (16 findings)

Commits: `aac8fe4` (first fixes), `4ad3090` (the rest).

| Id | Sorted as | File | What changed | Why | Commit |
| --- | --- | --- | --- | --- | --- |
| H1 | Blocking | evals/src/longmemeval.ts, packages/core/src/packet.ts | The loader renames every chat `chat-N` in haystack order and packets show no ids at all. A test uses a real-looking `answer_…` id and checks it never reaches a reader. | LongMemEval names every evidence chat `answer_…`, and packet headers printed those ids raw, so the packet arm's reader could see which chats held the answer. The ids come from the benchmark; printing them was the bug. | aac8fe4 |
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

## Round 1

A fresh audit (no context, no list of earlier findings) found 1 high, 4 medium and 12 low. A separate check of the original 16 found 8 fixed, 5 partly fixed and 3 design notes. Both raw reports are in the audit report's appendix.

### New findings from the round 1 audit

| Id | Sorted as | File | What changed | Why |
| --- | --- | --- | --- | --- |
| R1-H1 | Blocking | evals/src/cli.ts | A run stops before any call if the reader or judge has no price, or if the estimate had any errors. | An unpriced model made every estimate $0, so `--max-cost` passed, and the real run's billed calls went unrecorded. |
| R1-M1 | Blocking | evals/src/run.ts, evals/src/judge.ts | A judge failure keeps the reader's answer and all calls, including the judge's billed one, and counts in the errors column. The judge gets the same 16K output cap as every other call. | A judge failure threw away the reader's answer and cost, and a 2,000-token cap on a thinking judge invited it. |
| R1-M2 | Blocking | evals/src/subagent.ts, evals/results/smoke/*/summary.md, evals/README.md | The subagent backend says plainly that model names only key the files, the subagent reads its own system prompt and nothing isolates it. Stale pending prompts are cleared each pass. Smoke summaries carry a note: a pipeline check, not a result. | The smoke numbers can't be tied to the reader and judge they name. |
| R1-M3 | Blocking | evals/src/run.ts | The summary pairs every arm against `packet` as well as `bare`. The smoke result is reported only as having history against none. | Only packet vs bare had a paired interval, and with no tools bare can't answer. |
| R1-M4 | Blocking | packages/core/src/packet.ts, evals/src/arms.ts | With no tools, the history notice and the trust note don't mention a search tool. | Packet and bare were told about a tool that didn't exist; full and compaction weren't. |
| R1-L1 | Blocking | evals/src/longmemeval.ts | Held-out also leaves out questions whose evidence chat shares an evidence turn word for word, or at least half its turns, with a dev question's. 437 held out, 13 out of both. | One held-out question had a near-copy of a dev question's evidence. |
| R1-L2 | Blocking | evals/src/cli.ts | The "user turns" figure is the dev slice's (95%), not all 500 questions'. | The all-data figure used held-out labels. |
| R1-L3 | Blocking | packages/core/src/packet.ts, packages/core/test/packet.test.ts | The budget counts every character of the final text, joins and the section line included. A test sweeps ceilings from 300 to 3,000 in steps of 7. | Packets overshot by a few tokens. |
| R1-L4 | Blocking | evals/src/recall.ts | A turn counts as recalled only when all of its text is in the packet: every piece of a split turn, and never a blanked one. | Any piece of a long turn counted the whole turn. |
| R1-L5 | Blocking | evals/src/estimate.ts, evals/src/cli.ts | Every estimated search uses the question as its query, so each bills real results. The estimate prints a ceiling (every search used, which the cap uses) and a floor (no searches). | Searches after the first returned "No matches"; the ceiling alone overstated full by about 72x. |
| R1-L6 | Blocking | evals/README.md, evals/src/cli.ts | Docs match the code: Haiku's over-100K price is modeled, five arms, 437 held out. | Docs and code disagreed. |
| R1-L7 | Design note, non-blocking | packages/core/src/packet.ts | No change. | The packet sorting chats by date is packet design, from dates a real chat has. |
| R1-L8 | Justified | evals/README.md | Documented: a small-local run measures the chosen reader on small packets, and its full arm sends the whole history. | Skews against the packet, not for it. |
| R1-L9 | Blocking | evals/src/run.ts | A summarizer input tokens column. | Compaction's summary reads weren't in any token column. |
| R1-L10 | Justified | evals/README.md | Documented: the benchmark's rubric is lenient, abstentions count in headline accuracy, per-type accuracy is in summary.json. | The judge prompts are LongMemEval's own, and changing them would break comparability; it applies to every arm. |
| R1-L11 | Blocking | packages/core/test/prompt.structure.test.ts, evals/test/*.ts | The system-prompt test now checks the packet stays out of it. New tests: judge failure, cut-off reader call cost, the API client's stop reasons, one output cap for every call, the shared compaction summary, no tool mentioned without tools, near-copy evidence excluded, split-turn and blanked-turn recall, every ceiling respected. The stand-in summarizer still keeps the fact by rule: those tests check plumbing, not summary quality. | Tests missed the real risks. |
| R1-L12 | Justified | evals/README.md | Documented: only `eval recall` refuses held-out; held-out runs are for headline numbers by convention. | Anyone with the repo can run held-out; a lock wouldn't stop that. |

### Original findings, after the round 1 check

| Id | Round 1 verdict | What changed since |
| --- | --- | --- |
| H2 | Fixed, small gaps | The two compaction arms now share one summary per question (no summary-to-summary noise). A test checks reader input counts search results, not just the first context. |
| M2 | Fixed, one gap | The near-copy pair is now left out (R1-L1). The estimate and recall no longer overwrite the committed dev results when run on another split, a pick or a single profile. |
| M3 | Fixed, one hollow test | A test on hand-built answers fails if repeats are counted as separate questions. |
| M4 | Partly fixed | A cut-off or refused call carries its billed usage, and it is recorded. Tests cover the API client's stop reasons and the shared output cap. A failed answer still records 0 context tokens. |
| M5 | Partly fixed | Ceiling and floor estimates (R1-L5). Caching and per-question summaries are disclosed, not modeled. |
| M6 | Partly fixed | Both hollow tests fixed (M3, H2). The stand-in reader answering when the fact is in front of it is the point of the stand-in. |
| L3 | Partly fixed | Fixed (R1-L3). |
| L5 | Partly fixed | Split and blanked turns fixed (R1-L4). Recall still counts only the packet, not what a reader finds by searching; that is what recall means here. |

### Recall after round 1

Stricter recall (whole turns only) and the exact ceiling moved small-local from 70.2% to 68.1% (plain BM25 57.4%). Claude stays at 78.7% (plain BM25 76.6%).

## Round 2

A fresh audit found no leaks and no split contamination, and 4 medium and 10 low findings, all about fairness between arms and how results read. A separate check of the original 16 found 13 fixed and 3 design notes, with a few test gaps. Both raw reports are in the audit report's appendix.

### New findings from the round 2 audit

| Id | Sorted as | File | What changed | Why |
| --- | --- | --- | --- | --- |
| R2-M1 | Blocking | evals/src/arms.ts | Both compaction arms are told the history was summarized and may leave details out; `compaction-search` is also told the search tool reaches all of it, as `packet` and `bare` are. A test checks every arm that can search is told. | `compaction-search` had the tool but no word that its summary was lossy or that the tool reached the original chats. |
| R2-M2 | Justified | evals/README.md | Documented: `packet` against `bare` measures the whole builder, its own retrieval and budget included; the recall report's plain-BM25 baseline isolates retrieval. | The packet's fused ranking and fill are the builder under test. Giving the shared tool the packet's ranking would change what every arm is compared with. |
| R2-M3 | Blocking | evals/src/run.ts | Cost is split: the arm's own cost per question (reader and summarizer), the judge's cost per question, and the run's total with the judge. A test checks the split. | The judge, the same job for every arm, made up most of the cheap arms' cost and shrank the ratios between arms. |
| R2-M4 | Blocking | evals/src/cli.ts, evals/README.md | The recall report gives 95% bootstrap intervals, a paired packet-minus-BM25 difference with its interval and the questions only one side gets whole, and says these are tuning numbers and that one question is 2.1 points. | The builder's gain over plain BM25 was one question for claude, in-sample, with no intervals. |
| R2-L1 | Justified | evals/README.md | No change. Every arm's token size is in the summary. | Unequal token budgets are what the arms are; the gaps work against the packet. |
| R2-L2 | Design note, non-blocking | packages/core/src/packet.ts | No change. | The packet ordering same-day chats by timestamp is packet design, from dates a real chat has. |
| R2-L3 | Blocking | evals/src/estimate.ts | The estimate searches with the last plain user message, which holds the question in every arm. | For the packet arm the first user message is the packet, so it searched the packet's tail. |
| R2-L4 | Justified | evals/README.md | No change. | Parallel searches in one round are treated alike in every arm. |
| R2-L5 | Blocking | evals/src/run.ts, evals/src/cli.ts, .github/workflows/evals.yml | `--max-cost` also caps real spending during a run: no new answers start once it's spent, and the summary says if the run stopped early. A test checks it. | The cap was checked once, against an estimate. |
| R2-L6 | Justified | evals/README.md | Already documented (R1-L10). | The judge prompts are LongMemEval's own; agreement with human labels needs a paid run. |
| R2-L7 | Justified | evals/test/run.test.ts | Disclosed already (R1-L11): the stand-ins check plumbing, not quality. | Only a real run measures summary quality. |
| R2-L8 | Justified | evals/src/recall.ts | No change; the definition is in the report. | "Evidence chats found" is a looser, documented companion to "all evidence in packet". |
| R2-L9 | Blocking | evals/results/smoke/ | The committed `pending/` prompts are gone. The summaries already say they're a pipeline check, not a result. | Judge prompts with answers sat beside reader prompts. |
| R2-L10 | Justified | evals/README.md | Already documented (R1-L12). | A lock wouldn't stop anyone with the repo. |

### From the round 2 check of the original findings

| Id | Gap the check found | What changed |
| --- | --- | --- |
| H1 | The log said chats are renamed in shuffled order. | Corrected: haystack order. |
| H2 | The README still listed four arms. | Five arms in the table. |
| M1 | No test on the SDK mapping of `tool_choice`. | A test checks the API client sends `tool_choice: none` with the tool still defined. Still not checked against the live API. |
| M2 | No test pins each grouping rule alone; dev evidence chats appear as filler in held-out. | One test per rule. The filler overlap is noted in the README. |
| M3 | The pairing itself had no test. | A test fails if each question isn't differenced against itself. |
| M4 | A failed answer records 0 context tokens. | The packet-or-context column averages only answers that didn't fail. A test checks it. |
| L5 | The recall report didn't state its limits. | It now states both: unlabeled evidence chats aren't counted, and searches aren't. |
| L3, L4 | No test on real-confidence costing or the stratified `--limit`. | Not added: both are right on real data, and the budget sweep covers the ceiling. Noted as open. |

### Recall after round 2

Unchanged: claude 78.7% (66.0% to 89.4%) against plain BM25 76.6%, a +2.1-point paired difference (+0.0 to +6.4). Small-local 68.1% (55.3% to 80.9%) against 57.4%, +10.6 (+2.1 to +21.3).
