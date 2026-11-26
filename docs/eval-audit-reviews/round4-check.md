# Re-audit of the 16 findings against the current code (main @ a6477fa)

I read the code itself, not the commit messages or docs. I worked only on copies of the repo in the scratchpad: nothing was edited, committed or pushed, and `git status` in /home/user/long-con stayed clean. No network, no paid calls.

**What I ran:**
- `npm test`: 63/63 pass.
- `npx tsc -p .`: clean.
- `eval recall`, and `eval estimate` for both profiles. Their output matches the committed `evals/results/*.md` and the `.svg` byte for byte (`cmp`).
- Two check scripts of my own over the real data:
  - `/tmp/claude-0/-home-user-long-con/20a8eb28-71a3-56f9-b3ba-5051337ca9eb/scratchpad/copy3/audit-check.ts`
  - `/tmp/claude-0/-home-user-long-con/20a8eb28-71a3-56f9-b3ba-5051337ca9eb/scratchpad/copy3/audit-check2.ts`
- A mutation run: 23 mutations, each putting back an old bug, then `npm test`. Script: `/tmp/claude-0/-home-user-long-con/20a8eb28-71a3-56f9-b3ba-5051337ca9eb/scratchpad/mutate.mjs`. A mutation "survives" when every test still passes with the bug back in.

## Verdicts

| # | Finding | Verdict |
|---|---|---|
| H1 | Session ids leak the evidence labels | **Fixed** |
| H2 | Arms get unequal tools; token column hides it | **Fixed** |
| M1 | Last tool round drops tools | **Fixed** in code and tests. Not checked against the live API, which the README says |
| M2 | No held-out run; dev and held-out share evidence | **Fixed**. The leftover filler overlap is disclosed, and the reason holds |
| M3 | 50 questions, one run, no intervals | **Fixed** |
| M4 | Failed and cut-off calls handled silently | **Fixed** |
| M5 | Cost estimate and framing favor the packet | **Partly fixed**. Caching isn't modeled and real token counts aren't checked; both are disclosed |
| M6 | Tests pass without testing their claim | **Fixed**. The stand-in limits remain, and they are inherent to a unit test |
| L1 | `segmentTokens` isn't a size cap | **Fixed**, with a small overshoot from role labels |
| L2 | "Oldest first" sometimes wrong | **Design note, non-blocking**. It uses no information a real chat lacks. Changed anyway |
| L3 | Packets slightly overshoot their budget | **Fixed** in code. The tests don't guard the original cause |
| L4 | `--limit` isn't representative | **Fixed** |
| L5 | Limits of the recall metric | **Fixed**. The remaining limits are disclosed |
| L6 | Judge parsing | **Fixed** |
| L7 | Builder design shaped by the benchmark | **Design note, non-blocking**. No information a real chat lacks. Code unchanged, disclosure added |
| L8 | Packet-only "latest answers" register | **Design note, non-blocking**. No information a real chat lacks. Changed: the register is now empty in evals |

New problems found, all minor:
- The L3 regression isn't caught by any test.
- A latent issue in the loader with duplicate session ids. It is harmless on today's data.
- Search results don't mark partial turns.
- Units run slightly past the 400 cap because of role labels.
- The README Metrics table still lists "cost per turn with caching".

---

## H1: Fixed

**Code:**
- `evals/src/longmemeval.ts:50-57` sorts each question's chats, then renames every one to `chat-${n + 1}`. The raw id is used only as a key into a private map (`opaque.set(q.haystack_session_ids[i]!, id)`), and evidence is mapped through it at `:66`.
- `packages/core/src/packet.ts:161-162` renders segment headers as `### ${seg.date} · confidence … · matched …`, with the comment "No chat ids here".
- `searchHistory` (`arms.ts:212`) and compaction (`arms.ts:215-216`) render dates only.

**Real data:** my script built packets for all 500 questions at both profiles.
- 0 packets contain `answer_`, and 0 contain any original haystack id.
- On dev, the `search_history` results and the first messages of `full`, `packet` and `bare` hold no original ids either.
- The one `answer_` hit was chat content in the `full` arm (Python code, `answer_start = torch.argmax(...)`), not a label.
- An example header now reads `### 2023/05/20 (Sat) 10:19 · confidence 0.63 · matched title, watch, list · part of a longer turn`.

**Tests:** they now use real-looking ids, and they fail if the bug comes back.
- `longmemeval.test.ts:88-93` uses `answer_355c48bb` and `sharegpt_…`.
- `run.test.ts:270,347-351` uses `answer_9c1e_1`.
- `packet.test.ts:211-216` uses `answer_7f3e_1`.
- Mutation: putting `chat ${seg.sessionId}` back in the header fails 2 tests. Putting raw ids back in the loader fails 2 tests.

**Latent issue (new, non-blocking):** 13 questions carry a duplicate haystack id. `opaque.set` keeps the last copy. I checked all 13: every duplicate is a filler chat, the copies are identical, and none has a `has_answer` turn. So evidence mapping is unaffected today. It would silently misplace evidence if an evidence id were ever duplicated.

## H2: Fixed

**Code:**
- Five arms (`arms.ts:10-11`). Only plain `compaction` loses the tool: `arms.ts:97` sets `maxToolRounds: 0` for `arm === "compaction"`.
- `compaction-search` reads the same shared summary with the tool (`arms.ts:24-28,112-133`). `full` gets the tool too.
- The headline token column is now "Reader input tokens", summed over every reader call (`run.ts:337,351-353`).
- Each arm is compared against `bare` and against `packet` in paired tables (`run.ts:371-399`).

**Committed estimate** (claude, ceiling): packet reader input 29,755, compaction 19,176, compaction-search 84,076. The column people read now shows what the reader takes in.

**README:** `README.md:123` explains that packet against bare measures the builder's own retrieval too.

**Mutations:**
- Taking the tool away from compaction-search fails 3 tests.
- Counting only the first reader call fails 1 test.

## M1: Fixed in code. Live behaviour unverified, and disclosed

**Code:**
- `arms.ts:139-141` keeps `tools: [SEARCH_TOOL]` on every round and sets `toolChoice: canSearch ? "auto" : "none"`.
- `model.ts:74` sends `tool_choice: { type: req.toolChoice }`.

**Tests:** `run.test.ts:378-394` uses a greedy reader and checks that the last call has `toolChoice === "none"` with the tool still defined. `run.test.ts:542-550` checks that the client sends `tool_choice: {type:"none"}`. Both mutations fail a test: dropping tools on the last round, and omitting `tool_choice`.

**Disclosure:** `README.md:122` says "not yet checked against the live API". That still needs one real call.

## M2: Fixed. The leftover overlap is disclosed and the reason holds

**Code:**
- `--split held-out` exists (`cli.ts:38,81-96`). Run headers name the split (`cli.ts:212`).
- `eval recall` refuses held-out (`cli.ts:85-88`).
- `evidenceGroups` (`longmemeval.ts:117-157`) groups three ways: `_abs` siblings, a shared evidence turn, or at least half of an evidence chat's turns. `heldOutSplit` (`:160-166`) drops every held-out question in a dev group.

**Real data:**
- 437 held-out questions, 13 excluded, matching the README.
- 0 dev questions have their `_abs` sibling in held-out (the audit found 9).
- 0 held-out questions have an evidence chat identical to a dev evidence chat. Before the filter, 22 dev evidence chats were shared, which reproduces the audit's number.
- 0 have an equal evidence turn after normalizing case and whitespace.
- 0 have an evidence chat sharing any turn over 80 characters with a dev evidence chat.

**Tests:** each grouping rule has its own test, and removing any one fails it. Sibling join: 1 fail. Evidence-turn join: 1 fail. Half-turns join: 1 fail.

**Disclosed (`README.md:107`):**
- Dev evidence chats show up as filler in held-out histories, and the reverse.
- Only `recall` enforces dev-only.

The reason given ("neither gives answers away") holds: a chat appearing as filler isn't the evidence for that question.

## M3: Fixed

**Code:**
- `--repeats` (`cli.ts:40,125`).
- A per-arm 95% bootstrap over questions, with repeats averaged per question first (`run.ts:335,401-430`).
- Paired bootstrap differences against bare and against packet (`run.ts:385-399`).

**README:** `README.md:127` says one run is the default, there is no correction for making several comparisons, and dev gaps under about 10 points are noise.

**Tests:** `run.test.ts:406-431` and `:533-540`. Mutation: counting repeats as separate questions fails a test.

**Leftover:** the "Full run" tier (`README.md:86`) still says "standard deviation". The harness reports intervals instead. Wording only.

## M4: Fixed

**Code:**
- `max_tokens` and `refusal` stop reasons become a `BilledError` that carries the usage (`model.ts:78-79`).
- Calls made before a failure travel with the error (`arms.ts:104-109`, `arms.ts:160-171`) and are kept (`run.ts:278-286`).
- An empty answer counts as an error (`run.ts:274`).
- The client retries 6 times (`model.ts:62`).
- Errors are counted per arm next to accuracy (`run.ts:345,357`).
- `MAX_OUTPUT = 16_000` applies to every call: reader, summarizer and judge (`arms.ts:14,142,192`, `judge.ts:165`).
- The context column averages only answers that didn't fail (`run.ts:339`).

**Mutations:** each of these fails at least one test:
- dropping the `max_tokens` check
- dropping calls on error
- treating an empty answer as a plain wrong answer
- giving the summarizer a smaller cap

## M5: Partly fixed. The rest is disclosed

**Done:**
- The estimate is now a ceiling (every allowed search used) beside a floor (no searches), and `--max-cost` checks the ceiling (`estimate.ts:99-113`, `cli.ts:138-161`).
- The summarizer's input and the judge's cost have their own columns.
- Every estimate and run header carries `COST_CAVEATS` (`cli.ts:21`): the 5x price on Haiku prompts over 100K tokens, no caching, and compaction summaries paid per question.

**Not done:**
- Caching isn't modeled, yet `README.md:34` still lists "Cost per turn with caching" as a metric.
- Real token counts aren't checked. Estimates still use about 3.5 characters per token, which decides whether `full` crosses the 100K price step.

The README states both plainly (`:124`). The token count needs an API key, so that reason holds. No reason is given for leaving caching out.

**No test:** removing the long-prompt price survives the mutation run.

## M6: Fixed

**Label tests:** now real-looking ids, and they fail on regression (see H1).

**Cost test:**
- The false `compaction > full` assertion is gone.
- The stand-in now bills by the prompt actually sent (`run.test.ts:292`).
- Mutation: putting the flat 100-token billing back fails a test.

**Judge test:** `judge.test.ts:48-55` now covers "No, it said yesterday." and "The eyes have it."

**Unchanged and inherent:** the stand-in reader still answers whenever "Denver" appears (`run.test.ts:303`), and the stand-in summarizer still keeps the "moving" sentence (`:301`). These tests show the plumbing works, nothing more, and nothing claims more.

## L1: Fixed, with a minor overshoot

**Code:** `segments.ts:287-306` splits a long turn at blank lines, then lines, then sentences, then at a fixed character count. The claude cap is now 400 (`profiles.ts:354`).

**Real data** (48,292 units from 100 questions, rendered with role labels):
- median 334 tokens, p99 404, max 470
- 15 units over 420

The overshoot is only the `user:`/`assistant:` labels and newlines. The content stays within the cap, but the profile comment's "Hard cap on one retrieved unit" is slightly loose.

`search_history` on dev: median 824 tokens, max 1,167 (the audit saw up to 12K).

**Mutation:** removing turn splitting fails 2 tests.

**Minor new inconsistency:** `searchHistory` (`arms.ts:212`) doesn't mark partial turns "part of a longer turn", although the packet does.

## L2: Design note, non-blocking

It uses no information a real chat lacks: a real log is in time order.

**Changed anyway:**
- The loader sorts chats by date (`longmemeval.ts:48-50`), so every arm sees the same order.
- The packet sorts by date, then position (`packet.ts:98,176-179`).
- The "since" date is now the earliest date (`packet.ts:60,181-183`).
- Real data: 0 of 500 packets list segments out of date order at either profile (`audit-check.ts`).

**Tests:** removing the loader's sort fails a test. Removing the packet's own date key survives, but it's redundant once the loader sorts.

**README `:109`:** 76 questions have chats dated after the question. That's the benchmark's data and is the same for every arm.

## L3: Fixed in code. Test gap

**Code:** the cost of each unit is now measured with its real confidence and matched words, `renderSegment(hit.item, registers.rejected, confidence, hit.matched)` (`packet.ts:88`). The header and the section line are subtracted up front (`packet.ts:77`).

**Real data, all 500 questions:**
- 0 packets over the ceiling.
- Largest packet: 7,993 tokens at 8K, 2,498 at 2,500.

**Test gap:** if I put the old cause back (measuring cost with confidence 1), all tests still pass. On real data, 15/500 claude packets and 8/500 small-local packets then go over (max 8,013 and 2,504). The core test `packet.test.ts:142-159` sweeps ceilings but doesn't catch it. Removing the section line from the header count *is* caught.

**Disclosed open item:** standing rules aren't capped (`README.md:128`). The reason holds: my run found 0 packets over budget.

## L4: Fixed

**Code:** `cli.ts:97-105` takes `stratifiedSlice(dev, limit, 1)`.

**Real data:** the dev file still starts with 8 knowledge-update ids. `--limit 10` now gives knowledge-update 2, multi-session 3, temporal 3, single-session-user 1, single-session-assistant 1.

**Test:** `stratifiedSlice` is tested. The CLI path isn't.

## L5: Fixed. The remaining limits are disclosed

**Code:**
- A plain BM25 top-k baseline at the same ceiling and the same units, with intervals and a paired difference (`cli.ts:254-272,303-314`). Committed result: claude +2.1 points (+0.0 to +6.4), one question of 47. The README says that isn't a shown gain.
- A blanked turn no longer counts as recalled: `recall.ts:192-199` requires the turn's text in the packet. Test at `recall.test.ts:239-242`.

**Disclosed in the recall report:** recall leaves out what a reader would find by searching, and an evidence chat with no labeled turn isn't counted. The audit found the second changes nothing at 8K on dev, so that reason holds.

The baseline's token count leaves out headers, "which flatters it slightly", as stated in `cli.ts:252`.

## L6: Fixed

**Code:** `judge.ts:157`, `passes = /^\W*yes\b/i`.

**Test:** `judge.test.ts:48-55`. Mutation: putting `includes("yes")` back fails it.

**README `:126`:** discloses the deviations from the benchmark: the stricter parse, default temperature, and an added one-line system prompt.

## L7: Design note, non-blocking

It uses no information a real chat lacks: who said each turn is known in a real chat.

**Code unchanged:** the user-words index is still fused in (`packet.ts:124-139`).

**Disclosed:**
- The recall report says 95% of the dev slice's evidence turns are user turns, so this may not carry over to real chats.
- The BM25 baseline shows what that ranking adds.
- `profiles.ts:352-353` admits the segment cap was picked on this benchmark.

## L8: Design note, non-blocking

It uses no information a real chat lacks: the register holds past assistant turns.

**Changed:**
- `packet.ts:56` now keeps only answers from the current chat that aren't already riding along raw. Evals never pass a current chat id, so the register is always empty there.
- Real data: 0 of 500 packets contain "Your latest answers" at either profile.
- Mutation: removing the filter fails a core test.

---

I didn't check the live API's handling of `tool_choice: none` (M1) or real Claude token counts (M5); both need paid calls. My checks over all 500 questions were mechanical only (leaks, budget, ordering), with no scoring of held-out.
