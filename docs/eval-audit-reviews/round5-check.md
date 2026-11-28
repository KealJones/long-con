## Verdicts

| # | Finding | Verdict |
|---|---|---|
| H1 | Session ids leak evidence labels | Fixed |
| H2 | Arms get unequal tools; the headline token column hides it | Fixed |
| M1 | The tools-less last round probably errors | Fixed in code. Not yet run against the live API, which the README says |
| M2 | No held-out command; dev and held-out share evidence | Fixed. Some filler overlap is left, and the README says so |
| M3 | 50 questions, one run, no intervals | Fixed |
| M4 | Failed calls and cut-off answers handled silently | Fixed. The fix adds one new minor problem, below |
| M5 | The cost estimate and its framing favor the packet | Partly fixed. What's left is disclosed, and the reasons hold |
| M6 | Tests that pass without testing their claim | Fixed. The stand-in model limit remains, as it has to |
| L1 | `segmentTokens` isn't a size cap | Fixed |
| L2 | "Oldest first" is sometimes wrong | Design note, non-blocking. Uses only what a real chat has. Changed anyway |
| L3 | Packets overshoot their budget | Partly fixed. The code is right, but no test would catch it breaking again |
| L4 | `--limit n` isn't representative | Fixed |
| L5 | Limits of the recall metric | Fixed, with the rest disclosed |
| L6 | Judge parsing | Fixed |
| L7 | A builder design shaped by the benchmark | Design note, non-blocking. Uses only what a real chat has. Code unchanged, now disclosed |
| L8 | A packet-only noise register | Design note, non-blocking. Uses only what a real chat has. Changed: it no longer appears in eval packets |

**How I checked.** Everything ran on a copy of HEAD `c1393b1`, with the data symlinked in. `npm test` passed 66 of 66 and `npx tsc -p .` exited 0. `eval recall` and `eval estimate` for both profiles reproduced the committed results files byte for byte: `git status` showed only `evals/data/.gitkeep`, which my copy left out. No paid calls, no network, no repo edits.

**Mutation testing.** I broke each fix on purpose, one at a time, and ran the suite. All my scripts are in `/tmp/claude-0/-home-user-beep/20a8eb28-71a3-56f9-b3ba-5051337ca9eb/scratchpad/v2s/`, and the mutation runner is `/tmp/claude-0/-home-user-beep/20a8eb28-71a3-56f9-b3ba-5051337ca9eb/scratchpad/v2s/mut.mjs`.
- 24 of 29 mutations made a test fail, plus a corrected rerun of the loader-sort mutation.
- 5 broke nothing. Three matter: the paired-against-bare table being dropped (H2), the estimate's no-search floor (M5) and the budget measured at confidence 1 (L3).
- The other two were a smaller `MAX_OUTPUT` value and turning off the long-prompt price step. Neither is a regression of any finding.
- The packet's own date sort isn't tested either. The eval doesn't need it, because the loader already sorts by date and that sort is tested (L2).

---

## H1: Fixed
- **Loader.** `evals/src/longmemeval.ts:50-57` renames every chat `chat-${n + 1}` after a date sort and keeps a private map back to the original ids. Line 66 maps the evidence through that map.
  - All 948 evidence session entries map across, the same number as the raw file (the audit's 914 likely counted unique ids).
  - Every session in all 500 questions has an id matching `^chat-\d+$`.
- **Packet.** `packages/core/src/packet.ts:161-162` renders `### ${seg.date} · confidence … · matched …` with no id.
- **Search tool.** `evals/src/arms.ts:380` renders `### ${item.date}` with no id.
- **Real data.** On the 50 dev questions, at both profiles, I checked the first message of the full, packet and bare arms, the search output and the packet text. No raw session id appears, and `chat-N` is never mentioned.
  - The only `answer_` hits were Python code inside one chat (`answer_start = torch.argmax…`, question 8077ef71). That's chat content, and every arm sees it.
- **Tests now use real-looking ids.** `run.test.ts:28` uses `answer_9c1e_1`, `longmemeval.test.ts:36` uses `answer_`, and `packet.test.ts:211-216` uses `answer_7f3e_1`.
  - Mutations that pass raw ids through the loader, print `chat ${seg.sessionId}` in the packet, or add the id to search output each fail 1 or 2 tests.
- **No new problem.** 13 questions repeat a filler session id, so the id map keeps the later one. None of the repeated ids is evidence, so evidence mapping is unaffected.

## H2: Fixed
- **Tools.**
  - A `compaction-search` arm now exists (`arms.ts:177,264`).
  - `full`, `packet`, `bare` and `compaction-search` all go through the same `readerLoop` with the search tool.
  - Only classic `compaction` gets `maxToolRounds: 0`, and the README states that on purpose.
- **Headline token number.**
  - `summaryTable` (`run.ts:242`) puts "Reader input tokens" first: every reader call, tool results included (`run.ts:225`).
  - The packet-only number is now the later "Packet or context tokens" column.
- **Clean comparison.** `writeSummary` (`run.ts:264`) adds paired tables against `bare` and against `packet`.
- **Estimate shows it.** At the ceiling, packet reader input is 29,755 tokens against compaction's 19,176. So the column people read no longer flatters the packet.
- **Tests.** Mutations that take the tool from `full` or `compaction-search`, or count only the first reader call, each fail tests.
  - Gap: removing the bare paired table from `writeSummary` fails nothing.
- **Disclosed.** The README says `packet` against `bare` measures the builder's own retrieval too, and points to the recall report's BM25 baseline to isolate it.

## M1: Fixed in code, not yet run against the live API
- **Code.** `arms.ts:309`: `tools = maxToolRounds > 0 ? { tools: [SEARCH_TOOL], toolChoice: canSearch ? "auto" : "none" } : {}`. `model.ts:75` sends `tool_choice: {type: "none"}`, and `auto` with `disable_parallel_tool_use: true`.
- **Tests.** `run.test.ts:136-152` checks that the last call keeps the tool with `toolChoice` "none". `run.test.ts:300-308` checks the API body. Both mutations fail tests.
- **Fallback.** A tool call on a no-tool round becomes an "Empty answer" error rather than a quiet wrong answer (`run.ts:157`, `run.test.ts:310`).
- **Disclosed.** The README says "not yet checked against the live API". That reason holds: it needs one paid call, which neither audit was allowed.

## M2: Fixed, residual disclosed
- **Held-out command.**
  - `--split held-out` exists (`cli.ts:91-96`).
  - `recall` refuses held-out (`cli.ts:85-88`).
  - `heldOutSplit` and `evidenceGroups` (`longmemeval.ts:117-167`) group `_abs` twins, any shared evidence turn, and evidence chats sharing half their turns.
- **Real data.**
  - 437 held out, 13 left out of both, as the README says.
  - All 9 sibling pairs the audit named are excluded.
  - The audit's 22 of 92 dev evidence chats reused word for word in non-dev questions: 0 remain in held-out.
  - Held-out questions with a dev evidence turn word for word: 0.
- **Tests.** Removing any one of the three grouping rules fails a test.
- **Disclosed.** Only the recall refusal enforces the rule. Filler overlap runs both ways, and reworded evidence is missed (one clear case). These reasons hold: none of them gives answers away.

## M3: Fixed
- `--repeats` exists.
- Bootstrap intervals use per-question means, so repeats count once (`run.ts:291-320`).
- Paired tables bootstrap the per-question differences (`run.ts:274-289`).
- Tests: a point-estimate bootstrap and counting repeats separately each fail tests.
- The README says to treat dev gaps under about 10 points as noise, that there's no correction for multiple comparisons, and that headline claims need held-out plus repeats. The default is still one run, and that's disclosed.

## M4: Fixed, with one new minor problem
- **What's fixed.**
  - Calls made before a failure ride along with the error (`arms.ts:271-276`, `run.ts:169`), and a billed failure keeps its usage (`arms.ts:337`).
  - `max_tokens` and `refusal` raise a `BilledError` (`model.ts:79-80`).
  - Retries are now 10 (`model.ts:62`), and the output cap is 16,000 (`arms.ts:181`).
  - An empty answer counts as an error.
  - Errors and outages are separate columns. Outages are rate limits, 5xx errors and lost connections (`model.ts:95-98`).
  - All six related mutations fail tests.
- **New problem.** Outages are left out of accuracy, but they still count in the per-question token and cost averages, because `n = mine.length` includes them (`run.ts:204,225-228`).
  - My check, `/tmp/claude-0/-home-user-beep/20a8eb28-71a3-56f9-b3ba-5051337ca9eb/scratchpad/v2s/outage.ts`: 2 good `full` answers at 140K tokens plus 2 outages gives readerInputTokens 70,000 and cost per question $0.035.
  - That's half the true value, and it understates exactly the large-prompt arms the audit worried about.
  - The README warns only about accuracy covering fewer questions, not about tokens or cost.
- **Small gap.** An empty compaction summary isn't checked.

## M5: Partly fixed, disclosed, reasons hold
- **What's fixed.**
  - The estimate now prints a ceiling (every allowed search) and a floor (none), and the cap uses the ceiling (`cli.ts:147-157`, `estimate.ts:441`).
  - The shared summary is counted once in run totals.
- **What's disclosed, not modeled.** Every estimate and run header carries `COST_CAVEATS` (`cli.ts:21`): the 5x price over 100K tokens that every full call crosses, no caching modeled, and each question paying for its own summaries.
- **Reasons hold.**
  - Token counts are still estimates at 3.5 characters per token, which can't be checked offline. A real API run bills real usage, so only the estimate depends on it.
  - Caching is listed as a planned metric in the README.
- **Test gap.** The `EstimatingModel` floor isn't tested: making it search anyway fails nothing.

## M6: Fixed, one inherent limit
- **Label tests** now use `answer_…` ids, and the leak mutations fail them (see H1).
- **The false cost assertion is gone.** `run.test.ts:94` now asserts that summaries are billed, and the stand-in model bills by actual prompt size (`run.test.ts:50`).
- **Judge test** now covers "No, it said yesterday." and "The eyes have it." (`judge.test.ts:196-197`), and the `includes("yes")` mutation fails it.
- **Remaining limit.** The stand-in reader still answers whenever "Denver" is in its request, and the stand-in summarizer still keeps the "moving" sentence (`run.test.ts:59-61`). The end-to-end test shows plumbing and what each arm saw, not fairness. That's inherent to an offline stand-in, and nothing claims more.

## L1: Fixed
- `splitIntoSegments` and `splitTurn` (`segments.ts:205-255`) split long turns at paragraph, line, sentence, then character.
- Over 48,292 segments from 100 questions, the largest content total is 400. Rendered with "user: " prefixes, the largest is 470, because prefixes aren't counted, so `profiles.ts:273`'s "hard cap" is slightly loose.
- The largest 3-hit search result on dev is 1,167 tokens, against the audit's 12K single segment.
- Removing the split fails `packet.test.ts:192`.

## L2: Design note, non-blocking. Changed anyway
- Ordering by date uses timestamps, which a real chat has.
- **Changed.**
  - The loader sorts chats by date for every arm (`longmemeval.ts:50`).
  - The packet sorts by date, then position (`packet.ts:98,176-179`).
  - The notice uses the earliest date (`packet.ts:181-183`, `arms.ts:249`).
- **Verified.** No haystack is out of date order after loading, and no packet is out of order at either profile, across all 500. Dates are all zero-padded, so sorting them as text works.
- **Tests.** The loader sort is tested. The packet's own sort isn't, which is harmless since the loader already orders by date.

## L3: Partly fixed
- **Code.** The budget counts the final text: `packet.ts:77` subtracts the head plus the section line, and `packet.ts:88` measures cost with the real confidence.
- **Verified on all 500.**
  - claude: largest packet 7,993, 0 over 8,000.
  - small-local: largest 2,498, 0 over 2,500.
  - Largest header (rules) is 394 tokens, so the README's "under 400" holds.
  - Uncapped rules are disclosed.
- **Test gap.** Putting back the old bug (cost at confidence 1) passes every test. On real data that bug brings back 15 of 500 packets over 8,000 (max 8,013) and 8 over 2,500. The budget test the audit flagged still uses synthetic data, so it can't catch this.

## L4: Fixed
- `cli.ts:98-105` uses `stratifiedSlice(dev, limit, 1)`.
- `--limit 10` now gives 2 knowledge-update, 3 multi-session, 3 temporal, 1 single-session-user and 1 single-session-assistant, instead of 8 knowledge-update.
- Preference questions (3 of 50) round to 0 at 10.

## L5: Fixed, rest disclosed
- **Baseline.** A plain BM25 top-k at the same ceiling, with paired intervals (`cli.ts:254-272,303-314`). On claude the packet wins by only +2.1, interval +0.0 to +6.4. The README honestly calls that not a shown gain.
- **Blanked turns.** `recall.ts:528-535` requires a turn's full text in the packet, so a blanked turn doesn't count. The mutation fails `recall.test.ts:239`.
- **Disclosed.** Chats with no labeled turn aren't counted, and recall leaves out what a reader would find by searching.

## L6: Fixed
`judge.ts:493` is `/^\W*yes\b/i`. The test covers "yesterday", "eyes" and "**Yes**".

## L7: Design note, non-blocking
- Indexing the user's words uses only turn roles, which a real chat has.
- The code is unchanged (`packet.ts:132`).
- The recall report (`cli.ts:392`) and the README now say the choice suits LongMemEval (95% of dev evidence turns are user turns), and the BM25 baseline shows what it adds.

## L8: Design note, non-blocking. Changed
- The register only ever held the assistant's own earlier answers from the chat, which a real chat has.
- **Changed.** `packet.ts:56` keeps only answers from the current chat. The eval never sets one, so "Your latest answers" appears in 0 of 500 packets at either profile.
- Removing that filter fails `packet.test.ts:161`.

---

I didn't check live API behavior for M1 or real token counts for M5; both need a paid call. **Risk to know:** in a real run with outages, the per-question token and cost averages under-count the large-prompt arms (M4), and the L3 budget fix could break again without any test failing.