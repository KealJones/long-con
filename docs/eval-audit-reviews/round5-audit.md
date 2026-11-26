# Audit report: Long Con eval harness (LongMemEval_S, five arms)

I found no high-severity problems. The packet builder never sees benchmark labels, the dev/held-out split holds up under checking, and every arm gets the same reader, system prompt, judge and output cap. The search tool is the same for every arm except plain `compaction`, which has none by design. The real problems are one bias against the compaction arms, a cost estimate that runs low for compaction, and some low-severity footguns and test gaps. The repo was not changed (`git status` is clean). Everything below was checked with free local commands and scripts in the scratchpad.

## Medium

**M1. A compaction summary is asked to be nearly as long as the output cap, so one cut-off counts as a wrong answer for both compaction arms**
- **Where:** `evals/src/arms.ts:180` (`words = Math.round(compactAt * 0.375)`), `:190`, `:193` (`maxTokens: MAX_OUTPUT`, which is 16,000 at `:14`) and `evals/src/model.ts:80`.
- **What's wrong:** On the claude profile each fold asks for "at most 11,250 words". At about 1.3 tokens per word that is about 14,600 output tokens, against a 16,000 cap. Dense text full of names, numbers and dates runs closer to 1.4–1.5 tokens per word, which passes 16K.
  - A `max_tokens` stop throws `BilledError`. That rejects the shared summary, so both `compaction` and `compaction-search` fail.
  - The failure counts as wrong, not as an outage, because `BilledError` has no status.
  - The summary grows toward its target with each fold, and there are many folds.
- **Evidence:** I simulated the arm on the 50 dev questions with a summarizer that writes the length it's asked for. That gives 13.1 folds per question, and the last folds are about 14,600 tokens long. One overflow in any fold sinks both arms on that question.
- **How it skews:** It lowers compaction accuracy for reasons that have nothing to do with memory, which flatters the packet in the packet-vs-compaction comparison.
- **Fix:** Ask for a shorter summary (for example 0.25 × `compactAt` words), or give the summarizer a larger output cap.

**M2. The cost estimate understates compaction cost 2–5×, so the pre-run `--max-cost` gate and the committed estimate are off**
- **Where:** `evals/src/estimate.ts:8, 23–24`.
- **What's wrong:** The stand-in summary is capped at 2,500 words of "summary " (about 5,700 estimated tokens) and is billed as 2,500 output tokens. The real prompt asks for 11,250 words. A short stand-in summary also means fewer folds and smaller summarizer inputs.
- **Evidence:** `eval estimate --limit 50` (which doesn't write files) reproduces the committed numbers for compaction: $0.0248 per question and 156,049 summarizer input tokens. The same simulation as M1 gives:

| Summary length (share of asked) | Folds per question | Summarizer input tokens | Arm cost / question |
| --- | --- | --- | --- |
| Committed estimate | – | 156K | $0.0248 |
| 60% | 7.2 | 204K | $0.055 |
| 100% | 13.1 | 373K | $0.136 |

- **How it skews:** The committed estimate table understates compaction's cost next to the packet's, and cost is part of the headline claim. The pre-run cap check can pass runs that include compaction and then cost far more. The in-run cap does still stop it. The small-local profile is not affected (938 words asked, below the stand-in's cap).

## Low

**L1. The default `eval run` (subagent backend, claude profile with tools on) gives every arm a wrong score except `compaction`, without refusing first**
- **Where:** `evals/src/cli.ts:164–170` and `evals/src/subagent.ts:29`.
- **What's wrong:** Nothing checks for `--no-tools` before the run starts.
- **Evidence:** I ran the harness on one dev question with `SubagentModel` writing to a temp folder.
  - `full`, `packet` and `bare` came back as `Error: The subagent backend can't run tools`, which is a scored error, not a pending answer.
  - Only the shared summary was pending. Once it is answered, `compaction-search` hits the same error at its reader, and the run writes a summary where only `compaction` can score.
- **Fix:** The Errors column does show it, but the CLI should refuse before running.

**L2. A held-out run on the subagent backend writes questions and gold answers into a folder that git tracks**
- **Where:** `cli.ts:165`; the default output is `evals/results/smoke/<profile>`, which isn't in `.gitignore`.
- **What's wrong:** Judge prompts in `pending/` contain the correct answer.
- **Evidence:** There is precedent. Commit 4ad3090 committed `pending/` judge prompts (dev only), and they were removed in 2f04267.
- **How it skews:** Only the recall check refuses held-out data. A routine commit after a held-out subagent run would publish held-out answers, and the person tuning could then see them.
- **Fix:** Ignore `evals/results/smoke/*/pending`, or default the subagent output to `evals/runs/`.

**L3. Some API failures count as wrong answers rather than outages**
- **Where:** `evals/src/model.ts:95–99`.
- **What's wrong:** `isOutage` covers 429, 5xx and connection errors only.
  - 408 (`RequestTimeoutError`) and 499 count as wrong. These are more likely on the arm with the 140K-token prompt (`full`).
  - 401, 402 and 403 also count as wrong. A key that runs out of credit partway through keeps starting jobs, and every remaining answer becomes a wrong answer.

**L4. A judge reply that doesn't start with yes or no becomes a silent fail**
- **Where:** `evals/src/judge.ts:36`.
- **What's wrong:** A reply like "The response is correct. Yes" counts as a wrong answer. Nothing counts replies that start with neither yes nor no, so judge format drift is invisible.
- **Fix:** Count replies that aren't a clear yes or no apart, as judge errors.
- The lenient "contains the answer" rubric and the default temperature are already disclosed; nothing new there.

**L5. Some tests claim more than they check, and some gates have no test**
- **Where:** `evals/test/run.test.ts:325`.
- **What's wrong:**
  - The test "both compaction arms keep their context within the profile's compactAt" can't fail on a long summary: the stand-in summarizer returns one short regex match, and the code doesn't enforce the length.
  - These have no tests at all: `costOf`'s over-100K price switch, the CLI's refusal of held-out for recall, the `--max-cost` and unpriced-model refusals, and the subagent-plus-tools case from L1.

**L6. The noise threshold for dev gaps is a little optimistic**
- **Where:** `evals/README.md:129`.
- **What's wrong:** The README says to treat dev gaps under about 10 points as noise. With 50 paired questions and 20% discordant pairs, the standard error is about 6.3 points, so a 95% interval is about ±12. Eight comparisons are made with no correction (that part is disclosed). The printed paired intervals are correct, so rely on those.

**L7. Token columns mix estimates and billed counts**
- **What's wrong:** In API runs "Packet or context tokens" is chars/3.5, while "Reader input tokens" is what the API billed. The table doesn't say which is which.

## Design note (non-blocking)
The packet ranks with a second index built only from the user's words. The dev slice was used to tune that index, the 400-token segment cap and the 0.3 cutoff. On LongMemEval 842 of 896 evidence turns are user turns, and filler chats are mostly off-topic. Both help BM25 here more than in a real chat, so held-out numbers won't reveal how well this carries over.

## Checked and sound
- **No labels reach the packet builder:**
  - The loader drops `has_answer` and renames every chat `chat-N`.
  - Packets, the full transcript and search results show dates only.
  - Nothing outside `longmemeval.ts` and the recall check reads evidence, and the oracle file is never used (checked with grep).
  - No turn text carries label markers. The only matches are code (`answer_start`).
  - 13 questions repeat a chat id inside their history. All 13 repeats are filler, so the id-map overwrite doesn't touch evidence.
- **Dev slice:** It is exactly what `stratifiedSlice(all, 50, 20261125)` produces, so it was not hand-picked. Per-type counts match the full set's shares (8/13/6/3/7/13, including 3 abstention questions).
- **Held-out split:**
  - 437 questions kept and 13 left out of both, as the README says.
  - No near-identical-id twins (ids differing in the last character) of dev questions remain in held-out, and no question text is repeated.
  - Two held-out questions share more than 30% of their evidence words with dev question `gpt4_7f6b06db`, which matches the disclosed "one clear case".
  - 45 held-out histories contain a dev evidence chat, and 28 dev histories contain a held-out evidence chat, as disclosed.
- **Fair arms:** Same reader, system prompt, output cap and judge for every arm; compaction's summary is written by the same reader model. The same search tool and rounds go to every arm except plain `compaction`. The last round uses `tool_choice: none` and parallel tool calls are off. Notices change wording when there are no tools. The two compaction arms share one summary, counted once in the run total.
- **Judge prompts:** They match LongMemEval's `evaluate_qa.py` word for word, including the abstention one.
- **Statistics:** The bootstrap uses the right percentiles. Repeats are averaged per question. Paired tables compare each question with itself, and outages are left out of both arms of a pair.
- **Packet ceiling holds:** Across all 500 questions and both profiles, no packet goes over its ceiling (largest 7,993 on claude) and the largest header is 394 tokens.
- **Recall:** The report reproduces exactly (claude 78.7% versus BM25 76.6%, a one-question gap). Its stated limits are accurate: 45 evidence chats with no labeled turn affect 4 dev questions.
- **Tests and types:** `npm test` passes 66 of 66 and `npx tsc -p .` is clean.
- **Workflow:** Inputs reach the shell through environment variables, so they can't inject commands. It runs only on manual dispatch, with read-only permissions.

I did not check prices, the real token counts against the 3.5-characters-per-token estimate, or whether `tool_choice: none` behaves as expected on the live API.