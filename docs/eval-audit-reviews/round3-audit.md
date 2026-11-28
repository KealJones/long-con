# Audit of the beep eval harness (LongMemEval_S, five arms)

I found no label leak into the packet builder. The biggest skew is a data-prep problem: the packet arm sees history sorted by date, but the full and compaction arms see the benchmark's shuffled file order. After that come a cost cap that a mistyped value switches off, and compaction context budgets that aren't actually enforced. Everything else is low severity or already disclosed in evals/README.md.

All checks ran on a scratch copy of the repo; nothing in the repo changed, and `git status` there is clean. Results:
- `npm test`: 60/60 pass.
- `npx tsc -p .`: clean.
- `eval recall` reproduces the committed `evals/results/longmemeval-s-dev50-recall.md` exactly.
- My own analysis scripts are in /tmp/claude-0/-home-user-beep/20a8eb28-71a3-56f9-b3ba-5051337ca9eb/scratchpad/scripts/ (a1–a7).

---

## HIGH

### H1. Only the packet arm gets history in time order; the other arms get the benchmark's shuffled order

**Where:**
- The loader keeps file order: `evals/src/longmemeval.ts:49-55`.
- `full` and `compaction` render in that order: `evals/src/arms.ts:167` and `:197-199`.
- The packet sorts by date: `packages/core/src/packet.ts:99-100`.

**What's wrong:** LongMemEval_S haystacks are often not in date order.
- 211 of 500 questions are out of order: all 133 temporal-reasoning and all 78 knowledge-update questions.
- In the dev slice, 21 of 50 are out of order.
- Example: in `gpt4_483dd43c` every chat is on 2023/05/29 with times scattered; the file starts 22:28, 00:21, 00:23… and ends 06:39, 05:01.

**Why it skews toward packet:**
- In 38 temporal questions (5 in dev: `gpt4_6ed717ea`, `gpt4_93159ced`, `982b5123`, `gpt4_483dd43c`, `gpt4_c27434e8`) the evidence chats appear in a different order in the file than by date. These are the "which happened first" questions.
- The packet hands the reader its evidence oldest first. `full` lists chats in file order, so getting the order right depends on the reader re-sorting dozens of timestamps itself.
- `compaction` is worse:
  - Its "Recent chats" raw window is the last chats in the file, not the latest ones.
  - Its summaries are folded in non-time order.
- A real chat log is always in time order, so this advantage exists only on this benchmark.

**Not measured:** the effect size. It is bounded by roughly 5 of 50 dev questions for `full`, and more for compaction.

**Also in this data (same for every arm, but it compounds the problem above):** 76 questions (6 in dev) have chats dated after the question's "Current date", and 75 evidence chats sit after the question time. Example: `gpt4_483dd43c` asks at 08:33, with chats running to 23:30 the same day.

**Fix:** sort `sessions` by date once in `loadLongMemEval`, so every arm gets the same order. Add a test that every arm sees the chats in the same order.

---

## MEDIUM

### M1. A mistyped `--max-cost` turns the cost cap off entirely

**Where:**
- `evals/src/cli.ts:193-196`
- `evals/src/run.ts:40`
- `.github/workflows/evals.yml:30` (`max_cost` is a free-text string)

**What's wrong:** the value goes through `Number(values["max-cost"])` with no check. Typing `$2` or `2 USD` gives NaN, and then:
- The pre-run check `estimatedTotal > NaN` is false, so the run starts.
- The in-run check `spent >= NaN` is never true, so it never stops.

Checked: `Number('$2') = NaN`; `18.65 > NaN` gives false; `100 >= NaN` gives false. For scale, the committed estimate for the full dev slice on the claude profile is $18.65 at the ceiling.

No test covers an invalid cap: `run.test.ts:269` only tests `1e-9`.

**Fix:** reject anything that isn't a finite number ≥ 0, the same way `--limit` and `--repeats` are already validated.

### M2. Compaction context isn't held to `compactAt`, so arm budgets don't match and the small-local compaction numbers aren't meaningful

**Where:** `evals/src/arms.ts:164-187`

**What's wrong:**
- `compactAt` only decides when to fold. The summary itself is unbounded (up to `MAX_OUTPUT` = 16K tokens), and the final raw "Recent chats" window can hold about 30K tokens on the claude profile.
- On small-local (`compactAt` 2,500), every LongMemEval chat (about 2.8K tokens) crosses the threshold by itself. So the arm makes about 50 sequential summarizer calls per question.
- The committed estimate shows the result for small-local:
  - compaction context: 8,493 tokens, against a 2,500 budget and a 6K window;
  - summarizer input: 406K tokens per question;
  - compaction costs $0.10 per question against $0.001 for the packet.
- On the claude profile, compaction gets about 18–30K tokens against the packet's 8K ceiling.

**Effect:**
- Accuracy is not compared at matched budgets; compaction gets more context.
- Per-question cost, and the small-local compaction arm in particular, reflect this folding loop rather than a realistic compaction setup. The README's "pays for its own summaries" caveat doesn't cover this.

**Fix:**
- Cap the summary length and the raw window at `compactAt`.
- Or report the actual context each arm got next to its accuracy.
- Mark small-local `compaction` and `full` as not runnable on the target model.

---

## LOW

**L1. Cost totals count the shared compaction summary twice.**
- Where: `arms.ts:89-93`, `run.ts:109`, `cli.ts:139`, `run.ts:43`.
- Both compaction arms book the same summary calls. When per-arm `totalCost` is summed (the estimate's total and the in-run `spent`), the summary counts twice.
- This errs on the cautious side (the cap trips early), but "Total cost" overstates the run.

**L2. The packet's token ceiling isn't actually a hard limit.**
- Where: `packet.ts:62-64` and `:77`; `registers.ts:116`.
- Standing rules are added to the packet with no cap, so the budget goes negative. A history with 400 "Always…" lines gave a 9,421-token packet against small-local's 2,500 ceiling.
- No effect on the dev slice today (the largest header is 188 tokens; no packet is over its ceiling).
- The test "stays inside the profile's budget" (`packet.test.ts:142`) never includes rules, so it can't catch this.

**L3. The "All-evidence points per 1K packet tokens" column is misleading.**
- Where: `cli.ts:296` and `:303`.
- The ratio rewards smaller packets because of diminishing returns, not because they find evidence more efficiently. That's why small-local scores 30.0 against claude's 13.8, and why the packet (which has a cutoff) beats the BM25 baseline (which always fills to the ceiling).
- Fix: compare at matched mean tokens instead, which the sweep table already does.

**L4. The recall gain over BM25 is overstated in the README.**
- On the claude profile, packet against plain BM25 is +2.1, which is 1 question out of 47, with interval +0.0 to +6.4. The settings were also tuned on this same slice.
- `evals/README.md:123` says the gain "is visible". It should say the gain hasn't been shown on the claude profile.
- I checked whether the packet's dedupe explains the gap: it doesn't. BM25 with dedupe added scores the same (36/47 claude, 27/47 small-local).

**L5. Dev and held-out overlap in the other direction too.**
- 35 of the 437 held-out questions have their evidence chat word for word inside a dev question's history.
- The README (line 107) only mentions dev evidence showing up in held-out histories (27 cases).
- Tuning here is only a few parameters, so the risk is small, but the README should say both directions.

**L6. Failures in the `full` arm and empty answers are scored as plain wrong answers.**
- Where: `arms.ts:132`.
- Nothing checks that `full` fits the reader's window; `contextWindow` is only used in the recall report. A context-overflow error becomes a wrong answer for `full`. It shows in the errors column, but it isn't separated out.
- The largest history is about 149K estimated tokens plus 16K `max_tokens`, so it probably fits in 200K.
- An empty answer (for example, if `tool_choice: none` isn't honored, which the README says hasn't been checked live) is judged wrong with no error recorded.
- Fix: count empty answers as errors.

**L7. Subagent backend: the answer key can sit next to the questions, and the committed smoke results are stale.**
- Where: `subagent.ts`; `results/smoke/`.
- Compaction needs several passes (one per summary step). Meanwhile, judge prompts for other arms of the same question, which contain the correct answer, are already waiting in the same `pending/` folder.
- The committed smoke results come from commit 4ad3090 with an older table layout and older prompts. They are labelled as a pipeline check, but the README still lists them under "Results".

**L8. Statistics are thin.**
- 50 questions, one repeat, reader temperature left at the default.
- 8 paired comparisons (4 arms each against `bare` and against `packet`) with no correction for multiple comparisons.
- Dev decisions on gaps under about 10 points are noise.

**L9. Judge weaknesses (partly disclosed already).**
- The rubric is lenient ("contains the correct answer"; knowledge-update accepts old plus new), which rewards hedged answers that list several candidates.
- Temperature isn't pinned (the paper used 0).
- A system line is added that the original doesn't have.
- `passes()` counts any reply that doesn't start with "yes" as a fail, with no error flag. All 48 committed smoke verdicts were a clean yes or no.

---

## Checked and sound

- **No label leak:**
  - The loader drops `has_answer` and renames every chat to `chat-N`.
  - The packet builder only gets the chats and the question text.
  - Rendered packets, search results and full/compaction text show no ids.
  - `q.type`, `answer`, `evidence` and `abstention` reach only the judge, recall and slicing. Nothing reads the oracle file.
- **Dev slice:** it reproduces exactly from `stratifiedSlice(all, 50, 20261125)` and matches the type mix of the full set, abstention included (3 of 50). It isn't cherry-picked.
- **Held-out split:** 437 held-out plus 13 left out plus 50 dev = 500, as documented. No held-out question has the same text as a dev question. `eval recall` refuses held-out.
- **Recall metric:** a turn counts only if all of its text is in the packet. No dev question counts as complete while missing an evidence chat; the gap the README mentions affects 4 questions but none currently.
- **Fair setup between arms:**
  - Same system prompt, the same "Current date" line and the same reader for every arm.
  - Same tool and the same number of search rounds (except plain `compaction`, as intended).
  - Matching notices that history was cut.
  - Same output cap.
  - The judge doesn't know which arm wrote the answer.
- **Judge prompts:** they match LongMemEval's `evaluate_qa.py`.
- **Errors and cost:** a failed or cut-off call counts as wrong and keeps its cost; the judge's cost is kept out of each arm's own cost.
- **Workflow:** manual trigger only, read-only permissions, inputs passed through environment variables (no script injection), data checked by sha256.

---

**Design note (non-blocking, out of scope for findings):** the packet ranks partly by a separate index of the user's words alone, and the segment cap was tuned on dev. Both suit LongMemEval, where 95.3% of dev evidence turns are user turns (85 turns). Gains over plain search and over the tool-using arms may not carry over to real chats.

---

What I didn't check: anything that needs the paid API. That includes the size of H1's effect, real token counts and summary lengths, and whether `tool_choice: none` works against the live API. I also didn't verify the model prices in `PRICES`.