# Recheck of the 16 audit findings against the current code (main @ 69c905b)

I checked everything against the code and against commands I ran on a scratch copy. The repo was not touched: `git status` is clean. In the copy:

- `npm test`: 51 pass, 0 fail.
- `npx tsc -p .`: clean.
- `eval recall` and `eval estimate` (both profiles) reproduce the committed results files byte for byte.

To check the tests, I broke each fix on purpose (mutation testing), reran `npm test`, and noted whether any test failed. I also ran my own scripts over all 500 benchmark questions.

| Id | Verdict |
|---|---|
| H1 | Fixed |
| H2 | Fixed (README arm table is stale) |
| M1 | Fixed in code; not confirmed against the live API; the SDK mapping is untested |
| M2 | Fixed (one residual note) |
| M3 | Fixed (the paired logic has no test that would catch a regression) |
| M4 | Fixed, one small gap (failed answers record 0 context tokens) |
| M5 | Partly fixed; what's left is disclosed and the reasons hold |
| M6 | Fixed (the stand-in reader still only checks plumbing; disclosed) |
| L1 | Fixed |
| L2 | Design note, non-blocking (changed anyway; uses dates a real chat has) |
| L3 | Fixed (one test gap) |
| L4 | Fixed (no test) |
| L5 | Partly fixed |
| L6 | Fixed |
| L7 | Design note, non-blocking (unchanged; uses only roles a real chat has) |
| L8 | Design note, non-blocking (changed; the register no longer shows up in eval packets) |

---

## H1. Evidence labels leaked through session ids: fixed
- **Loader.** `evals/src/longmemeval.ts:48-52` renames every chat: `const id = \`chat-${i + 1}\`;`. Evidence is remapped through a private map (`:62`).
- **Packet.** `packages/core/src/packet.ts:162` segment headers show date, confidence and matched words, and no id. The comment there reads "No chat ids here".
- **Search results.** `arms.ts:189` renders dates only.
- **My script over all 500 questions:**
  - 948 of 948 evidence ids still map, so none are dropped.
  - 0 sessions keep a raw id.
  - Across all 50 dev questions, both profiles, and the `full`, `packet` and `bare` first messages plus search results, no text matches `answer_|sharegpt_|ultrachat|chat-\d+`. The only two hits were false positives: `answer_start` inside a code snippet in a chat.
- **Tests catch a regression.**
  - Putting `chat ${seg.sessionId}` back in the packet header fails 2 tests (run.test "no arm's reader ever sees … chat ids" and a core packet test).
  - Putting raw ids back in the loader fails longmemeval.test:33.
  - Adding ids to search results fails run.test:104.
- **Doc overstatement.** `docs/eval-audit-log.md:13` says chats are renamed "in shuffled order". The code numbers them in haystack order. That isn't a leak, because ids never reach the reader, but the doc is wrong.

## H2. Unequal tools and a misleading token column: fixed
- **Tools.**
  - `arms.ts:2-3,91` give every arm except classic `compaction` the search tool. That now includes `full`.
  - A new `compaction-search` arm reads the same shared summary (`arms.ts:104-117`) plus the tool.
- **Headline column.** `run.ts:122` makes "Reader input tokens" (every reader call, tool results included) the first token column. The old context column is now "Packet or context tokens".
- **Paired tables.** `run.ts:143` pairs every arm against both `bare` and `packet`.
- **Estimate output, ceiling then floor:**
  - packet: 30,778 / 5,959 reader input tokens
  - compaction-search: 80,155 / 18,296
  - compaction: 18,222 / 18,222
- **Tests.** Taking the tool away from `compaction-search` or from `full` fails run.test:123 (and :215).
- **Stale doc.** `evals/README.md:11-18` still says "Four arms" and its table has no `compaction-search`. Line 119 correctly says five.

## M1. The last tool round could error: fixed in code, not confirmed live
- **Code.**
  - `arms.ts:125`: on the last round the tool stays defined with `toolChoice: "none"`.
  - `model.ts:275` maps it to `tool_choice: { type }`.
- **Test.** Going back to dropping tools on the last round fails run.test:123, which checks for `toolChoice "none"` with the tool still defined.
- **Gaps.**
  - Deleting the `tool_choice` line in `AnthropicModel.complete` passes all 51 tests, so the SDK mapping is unguarded. If it regressed, a real model could still call the tool on the last round, and `readerLoop` would return empty text, scored as wrong.
  - Not confirmed against the real API. The audit log (`docs/eval-audit-log.md:15`) says so; the README does not. Confirming it needs one paid call, which I didn't make.

## M2. No held-out run, and dev and held-out shared evidence: fixed
- **Code.**
  - `--split held-out` exists (`cli.ts:81-96`), and `recall` refuses it (`:85-88`).
  - `evidenceGroups` and `heldOutSplit` (`longmemeval.ts:113-163`) group by three rules: `_abs` siblings, a shared evidence turn, and at least half of turns shared.
- **Real data.**
  - 437 held out and 13 excluded, matching the README.
  - 0 dev questions have their sibling in held-out (the audit found 9).
  - 0 held-out evidence sessions are identical to dev evidence (the audit found 22).
- **Tests.** Each grouping rule alone can be removed and all tests still pass, because the fixtures are caught by more than one rule. On real data, removing any single rule also still gives 437/13, so the split is robust. But no test pins each rule on its own.
- **Disclosed and reasonable.** Only `recall` is locked out of held-out; the README (`:106`) says held-out is kept for headline numbers by convention. The reason given, that a lock wouldn't stop anyone with the repo, holds.
- **Residual note (new, non-blocking).** 37 of the 92 dev evidence chats appear as filler, not evidence, in held-out haystacks. That doesn't leak answers, but held-out isn't fully independent of what was looked at during tuning. Not disclosed.

## M3. One run, no intervals: fixed
- **Code.**
  - `--repeats` is validated (`cli.ts:133`).
  - There is a seeded percentile bootstrap over questions (`run.ts:182-198`), with repeats averaged per question first (`:170-179`).
  - `pairedTable` bootstraps the difference for each question (`:153-167`), so it is truly paired.
- **Tests.** run.test:171 and :181 cover how wide the interval is and that repeats don't count as separate questions.
- **Gap.** Replacing the paired difference with "mine minus the baseline's mean" passes all tests, so the pairing itself is unguarded.

## M4. Failed calls and truncated answers handled silently: fixed, one small gap
- **What changed.**
  - `max_tokens` and `refusal` stops throw a `BilledError` that carries usage (`model.ts:279-280`).
  - Billed failures are recorded (`arms.ts:144-156`).
  - Calls made before a failure travel with the error (`arms.ts:96-101`, `run.ts:63`).
  - A judge failure keeps the reader's answer and calls (`run.ts:59-61`).
  - There is an errors column, a 16K output cap on every call (`arms.ts:14`), and `maxRetries: 6` (`model.ts:263`).
- **Tests.** Disabling the `max_tokens` check fails run.test:235. Dropping the calls attached to an error fails run.test:110 and :190.
- **Gap.** A failed answer still records `contextTokens: 0` (`run.ts:64`), which drags that column down for the arms that error. It is no longer the headline column. The audit log discloses this; the README doesn't.

## M5. Cost estimate favored the packet: partly fixed, rest disclosed
- **What changed.**
  - The estimate now prints a ceiling (every allowed search used) and a floor (no searches) (`cli.ts:146-157`; $18.66 and $7.21 for claude).
  - Searches use real queries (`estimate.ts:28-33`).
  - `COST_CAVEATS` (`cli.ts:21`) appears in every estimate and API run header: Haiku's 5x price above 100K tokens, caching not modeled, compaction summaries paid per question.
- **Not modeled:**
  - prompt caching
  - spreading the summarizer's cost over many turns
  - real token counts (still 3.5 characters per token)
- **Do the reasons hold?** Yes, as limits of a cold, one-question replay. The harness sets no `cache_control`, so its numbers are true for this harness. But the cost-per-question column still overstates `full` and `compaction` relative to real multi-turn use, so no cost claim should come from it. The README metric "Cost per turn with caching" (`:33`) is still not produced.

## M6. Tests passed without testing their claim: fixed (one disclosed limit)
- **Label tests.** They now use real-looking ids (`answer_355c48bb`, `sharegpt_…`, `answer_9c1e_1`), and the mutations above show they fail when the leak comes back.
- **Cost test.** The false "compaction costs more than full" assertion is gone. The stand-in bills by prompt size (run.test:50), and run.test:93 checks the summarizer cost is billed to compaction.
- **Judge test.** It covers the cases the audit flagged ("No, it said yesterday.", "The eyes have it.") (judge.test:152-159).
- **Still true.** The stand-in reader passes whenever "Denver" is anywhere in its input, and the stand-in summarizer keeps the "moving" sentence by rule (run.test:59-61). The audit log (R1-L11) discloses this. The reason, that these tests check plumbing and not summary quality, holds: only a real run measures fairness.

## L1. `segmentTokens` was not a cap: fixed
- `segments.ts:144-194` splits long turns at blank lines, then lines, then sentences, then characters. The cap is now 400 (`profiles.ts:242,259`).
- Over 48,292 segments from 100 questions, measured as rendered with role prefixes: median 334, p99 404, max 470 tokens. The audit found max 12,248. Content alone stays at or under 400; the role labels add the small overshoot.
- A full 3-result search on dev is at most 1,167 tokens.
- Removing the cap fails 2 tests.

## L2. Ordering: design note, non-blocking
- No information a real chat wouldn't have: it sorts by session dates.
- Changed anyway: `packet.ts:98,176-183` sorts by the date string, then position. `earliestDate` sorts the dates.
- My check found 0 of 100 dev packets (both profiles) out of date order.
- No test pins it: sorting by position alone passes all tests. That's acceptable for a design note.

## L3. Packets overshot their budget: fixed (test gap)
- `packet.ts:77,88` now costs each segment with its real confidence, and counts the joins and the section line.
- Over all 500 questions: 0 packets over the ceiling for claude (max 7,993 of 8,000) and 0 for small-local (max 2,498 of 2,500).
- **Gap.** Going back to costing with `confidence 1` passes all tests, yet on real data it puts 15 claude and 8 small-local packets over the ceiling (max 8,013 and 2,504). The core budget test only catches a missing header cost.

## L4. `--limit` wasn't representative: fixed (no test)
- `cli.ts:98-105` uses `stratifiedSlice(dev, limit, 1)` and validates the number.
- `--limit 10` now gives 2 knowledge-update, 3 multi-session, 1 single-session-assistant, 1 single-session-user and 3 temporal-reasoning (it used to be 8 knowledge-update and 2 multi-session).
- No test: reverting to `dev.slice(0, limit)` passes all tests.

## L5. Limits of the recall metric: partly fixed
- **Fixed.**
  - A plain BM25 top-k baseline at the same ceiling (`cli.ts:247-265`). On dev, claude complete recall is 78.7% against 76.6%; small-local is 68.1% against 57.4%.
  - A blanked "rejected answer" turn no longer counts, and a split turn needs every piece (`recall.ts:101-118`). Both are tested; removing the whole-text check fails 2 tests.
- **Not fixed.**
  - `complete` still uses turn labels only, so evidence sessions with no `has_answer` turn are ignored.
  - Recall still excludes what a reader finds by searching.
- **Disclosure overstated.** The audit log (`docs/eval-audit-log.md:25`) says "Recall's other limits are noted in the report". The committed recall report only says "every labeled evidence turn is in it" and mentions neither limit.

## L6. Judge parsing: fixed
- `judge.ts:69` now reads `passes = (judgeReply) => /^\W*yes\b/i.test(judgeReply)`.
- Going back to `includes("yes")` fails judge.test:152.

## L7. A design shaped by the benchmark: design note, non-blocking
- No information a real chat wouldn't have: the user-words index uses turn roles, which a real chat has.
- The builder is unchanged (`packet.ts:124-139`).
- What was added: the BM25 baseline, and a disclosure in the recall report that 95% of the dev slice's evidence turns are user turns and this "may not carry over to real chats".

## L8. A packet-only noise register: design note, non-blocking
- No information a real chat wouldn't have.
- Changed: `packet.ts:56` keeps only answers from the current session, and the eval passes no current session.
- 0 of 100 dev packets now contain "Your latest answers". Removing the filter fails a core test.
- Separately, the "Standing rules" register (from the chat text, labeled by date) still appears in 42 of 100 dev packets. It's real-chat information and out of scope.

---

Not checked: anything that needs a paid or network call. That means M1 against the live API, real token counts for M5, and whether `output_config.effort` is the right request shape. The repo still needs tests for the SDK `tool_choice` mapping, paired bootstrapping, `--limit` stratification, real-confidence budget costing, and each held-out grouping rule on its own. All of those code paths are correct today; a regression in any of them would pass CI.