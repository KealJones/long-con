## Verdicts

| # | Verdict | One line |
|---|---|---|
| H1 | **Fixed** | The loader renames every chat to `chat-N`, and the packet and search output print no ids. Tests now use real-looking `answer_…` ids, and reverting any of the three fixes fails a test. |
| H2 | **Fixed** (small gaps) | There is a new `compaction-search` arm, every arm except classic `compaction` gets the same search tool, reader input is the headline token number, and there is a paired table against `bare`. Tests catch it if the tool is taken away again. The headline column is not guarded by any test. |
| M1 | **Fixed** | On the last round the tool stays defined, with `tool_choice: none`. Reverting this fails a test. |
| M2 | **Fixed**, one gap left | `--split held-out` gives 438 questions and leaves out 12 that share evidence with dev. Exact twins and exact copies are gone, but one near-duplicate pair still crosses the split. |
| M3 | **Fixed** (code); one test is hollow | There are repeats, bootstrap intervals and a paired interval. The test for "repeats count once" passes even when that behavior is broken. |
| M4 | **Partly fixed** | Failed answers now keep their calls, `max_tokens` and refusals throw, output is capped at 16K, there are 6 retries and an Errors column. But the call that throws, often the costliest one, is never recorded, and the `stop_reason` checks have no test. |
| M5 | **Partly fixed** | Caveats are added and the estimate is now a ceiling. Caching is still not modeled and compaction is still billed per question. **New problem:** the ceiling makes `full` look about 72x dearer than packet, up from about 12x. The README contradicts the code on long-prompt pricing. |
| M6 | **Partly fixed** | The label, cost and judge tests are fixed and catch regressions. The stand-in reader and summarizer still play into the answer, and two new tests are hollow. |
| L1 | **Fixed** | Units now stay under the 400-token cap (max 401). Reverting the turn split fails a test. |
| L2 | **Design note, non-blocking** (changed anyway) | Only real-chat information is used. Order is now by date: 0 of 500 packets out of order. |
| L3 | **Partly fixed** | Budget is measured at the real confidence now, but 9 of 500 (claude) and 31 of 500 (small-local) packets still overshoot. No test catches a revert. |
| L4 | **Fixed** | `--limit` now takes a stratified pick. There is no test, which is fine for a CLI flag. |
| L5 | **Partly fixed** | A plain BM25 top-k baseline is added. The other three limits are unchanged. |
| L6 | **Fixed** | The judge reply must open with yes. The test covers "eyes", "No, … yesterday" and `**Yes**`. |
| L7 | **Design note, non-blocking** (code unchanged; now disclosed and measured) | Uses only role labels, which a real chat has. |
| L8 | **Design note, non-blocking** (changed) | The recent-answers register now only reads the current chat, so it never fires in evals (0 of 500). A standing-rules register still adds noise to 21 of 50 dev packets, but it uses only real-chat information. |

**What I ran:**
- `npm test`: 41 of 41 pass.
- `npx tsc -p .`: clean, exit 0.
- `eval recall`, `eval estimate` and `eval estimate --profile small-local`, run in a copy at `/tmp/claude-0/-home-user-long-con/20a8eb28-71a3-56f9-b3ba-5051337ca9eb/scratchpad/copy`. All three reproduce the committed results byte for byte. The real repo is untouched (`git status` is empty).
- My own checks on the real data: `/tmp/claude-0/-home-user-long-con/20a8eb28-71a3-56f9-b3ba-5051337ca9eb/scratchpad/check.ts`, `check2.ts`, `check3.ts` and `near.py` in the same folder.
- A mutation script, `/tmp/claude-0/-home-user-long-con/20a8eb28-71a3-56f9-b3ba-5051337ca9eb/scratchpad/mutate.sh`. It undoes one fix at a time in a throwaway copy and runs the tests. Results are in `mutate.out` in the same folder.

---

## H1: evidence labels leaked through chat ids. **Fixed**
- **Loader:** `evals/src/longmemeval.ts:48-52` sets `const id = \`chat-${i + 1}\`` and keeps a private map so recall still finds the evidence (`:62`).
- **Packet:** `packages/core/src/packet.ts:157` renders `### ${seg.date} · confidence … · matched …`, with no id. Search results print the date only (`evals/src/arms.ts:301`).
- **Real data:**
  - 0 sessions in all 500 questions keep their original id.
  - The evidence session counts match the raw data for all 500.
  - Across dev, at both profiles, I checked every reader's first message (`full`, `packet`, `bare`) and the search output against `answer_|sharegpt|ultrachat|chat-\d+|has_answer|_abs`. The only match is code inside a chat (`answer_start = torch.argmax(...)` in question 8077ef71, `full` arm), not an id.
- **Tests now use real-looking ids.** `run.test.ts:27` uses `answer_9c1e_1`; `longmemeval.test.ts:189` uses `answer_355c48bb` and `sharegpt_…`; `packet.test.ts:207` uses `answer_7f3e_1`. Each revert fails a test:
  - printing `chat ${seg.sessionId}` in the packet fails tests 20 and 39;
  - keeping raw ids in the loader fails test 8;
  - printing the id in search results fails test 20.

## H2: unequal tools, and a token column that hid it. **Fixed** (small gaps)
- **Tools:**
  - `arms.ts:226-229`: `compaction` runs with `maxToolRounds: 0`, while `compaction-search` uses the same summary with the tool.
  - `full`, `packet` and `bare` share `readerLoop` with the profile's tool rounds (`:245`).
  - Test 22 checks that every arm except `compaction` reads with `search_history`. Taking the tool from `compaction-search` or from `full` fails it.
- **Headline tokens:**
  - `run.ts:99` sums input over every reader call, and `summaryTable` puts "Reader input tokens" before "Packet or context tokens" (`run.ts:113`).
  - The committed estimate (claude) shows packet at 26,984 reader input tokens, compaction at 18,222, and compaction-search at 131,460.
- **Paired table:** `pairedTable` against `bare` (`run.ts:140-154`), checked by test 23.
- **Gaps:**
  - Making `readerInputTokens` equal `contextTokens` fails no test. Test 18's "packet < full / 5" holds either way.
  - `compaction` and `compaction-search` each write their own summaries (`compact()` is called once per arm). Their difference therefore includes summary-to-summary noise, and the summaries are paid for twice.

## M1: the last tool round could error. **Fixed**
- `arms.ts:245` reads: `tools: [SEARCH_TOOL], toolChoice: canSearch ? "auto" : "none"`.
- `model.ts:248` passes `tool_choice: { type }`.
- Test 22's greedy reader checks that the last call has `toolChoice === "none"`, the tool still defined, and no error.
- Going back to dropping tools on the last round fails test 22.
- Whether the real API accepts this was not checked: that needs a paid call.

## M2: no held-out reporting, and dev shared evidence with held-out. **Fixed**, one gap left
- **Held-out command:**
  - `cli.ts:91-96` adds `--split held-out` using `heldOutSplit`.
  - `cli.ts:85-88` refuses `recall` on held-out.
  - The workflow has a `split` input.
- **Grouping:** `longmemeval.ts:112-146` joins `X` with `X_abs` and questions with identical evidence chats (sha256 of the turns).
- **On real data:** 438 held out and 12 left out. 0 `_abs` siblings cross the split, and 0 of the 92 dev evidence chats appear word for word in held-out evidence.
- **Test:** test 14. Making `heldOut = rest` fails it.
- **Gap:** grouping only catches identical chats. Dev `gpt4_1e4a8aec` and held-out `gpt4_1e4a8aeb` (both gardening and tomato saplings) have evidence chats that share 9 of 12 and 11 of 12 turns, including one `has_answer` turn word for word. It is the only pair over 50% shared turns (`near.py`).
- **Minor new problems:**
  - `cli.ts:134` always writes `longmemeval-s-dev50-estimate-<profile>.md`, so `estimate --split held-out` or `--limit` overwrites the committed dev estimate. `recall --limit` does the same to the committed recall report.
  - The help text says held-out is "the other 450" (it is 438), says "all four arms", and gives the default `--arms` as four arms when it is five.

## M3: one run, no intervals. **Fixed** (code); one test is hollow
- `--repeats` (`cli.ts:58,122-127`), a seeded percentile bootstrap over questions (`run.ts:169-185`), with repeats averaged per question (`:157-166`), and a paired bootstrap of per-question differences (`:148-150`).
- Test 25 checks the interval width. Making the bootstrap return a single point fails it.
- **Hollow test:** test 24 claims "a question repeated counts once in the interval". If I make every repeat its own question, it still passes, because every answer passes and the interval is [1, 1] either way.

## M4: failed calls and cut-off answers were silent. **Partly fixed**
- **Done:**
  - `arms.ts:233-236` attaches the calls made so far to the error, and `run.ts:57` keeps them. Reverting either fails test 21.
  - `model.ts:251-252` throws on `refusal` and `max_tokens`.
  - `MAX_OUTPUT = 16_000` (`arms.ts:160`).
  - `maxRetries: 6` (`model.ts:238`).
  - An Errors column (`run.ts:105,117`).
- **Not done:**
  - The call that throws is never recorded. `call()` pushes only after `complete()` returns (`arms.ts:265-266`), and `AnthropicModel` throws on `max_tokens` before returning usage. A 16K-output failure, which is billed, disappears from cost and tokens.
  - Failed answers still record `contextTokens: 0` (`run.ts:58`).
  - No test covers the `stop_reason` checks or the 16K cap. Removing the `max_tokens` throw, or setting `MAX_OUTPUT` back to 4000, fails nothing.

## M5: cost framing favored the packet. **Partly fixed**
- **Done:**
  - `COST_CAVEATS` (`cli.ts:21`) appears in the estimate and API-run headers and covers the over-100K price step, caching and the per-question summaries.
  - The estimate now assumes every allowed search is used (`estimate.ts:13-16`), so it no longer understates the tool arms.
- **Not done:** caching is still not modeled, summaries are still billed per question, and token counts are still estimates.
- **New problem:**
  - Because `full` now has the tool, the ceiling assumes it resends the 141K history 4 times. The committed estimate shows `full` at 1,006,482 reader input tokens and $0.5099 per question, against packet at $0.0071, about 72x. The audit flagged about 12x.
  - The README (`evals/README.md:120`) says Haiku's over-100K pricing "isn't modeled", but `model.ts:224,232` models it and `COST_CAVEATS` says it is billed.

## M6: tests that passed without testing their claim. **Partly fixed**
- **Fixed:**
  - Label tests use real-looking ids (see H1); the mutations are caught.
  - The cost test is gone. The stand-in now bills by prompt size (`run.test.ts:45`); going back to a flat 100 tokens fails test 18.
  - The judge test now covers the parsing weak spots (see L6).
  - Test 23 (with no tools, `bare` fails where `packet` passes) actually tells the arms apart.
- **Unchanged:** the stand-in reader still answers whenever "Denver" appears anywhere (`run.test.ts:54`), and the stand-in summarizer still keeps the "moving" sentence by regex (`:52`).
- **New hollow tests:**
  - Test 24 (see M3).
  - Test 18 says "measured on everything the reader took in", but it also passes when only context tokens are counted.

## L1: `segmentTokens` was not a size cap. **Fixed**
- `segments.ts:200-250` splits long turns at blank lines, then lines, then sentences, then characters.
- The claude profile uses `segmentTokens: 400`.
- Over 48,292 units from 100 questions: median 330 tokens, p99 400, max 401 (8 units at 401).
- Three dev search results come to a median of 824 tokens and a max of 1,167.
- Turning off the turn split fails test 38.

## L2: "oldest first" was sometimes wrong. **Design note, non-blocking**
- No information a real chat wouldn't have: it is only dates and order.
- Changed anyway:
  - The sort key is date, then place (`packet.ts:95,171-174`).
  - The "since" date is now the earliest date (`:176-178`, and `bare` at `arms.ts:217`).
  - Every date in the data has the shape `9999/99/99 (Ddd) 99:99`, so sorting as text is safe.
  - Out of order: 0 of 500 at both profiles. Wrong "since" date: 0 of 500.
- No test catches a revert of either fix.

## L3: packets overshot their budget. **Partly fixed**
- The cost is now measured at the real confidence (`packet.ts:85`).
- Still over budget:
  - claude: 9 of 500 packets, max 8,008.
  - small-local: 31 of 500, max 2,509.
  - The committed recall report itself shows "Largest packet 2,508" against a 2,500 ceiling.
- Cause: the header estimate (`:74`) leaves out the blank line, the "Retrieved history, oldest first:" line and the joining newlines. For example, question 19b5f2b3 has parts summing to 2,500 but a total of 2,508.
- Going back to measuring at confidence 1 fails no test. Test 35 uses only synthetic data.

## L4: `--limit` was not representative. **Fixed**
- `cli.ts:98-105` uses `stratifiedSlice(dev, limit, 1)`.
- `--limit 10` now gives 2 knowledge-update, 3 multi-session, 1 single-session-assistant, 1 single-session-user and 3 temporal-reasoning. It was 8 knowledge-update and 2 multi-session.
- Integer validation is added. There is no test.

## L5: limits of the recall metric. **Partly fixed**
- **Done:** `bm25Runs` (`cli.ts:222-236`) adds a plain BM25 top-k baseline at the same ceiling.
  - claude: 78.7% complete recall against 76.6% for plain BM25.
  - small-local: 70.2% against 59.6%.
- **Unchanged** (`recall.ts` is as before):
  - Recall still counts only packet segments, not what the reader finds by searching.
  - "Complete" still uses turn labels only.
  - A blanked rejected turn would still count as recalled.

## L6: judge parsing. **Fixed**
- `judge.ts:105` reads `passes = /^\W*yes\b/i`.
- Test 7 checks "No, it said yesterday." and "The eyes have it." as fails, and `**Yes**` as a pass.
- Going back to `includes("yes")` fails test 7.

## L7: a builder shaped by the benchmark. **Design note, non-blocking**
- No information a real chat wouldn't have: role labels exist in real chats.
- The code is unchanged: indexing user words alone is still fused with all words (`packet.ts:121-136`).
- Changed: the recall report now says it suits LongMemEval (94% of evidence turns are user turns), and the BM25 baseline measures what it adds.
- The profile comment (`profiles.ts:296-297`) admits the 400-token cap was picked on the dev slice.

## L8: a packet-only register. **Design note, non-blocking**
- No information a real chat wouldn't have.
- Changed: `packet.ts:55` keeps recent answers only from the current chat. The evals pass no current chat, so "Your latest answers" appears in 0 of 500 packets.
- Still there:
  - The standing-rules register (`packet.ts:60-63`) appears in 162 of 500 packets, 21 of 50 on dev.
  - It is mostly filler. For example, question 18bc8abd (about BBQ sauce) carries "Remember to trust your creative instincts and let the story unfold naturally."
  - It is packet-only, but taken from the user's own past turns.

---

Not checked: whether the API accepts `tool_choice: none` with thinking on the final round, and real token counts. Both need paid calls.

The one finding that can still bias results is M2's near-duplicate pair. Besides that, the M4 failed-call cost and the M5 ceiling skew both understate `full`'s side of the comparison, the M4 one in measured runs and the M5 one in the committed estimate. Nothing in the repo was edited.
