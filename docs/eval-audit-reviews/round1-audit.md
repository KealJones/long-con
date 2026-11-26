# Audit report: long-con eval harness (LongMemEval_S, five arms)

I found no direct leak of labels into the packet. The loader drops `has_answer` and `answer_session_ids`, renames every session to `chat-N`, and keeps the evidence only in `q.evidence`. The labels reach nothing except `recall.ts`. The oracle file sits in `evals/data/` but no code reads it. The serious problems are in cost accounting, failure handling and the subagent backend. There is one small split leak. Several prompts and metrics are unequal or mislabeled in ways that are minor, but worth fixing before anyone quotes a headline number.

What I ran:
- `npm test`: 41/41 pass.
- `npx tsc -p .`: clean.
- `eval recall` and `eval estimate`: both reproduce the committed result files byte for byte (`git status` stayed clean).
- I also recomputed the smoke-run prompt hashes with the current code. All 48 reader prompts match the committed answer files.
- My own scripts are in /tmp/claude-0/-home-user-long-con/20a8eb28-71a3-56f9-b3ba-5051337ca9eb/scratchpad/ (a1–a10).

---

## High

### H1. The cost cap is bypassed, and spend is hidden, when the reader or judge model has no price entry
**Where:** `evals/src/model.ts:41` (`costOf` throws), `evals/src/arms.ts:120`, `evals/src/run.ts:54-58`, `evals/src/cli.ts:129-131,168-171`, and `.github/workflows/evals.yml`, where `reader` and `judge` are free-text inputs.

**What's wrong:** `costOf` throws for any model not in `PRICES`. Inside the estimate, that throw is caught by `answerOne` and turned into an error answer that costs $0. So the estimated total comes out as $0, and `estimatedTotal > maxCost` passes. The CLI never looks at the estimate's error count.

In the real API run, every call is made and billed first, then `costOf` throws. `call()` pushes to `calls` only after `costOf` returns, so the billed call is never recorded:
- With an unpriced judge, every reader call is paid for, then the whole answer is recorded as an error with `calls: []`.
- With an unpriced reader, the first call per question and arm is paid for and then dropped.

The summary then reports about $0 spent and 0% accuracy on every arm.

**Evidence:** `a4.ts` runs the real `runEval` with `EstimatingModel` on 6 dev questions and arms full, packet, bare:
```
claude-haiku-5-5 claude-opus-5-5  estimated total $ 3.0806 errors 0,0,0
claude-haiku-5-5 claude-opus-4-7  estimated total $ 0.0000 errors 6,6,6   "No price for claude-opus-4-7"
claude-sonnet-4-6 claude-opus-5-5 estimated total $ 0.0000 errors 6,6,6   "No price for claude-sonnet-4-6"
```
One typo in the workflow's judge field (for example `claude-opus-4-7`) on the held-out split would spend the full uncapped reader cost (the full arm alone is about $0.51 per question). The run would score nothing and report $0.

**Fix:** validate the reader and judge against `PRICES` before running. Refuse to run when the estimate has any errors. Record usage before calling `costOf`.

---

## Medium

### M1. A judge failure throws away the reader's answer and its paid calls, and is charged to the arm
**Where:** `evals/src/run.ts:54-58`, `evals/src/judge.ts:37-45`.

**What's wrong:** `runArm` attaches `calls` to its own errors, but `judge()` does not. If the judge call throws, the catch block finds `err.calls` undefined and sets `calls = []`, `answer = ""`, `contextTokens = 0`, `pass = false`.

So a correct reader answer is scored wrong, and its cost and tokens vanish from the summary. Ways the judge can throw:
- refusal or `max_tokens` (Opus 5.5 always thinks, and the judge is capped at `maxTokens: 2000`);
- a missing price (H1);
- a subagent `Pending`.

**Skew:** this lands on whichever arm produces answers the judge chokes on. The README claims "a failed call ... keeps what it already cost", and that is false on this path. The test "a failed call counts as a wrong answer ... with what it already cost" only exercises reader failures.

**Fix:** score judge errors separately as "unjudged", not as wrong, and keep `result.calls`.

### M2. The subagent backend has no isolation, and its model labels can't be checked; the committed smoke numbers can't be attributed to the reader and judge they name
**Where:** `evals/src/subagent.ts:27-31`, `evals/results/smoke/*/pending/`, `evals/results/smoke/*/answers/`, `evals/src/cli.ts:150-155`.

**What's wrong:**
- **The model is only a hash salt.** `req.model` never selects anything; it only goes into the hash. Whichever model the orchestrating session spawns is the actual reader and judge. Yet the summaries say "reader claude-sonnet-5-5, judge claude-opus-5-5".
- **Judge files with answers are committed.** 22 judge prompts containing `Correct Answer:` or `Explanation:` are committed in `smoke/claude/pending` and `answers`, and the same in `smoke/small-local`. Both runs use the same 12 questions.
- **Nothing stops a reader from reading them.** Nothing makes a reader subagent answer "from that file alone". A subagent with file tools in this repo can read the sibling folder's judge prompts, or earlier answers, for the same question.
- **Stale prompts pile up.** The output folder is reused across runs by default and `pending/` is never cleared.
- **Not the same prompt.** The README says "Same prompts, byte for byte, as an API run", but the subagent also reads its own system prompt.

**Skew:** an unverifiable reader, a possible leak of reference answers, and an unverifiable judge. Treat the committed smoke accuracies as anecdotes, not measurements.

### M3. The only committed accuracy result compares the packet against an arm that can't answer by construction
**Where:** `evals/results/smoke/*/summary.md`.

**What's wrong:** both smoke runs use `--no-tools --arms packet,bare`. With no tools, `bare` sees only "history was left out" plus the question. It passed exactly 1 of 12, the abstention question `0862e8bf_abs`. So "+75.0 (+50.0 to +91.7)" measures "has any history versus none". It says nothing about packet versus full or compaction, which is the README's stated question.

In addition, `pairedTable` (`run.ts:140`) only ever pairs arms against `bare`. The comparison the project cares about, packet versus compaction-search and packet versus full, has no paired interval anywhere in the harness. It would get only overlapping unpaired intervals.

**Fix:** add `against` options for `compaction-search` and `full`. Don't cite the packet-versus-bare-without-tools numbers as evidence for the packet.

### M4. Without tools, the packet and bare prompts still promise a search tool; the full and compaction prompts don't
**Where:** `packages/core/src/packet.ts:41-44,58-59`, `evals/src/arms.ts:64-71`, `evals/src/cli.ts:119`.

**What's wrong:** `--no-tools` sets `maxToolRounds: 0`, but two prompts still promise a tool:
- `HISTORY_NOTICE` ("The search_history tool can reach all of it") still goes into the packet and bare arms.
- `TRUST_NOTE` ("use the tools instead") still goes into the packet arm.

No tool is defined. The full and compaction arms get no such text. The subagent backend, which is the default, requires `--no-tools`, so every subagent run has this mismatch.

**Evidence:** `smoke/claude/pending/reader-04cffb4555ae5c08.txt` opens with "The search_history tool can reach all of it." and no tool exists in that run. Several bare answers echo it.

**Skew:** this nudges the packet and bare arms toward "I can't tell". That hurts them on answerable questions and helps them on abstention questions, which are scored as part of headline accuracy. The arms that don't get the notice are unaffected. The size and direction of the net effect are unknown, but the prompts are unequal.

---

## Low

### L1. Split leak: one held-out question shares near-identical evidence with a dev question
**Where:** `evals/src/longmemeval.ts:112-136`. Questions are grouped only by an exact SHA-256 of a whole evidence chat (line 129).

**Evidence (`a6.ts`, `a8.ts`):**
- Dev question `gpt4_1e4a8aec`: "What gardening-related activity did I do two weeks ago?"
- Held-out question `gpt4_1e4a8aeb`: "How many days passed between the gardening workshop and planting the tomato saplings?"
- The raw evidence ids differ (`answer_16bd5ea6_*` versus `answer_16bd5ea5_*`). The evidence chats are not byte-identical but share an exact evidence turn, and the user-word Jaccard overlap is 0.98.

**Scope:** this is the only such pair out of 438 (all other overlaps are 0.5 or lower). Separately, 45 of 438 held-out haystacks contain a dev evidence chat as a distractor. That is benchmark design, not answer leakage.

**Fix:** group by a near-duplicate threshold on evidence turns, or by the raw answer-id stem with a trailing digit allowed.

### L2. A design statistic was computed on held-out labels
**Where:** `evals/src/cli.ts:341` ("94% of evidence turns are user turns") and the comment at `packages/core/src/profiles.ts:47`.

**Evidence:** the user share of evidence turns is 0.9397 over all 500 questions and 0.9529 on dev. The committed 94% is the all-data figure, so held-out `has_answer` labels were looked at while justifying the user-words index. It's a coarse statistic with little impact, but it breaks the rule "full-run questions are never looked at while tuning".

### L3. The packet can exceed its own ceiling
**Where:** `packages/core/src/packet.ts:74` versus `:97`. The budget subtracts only the head. The `""` / "Retrieved history, oldest first:" lines and the newlines that join segments are not budgeted.

**Evidence:** the committed and reproduced recall report shows a small-local largest packet of **2,508** tokens against a 2,500 ceiling. The test "stays inside the profile's budget" passes only because its case leaves slack.

### L4. Turn recall counts a partial segment as containing the whole evidence turn
**Where:** `evals/src/recall.ts:16-17`. When a long turn is split (`partial`), any piece of that turn counts the evidence turn as found, even if the fact sits in another piece.

**Scope:** 2 of 85 dev evidence turns are over 400 estimated tokens (`a1.ts`), so turn and complete recall are overstated by at most a few points.

### L5. The estimate is called a "ceiling" but under-counts searches
**Where:** `evals/src/estimate.ts:14-15,24-27`. `lastUserText` returns `""` when the last user message is a `tool_result` array. So every search after the first returns "No matches.", and only one search's results are ever billed.

JSON-escaping in the estimate's token count pushes the other way, so the net effect is unclear. Either way, it isn't the stated ceiling, and the cap in H1 depends on it.

### L6. Docs and code disagree
- `evals/README.md:120` says "Haiku's over-100K-token pricing isn't modeled". `costOf` does model it, and `COST_CAVEATS` says so too.
- The CLI usage text says "the other 450" (it's 438), "all four arms" (there are five), and gives the default arms as `full,compaction,packet,bare` (the code's default is all five).

I checked list prices against the current Claude API price table: Haiku 5.5 is $0.10 / $0.50, or $0.50 / $2.50 above 100K tokens; Sonnet 5.5 is $2 / $10; Opus 5.5 is $4 / $20. `PRICES` is correct.

### L7. The packet re-sorts chats by time; the full and compaction arms keep the benchmark's order
**Where:** `packet.ts:171-174` (the `order` function) versus `arms.ts` `renderEach`.

**Evidence:** 211 of 500 haystacks are not in time order, but only within a day; there are 0 day-level inversions. 39 questions have evidence chats out of time order (38 of them temporal-reasoning). The full arm still sees each chat's timestamp, so the edge is small.

Also, 44 questions have evidence dated after the question's own "Current date". That's a benchmark quirk and applies to all arms equally.

### L8. The small-local profile doesn't make the full arm small
The `full` arm ignores `profile.contextWindow` ("as long as it fits" is not enforced), and the reader is Haiku whatever the profile. Small-local runs measure Haiku with small packets, not LFM3. The full arm sends about 140K tokens on a profile sized for a 6K window. This makes the full arm look unrealistically strong, which skews against the packet, not for it.

### L9. "Reader input tokens" leaves out compaction's summarizer input
**Where:** `run.ts:99`. The compaction arms' roughly 140K tokens of summarizer reads per question aren't counted, though they are in the cost. This flatters compaction, not the packet. The "All-evidence points per 1K packet tokens" metric (`cli.ts:263`) is a ratio that rewards stopping early and doesn't scale linearly. Read it with caution.

### L10. Judge weaknesses (they apply to all arms)
- The prompts match LongMemEval's `evaluate_qa.py` word for word. A system line was added, and grading is strict on an opening "yes", which is good.
- The original rubric is lenient: "response contains the correct answer". An answer that lists several candidates can pass. Arms that put more candidates in front of the reader (packet, full) can gain from this compared with bare.
- Abstention questions are scored inside headline accuracy, and a refusal passes them. Arms whose prompts encourage hedging (M4) get credit for it.
- The judge runs Opus 5.5 with always-on thinking at `maxTokens: 2000`. Hitting `max_tokens` becomes an error and lands in M1.

### L11. Tests that don't test what they claim, or miss the real risks
- `prompt.structure.test.ts`, "system prompt passed through untouched": an identity check that can't fail.
- `longmemeval.test.ts`, the held-out exclusion test, covers only byte-identical evidence. It can't catch L1.
- No test covers M1 (judge-failure accounting), H1 (unpriced model or estimate errors), M4 (no-tools prompt text), L3 (ceiling including the retrieved-history header), or L4 (partial segments).
- `run.test.ts`'s stand-in summarizer uses a regex to copy the "moving" sentence into the summary, so the compaction path passes trivially.

### L12. Held-out is protected by convention only
`eval recall` refuses held-out, but `eval run --split held-out` and `estimate` can be run as often as anyone likes. Nothing logs or limits held-out runs.

---

## Checked and sound
- **Labels and ids:** no `has_answer`, answer ids or oracle data reach the builder or any reader. Packets render dates, not ids. The builder's only inputs are the sessions, the question text and the profile.
- **Equal treatment:** same `SYSTEM`, same reader, same `MAX_OUTPUT`, same search tool and number of rounds for all arms except classic `compaction`. The last round keeps the tool defined but forbids calls. The compaction summarizer uses the reader model and never sees the question.
- **Dev slice:** regenerating `stratifiedSlice(all, 50, 20261125)` reproduces the committed ids exactly. Type mix and abstention share (3/50) match the full set.
- **Not cherry-picked:** if anything, the slice is unusually hard. Packet complete-recall is 78.7% on dev against 87.5% on held-out and a median of 87.2% over 200 random stratified slices; dev sits at the 2nd percentile (`a9.ts`). So dev recall understates the packet, and anything tuned on it was tuned on hard cases.
- **Statistics:** bootstrap over questions with repeats averaged first, seeded and paired correctly. Accuracy equals the mean of per-question means.
- **Workflow:** manual trigger only, secrets passed via env, data checked by sha256, nothing committed back. The H1 bypass is the exception.
- **Reproducibility:** recall, estimate and smoke prompts all reproduce exactly from the current code.

**Design note (not blocking):** the user-words-only BM25 index and the 400-token segment cap were picked because LongMemEval's evidence is about 94% user turns. That suits this benchmark and may not hold for real chats, where facts often sit in assistant turns.

**Not checked:** I made no paid or network calls, so I couldn't observe real API behavior (refusal rates, judge `max_tokens` hits, actual token counts against the 3.5 characters-per-token estimate).
