# Audit: beep context-packet evals (LongMemEval_S)

Scope: I read every file in `packages/core`, `evals/src`, `evals/test`, `apps/cli` and `evals/README.md`. I ran `npm test` (33/33 pass), `npx tsc -p .` (clean), and `eval recall` / `eval estimate`. Both reproduce the committed results files byte for byte (`git status` was clean afterwards). I also ran my own scripts against the local data. No paid calls, no network, no repo edits.

Note: to check whether the dev slice is representative, I computed **aggregate** packet recall on the 450 held-out questions (one number, below). Nothing was tuned on it.

---

## HIGH

### H1. The packet arm's reader sees the benchmark's evidence labels, through session ids
- **Where:** `packages/core/src/packet.ts:144`, which puts `chat ${seg.sessionId}` in every segment header. Reached from `evals/src/arms.ts:65-67`.
- **What's wrong:** In LongMemEval_S, every evidence session id starts with `answer_` (`answer_<hex>_N`, `answer_ultrachat_…`, `answer_<hex>_abs_N`). No non-evidence session id does. Counted over all 500 questions:
  - 914 evidence sessions, all named `answer_*`.
  - 0 filler sessions named `answer_*`.
- `loadLongMemEval` strips `has_answer` and `answer_session_ids`, but it passes the raw ids straight through as `Session.id`. The packet then prints them to the reader.
- **Evidence:** I built the real dev packets at the Claude profile, 8K tokens. **48 of the 50 dev packets, and 45 of the 47 answerable ones, show `chat answer_…` in a header.** Example from the first dev question:
  ```
  ### 2023/05/20 (Sat) 10:19 · chat answer_766ab8da_1 · turns 1-4 · confidence 0.98 · ...
  ### 2023/05/22 (Mon) 11:43 · chat sharegpt_NUyiNZE_0 · turns 1-2 · ...
  ### 2023/05/22 (Mon) 23:41 · chat a0201607_3 · ...
  ```
- **Only the packet arm gets this.** `full`, `compaction` and `search_history` render dates only (`arms.ts:135,139`).
- **How it skews results:** The reader is told which retrieved chunk is the answer chunk. It can ignore distractors that BM25 pulled in, which inflates packet accuracy over every other arm, hardest on multi-session and knowledge-update questions where distractors matter.
- **Why the tests miss it:** The tests that claim to guard this use made-up ids (`s2`, `fact`) that look nothing like the real ones (see M6).
- **Fix:** Re-key sessions to opaque ids (for example their index) in the loader, and keep a private map back to the original ids for recall.

### H2. The arms get unequal tools, and the headline token column hides it
- **Where:** `evals/src/arms.ts:56-72`, `run.ts:91,102`, `results/longmemeval-s-dev50-estimate.md`.
- **What's wrong:** `packet` and `bare` get `search_history` for up to 3 rounds, each returning 3 whole segments. `compaction` and `full` get no tool (`readerLoop(..., false)`).
  - The README frames the benchmark as "Beep versus compaction". But the packet arm is really "packet + search on demand", while compaction gets a summary that doesn't know the question and no way to look anything up.
  - There is no `compaction + search` arm to isolate the packet's own effect.
  - `contextTokens`, the first number after accuracy in `summaryTable`, counts only the packet (`packet.tokens`). It leaves out the packet resent on every tool round and all the tool results.
- **Evidence:** The committed estimate already assumes exactly one search (see M5):

  | Arm | Context tokens | Reader input tokens |
  |---|---|---|
  | packet | 7,789 | 20,587 |
  | compaction | 17,979 | 18,222 |

  So by the harness's own estimate, **the packet arm's reader takes in more tokens than the compaction arm's**, while the headline column shows less than half. With 2-3 searches the gap grows. A search hit is about 1,350 tokens at the median and up to 12K (see L1).
- **How it skews results:** "As accurate for fewer tokens" will look true on the column people read, even when it's false on actual reader input. Any accuracy edge over compaction can't be credited to the packet.
- **Fix:**
  - Give compaction the same tool, or add a `compaction+search` arm.
  - Report reader input tokens (all calls) as the headline token number.
  - Report accuracy against the bare arm, which is the only clean "what does the packet add" comparison.

---

## MEDIUM

### M1. The last tool round probably errors, and an error is scored as a wrong answer
- **Where:** `arms.ts:79-81`, with the error path at `run.ts:50-53`.
- **What's wrong:** When `round === maxToolRounds`, the request leaves out `tools`, but `messages` still holds `tool_use` and `tool_result` blocks from earlier rounds.
  - The Messages API normally rejects that ("Requests which include tool_use or tool_result blocks must define tools").
  - On models with preserved thinking, removing tools is also a history edit that can 400.
- **I could not confirm this offline.** It needs a one-call smoke test.
- **How it skews results:** Every question where the reader used all 3 searches becomes an error, which counts as a fail. Even if the API accepts the request, the reader is cut off mid-plan. This biases *against* packet and bare, but it is still a measurement bug.
- **Fix:** Keep `tools` on the final round and add `tool_choice: none`, or answer the last tool call with a "no more searches" `tool_result`.

### M2. Nothing reports on held-out data, and dev and held-out share evidence
- **Where:** `cli.ts:60-61,95`, `longmemeval.ts:67-91`.
- **What's wrong:**
  - The README rule is "Tune on dev, report on held-out". But no command runs held-out: `run` only runs the 50 dev ids, and its header says "dev run". Any accuracy number produced today is on the slice the builder is tuned on.
  - The split is by question id, but LongMemEval contains `X` / `X_abs` sibling pairs built from the same evidence. **9 of the 50 dev questions have their sibling in held-out:** `f4f1d8a4`, `0862e8bf_abs`, `60bf93ed_abs`, `a96c20ee`, `ba358f49`, `2311e44b_abs`, `gpt4_93159ced`, `982b5123`, `gpt4_c27434e8`.
  - **22 of the 92 dev evidence sessions appear word for word as evidence in held-out questions** (under different ids, so the id-overlap check reports 0).
- **How it skews results:** Tuning the builder by looking at dev failures directly tunes it on part of held-out. Held-out numbers for those questions won't be independent.
- **Fix:** Split by evidence-content cluster (group siblings and identical sessions together), and add an explicit held-out command that is never run during tuning.

### M3. 50 questions, one run, no confidence intervals
- **Where:** `cli.ts`, `run.ts`; README promises "several runs with standard deviation".
- **What's wrong:** There is no repeat or seed option, no CI and no paired test. One question is worth 2 points of accuracy, and a 95% CI at around 70% is about ±13 points.
- **Evidence:** Packet complete-recall across 300 other 50-question stratified slices (seeds 1-300) ranges from 62.2% to 93.6% (median 78.7%).
- **How it skews results:** Arm differences and builder changes smaller than about 10 points are noise, but the summary table gives no sign of that.
- **Fix:** Paired bootstrap CIs per arm pair, several runs, and the full set for any claim.

### M4. Failed calls and truncated answers are handled silently
- **Where:** `run.ts:50-53`, `model.ts:57`, `arms.ts:80,110-121`.
- **What's wrong:**
  - An errored question is stored with `calls: []` and `contextTokens: 0`. Its cost and tokens vanish from that arm's averages while it counts as a fail.
  - `stop_reason === "max_tokens"` is never checked. Haiku 5.5 thinks by default (effort medium), and readers and the summarizer have only `max_tokens: 4000`. A truncated or empty compaction summary, or an empty reader answer, passes through silently.
  - The `full` arm sends 4 concurrent ~140K-token requests, the most exposed to rate-limit 429s after the SDK's 2 retries.
- **How it skews results:**
  - Errors fall on the large-context arms.
  - Their mean costs and tokens look lower than they really are.
  - Truncated compaction summaries depress compaction accuracy for reasons unrelated to the method.
- **Fix:** Record calls from failed attempts, check `stop_reason`, retry rate-limit errors, report errors per arm next to accuracy, and raise `max_tokens`.

### M5. The cost estimate and cost framing favor the packet
- **Where:** `model.ts:31-42`, `estimate.ts:13-18`, `cli.ts:75`.
- **What's wrong:**
  - All 50 dev `full` contexts estimate above 100K tokens (min 135,851, median 141,832), so every `full` call is priced at Haiku's long-prompt rate: 5x input, 5x output. The pricing matches the docs, but most of the "packet is 12x cheaper than full" gap is this price step, which can't be checked without a real token count (estimates use 3.5 characters per token).
  - Prompt caching isn't modeled. The README lists "cost per turn with caching" as a metric, and in the multi-turn use case a cached full history is about 10% of its listed price.
  - The whole compaction summarizer bill (about 5 calls) is charged to one question. In real use it is spread over many turns.
  - The estimate assumes exactly one search per tool arm, which understates packet and bare if they search 2-3 times.
- **How it skews results:** The cost-per-question column overstates what full and compaction cost relative to the packet.

### M6. Tests that pass without testing their claim
- **Label tests:**
  - `evals/test/longmemeval.test.ts:33-37` ("the chats a builder reads carry no evidence labels") greps the session JSON for `has_answer`.
  - `evals/test/run.test.ts:91-95` ("no arm's reader ever sees the evidence labels") greps for `fact#0|answer_session|has_answer`.
  - Both fixtures use ids like `s2` and `fact`, so neither can catch H1, which leaks through 45/47 real packets.
- **Cost test:** `run.test.ts:80` asserts `compaction totalCost > full totalCost`. That only holds because the stand-in bills a flat 100 input tokens per call whatever the prompt size. In reality full costs about 2.7x compaction. The assertion encodes something false.
- **Stand-in reader:** It answers correctly whenever "Denver" appears anywhere in the request (`run.test.ts:52`), and the stand-in summarizer is built to keep the "moving" sentence (`:50`). The end-to-end test shows plumbing works, not that the arms are compared fairly.
- **Judge test:** `judge.test.ts:48-52` doesn't exercise the known weak spots of the substring rule (see L6).

---

## LOW

### L1. `segmentTokens` is not a size cap
- **Where:** `segments.ts:25`; documented as "Size cap" at `profiles.ts:9`.
- **What's wrong:** Cuts only happen before a user turn, so a long assistant reply overruns the 1,200-token setting. Over 10,840 segments from 100 questions: median 1,343, p99 2,136, max 12,248 tokens; 67% are over 1,200.
- **Effect:** `search_history` returns 3 such segments with no cap (`arms.ts:133-135`), so tool-arm token use is bigger and more variable than the setting suggests.

### L2. "Retrieved history, oldest first" is sometimes wrong
- **Where:** `packet.ts:89-92,158-160`.
- **What's wrong:** The sort uses position in the haystack, not date.
  - 211 of 500 haystacks (21 of 50 dev) are out of date order.
  - The worst backward jump is under 1 day, so it's same-day time order.
  - 7 of 50 dev packets list segments out of order under the "oldest first" label, for example 23:41 before 03:27 on the same date.
  - `HISTORY_NOTICE` "since" also uses the first date in the array, not the earliest.
- **Effect:** Small; could mislead temporal-reasoning questions, mostly against the packet.

### L3. Packets slightly overshoot their budget
- **Where:** `packet.ts:81-91`.
- **What's wrong:** Cost is measured with `confidence 1`, but the final render prints e.g. `0.48`.
- **Evidence:** 24/500 packets exceed 8,000 tokens (max 8,013); 21/500 exceed 2,000 (max 2,011). The core budget test only uses synthetic data.

### L4. `--limit n` is not a representative subset
- **Where:** `cli.ts:61` with `longmemeval.ts:81-88`.
- **What's wrong:** The slice file is ordered by type, so the first 8 ids are all knowledge-update. `--limit 10` is 8 knowledge-update plus 2 multi-session. Knowledge-update is one of the easiest types (87.5% complete recall at 8K, against 72.3% overall), so quick partial runs look better than the slice.

### L5. Limits of the recall metric
- **Where:** `recall.ts`, `cli.ts:114-154`.
- **What's wrong:**
  - There is no plain-retrieval baseline at the same token budget, though the README lists one. So 72.3% complete recall can't be read as "the builder beats BM25 top-k".
  - Recall only counts packet segments, not what the packet arm sees after searching.
  - `complete` uses turn labels only, and 45 evidence sessions (32 questions, 4 in dev) have no `has_answer` turn. I checked: at 8K this changes nothing on dev.
  - The "rejected answer" blanking (`packet.ts:148`) would still count a blanked evidence turn as recalled. It never fires on this data (0/500).

### L6. Judge parsing
- **Where:** `judge.ts:32`.
- **What's wrong:** `includes("yes")` also matches "eyes" and "yesterday", or "no … yes". It copies the benchmark's script and is unlikely with "Answer yes or no only".
- **Sound:** The judge is blind to which arm answered (it sees only question, reference and response), and uses the same prompt for every arm.
- **Caveat:** Opus judging Haiku is a same-family pairing. That doesn't favor any arm, but scores don't compare with published numbers (the README already says so).

### L7. A builder design shaped by the benchmark
- **Where:** `packet.ts:112-124`.
- **What's wrong:** Indexing the user's words alone fits LongMemEval's labeling: 832 of 886 `has_answer` turns (94%) are user turns. This isn't leakage, but if it was chosen after looking at the data it is a benchmark-specific tuning that may not carry over to real chats. Retrieval of single-session-assistant facts depends entirely on the all-words index.

### L8. A packet-only noise register
- **Where:** `registers.ts:38,44`, rendered at `packet.ts:68-71`.
- **What's wrong:** "Your latest answers, so you stay consistent" carries the first lines of the last two assistant turns in the haystack. Example: "**Online Resources for Learning Pottery Wheel Basics:**". It is irrelevant to the question and appears only in the packet arm.

---

## Checked and sound
- The dev slice reproduces exactly from seed 20261125.
- Per-type counts match a largest-remainder stratified split (7/13/3/13/8/6, including 3 abstention questions, which is the full set's 6%).
- Dev and held-out are disjoint by id. No dev evidence session **id** is reused in held-out.
- **The dev slice is not cherry-picked in the packet's favor; it's harder than typical.**
  - Dev complete recall at 8K: 72.3%.
  - Held-out aggregate: 79.0%.
  - Dev sits at the 10th percentile of 300 other seeds; 90% of seeds score as well or better.
- `has_answer` and `answer_session_ids` are stripped from turns; the leak is only through ids (H1).
- `longmemeval_oracle.json` is present locally but no code reads it.
- Every arm uses the same reader, system prompt and question string (with the current date). The packet builder sees only the question text and the haystack.
- The judge prompts match LongMemEval's per-type prompts.
- The resolver almost never fires on this benchmark (0 notes on dev, 2 of 500 marked unsure), so it doesn't affect the results.
- The rejected-answer heuristic blanks 0 evidence turns across all 500.

## Not checked
- Whether the API really rejects the tools-less final round (M1). It needs one real call.
- Real Claude token counts against the 3.5-characters-per-token estimate, which decides whether `full` crosses the 100K long-prompt price step (M5).
