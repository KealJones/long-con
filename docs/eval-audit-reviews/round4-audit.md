# Audit of the beep eval harness (LongMemEval_S, five arms)

**Bottom line:** I found nothing that lets the packet builder see answers or evidence labels. Nothing in the harness strongly favours the packet arm, and I found no high-severity issue. Two medium issues could skew a real API run. One makes the compaction baseline weaker than it should be. The other turns API failures into "wrong" answers, and those failures will pile up in the `full` arm. The rest are low-severity accounting, test and doc gaps.

What I ran: `npm test` (63/63 pass), `npx tsc -p .` (clean), `eval recall --profile claude` and `--profile small-local` (print only; the output matches the committed report exactly), and my own scripts in `/tmp/claude-0/-home-user-beep/20a8eb28-71a3-56f9-b3ba-5051337ca9eb/scratchpad/` (`a1.ts`–`a6.ts`). I edited nothing, made no paid calls and used no network.

## Medium

**M1. The compaction summarizer prompt never asks it to keep what the assistant said.**
- **Where:** `evals/src/arms.ts:189`.
- **What's wrong:** the prompt says "Keep facts about the user, what they asked for, decisions, preferences, names, numbers and dates. Drop small talk." It says nothing about what the assistant recommended, listed or explained.
- **Why it matters:** `single-session-assistant` questions (56/500, 6 in dev) ask exactly for that. The packet arm gets assistant turns verbatim in retrieved units.
- **Skew:** this handicaps both compaction arms on a whole question type, and only those two arms. The baseline prompt was written by the side being compared against it.
- **Fix:** have the summarizer also keep the assistant's concrete recommendations, lists and answers.

**M2. Infrastructure errors are scored as wrong answers, and they will concentrate in `full`.**
- **Where:** `evals/src/run.ts:278-286`, `evals/src/model.ts:111`, concurrency 4 at `cli.ts:137`.
- **What's wrong:** any reader or judge exception counts as a fail. That includes a 429 still failing after the SDK's 6 retries, an overload, or a refusal.
- **Why `full` takes the hit:** each `full` call sends about 141K estimated tokens. With 3 search rounds the history is re-sent four times, about 580K tokens per answer (committed estimate). Four of these run in parallel.
- **Retries are short:** the SDK's own backoff is 0.5→8 s, capped (`client.js` `calculateDefaultRetryTimeoutMillis`), so about 23 s in total unless a retry-after header says otherwise. On an account with a modest input-tokens-per-minute limit, `full` (and to a lesser degree the compaction summarizers) will hit rate limits far more often than packet or bare.
- **Skew:** those failures become accuracy losses for `full` only, and in every paired table. The Errors column shows them, but accuracy and paired differences don't separate them out.
- **Fix:** keep model and judge mistakes counted as wrong. Report infrastructure failures (429, 5xx, overload) apart and exclude or retry them, or throttle by tokens.

## Low

**L1. Held-out grouping misses paraphrased evidence from the same scenario.**
- **Where:** `evals/src/longmemeval.ts:117-157`. Grouping only joins questions on identical turns or at least half the turns identical.
- **Example:** held-out `gpt4_1d80365e` ("How many days did I spend on my solo camping trip to Yosemite?") and dev `gpt4_7f6b06db` (the order of three trips, ending with that same Yosemite trip starting 2023/05/15) share the fact through reworded evidence chats. Evidence-turn word overlap is 0.55; none of the turns is identical.
- **Scale:** I found 1 strong and about 3 weaker cases among 437 held-out questions.
- **Context:** 45 held-out haystacks also contain a dev evidence chat verbatim as filler (the README discloses this direction).
- **Impact:** small. The builder only has a few tuned settings, so it can't memorise answers. But the README's "shares no evidence with dev" is stronger than the code.

**L2. The compaction budget isn't enforced, and the test claiming it can't fail.**
- **Where:** `arms.ts:179-204`, test at `evals/test/run.test.ts:322-327`.
- **What's wrong:** the summary length is only requested ("at most N words"). After the last fold, the context is the summary, whatever its size. So the README's "a last fold keeps the whole context within it" holds only if the model obeys.
- **Evidence:** the committed small-local estimate shows compaction context at **5,751 tokens against `compactAt` 2,500** (its stand-in summary ignores the cap).
- **The test:** it passes only because its stand-in summarizer returns one short sentence; it never exercises an overrun.
- **Skew:** if anything this gives compaction more tokens than the packet, so it doesn't favour the packet. It is still config that doesn't do what it says.
- **Also:** `estimate.ts:202` bills 2,500 summarizer output tokens but feeds forward about 5,700 tokens of text.

**L3. The estimate's "ceiling" isn't a ceiling.**
- **Where:** `estimate.ts:197-199` vs `arms.ts:150`.
- **What's wrong:** the stand-in makes one tool call per round. A real reader can make several parallel `tool_use` calls per round; each returns `searchResults` units and the code doesn't limit them.
- **Impact:** the `--max-cost` check and the "Searches" column assume one call per round. The cost can exceed the "ceiling". Tools are the same for every arm, so this doesn't skew between arms.

**L4. Judge is unvalidated and noisy.**
- **Where:** `judge.ts:38-47`.
- **Details:** Opus at default temperature, `effort: "low"`, with an extra system prompt. There's no check of agreement with the paper's GPT-4o judge or with human labels, and no judge repeats separate from reader repeats.
- **Leniency:** the rubric passes anything that "contains the correct answer", and knowledge-update passes old plus new values. Answers that list several candidates get credit, and no check catches hedged multi-answers. Arms that see more candidates can benefit.
- **What's sound:** the judge doesn't know the arm; the prompts match `evaluate_qa.py`; the `^\W*yes` parse is correctly stricter than the original.

**L5. Cost figures rest on assumptions I couldn't verify offline.**
- **Where:** `model.ts:95-106`.
- **Details:** `full`'s cost advantage gap comes mostly from the hard-coded 5x Haiku price over 100K tokens and from no prompt caching. Compaction pays a full re-summarization per question.
- **Status:** all three are disclosed in `COST_CAVEATS`. Still, the "Arm cost / question" column (`full` $0.29 against packet $0.0035 at the ceiling) is not a real-world cost ratio, and the price table is an unverified assumption.

**L6. "All evidence in packet" ignores evidence chats with no labeled turn.**
- **Where:** `recall.ts:164-172`.
- **Scale:** 32/500 questions, 4 in dev (e.g. `gpt4_d6585ce9`: 5 evidence chats, 1 labeled). Those questions can score "complete" while missing needed chats.
- **Status:** disclosed. On dev the effect is nil today (I checked all 4), but it can flatter future builder versions.

**L7. Held-out discipline is by convention only.**
- **Where:** `cli.ts:85-96`.
- **Details:** only `recall` refuses held-out; `run` and `estimate --split held-out` work freely, and the workflow offers held-out as a menu choice. Disclosed in the README.

**L8. README Metrics table lists metrics the harness doesn't compute.**
- **Where:** `evals/README.md`, Metrics table.
- **Not implemented:** false-memory rate, harm rate, needless searches, wrong-item acceptance, time to first token, cost with caching, and others. Only "What the harness does today" is accurate. Mark the rest as planned.

## Design note (non-blocking, labeled as such)

The packet's recall advantage over plain BM25 on small-local (+10.6 points) comes entirely from its second index over user turns only. That suits LongMemEval because 842 of 896 evidence turns (94%, whole set) are user turns.

My ablation on dev (47 answerable questions):

| Profile | Packet | BM25, all words | BM25, user turns only, deduped |
| --- | --- | --- | --- |
| small-local | 32 | 27 | 33 |
| claude | 37 | 36 | 36 |

Removing duplicate units from the BM25 baseline changes nothing. The README notes this suits LongMemEval; expect the gain to shrink on real chats.

## Checked and sound

- **No labels reach the builder.** The loader strips `has_answer` and renames every session to `chat-N` in date order. On the real file: 0 non-opaque ids, 0 extra keys, 0 label strings in content. `buildPacket` gets only sessions and the question text. The oracle file is never read. Packets and renders show no ids.
- **Dev slice isn't cherry-picked.** It reproduces exactly from `stratifiedSlice(all, 50, 20261125)`. It was committed with the first harness commit. Type shares match the full set. Dev and held-out are alike: 1.84 vs 1.90 evidence chats per question, 47.8 vs 47.7 chats. No two dev questions share an evidence group. Held-out is 437 with 13 excluded, as stated.
- **Same treatment across arms.** All arms get the same system prompt, the same "Current date" line, the same chat order (date-sorted, which I confirmed fixes 211 out-of-order questions), the same output cap, and the same tool and rounds (none for classic compaction). With `--no-tools`, no prompt mentions a tool. The two compaction arms share one summary, and cost is counted once in totals.
- **Packet budget holds.** Every packet stays within its ceiling across all 500 questions (max 7,993/8,000 and 2,498/2,500), including the uncapped rules header.
- **Statistics are done right.** Repeats are averaged per question before the bootstrap. Paired differences are per question. The bootstrap is seeded. Small gaps are correctly called noise.
- **Workflow is safe.** Inputs go through env vars (no script injection), models without a price are refused, the cap is checked before and during the run, and the data is checked by sha256.
- **Benchmark quirks are disclosed and equal across arms.** 76 questions have chats dated after the question, 44 of them with same-day evidence timestamped later. Same for every arm.
- **Smoke results are labeled pipeline checks**, not results.

I did not check Haiku 5.5's real prices or rate limits, or real API behaviour such as `tool_choice: none`. Those need network access.