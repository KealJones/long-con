# Audit of the long-con eval harness

I found no answer leakage and no split contamination. The main problems are uneven treatment between arms and metrics that mislead. None of the problems below is a correctness bug that hands the packet labels. I found 4 medium findings and 10 low ones.

Commands I ran (all free, nothing in the repo changed; `git status` was clean afterwards):
- `npm test`: 51 of 51 pass.
- `npx tsc -p .`: clean.
- `eval recall --limit 50` and `eval estimate --limit 50` (claude and small-local). I used `--limit` so the commands would not overwrite the committed files. The recall output matches the committed report except for one trailing newline.
- My own scripts in `/tmp/claude-0/audit/`.

## Medium

**M1. The packet and bare arms are told to search. compaction-search gets the same tool with no such instruction.**
- Where: `packages/core/src/packet.ts:42-45, 60-61`; `evals/src/arms.ts:76` (bare) and `arms.ts:92` (compaction).
- What's wrong:
  - The packet's first lines say "Earlier chat history … was left out to fit. The search_history tool can reach all of it."
  - Its trust note adds "use the tools instead".
  - bare gets the same notice.
  - compaction-search gets only `Summary of earlier chats… Recent chats…` plus the tool definition. It is never told the summary is lossy or that the tool reaches the original chats.
  - The README says this is "the fair comparison" and that every arm has "the same system prompt". The system prompt is the same, but the instruction about using the tool is not.
- Effect: compaction-search will probably search less than the packet arm when its summary has dropped a fact. That lowers its accuracy against the packet.
- Fix: give compaction-search the same left-out-history notice. The notice could also be added to every arm's question.

**M2. The tool-only arms get a weaker search and a smaller retrieval budget than the packet.**
- Where: `arms.ts:184-190` (`searchHistory`) against `packet.ts:123-139` (`search`) and the profile's `packetTokens`.
- What's wrong:
  - The packet ranks with two BM25 indexes fused together (all words, and the user's words alone), removes duplicates, applies a confidence cutoff, and fills up to 8,000 tokens before the reader starts.
  - The search tool every arm shares is plain BM25 over all words. It returns the top 3 results (top 1 on small-local).
  - With the claude profile, a tool-only arm sees at most 3 rounds × 3 units × about 400 tokens, roughly 3,600 tokens of retrieved history.
  - The committed recall report itself shows that ranking by the user's words is worth 10.7 points of complete recall on small-local (68.1% against 57.4%). Only the packet benefits from it.
- Effect: "packet vs bare" and "tool calls saved against bare" partly measure a better search engine and a bigger budget, not giving the reader a packet up front.
- Fix: route the tool through the same search code, or report the packet against an arm that does one search with the same search code and the same budget.

**M3. "Cost / question" includes the Opus judge, which makes up most of the cheap arms' cost.**
- Where: `evals/src/run.ts:54` puts the judge call into `result.calls`; `run.ts:100` sums every call into `totalCost`.
- Evidence, from the floor table of the claude estimate I re-ran:

| Arm | Reported cost / question | Of which reader (my calculation) | Of which judge |
| --- | --- | --- | --- |
| packet | $0.0049 | about $0.0010 | about $0.0039 |
| bare | $0.0043 | about $0.0004 | about $0.0039 |
| full | $0.0775 | about $0.0736 | about $0.0039 |

  Reader cost is 5,959 × $0.10/M plus 800 × $0.50/M for the packet. The judge is about 200 input tokens at $4/M plus 150 output tokens at $20/M.
- Effect:
  - The reported full-to-packet cost ratio is about 16×. Counting only what each arm itself spends, it is about 74×.
  - The column measures grading as well as the arm's own spending. Every arm pays the same judge cost, so the ratios between arms shrink.
  - This works against the packet, but the headline cost metric is still wrong.
- Fix: report judge cost in its own column.

**M4. The recall results are in-sample, and the gaps they report are one question.**
- Where: `evals/results/longmemeval-s-dev50-recall.md`; `packages/core/src/profiles.ts:44-48`.
- What's wrong:
  - `segmentTokens` = 400 and `minConfidence` = 0.3 were tuned on these same 47 answerable dev questions. The code comment says so ("smaller still scored a little higher").
  - With the claude profile, the packet's complete recall is 78.7% (37 of 47) against 76.6% (36 of 47) for plain BM25 at the same ceiling. That is one question.
  - "Adaptive" against "fixed" at 8,000 tokens is also 78.7% against 76.6%, again one question.
  - There are no intervals on any recall number.
- Effect: the "builder's gain over plain search" claim is within noise and is measured on the data used to tune it.
- Fix: add intervals. State in the report that these are tuning numbers, not held-out ones.

## Low

**L1. Arms run at very different token budgets, and `compactAt` does not cap compaction.**
- Where: `arms.ts:159-182`.
- What's wrong:
  - The summary length is never capped; the summarizer's output limit is `MAX_OUTPUT`, 16,000 tokens.
  - With small-local, the estimated compaction context is 8,469 tokens. That is more than the profile's 6,000-token window and its 2,500-token `compactAt`. The packet is held to 2,500.
  - With claude, the estimated contexts are: full 141,000, compaction 18,000, packet about 5,700.
- Effect: the token gaps are reported and they work against the packet, but no accuracy figure is at matched tokens.

**L2. Same-day chats come in a different order in different arms.**
- Where: `arms.ts:192-194` keeps the benchmark's list order; `packet.ts:98, 176-179` sorts by full timestamp.
- Evidence:
  - 211 of 500 haystacks have time inversions within a day. None has an inversion across days.
  - In 39 questions (38 of them temporal-reasoning, 5 in dev), the evidence chats' list order disagrees with their timestamp order.
- Effect: questions about which of two same-day events came first can be read differently by full and compaction than by the packet.

**L3. The estimate searches the packet arm with the wrong query.**
- Where: `evals/src/estimate.ts:29-32`.
- What's wrong: `lastUserText` takes the first string user message. For the packet arm that message is the packet itself, so the stand-in searches the packet's last 500 characters instead of the question.
- Effect: small, since a search result's size is capped.

**L4. "Searches" are really rounds.**
- Where: `arms.ts:122-128`; the CLI says "up to N searches" at `cli.ts:123`.
- What's wrong: parallel tool calls within a round are not capped. The "ceiling" estimate assumes one search per round, so it is not a strict ceiling.
- Effect: all arms are treated the same.

**L5. There is no spending cap while a run is going.**
- Where: `cli.ts:193-197`.
- What's wrong:
  - `--max-cost` is checked once, before the run, against an estimate with fixed output guesses: 800 tokens per reader call, 2,500 per summary, 150 per judge.
  - Real outputs may be longer: Haiku 5.5 thinks by default, and calls are capped at 16,000 output tokens.
  - The workflow's text ("stops before any call") is accurate, but nothing stops a run that overshoots once it has started.

**L6. The judge has never been checked.**
- Where: `judge.ts`.
- What's wrong:
  - The prompts match LongMemEval's word for word. The pass check (the reply must open with "yes") is stricter than the benchmark's.
  - There is no check of the judge's agreement with human labels, and the "low" effort setting was never tested.
  - The rubric is lenient ("contains the correct answer"), so an answer listing several candidates can pass.
  - Abstention questions pass on any refusal, which favours arms that see little history (bare). These are 3 of the 50 dev questions; the README discloses this.

**L7. The tests check the plumbing, not the claims made about them.**
- Where: `evals/test/run.test.ts`.
- What's wrong:
  - The stand-in reader answers correctly whenever "Denver" appears anywhere in its messages.
  - The stand-in summarizer copies the "moving" sentence word for word, so "every arm finds Denver" is true by construction.
  - The ceiling test (`packet.test.ts:142`) never puts standing rules in the packet's header. On the real data the header never pushed a packet past its ceiling: none of the 500 questions did, and the largest header was 394 tokens.
  - `recall.test.ts` never covers a text match that comes from elsewhere in the packet. The `inPacket` range check limits this risk.

**L8. "Evidence chats found" is lenient.**
- Where: `recall.ts:31`.
- What's wrong: a chat counts as found if any of its units is in the packet, even one with no evidence in it. The definition is documented.

**L9. The committed smoke results show nothing about the arms.**
- Where: `evals/results/smoke/`.
- What's wrong:
  - They come from stale commit 4ad3090 and compare only packet and bare, with no tools.
  - The subagents were unconstrained. `evals/data/longmemeval/longmemeval_oracle.json` (the file holding only the evidence chats) sits locally.
  - On later passes, judge prompts containing the correct answers are written to `pending/` beside reader prompts that are still unanswered.
  - The `pending/` folders were committed.
  - The summaries are labeled as a pipeline check, which is fair. Still, nothing in these files should be quoted as accuracy.

**L10. Re-running held-out is not prevented.**
- Where: `cli.ts:85-96`; the workflow exposes `split=held-out`.
- What's wrong: anyone can re-run held-out for each builder version and pick the best. The README admits nothing enforces this rule.

## What I checked and found sound

- **No labels reach the packet.**
  - `loadLongMemEval` renames sessions to `chat-N` and keeps `has_answer` and `answer_session_ids` in a separate `evidence` field.
  - `buildPacket` receives only the sessions, the question and the profile.
  - No session lacks a date, so the `chat <id>` fallback label never fires.
  - Nothing reads the oracle file.
- **The dev slice is fair.**
  - The committed 50 ids are exactly what `stratifiedSlice(all, 50, 20261125)` produces.
  - The type shares match the full set, abstention questions included (3 of 50 against 30 of 500).
  - Every answerable question has evidence turns, so no question counts as complete with nothing to find.
- **The held-out split is clean.**
  - 437 questions are held out and 13 are excluded.
  - No held-out evidence turn reaches 0.6 word overlap (Jaccard) with any dev evidence turn.
  - 40 held-out haystacks contain dev evidence chats as filler, which is not a leak.
- **The arms are otherwise treated the same.** Every arm gets the same system prompt, reader, output cap and question with the current date. Every history is past the switch point (the smallest is about 131,800 estimated tokens), so the packet arm never falls back to the full chat. With `--no-tools`, no prompt mentions a tool.
- **Prices match the current Claude list prices.**
  - Haiku 5.5: $0.10 in and $0.50 out per million tokens, rising to $0.50 and $2.50 for prompts over 100K.
  - Sonnet 5.5: $2 and $10.
  - Opus 5.5: $4 and $20.
  - `costOf` applies the over-100K price to the whole call, which is correct.
- **Failures and statistics are handled correctly.**
  - Failed and cut-off calls count as wrong, and the cost they already ran up is kept.
  - The bootstrap resamples questions and averages repeats within a question first.
  - The paired intervals are done correctly.

## Design note (not blocking)

Ranking by the user's words alone suits LongMemEval, where 95% of the dev evidence turns are user turns, so the dev gains may not carry over to real chats. The recall report already says this.

---

I did not check the judge's output on any real verdicts, and no real model ran. M1 and M2 are the ones to fix before any headline number is published.