# Re-audit of the 16 eval-harness findings (beep @ 2f04267, branch main, clean tree)

I checked every finding against the current code, not the commit messages. I also mutation-tested the fixes: each fix was reverted one at a time in a scratch copy of the repo, then the full test suite was run. If a test fails when the fix is reverted, the fix is guarded. The real repo was not edited.

Commands I ran:
- `npm test`: 60/60 pass.
- `npx tsc -p .`: exit 0.
- `eval recall`, `eval estimate` and `eval estimate --profile small-local`, run in the copy. All four committed results files came out byte for byte the same (`cmp`).
- My own scripts over all 500 LongMemEval_S questions.

| # | Verdict |
|---|---|
| H1 | **Fixed** |
| H2 | **Fixed**. New minor problem: the shared compaction summary is counted twice in run totals |
| M1 | **Fixed in code and tests**. Not yet checked against the live API; the README says so and the reason holds |
| M2 | **Fixed**. The remaining overlap is disclosed and the reason holds |
| M3 | **Fixed** |
| M4 | **Fixed** |
| M5 | **Partly fixed**. The rest is disclosed rather than modeled |
| M6 | **Fixed**. One caveat about the stand-in model remains, and it is documented |
| L1 | **Fixed** |
| L2 | Design note, non-blocking. No information beyond a real chat. It was still changed and fixed |
| L3 | **Fixed** in behavior. No test catches the original cause coming back |
| L4 | **Fixed**. No test |
| L5 | **Fixed**. Two limits are disclosed and the reasons hold |
| L6 | **Fixed** |
| L7 | Design note, non-blocking. No information beyond a real chat. Design unchanged, a disclosure was added |
| L8 | Design note, non-blocking. No information beyond a real chat. It was changed: the register is now absent from eval packets |

---

## H1. Session ids leaked evidence labels: Fixed
- **Loader.** `evals/src/longmemeval.ts:47-53` renames every session to `chat-${i + 1}` and keeps a private map back to the original ids. Line 62 remaps the evidence through that map.
- **Packet.** `packages/core/src/packet.ts:160-162` renders segment headers with no id at all: `### ${seg.date ?? "undated"} · confidence … · matched …`.
- **Other places.** `searchHistory` (`arms.ts:194`) and `renderEach` (`arms.ts:197-198`) show dates only.
- **My check over all 500 questions × 2 profiles:**
  - 0 sessions have an id other than `chat-N`.
  - The evidence remap disagrees with the raw labels 0 times.
  - In the first messages of `full`, `packet` and `bare`, and in every `search_history` result, 0 contain `answer_<hex>`, `answer_ultrachat` or `has_answer`.
  - 0 chat turns contain an id-like string.
- **Tests now guard it.**
  - Mutation A (the packet prints `chat ${seg.sessionId}` again) fails 2 tests: `run.test.ts:104-108`, whose fixture uses the real-looking id `answer_9c1e_1`, and `packet.test.ts:211-216`.
  - Mutation B (the loader keeps raw ids) fails `longmemeval.test.ts:33-38`.

## H2. Unequal tools, and a misleading token column: Fixed (new minor problem)
- **Tools.** Every arm but classic `compaction` gets the same tool and the same number of rounds. `arms.ts:94` sets `maxToolRounds: 0` only when `arm === "compaction"`. A new `compaction-search` arm (`arms.ts:10`) reads the same summary through a shared promise (`arms.ts:109-122`).
- **Headline token number.** `summaryTable` (`run.ts:134`) puts "Reader input tokens", summed over all reader calls (`run.ts:118`), right after accuracy, interval and errors.
- **Paired comparisons.** Each arm is paired against `bare` and against `packet` (`run.ts:156`).
- **Regenerated estimate (ceiling).** It now shows the honest picture: packet reader input 29,755 against compaction 18,246, with packet tokens 5,717 in a separate column.
- **Mutations caught:**
  - K (`compaction-search` loses its tool) fails 3 tests.
  - J (headline column counts the packet only) fails `run.test.ts:89`.
  - P (the summary note is dropped) fails 2 tests.
- **New problem.** Both compaction arms report the shared summary's cost as their own (`arms.ts:24-27`; README:122 discloses this per arm). Summing the arms, as the estimate's "Total", the `--max-cost` pre-check (`cli.ts:139`) and the in-run `spent` counter (`run.ts:43`) all do, counts the summary twice.
  - My script, 5 dev questions: 27 summarizer calls made, 54 reported across the two arms.
  - In the committed estimate, the floor total of $7.21 is overstated by about $1.1 (one summary bill per question, roughly 15%).
  - It errs on the safe side: the cap trips early. But the run total is not what a real run would spend.

## M1. The last tool round would likely error: Fixed in code and tests, live check open
- **Code.** `arms.ts:128-131` keeps `tools: [SEARCH_TOOL]` on every round when `maxToolRounds > 0` and sets `toolChoice` to `"none"` once searches run out. `model.ts:288` sends `tool_choice: { type: req.toolChoice }`. The SDK (1.14.0) defines `ToolChoiceNone`.
- **Tests.**
  - `run.test.ts:135-151`: a reader that never stops searching makes 2 tool calls, its last request has `toolChoice` set to `none` and still carries the tool, and no error results.
  - `run.test.ts:295-303`: the API client really sends `tool_choice` and keeps `tools`.
  - Mutation C (tools dropped on the last round) fails `run.test.ts:123`.
- **Open item.** README:120 says "not yet checked against the live API". The reason holds: checking needs a paid call.

## M2. No held-out reporting, and dev and held-out shared evidence: Fixed
- **Held-out command.** `--split held-out` (`cli.ts:85-96`) uses `heldOutSplit` and `evidenceGroups` (`longmemeval.ts:113-163`). These group questions by `_abs` twin, by any evidence turn shared word for word, and by evidence chats that share at least half their turns. `eval recall` refuses held-out (`cli.ts:85-88`).
- **My independent check:**
  - Held-out has 437 questions; 13 are left out of both splits, matching README:107.
  - 0 dev siblings remain in held-out; the audit's 9 are all gone.
  - 22 of the 92 dev evidence chats appear as evidence elsewhere, and 0 held-out questions share an identical evidence chat, an evidence turn, or half their turns with dev evidence.
- **Tests.** Mutation N (no twin grouping) fails 1 test and Q (grouping ignored) fails 5. Each grouping rule has its own test (`longmemeval.test.ts:85-131`).
- **Disclosed and still open.**
  - Nothing enforces "held-out only for headline numbers" apart from the recall refusal. That is a matter of discipline, so the reason holds.
  - 45 held-out haystacks contain a dev evidence chat word for word as filler (my count; the README states the fact without a number). The README's reason ("gives no answers away") holds: those chats are not evidence for those questions.

## M3. 50 questions, one run, no intervals: Fixed
- **Code.**
  - `--repeats` exists (`cli.ts:39`, `run.ts:33-34`).
  - The 95% percentile bootstrap resamples questions after averaging repeats (`run.ts:182-211`).
  - The paired tables use a per-question bootstrap of the differences (`run.ts:166-180`).
  - The recall report adds intervals and a paired difference.
- **Tests.**
  - `run.test.ts:171-178` (the interval narrows as questions are added) and `run.test.ts:181-188`.
  - Mutation R (repeats counted as separate questions) fails `run.test.ts:181`.

## M4. Failed calls and truncated answers were handled silently: Fixed
- **Code.**
  - `model.ts:292-293`: a `refusal` or `max_tokens` stop throws `BilledError`, which carries the usage.
  - `arms.ts:149-161` records the cost of a billed failure.
  - `arms.ts:101-106` attaches calls made before the failure.
  - `run.ts:63-68` keeps them, including a judge failure.
  - Errors column (`run.ts:126`). Every call's output cap is `MAX_OUTPUT = 16_000` (`arms.ts:14`). The SDK client gets `maxRetries: 6` (`model.ts:276`).
  - I checked that 16K stays under the SDK's non-streaming guard: (3600 × 16000) / 128000 = 450 s, under 600 s (`client.js:928`).
- **Mutations caught:** H (no `max_tokens` check), I (failed arm drops its calls), O (summarizer cap of 4000) and U (judge-failure cost dropped) each fail at least 1 test.

## M5. Cost estimate and framing favor the packet: Partly fixed
- **Fixed.**
  - The estimate now prints a ceiling (every search used) and a floor (none) (`cli.ts:146-157`; `estimate.ts:18`).
  - Judge cost is split from each arm's own cost (`run.ts:109-123`).
  - `COST_CAVEATS` (`cli.ts:21`) goes into every estimate and API-run header.
- **Not fixed, disclosed only:**
  - Prompt caching is not modeled.
  - Each question still pays for its own compaction summaries.
  - Tokens are still estimated at 3.5 characters per token, so whether `full` really crosses the 100K long-prompt price step is unverified.
  - README:34 still lists "Cost per turn with caching" as a metric, and it is not implemented.
- **Do the reasons hold?** The disclosure is accurate, so they hold as long as no cost claim is made from these columns. As it stands, the cost per question still overstates `full` and compaction relative to real multi-turn use. The double-counted summary (under H2) skews totals a little further.

## M6. Tests that passed without testing their claim: Fixed (one caveat remains)
- **Label tests** now use real-looking ids, and mutations A and B are caught (see H1).
- **The false cost assertion is gone.** The stand-in now bills by prompt size (`run.test.ts:49-50`). Line 93 checks only that summaries are billed to compaction.
- **Judge test** now covers the weak spots: "No, it said yesterday." and "The eyes have it." (`judge.test.ts:179-186`). Mutation L fails it.
- **New test that tells arms apart:** with no tools, `bare` fails where `packet` passes (`run.test.ts:154-161`).
- **Caveat that remains.** The stand-in reader still passes whenever "Denver" appears anywhere in the request (`run.test.ts:61`), and the stand-in summarizer still keeps the "moving" sentence by rule (`run.test.ts:59`). So those end-to-end tests check plumbing, not how fairly the arms compare. This is documented in `docs/eval-audit-log.md` (R1-L11, R2-L7), and only a real run can test summary quality.

## L1. `segmentTokens` was not a size cap: Fixed
- **Code.**
  - `segments.ts:276-281` flushes before any piece that would cross the cap, not only before user turns.
  - `splitTurn` (`segments.ts:287-306`) splits long turns at blank lines, then lines, then sentences, then anywhere.
  - The cap is now 400 (`profiles.ts:354`).
- **Measured** over 48,292 segments from 100 questions:
  - Content tokens: max 400, 0 over the cap.
  - Rendered with `role:` prefixes: median 334, p99 404, max 470.
  - A 3-result `search_history` call: median 825 tokens, max 1,215 (it was up to 12K).
- **Tests.** Mutation G (cut only before user turns) and S (`splitTurn` never splits) both fail `packet.test.ts:192`.

## L2. "Oldest first" was sometimes wrong: design note, non-blocking (and fixed)
- **Information check.** Dates are what a real chat has, so no information beyond a real chat is involved.
- **What changed.**
  - The sort key is date, then position (`packet.ts:98, 175-179`).
  - The notice now uses the earliest date (`packet.ts:181-183`), and so does `bare` (`arms.ts:79`).
- **Measured.** All dates are in the fixed-width sortable form. 0/500 packets at either profile have headers out of order, and 0 notices have the wrong "since" date.
- **No test.** Mutations E and E2 pass the suite. That is acceptable for a design note.

## L3. Packets overshot their budget: Fixed in behavior, test gap
- **Code.**
  - `packet.ts:77` subtracts the head plus the `\n\n${RETRIEVED}` section line before filling.
  - `packet.ts:88` measures each segment's cost with its real confidence.
- **Measured.** 0/500 packets over 8,000 tokens (max 7,993), and 0/500 over 2,500 (max 2,498).
- **Test gap.**
  - The test `packet.test.ts:142-159` now sweeps ceilings from 300 to 3000 and catches mutation D2 (the section line not counted).
  - It does not catch mutation D, which brings back the original cause (cost measured at `confidence 1`). With D applied, the suite passes, but 15/500 real packets go over 8,000 (max 8,013) and 8/500 go over 2,500.
  - The test still uses synthetic data only.

## L4. `--limit` was not representative: Fixed (no test)
- **Code.** `cli.ts:104` now uses `stratifiedSlice(dev, limit, 1)`.
- **Measured.**
  - `--limit 5` takes one question from each of 5 types.
  - `--limit 10` takes knowledge-update 2, multi-session 3, single-session-assistant 1, single-session-user 1, temporal-reasoning 3.
- **No test.** Mutation M (back to taking the first n) passes the suite.

## L5. Limits of the recall metric: Fixed (two limits disclosed)
- **Plain-BM25 baseline added** at the same ceiling, with intervals and a paired difference (`cli.ts:246-268`). Committed report: claude +2.1 (interval +0.0 to +6.4); small-local +10.6 (+2.1 to +21.3).
- **Blanked and partial turns** no longer count as recalled (`recall.ts:52-63`). Mutation T fails 2 tests.
- **Disclosed in the report header:** chats with no labeled evidence turn aren't counted, and what a reader finds by searching is left out. Both reasons hold:
  - The audit found that unlabeled chats change nothing on dev.
  - What search adds depends on the reader, so it belongs in an accuracy run.
- **Also disclosed:** the baseline's token count flatters it slightly.

## L6. Judge parsing: Fixed
- **Code.** `judge.ts:111` is `passes = /^\W*yes\b/i.test(judgeReply)`. It is stricter than the benchmark's script, which README:124 discloses.
- **Test.** `judge.test.ts:179-186`. Mutation L fails it.

## L7. A builder design shaped by the benchmark: design note, non-blocking
- **Information check.** The user-words index uses turn roles, which any real chat has. No benchmark labels are involved.
- **Design unchanged.** `packet.ts:124-139` still fuses the all-words and user-words rankings.
- **Disclosure added.**
  - The recall report notes that 95% of dev evidence turns are user turns and that this "may not carry over to real chats".
  - `profiles.ts:352-353` admits the 400-token cap was tuned on this benchmark.
  - The report calls its own numbers tuning numbers.

## L8. A packet-only noise register: design note, non-blocking (changed)
- **Information check.** The assistant's own earlier answers are real-chat information.
- **What changed.**
  - `packet.ts:56` keeps only answers from the current chat that aren't already riding along raw.
  - `packet.ts:54` does the same for the results register.
  - The eval never passes a current chat, so both registers are empty there.
- **Measured.** 0 of 1,000 packets contain "Your latest answers" or "Latest results you gave".
- **Test.** No dedicated test, but mutation F (any chat allowed) happens to fail `packet.test.ts:161`.

---

**Not checked:**
- Anything that needs a paid call: whether `tool_choice: none` with prior tool turns is accepted, and real token counts against the 3.5 characters-per-token estimate. The 100K price step and the cost framing depend on the latter.
- The `--split held-out` and `--repeats` paths, beyond reading the code.
- The GitHub workflow, which I only looked at in the diff.

**Risks that remain:**
- Run totals and the cost cap count the shared compaction summary twice.
- Nothing stops the L3 cause (measuring at `confidence 1`) from coming back unnoticed.

My scripts are in /tmp/claude-0/-home-user-beep/20a8eb28-71a3-56f9-b3ba-5051337ca9eb/scratchpad/c2/zz/ and /tmp/claude-0/-home-user-beep/20a8eb28-71a3-56f9-b3ba-5051337ca9eb/scratchpad/scripts/mutate.py.