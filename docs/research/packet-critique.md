# Packet critique: Fable 5.2, Opus 5.5 and Haiku 5.5

Three Claude models each read real packets from the current builder, answered questions using only those packets, then critiqued the packet twice: as a small ~1.7B reader and as a large one. This page merges their reviews, checks their claims against the code and data, and says where they're wrong. Their raw reviews are in the appendix, unedited.

This covers the packet's design and the builder's output only. The eval harness is being fixed in a separate thread. No code was changed for this.

## Top 3 takeaways

1. **The idea holds, but today's packets mostly hurt.** The pre-done lookups are confidently wrong. "Now double it" resolves to 100 (the interest) instead of the $5,500 answer. Nearly all of the 28 "standing rules from the user, word for word" in the LongMemEval packets are pasted advice like "Remember to have fun and be creative", while a real "from now on always write TypeScript" rule is missed. All three critics would turn the results register and rules off until they're fixed.
2. **"Minimal sufficient" isn't happening.** Confidence is a share of the top hit, so the top hit is always 1 and the 0.3 cutoff almost never stops anything. most LongMemEval packets fill to 95-100% of the ceiling, and questions with no answer get bigger packets than answerable ones. The fix all three ask for: an absolute relevance floor, plus a "not found: iPad case" line when the question's key term matches nothing.
3. **Small and large readers split on labels, not on substance.** Fable and Opus got all five questions right by reading past the junk; the small-model failures are predictions, not runs. All three say the trust note and confidence numbers are noise for big models and harmful for small ones. They disagree on keeping the "matched" words and on trimming assistant turns.

## How it was run

- **Real packets:** 24 sample packets: 12 cases from `buildPacket` at commit aac8fe4, each built at the claude profile (8,000-token ceiling, 6 raw turns) and the small-local profile (2,500, 2 raw turns). Eight made-up chats (S1-S8) exercise follow-ups, the resolver, the gate, rejected answers, rules and the model's own recent answers. Four LongMemEval_S questions cover knowledge-update, temporal, multi-session counting and abstention.
- **Mocks:** the builder can't yet make a notes register, open loops, Q→A answers or richer per-item labels, so those were written by hand from the plan (M1-M3) and marked as mocks.
- **Leak check:** no `answer_` ids or benchmark labels appear in any sample packet.
- **Critics:** Fable 5.2, Opus 5.5 and Haiku 5.5, run as subagents with only the samples, a plan excerpt and the same brief. Each answered five questions from one packet before reading the design docs, so the design couldn't shape their answers. No paid API calls.
- Samples, mocks, questions and the build script are in [packet-critique/](packet-critique/).

## The questions: what each critic answered from the packet alone

| Question | Right answer | Fable 5.2 | Opus 5.5 | Haiku 5.5 | What the packet did |
| --- | --- | --- | --- | --- | --- |
| S5 small: "now double it" | About $11,000 (double $5,500) | $11,000 | $11,000 | Hedged: "200... or do you mean $11,000?" | Told the model twice that "it" = 100 |
| S8 claude: "what shard size did you say and why" | 64 MB; not in the packet, so search | Not in view, would search | Not in view, would search | Not in view, would search | Offered "Latest results you gave: 1.2" (a GB download size) and nothing else |
| LME 18bc8abd small: BBQ sauce now | Kansas City Masterpiece | Right | Right | Right | Evidence present; about 85-90% of the packet was noise |
| LME gpt4_6ed717ea small: pads or dog bed first | Training pads | Right | Right | Right | Evidence present, the bed turn twice |
| LME 60bf93ed_abs claude: iPad case days | Never mentioned | Abstained | Abstained | Abstained | 7,927 tokens of "case" and "take" matches, and no "not found" signal |

The large readers routed around every bad line. What a 1.7B model would do with "it = 100", "1.2" or "3. Amtrak" is the critics' prediction, and the reader ladder (Opus, Haiku, LFM3 1.7B) is how to check it.

## Where all three agree

Each point below I checked against the code or data myself.

1. **The results register takes the last number in a turn, not the answer.** `buildRegisters` keeps the final number match in each assistant turn: 100 from "roughly $100 in interest", 7.5 from a hike list item, 1.2 from "a 1.2 GB download". They come with no unit or label, and 7.5 rides along on a thank-you and a coding ask.
2. **The resolver trusts that register.** "Multiply it by 3" resolves to 7.5 hike miles on the claude profile, and "unsure" on small only because 7.5 fell out of its 2-turn window.
3. **The rules extractor fails both ways.** It only fires when the trigger starts a sentence, so "ok so for the tilde repo from now on always write typescript" is missed. It doesn't check what kind of text it's reading, so pasted assistant sign-offs become rules: 28 rule lines across 21 of the 50 dev packets, nearly all of them junk. The "word for word" label makes them the most trusted lines in the packet.
4. **The gate doesn't close on "thanks!!".** A message with no content words makes the resolver say "unsure", which opens the gate, which retrieves using the previous user turn's words. The packet adds "Reference unclear... Check before assuming", which invites a small model to answer a thank-you with "what do you mean?".
5. **Confidence is relative, so the cutoff doesn't cut.** "confidence 1 · matched now" sits on a junk segment. Mean LongMemEval packet: 5,701 tokens for answerable questions, 5,976 for abstention questions (claude profile).
6. **No "today" line.** "Currently", "how many days ago" and "the weekend after Thanksgiving" have nothing to anchor to.
7. **No negative result.** When retrieval finds nothing (S8) or the key term never appears (iPad), the packet is silent. One line saying so is the best abstention aid there is.
8. **The trust note and confidence numbers don't earn their tokens.** For large readers they're ignored. For small readers they add numerals near the content, ask for a judgment ("anything that looks wrong") the model can't make, and point at tools it may not have.
9. **Fragments and repeats.** 74% of claude-profile segments are "part of a longer turn", 57% repeat a header for the same chat, and the same fact often appears two or three times. Continuations start mid-list with a fresh `assistant:` label, so they read as new turns.
10. **Keep the rejected-answer placeholder.** "[an answer the user rejected, left out]" in S4 was the cleanest thing in the set, and oldest-first order made the knowledge-update answer obvious.

## A gap the critics found from outside, with its cause

Opus and Fable both saw that the current session's turns just outside the raw window vanish (S8: the shard-size answer is unreachable). They could only guess why. The code shows two bugs:

- Search skips any segment that ends inside the raw window. With 400-token segments, the whole current session is one segment, so its early turns are skipped along with the raw ones.
- The "your latest answers" register is cut to the last N answers before the ones already riding along raw are removed, so it's empty whenever N is no bigger than the raw window. It never appeared in any sample.

## Where they disagree

| Topic | Fable 5.2 | Opus 5.5 | Haiku 5.5 | My read |
| --- | --- | --- | --- | --- |
| "matched <words>" labels | Drop; builder debugging | Keep for large models: it's how Opus discounted the "case" hits | Only if the words really are in the query | Keep for large once fixed. Today "matched dash" comes from the previous user turn leaking into the query |
| Assistant turns | Cut to first line plus a pointer, both profiles | Cut on the small profile only | Drop fragments that lack their question | Contested, see below |
| Relevance cutoff | Absolute floor with rarity weighting | Absolute threshold, plus stopword and digit filtering | Raise the relative cutoff to 0.5 and cap at 4 items | Absolute. A higher relative cutoff still lets the best of a bad lot in |
| Caching | Move recent turns before the packet and grow them in blocks | Put the stable lines in their own cache block or the system prompt | One fixed block at the top of the packet | Stable lines to the system prompt: all agree. Fable's reorder is worth one eval |
| Small raw window | 3+ exchanges | Build registers from the whole session instead | Not raised | Both, they fix different cases |
| Format copying | Not raised | `###` headers and `user:` lines may make a small model continue the transcript | Not raised | Plausible and cheap to measure |

## Where the critics are wrong

- **Haiku: "100 appears nowhere in the packet or the riding turns."** It's in the raw turn: "roughly $100 in interest". Haiku missed it, and that's why it hedged toward 200 on Q1. That's a small-reader failure in its own right: it lost track of a number in a two-line turn.
- **Haiku's smallest-packet sketch** resolves "it" to $20,880, the rent figure from a different scenario.
- **Opus: "the LongMemEval ingest flattens session dates."** The loader copies dates exactly. The dataset itself puts all 46 sessions of gpt4_6ed717ea on one day, 33 of them after the question's timestamp. Across the dev slice, 10 of 50 questions have every session on one day and 6 have sessions dated after the question. That still matters for temporal evals, and the builder should drop history dated after "now", but it isn't an ingest bug.
- **Opus and Fable: "registers only read the raw window."** Half right. Results are limited to the recent turns on purpose, since "it" points at something just said. The recent-answers register is the real bug (above). So keep results recent, but typed and labeled.
- **Fable: "turn the registers off until they're precise."** Too broad. The rejected-answer marker is a register and it works. Turn off the results-to-resolver path and the rules, not the whole register set.
- **Fable and Opus: cut assistant turns to their first line.** That breaks the "what did you tell me" questions: 6 of the 50 dev questions are single-session-assistant ones whose answer sits in the body of an assistant turn (the omelette egg count, the 38 study subjects). Trim assistant text only when the message isn't asking about what the assistant said, or keep the paragraph that matched.
- **Fable: move recent turns before the packet.** That reverses a decided order. It might pay off, since the recent turns would cache and on a small local model the KV prefix would survive. But it only works if the window grows in blocks rather than sliding, so it needs an eval measuring cache hits and accuracy, not a switch.

## Proposed changes, ranked

Small and large are scored separately, since that's where the critics differ. None of these are done; code changes wait on your yes.

| # | Change | Small models | Large models | Eval that settles it |
| --- | --- | --- | --- | --- |
| 1 | Typed, sourced results: value, what it is, unit and date, taken from the answer's headline number. Unsure lines name their candidates ("Cowles Mountain or Potato Chip Rock?") | High | Medium | Follow-ups with distractor numbers in the same sentence (S5, S6, S8 style), register on vs off, scored on wrong-number answers |
| 2 | Absolute relevance floor, rarity weighting, no digit or stopword matches, and a "not found: X" line | High: packets shrink | High: cost and abstention | Abstention subset harm rate; recall against tokens; abstention packets should come out smaller than answerable ones |
| 3 | Cover the current-session gap: split segments at the raw-window edge, fix the recent-answers order, find lists anywhere in the session | High | Medium | The same follow-up placed 0, 2, 6 and 20 turns back, per profile |
| 4 | Rules: catch triggers mid-sentence, skip pasted or quoted assistant text, tag each rule with a scope | High: small models over-obey | Low to medium | Precision and recall on labeled rule statements; rule lines per LongMemEval packet should be about 0 |
| 5 | Close the gate on acknowledgements | Medium | Medium: cost | Wasted lookups and packet tokens on an acknowledgement subset |
| 6 | A "Today:" line, last in the packet so it doesn't break the cache, and drop history dated after it | Medium | Medium | Temporal and knowledge-update subsets, before and after |
| 7 | Label diet: no confidence numbers, date-only headers, one header per chat, span ids instead of "part of a longer turn", de-duplicate across sections | High | Low | A/B on the trick set; also count replies that start with `###` or `user:` |
| 8 | History notice and trust note into the system prompt, reworded ("The chat log starts 2026/10/02. Only parts are shown."); trust note off for small models | Medium | Low: cache | On vs off per model on the reader ladder |
| 9 | Trim assistant turns when the message isn't about what the assistant said (contested) | High | Medium: cost | Recall against tokens by LongMemEval type, single-session-assistant included |
| 10 | Recent turns before the packet, window growing in blocks (contested) | Medium: KV reuse | Medium: cost | Cache-hit tokens per turn and accuracy over a 50-turn replay |

## For the design itself

- **The most valued label is "supersedes".** M2's "currently Kansas City Masterpiece (was Sweet Baby Ray's, 4/16)" answers the question outright. All three singled out supersession marks as exactly the kind of lookup the packet exists to pre-do.
- **The small M1 mock is close to the right shape. The claude M1 mock says each fact three or four times** (notes, open loops, Q→A, the retrieved segment and the raw turns). De-duplication across sections has to be a rule, not a hope.
- **Rules need a scope.** The tilde rules rode into a Thanksgiving fares question in M1. On a small model that's a quarter of the packet spent on something irrelevant.
- **Low precision is also a privacy problem.** A user's health turn was pulled into the iPad-case answer on the word "take". In a real endless chat, junk retrieval surfaces things the user never meant to bring up again.
- **Cost check.** Opus pointed out that a junk-filled 7.9K packet costs about what 79K tokens of cached transcript does, since cache reads bill at roughly a tenth. That matches the 80K switch point in the claude profile, and it's why keeping packets lean is the whole cost case.

## Appendix A: numbers I checked

From the 50-question dev slice, built at both profiles:

| | claude | small-local |
| --- | --- | --- |
| Packets carrying "standing rules" | 21 of 50 | 21 of 50 |
| Rule lines in all (nearly all pasted advice) | 28 | 28 |
| Segments | 933 | 411 |
| "Part of a longer turn" segments | 690 (74%) | 278 (68%) |
| Segments from the evidence chats | 395 (42%) | 218 (53%) |
| Segments right after another from the same chat, with a new header | 530 | 191 |
| Mean packet tokens, answerable | 5,701 | 2,276 |
| Mean packet tokens, abstention | 5,976 | 2,470 |

Data: LongMemEval_S cleaned, sha256 matching the fetch script's pin. Hugging Face is blocked from this environment, so it came from a GitHub mirror and was checked against that hash.

## Appendix B: Fable 5.2, raw review

Unedited.

# Context packet critique (independent reader, Fable 5.2)

**Verdict:** the packet's *idea* holds up, but the current builder's packets are mostly harmful or padded. The registers and resolver are wrong often enough that I'd switch them off until they're fixed, and retrieval fills to the ceiling with junk. The hand-written small-local mock (M1 small) is close to the right shape; the real output is far from it.

Coverage: I read S1–S8 in both profiles line by line, the five question packets in full, the mocks and design.md. I skimmed rather than line-read the other LME packets (the claude-profile knowledge-update and temporal ones, and both 6d550036 ones).

## Part 1: answering as the model, packet only

**1. S5 small-local, "now double it"**
- My reply: "About $11,000" (double the ~$5,500 balance, or equivalently $900 a month).
- How sure: about 85% that "it" is the $5,500.
- The packet actively misled: `Reference resolved: 'it' read as the last result, 100.` and `Latest results you gave: 100`. 100 is the interest sub-figure, not the answer. I overrode it only because the raw turn sits right below. A 1.7B model will say "200".
- The retrieved segment (`confidence 1 · matched now`) is the TypeScript/tilde chat, pulled in on the word "now". Pure noise at "confidence 1".

**2. S8 claude, "what shard size did you say and why"**
- My reply: "I can't see a shard size in what I have in front of me. The recent turns cover OPFS vs Cache API and the 1.2 GB download check. I'd need to search the history."
- How sure: very sure the packet doesn't hold it.
- The whole packet is `Latest results you gave: 1.2`. That is the 1.2 GB from the storage warning, unitless, and it sits exactly where a shard size would go. A small model will answer "1.2".
- The scenario is meant to show own-answers outside the raw window. It shows the opposite: "retrieval ran" and returned nothing for a question whose answer is earlier in the same session.

**3. LME knowledge-update small-local, BBQ sauce**
- My reply: Kansas City Masterpiece.
- How sure: about 95%.
- Helped: the dated headers, and oldest-first order putting the 06/30 "currently obsessed with Kansas City Masterpiece" last, after April's Sweet Baby Ray's.
- Hurt: roughly 2,300 of 2,489 tokens are irrelevant (onion tips, sports-league brand partnerships, wood chips, three fake "rules"). The answer is two user sentences.

**4. LME temporal small-local, dog bed vs training pads**
- My reply: the training pads for Luna came first ("about a month ago" vs the bed "about three weeks ago", both said on 05/29).
- How sure: about 85%.
- Helped: both statements carry the same date, so the offsets compare directly.
- Hurt: `matched max, train` pulled a "self-aware chatbot" persona called Max; `matched bed` pulled "go to bed earlier"; `matched item, first` pulled a necklace appraisal. The bed fact appears twice (0.85 and 1).
- Odd: the question is dated 08:51 but the evidence is stamped 19:41 and 21:15 the same day. Either a dataset quirk or the builder isn't filtering by time; worth checking.

**5. LME multi-session 60bf93ed_abs claude, iPad case**
- My reply: "Nothing here mentions an iPad case, so I can't say. The nearest thing is a backpack bought from Amazon on 1/15, with no arrival date."
- How sure: about 90% the packet lacks it; I can't know the log lacks it.
- The packet spent 7,927 tokens to carry nothing. `confidence 1 · matched case` is a vinyl display case. "iPad" matched nothing, and the packet never says so. That one sentence was the only useful thing it could have told me.

## Builder bugs visible in the outputs

1. **The results register grabs the last number, not the result.**
   - S5: `100` (interest) instead of $5,500.
   - S1/S2/S3/S6/S7: `7.5`, a trail length inside a list item, shown even on a coding request (S7).
   - S8: `1.2` (GB).
   - None have a unit or a label.
2. **The resolver trusts that register.** S6 claude was meant to be "unsure" but says `'it' read as the last result, 7.5`. Small-local says unsure only because 7.5 fell out of its 2-turn window, so resolver behaviour depends on the profile's window, not on the chat.
3. **S1 small-local asks about a list that isn't there.**
   - "The third one" refers to the hike list, which is outside the 2 raw turns and not in the packet.
   - The packet *does* contain a different numbered list (`3. Amtrak: about 9 hours`).
   - A small model will answer about Amtrak. "Check before assuming" doesn't fix a missing list.
4. **The gate doesn't close.** S3 "thanks!!" has "retrieval ran", carries the full Thanksgiving segment, and adds `Reference unclear: a bare follow-up... Check before assuming.` The plan's version (M3) is one line.
5. **The rules register is wrong in both directions.**
   - Misses the real rule: S7 has no "Standing rules" section. The TypeScript rule shows up only because retrieval happened to match "webgpu".
   - Invents rules: the LME packets list `"Remember to be patient and kind to yourself throughout your fitness journey."` as `Standing rules from the user, word for word`. These read like assistant sign-offs (I can't see the source turns to confirm). It looks like a "remember to" trigger with no speaker check.
6. **Decimals are split into search terms.** `matched 5` (S1 claude) and `matched 3, 5` (S6) come from "7.5" and "by 3" hitting "5 hours" and "3. Amtrak".
7. **"Confidence" is rank normalised to the top hit.**
   - Every packet has a 1, including the stopword match in S5 and the display case in the abstention question.
   - A 0.3 cutoff on a relative score never stops: LME packets land at 7,927/7,994/7,734 of 8,000 and 2,489/2,445/2,453 of 2,500. The ceiling is being used as a target.
8. **No stopword or rarity weighting.** Matches on `take`, `day`, `after`, `now`, `first`, `item` outrank the absence of "iPad".
9. **No de-duplication.** KC Masterpiece, the dog bed and the Whiskas order each appear twice.
10. **"Whole units" isn't happening.**
    - Chunks start mid-list (`assistant: 6. **Avoid Overfeeding**`).
    - One assistant turn renders as two `assistant:` lines.
    - Several `###` headers share one timestamp, so I can't tell whether chunks are adjacent.
11. **The current session outside the raw window is unreachable** (S8). This hole is widest on the small profile.
12. **No "today" in the packet**, though "currently" and "how many days" questions need it.

## Part 2: as a 1.7B reader with ~6K context

- **Numbers in labels leak into answers.** `confidence 0.86 · matched 3` sits above "multiply it by 3". I'd drop every bare number that isn't content.
- **I'd over-trust anything phrased as a conclusion.** `Reference resolved: ... 100` and `Latest results you gave:` are short, declarative and at the top. They are also the least accurate parts of the packet.
- **"Standing rules ... word for word" is the highest-trust label there is.** Fake ones ("have fun and be creative") will colour answers about dog beds.
- **Boilerplate is most of the small packets.** The notice and trust note are about 55 tokens. S8's packet is 76 tokens: 55 of boilerplate plus one misleading number.
- **"Use the tools instead" may point at nothing.** The small profile may have few or no tools.
- **`Earlier chat history (since 2026/10/02 ...) was left out to fit` misreads two ways.**
  - "Since" reads as "everything after that date is missing".
  - "To fit" is untrue for a 198-token packet.
  - Clearer: "The chat log starts 2026/10/02. Only parts are shown."
- **Assistant listicles drown the evidence.** In the BBQ packet the facts are in user sentences; the wood-chip and side-dish lists are what a small model will echo.
- **`[an answer the user rejected, left out]` (S4) is good.** Short, and it stops me reconstructing the wrong answer. Keep it.
- **A 2-turn raw window is too small.** S1, S2 and S6 on small-local all fail for that reason alone. Raw recent turns are the cheapest, most reliable context, and tokens are better spent there than on retrieval.
- **The M1 claude mock would hurt me.** The travel options appear three times (Notes, Q→A, raw), the fare offer three times, and the rent results are irrelevant to the message.
- **The M1 small-local mock is the best thing in the set.** One flaw: `"those fares" = Southwest fares` is a guess stated as fact, and it contradicts the note that the family is driving.

## Part 3: as a large reader

- **What I ignored:** the trust note, the confidence numbers and the "matched" words. I judge a chunk by reading it. "Matched take" told me only that the chunk shouldn't be there.
- **What I distrusted:** both registers, after seeing 100 and 7.5.
- **What's missing:**
  - Today's date.
  - A negative result: "no hits for 'iPad case'".
  - Supersession marks. M2's `supersedes: Sweet Baby Ray's` is the most valuable label in either file, and it's the kind of lookup the packet exists to pre-do.
  - Stable pointers or ids per chunk, so I can ask for the rest of "a longer turn".
  - Units and a label on every result.
- **Ordering:** oldest-first is right for update and temporal questions and puts the best evidence nearest the question. Keep it, but group chunks by session under one header.
- **Caching:**
  - The packet changes every turn and sits before the recent turns, so the cached prefix is the system prompt, tools and two lines. The recent turns are never cached.
  - I'd move the notice and trust note into the system prompt.
  - I'd put recent turns before the packet and let the window grow in blocks (say 6 to 12 turns, dropped 6 at a time) so it stays a stable prefix.
  - Packet, "today" and the new message go last. A date in the stable part would break the cache daily.
- **Disagreements with design.md:**
  - *Whole units, never trimmed* is wrong for chat history. Keep user turns whole and cut assistant turns to their first line plus a pointer. The current rule is why packets are 90% listicle.
  - *Confidence, source and why on every item* is builder debugging. Log it; don't show it. Keep the date.
  - *Every packet says it's a best guess* belongs once in the system prompt.

## Part 4: direct answers

**Cut with no loss**
- `Latest results you gave:` in its current form.
- `Reference resolved:` when it's derived from that register.
- `Reference unclear ... Check before assuming` on bare follow-ups. Include the last list instead.
- `confidence N` and `matched words`.
- "Part of a longer turn" (replace with a pointer).
- The per-packet trust note.
- "To fit".
- Assistant filler bodies.
- Rules whose scope doesn't match the message (small profile).
- Duplicate statements of one fact.
- On the claude M1 mock: the raw segment whenever a Q→A line already covers it.

**Smallest packet that keeps the value**

```text
[system prompt, once] The chat log starts 2026/10/02. You see only parts; search_history reaches the rest. Packet lines are code-built guesses; the raw turns win if they disagree.

[recent turns, raw: 3+ exchanges even on small]

<packet>
Rules: "always write typescript, never python" (tilde)     <- only if in scope
"the third one" = 3. Potato Chip Rock: 7.5 miles...        <- only if resolved from a list in view
Facts:
- 2023/06/30 user: currently obsessed with Kansas City Masterpiece BBQ sauce (replaces Sweet Baby Ray's, 04/16)
- no hits for "iPad case"
Today: 2023/07/15
</packet>
[new message]
```

An empty packet is nothing at all. On the claude profile I'd add the two or three raw user turns behind each fact, with ids.

**Trust note and confidence numbers**
- For a large reader: neutral to slightly negative. I didn't need them, and "confidence 1" on junk lowers trust in the whole packet.
- For a small reader: net harmful. They add numerals, point at tools that may not exist, and do nothing against the confidently wrong `Reference resolved` line, which doesn't "look wrong".
- If uncertainty must be shown, use a word only on weak items ("weak match"), and order by relevance.

**Top 5 changes, ranked**

| # | Change | Helps | How an eval settles it |
|---|---|---|---|
| 1 | Absolute score floor, rarity weighting and stopwords; stop at the floor, not the ceiling; emit "no hits for X" when a rare query term matches nothing | Both | Abstention questions (the `_abs` set): harm rate and packet tokens at equal recall, against the no-packet arm |
| 2 | Turn registers and resolver off until they're precise: results need a unit and label and must be the headline figure; rules need a speaker check and scope | Both, small most | A trick set like S5/S6/S8, register on vs off, scored on wrong-number answers |
| 3 | Small profile: raw window of 3+ exchanges; when the resolver is unsure, pull in the referenced list; index the current session beyond the window | Small | Sweep window 2/4/6 on a follow-up set; S1 and S8 should flip |
| 4 | Turn-level evidence: user turns whole, assistant cut to one line plus pointer, de-duplicated, with "replaces" marks | Both (cost for large, context for small) | Recall vs tokens on LongMemEval; knowledge-update accuracy with and without marks |
| 5 | Move the notice and trust note to the system prompt, drop confidence and matched, add today's date last, put recent turns before the packet | Large (cache), small (noise) | On/off arms per model, plus cache-hit tokens per turn |

Not checked: I didn't see the source turns behind the suspect "rules", so the speaker misattribution is inferred from their wording. The small-model predictions are my reading, not runs on LFM3.

## Appendix C: Opus 5.5, raw review

Unedited.

# Critique of the Beep context packet

I read only the four files I was given: `questions.md`, `samples-real.md`, `mock-samples.md` and `design.md`. For Part 1 I answered each question from its named section alone, before reading anything else.

**Bottom line:** most of the packet's design ideas are sound. The builder output is not, for three reasons:
- **The registers and the resolver only look at the raw recent turns.** That is the one place where they add nothing. They never reach the gap where they are needed: turns in the current session that have scrolled out of the raw window.
- **The results register stores bare numbers pulled from prose.** The small model is the reader most likely to act on them.
- **Retrieval has almost no precision.** It matches on digits, stopwords and common verbs, so large-profile packets fill the 8K ceiling with junk that is marked as high confidence.

---

## Part 1: Answering as the model that received each packet

### Q1. S5, small-local profile: "now double it"

- **My answer:** "If you put in $900 a month instead, that's about $11,000 after a year: $10,800 in deposits plus about $200 in interest. (Doubling the $5,500 total also comes to about $11,000.)"
- **How sure:** high on about $11,000. Medium on which "it" the user meant, but both readings give the same number.
- **What misled me:** the packet says the answer is 200, twice:
  - `Reference resolved: 'it' read as the last result, 100.`
  - `Latest results you gave: 100`

  The builder took the *last number in the sentence* ("roughly $100 in interest"), not the answer itself ($5,500). A 1.7B model given that line twice will almost certainly reply "200". The retrieved block (tilde repo, TypeScript, WebGPU) is pure junk, pulled in because the word `matched now` hit. It was labeled `confidence 1`.

### Q2. S8, claude profile: "wait so what shard size did you say and why"

- **My answer:** "I don't have that in front of me. The 1.2 GB I mentioned was the total download size, not a shard size. Let me search back for it." With tools, I'd call `search_history("shard size")`.
- **How sure:** sure that the packet doesn't hold the answer.
- **What misled me:** `Latest results you gave: 1.2` invites the reply "1.2 GB". That number comes from "a 1.2 GB download" and is not a result at all. This scenario was meant to show the register of the model's own recent answers. That register never appears. Retrieval also ran on a literal phrase ("shard size") and returned nothing, so the earlier answer is unreachable by any route. That points to a blind spot in the builder.

### Q3. LongMemEval knowledge-update (18bc8abd), small-local profile

- **My answer:** Kansas City Masterpiece.
- **How sure:** high. The 2023/06/30 turn says "currently obsessed with Kansas City Masterpiece". The April turns say Sweet Baby Ray's, and oldest-first order makes the update obvious.
- **What helped:** dates and chronological order.
- **What didn't:** about 85% of the 2,489 tokens is noise:
  - caramelized onions;
  - three blocks on sports-league "brand partnerships", pulled in because `matched brand` hit;
  - long lists of wood-chip tips;
  - three made-up "standing rules" (`"Remember to be patient and kind to yourself throughout your fitness journey."`).

### Q4. LongMemEval temporal-reasoning (gpt4_6ed717ea), small-local profile

- **My answer:** the training pads for Luna came first. They were bought "about a month ago"; the dog bed was "about three weeks ago". Both were said on the same day.
- **How sure:** fairly high.
- **What misled or confused me:**
  - The turns are stamped 19:41 and 21:15 on 2023/05/29, but the question was asked at 08:51 that same day, so the evidence is dated after the question.
  - There is no "today" line, so "a month ago" can't be anchored to a date.
  - The junk includes a role-play chatbot named "Max" (`matched max, train`), insomnia advice (`matched bed`) and necklace insurance (`matched item, first`).

### Q5. LongMemEval multi-session (60bf93ed_abs), claude profile

- **My answer:** "I don't see you mentioning an iPad case anywhere in what I have. When did you order it? I can search further back." This is an abstention question, so not answering is correct.
- **How sure:** fairly sure.
- **What helped:** the `matched case` label. It showed me that every "case" hit was a vinyl-record display case, so I could discount them.
- **What misled me:**
  - The packet is 7,927 tokens of near-total junk: lumbar-spine book chapters, a rabbit-grooming argument, compost, streamers.
  - It contains tempting wrong answers. "bought it from Amazon on 1/15" is about a backpack, and "bought 12 packets … about 10 days ago" is cat food. A small model could easily answer "10 days".
  - A user's Crohn's disease turn was pulled in on `matched take`. Low precision here is also a privacy leak into unrelated answers.

---

## Builder bugs visible in the outputs

1. **Registers and the resolver only read the raw window (the inference is consistent across every sample).**
   - In S1, the claude profile resolves "the third one" because the hike list is in its 6-turn window. The small profile says unsure because the list fell outside its 2-turn window.
   - In S7, the claude profile shows `7.5` (in window) and the small profile shows nothing.
   - In S8, the shard-size answer is outside both windows. The register shows the in-window `1.2` instead.

   So registers only repeat what is already visible raw, and they are empty exactly where they matter. The design says "the model's own recent answers go in the registers", and that never happens in any real sample.
2. **The turns between "earlier history" and the raw window are a blind spot.** S8's literal-phrase search found nothing. In S1 (small profile), retrieval brought back the *Thanksgiving travel* list rather than the hike list. That list's third item is "3. Amtrak", so a small model will confidently answer "Amtrak is doable: 9 hours, $62 each". That is worse than having no packet.
3. **The results register picks the wrong numbers:**
   - `100` is the interest, not the $5,500 answer.
   - `7.5` is the mileage of one hike, not a result. It sits stale in S2, S3 and S7, where it has nothing to do with the question.
   - `1.2` is a download size.
4. **The S6 resolver output contradicts the scenario.** The title says "(unsure)", but the claude profile prints `Reference resolved: 'it' read as the last result, 7.5`, so "multiply it by 3" would give 22.5 miles. The scenario itself is also flawed: "no earlier number in the recent turns" is false for the claude profile, because the raw hike list has 7.5 in it.
5. **The rules extractor fails both ways:**
   - **False positives:** every LongMemEval "Remember to …" line becomes a standing rule, presented as word-for-word truth on every turn.
   - **False negatives:** S7 exists to exercise rules, yet "from now on always write typescript, never suggest python" is not in a rules section in either profile. It only shows up because retrieval happened to hit it. The same goes for S1, which also claims to exercise standing rules.
6. **The gate doesn't close.** S3 ("thanks!!") gets 272–281 tokens: the travel block, a stale `7.5`, and `Reference unclear: a bare follow-up, leaning on the recent turns. Check before assuming.` That line invites a small model to answer a thank-you with "what do you mean?".
7. **Confidence is normalized to the top hit, so it means nothing.** `confidence 1 · matched now` sits on a junk block, as do `confidence 1 · matched dash` and `matched 3, 5`. The 0.3 cutoff is relative too, which is why the LongMemEval claude packets reach 7,734, 7,927 and 7,994 tokens out of 8,000. "Ceiling, not target" is violated in every LongMemEval claude sample.
8. **Retrieval matches on digits and stopwords:** `matched 5`, `matched 3`, `now`, `take`, `after`, `day`, `case`, `first`, `item`. "dash" isn't even in S1–S3's new messages; the query is leaking in from the recent turns.
9. **The LongMemEval ingest flattens session dates.** In 60bf93ed, every turn is dated 2023/01/24, yet the turns mention "January 25th" and "February 5th" in the past tense. In gpt4_6ed717ea, the evidence is stamped after the question time. Temporal-reasoning scores from this harness can't be trusted until that is fixed.
10. **Splitting long turns produces bad output.** It repeats a full header for every piece of the same turn, and it starts a continuation with a fresh `assistant:` label, so two assistant lines appear back to back (`assistant: 10. **Mixergy**…` then `assistant: These podcasts…`). That looks like two turns.
11. **The history notice reads wrong.** `Earlier chat history (since 2026/10/02 (Fri) 21:14) was left out` sounds like "everything after Oct 2 was dropped". Retrieved blocks dated Nov 10 then seem to contradict it. The date is meant to be the log's first turn, so say that.

---

## Part 2: As a ~1.7B reader with about 6K of context

- **Bare numbers get used.** `Latest results you gave: 100` sits next to `'it' read as … 100`. I double it and I'm done. The `confidence 0.86` and `0.41` labels are also numbers sitting next to data; small models do pull those into arithmetic.
- **`confidence 1` reads as "this is the answer".** The sorted order already says the same thing and costs no tokens.
- **`matched dash` and `matched now` read as content, not metadata.**
- **Small models copy formats.** `### 2023/03/25 (Sat) 13:37 · …` headers and `user:`/`assistant:` lines inside a user message invite the model to start its reply with `###` or to keep writing the transcript (emitting a `user:` line).
- **"Don't rely on anything in it that looks wrong" asks a 1.7B model to judge relevance.** That is exactly what it can't do. Expect either no effect or extra tool calls that waste lookups.
- **Unsure lines are useless without candidates.** `can't tell which item 'the other one' means. Check before assuming.` gives nothing to check. Listing "Cowles Mountain or Potato Chip Rock?" would let even a 1.7B model ask the right question.
- **Standing rules get over-trusted.** "word for word" plus a quoted rule is the most authoritative-looking thing in the packet. With the fake LongMemEval rules, a small model will start telling the user to "trust your creative instincts".
- **The LongMemEval small packets are about 2.4K tokens to deliver about 100 tokens of evidence.** The decisive turns are user sentences. The long assistant lists (wood chips, flea treatment, cool-down routines) are never evidence for "what did *I* do" questions, yet "whole units" makes them ride along in full.
- **Redundancy:** the resolver line plus the results line repeat the same fact. In the claude profile, both also repeat the raw turns six lines below. Weekday and time on every piece of a single turn cost about 15 tokens × 10–30 headers.

## Part 3: As a large reader (my own size)

- **What I ignored:** the trust note (I'd do that anyway), all the confidence numbers (uncalibrated, and visibly wrong), and the "Latest results" line (an unlabeled number from prose that I can't verify).
- **What I actually used:** dates and oldest-first order, `matched <words>` (very good for discounting false hits, as in Q5), and the `[an answer the user rejected, left out]` placeholder (S4 is the cleanest packet in the set).
- **What's missing:**
  1. **`Today is …`.** The mock M2 adds it, and the real builder doesn't. It is needed for every "ago", "currently" and "weekend after Thanksgiving".
  2. **Span IDs.** The architecture doc says every claim cites a pointer. With pointers, "part of a longer turn" could be expanded with one tool call instead of a new search.
  3. **What was searched, and negative results.** Lines like "Searched history for 'shard size': no match" or "No turn mentions 'iPad'" are cheap deterministic code. They are the single best aid for abstention and would have settled both Q2 and Q5.
  4. **Tool names beyond `search_history`.**
- **Caching:**
  - The stable part (notice, trust note, rules) is about 50–150 tokens. That only helps if it is its own content block with a cache breakpoint, or moved into the system prompt; inside a single `<packet>` message it rides with the volatile part. In practice the cacheable prefix is the system prompt plus tools.
  - The bigger point is economics. Everything after that prefix is uncached every turn. A junk-filled 7.9K packet costs roughly what about 79K tokens of cached transcript would cost to re-read (cache reads bill at roughly a tenth of normal input). So against a plain cached chat, Beep's cost advantage only exists if packets stay lean.
- **Ordering:** rules first, then volatile content, is right. Within the volatile part, putting the answer-ready items (resolved references, Q→A, notes) before raw spans is right, as the mocks do.

## Mocks

- **M1, claude profile:** the same fact appears three or four times.
  - "Dash carsick" is in Notes and in the retrieved block.
  - The fare offer is in Open loops, the Reference line, Q→A and the retrieved block.
  - The rent results `$1,740`/`$20,880` are stale and unrelated to the message.
  - "Your latest answers" repeats the raw turns.

  The Notes do earn their place in one way: they surface the "carsick on planes" conflict with "check those fares".
- **M1, small-local profile:** close to the right shape (see the sketch in Part 4). It still carries the tilde-repo rules into a fares question, so rules need a scope tag and a scope filter for small profiles.
- **M2:** `supersedes: Sweet Baby Ray's` plus `Today is` answers the question outright. Once that note exists, the two raw spans are redundant for a small model; keep one as proof for a large one.
- **M3:** right.

---

## Part 4: Direct answers

### What can be cut entirely with no loss

- Per-item `confidence N`, as currently computed.
- The weekday and the time of day in headers. Keep the date, and keep the time only when the same day needs ordering.
- The text "part of a longer turn". Use `…` plus a span ID.
- `Latest results` and `Reference resolved` whenever the referent is already in the raw turns.
- Any register entry that is a bare unlabeled number.
- The `(since …)` parenthetical, in its current wording.

### The smallest version that keeps the value

```
[stable block, cached]
Chat began 2026/10/02. Only pieces are shown; search_history finds the rest.
Rules (user's words): "always TypeScript, never Python" [tilde]   ← filter by scope for small
[volatile]
Today: 2026/11/26 (Thu)
"the third one" = Potato Chip Rock: 7.5 mi, hot, exposed (your hike list, 11/25)   ← only if referent not in raw turns
Earlier you said: HYSA total ≈ $5,500 ($5,400 deposits + ~$100 interest)        ← labeled, headline value
Known: currently likes Kansas City Masterpiece (6/30; was Sweet Baby Ray's 4/16)
Not found: no turn mentions "iPad"                                                ← when a key entity has zero hits
Past chat, oldest first:                                                          ← large profile, or when nothing above answers
[11/10 #a41] user: … / assistant: …   (matched: fares)                           ← "matched" for large only
```

The default for "thanks", or anything else fully covered by the raw turns, is the stable block alone.

### The trust note and per-item confidence numbers

- **Confidence numbers:** noise for both readers today, because they are relative and the top hit is always 1. They actively mislead the small reader. Even calibrated, ordering plus an absolute cutoff carries the same signal for free.
- **Trust note:** harmless and cheap for a large model, but it changes nothing. For a 1.7B model it probably causes harm or wasted lookups. Keep it only where an eval shows a gain.
- **The label worth keeping:** `matched <words>`, and only for large models.

### Top 5 changes, ranked by impact

1. **Build registers, the resolver and the lists register from the whole current session, and suppress anything already in the raw window.** *Mainly small models; S8 shows it helps both.*
   *Eval:* a follow-up set ("the third one", "double it", "what did you say about X") with the referent placed 0, 2, 6 and 20 turns back. Measure resolution accuracy per profile. Today's builder should collapse past the raw window.
2. **Make registers typed and labeled.** Results become value + what it is + date, taken from the answer's headline. Unsure lines name their candidates. Never emit a bare number. *Both, small most.*
   *Eval:* arithmetic follow-ups with distractor numbers in the same sentence. Score exact-answer accuracy, and count how often a bare register value gets used wrongly.
3. **Fix retrieval precision.** Use stopword and digit filtering and an absolute score threshold, and enforce "ceiling, not target". Index the user's words for fact questions. For the small profile, cut assistant spans to their first lines. Add negative results ("not found: iPad"). *Both: cost for large models, accuracy and abstention for small ones.*
   *Eval:* LongMemEval recall and accuracy against packet tokens, with the no-packet arm, plus harm rate on `_abs` questions.
4. **Anchor dates.** Add a `Today:` line and fix the LongMemEval ingest so each session keeps its real date. *Both.*
   *Eval:* accuracy on the LongMemEval temporal-reasoning and knowledge-update subsets, before and after.
5. **Put labels on a diet.** Drop the confidence numbers, use date-only headers, and add span IDs. Keep `matched` for the large profile only. Test the trust note on and off. Use role labels a small model won't continue as a transcript. Fix the rules extractor's false positives and negatives under this same heading. *Mainly small models.*
   *Eval:* an A/B on the trick set. Measure accuracy, wasted lookups, and the rate at which the small model emits `###` or `user:` at the start of its reply.

---

Not checked: I saw only builder output, not the builder code, so the claim that registers only read the raw window is an inference from the outputs. It holds in every sample. I skimmed the long LongMemEval claude-profile sections rather than reading them line by line.

## Appendix D: Haiku 5.5, raw review

Unedited.

CRITIQUE OF THE BEEP CONTEXT PACKET (samples-real.md, mock-samples.md, design.md)

Process note: to find the sections I grepped the header lines of samples-real.md (headers only). My first Part 1 read used a range that also pulled in S6 and S7 for the small-local S5 block. I did not use those for any answer. Everything in Part 1 was answered before I read design.md or mock-samples.md.

PART 1: EXPERIENCE (answers given as the receiving model, no tools)

1. S5, small-local, "now double it"
Reply: "Doubling the last figure I gave, 100, gives 200. But I don't see where that 100 came from. My last number in view was the HYSA estimate of about $5,500, so do you mean $11,000?"
Confidence: about 40% that 100 is the intended referent. Very confident the packet's 100 has no source in the packet or the raw turns.
Packet helped: nothing. It misled: "Reference resolved: 'it' read as the last result, 100" and "Latest results you gave: 100" are stated as fact, but 100 appears nowhere in the packet or the riding turns. The newest real figure is the $5,500 raw turn, which the resolver ignored.

2. S8, claude, "wait so what shard size did you say and why"
Reply: "I don't see a shard size in what I have. The only number visible is 1.2 GB, which was a phone download size I flagged, not a shard size. I don't want to guess a reason. Let me search the chat for it."
Confidence: high (about 90%) that shard size is not in the packet. Medium that 1.2 is not the target.
Packet helped: the raw turns were clear about the OPFS and Cache API fallback. It misled: "Latest results you gave: 1.2" looks like a stated result, so I could easily have said "1.2 GB, because of the download size" and invented a reason. Retrieval "ran" and returned nothing, and the packet does not say "no match". That silence is a trap.

3. LME knowledge-update 18bc8abd, small-local, "What brand of BBQ sauce am I currently obsessed with?"
Reply: "Kansas City Masterpiece BBQ sauce. You said on 2023/06/30 that you were currently obsessed with it. Sweet Baby Ray's was your favorite back on 2023/04/16."
Confidence: about 95%.
Helped: the 2023/06/30 entry at confidence 1 with the word "currently" is decisive, and the older Sweet Baby Ray's entry sits right beside it for contrast. Misled or diluted: three "Standing rules" lines ("Remember to trust your creative instincts...") are noise that tempts the model to bend its answer to them. The sports-brand-partnership and onion turns add nothing. There is no "Today" line, so "currently" has to be judged from the chat's own timeline.

4. LME temporal-reasoning gpt4_6ed717ea, small-local, "Which item did I purchase first, the dog bed or the training pads?"
Reply: "The training pads came first. You said the pads were bought about a month ago, and the dog bed about three weeks ago, both on the same day. So the pads are older."
Confidence: about 70%. The approximate phrases are the only evidence.
Helped: both purchase turns are present, with confidence 0.95 and 0.85. Misled or hurt: every turn in the packet carries the same date, 2023/05/29, so the packet gives me no way to order events except relative phrases buried in the text. The bed turn appears twice in the packet, and a "Remember to have fun" standing rule adds nothing.

5. LME multi-session 60bf93ed_abs, claude, "How many days did it take for my iPad case to arrive after I bought it?"
Reply: "I don't have anything about an iPad case in what I can see. I'd need to search the chat before giving a number."
Confidence: about 95% that the iPad case is absent from the packet.
Helped: the packet has no iPad content at all, so it does not lure me into an invented number. Misled: about 1,500 tokens of "matched case" hits are display-case and records conversations, and one carries confidence 1.0. A tired reader could answer with a display-case number. The packet gives no signal that a key term of the question was never found, so it doesn't tell me to abstain.

PART 2: AS A ~1.7B READER WITH ~6K CONTEXT

- The packets already eat the budget. Small-local packets come in at 2,363 to 2,489 tokens, which is 95 to 100 percent of its 2,500 ceiling, plus the system prompt, tool list and raw turns. That leaves very little room to think.
- "Latest results you gave: 7.5" is pinned into S2, S3, S6 and S7, including a coding request. A small model will read it as "the answer" to whatever "it" is.
- "matched 5" (S1 claude) and "matched dash" (S1 small, S2, S3) are labels for words not in the new message. Those labels actively mislead.
- Header numbers mix "confidence 1" with "confidence 0.92". A small model may read 1 as true or 100 percent, and 0.31 as nearly as good.
- "Standing rules from the user, word for word" makes casual "Remember to be patient and kind to yourself" lines look like binding instructions. A 1.7B model will over-obey them.
- "Don't rely on anything in it that looks wrong" asks a 1.7B model to judge correctness it cannot judge. It is more likely to ignore good items or to trust bad ones.
- "Use the tools instead" invites extra calls. I can't tell from the docs whether the small profile even gets search_history. If it does not, the notice names a tool it doesn't have.
- "part of a longer turn" fragments start mid-list ("8. Develop a portfolio", "9. Tuning machines", "7. Clean and lube") with no question in front. That is worse for a small model than a full skip.
- Duplicated text burns tokens. The dog-bed turn is repeated two or three times in the temporal packets (both profiles). The rent-share answer repeats across Reference, Latest results and items.
- Over-trust hotspots: "Reference resolved" (S1, S5, S6), "Latest results" (almost everywhere), and the "Standing rules" block.

PART 3: AS A LARGE READER

- A large model would ignore the confidence numbers and probably the trust note. It would notice that "Latest results" is stale or unrelated, and would likely skim the "matched X" labels.
- Missing: an explicit "now" anchor. The LME packets have none. mock M2 has "Today is 2023/07/15", which the real builder doesn't produce.
- Missing: a coverage line for abstention, such as "question terms not found: iPad, arrive". The abs question has no such signal.
- Missing: a clear marker when retrieval ran and found nothing (S8). Silence reads as "nothing relevant", which is ambiguous.
- Missing: any visible reason a resolved referent was chosen. The resolver output is opaque: "resolved" with no source turn.
- Ordering and caching: the "Standing rules" block shows up inside the packet only in some packets (LME 18bc8abd and temporal, not S-series). Its presence moves the packet's tail, so the cached prefix is not stable where the design says pinned rules sit before the packet. The "since <date>" in the notice is stable, which is good. The per-turn packet is always new, so only system prompt, tools and pinned notice actually cache. Put the notice, trust note and rules in one fixed block at the top of the packet, and keep it byte-identical every turn.

PART 3b: WHAT I FOUND HARD, AS A SMALLER CLAUDE MODEL

- I lost track in the 7 to 8K LME packets. I had to scan for the user's question terms to find the relevant turns, then re-check the dates.
- I skimmed the "matched" labels and the confidence numbers. Once I saw "confidence 1" on an irrelevant hit, I stopped trusting that field and read the text.
- I could not weigh "Reference resolved: 100" against the raw HYSA turn. I had nothing to check the 100 against, so I wrote a conditional answer.
- The "Standing rules" block made me hesitate. It looked like it should shape my answer, though it had nothing to do with the question.
- I re-read the recent turns more than the packet, because the packet's relevant items were buried among junk.
- When retrieval returned nothing (S8), I did not know whether to search or to answer from memory. The packet did not say which.

PART 4: DIRECT ANSWERS

Which pieces could be cut with no loss?
- The "Standing rules" block as built. It misfires in both directions (see bugs).
- "Latest results you gave" unless the last turn was an arithmetic result. It does nothing in S2, S3, S7 and S8, and it misled me in S5, S6 and S8.
- The duplicate "Reference resolved" plus "Latest results" pair, which states the same number twice.
- Items below about 0.5 confidence. The 0.30 to 0.46 items in multi-session and 18bc8abd add noise and no recall.
- "part of a longer turn" fragments that lack their question, and duplicate turns.
- Plain-text "matched <word>" labels unless the word is really in the query.

Smallest packet that keeps the value (sketch, roughly 250 to 350 tokens for small):
```
Earlier chat before 2026/10/02 was left out. search_history can read it.
Now: 2026/11/25 (Wed) 09:30
Referent: "it" = $20,880 (your 2026/10/20 rent figure, "multiply it by 12"). If none fits, "Referent unclear: ask or search."
Rules: "from now on always write typescript, never suggest python" (tilde, 2026/10/02)
Question terms not found in history: iPad, arrive
History:
2026/10/20 18:02 - rent share: $1,740/month (60/40; the rejected 1st answer omitted)
2026/10/20 18:05 - $20,880/year
```
Each history line should cite a turn, and the "not found" line gives the model its abstention cue. The trust note becomes this concrete line, not a general warning.

Does the trust note and per-item confidence help or add noise?
- For large readers: noise. They read the text and discount the numbers themselves. The trust note is harmless but does no work.
- For small readers: the numbers add noise and false precision (0.31 vs 1 reads as truth), and "don't rely on anything that looks wrong" is a judgment they can't make reliably. Replace both with rank order plus a short reason, and keep a strong/weak bucket only if the evals prove it. Test the trust note off for small first.

Top 5 changes, ranked by impact:
1. Ground every referent and register value in a cited source turn, or say "unclear". Never pin "Latest results" unless the previous turn was a calculation, and add a type check (miles times 3 should not resolve). Both readers. Evidence: S5 (100 unsourced), S6 (7.5 vs the rent chain, and small said "unsure" on the same input), S8 (1.2 GB as a shard size). Eval: referent accuracy on a follow-up set plus harm rate (wrong referent used).
2. Make the gate close on acknowledgements. S3 ("thanks!!") pulled the full driving chat into the claude packet, and mock M3 expects it empty. Both readers, and a cost win. Eval: wasted-lookup count and packet miss rate on the trick-set acknowledgement subset.
3. Enforce a real small budget: confidence floor about 0.5, cap about 4 items, drop identical or near-identical text, and drop orphan fragments unless their question is included. Small readers mainly. Current small packets always sit at 95 to 100 percent of ceiling, so the cutoff is not doing its job. Eval: sweep 1.2K, 1.8K and 2.5K on small, plotting recall, harm and the no-packet arm.
4. Add a "Now" line, a question-term coverage line, and a supersede filter. This would fix the iPad abstention (60bf93ed) and the superseded Sweet Baby Ray's entries, which the design says to drop and the builder keeps. Both readers. Eval: the abs subset and the knowledge-update subset, scored for harm.
5. Fix rule detection in both directions. Capture the user's real standing rules, such as "from now on always write typescript", which the tilde turn in S7 contains and the builder missed. Stop capturing casual "Remember to..." chat lines, which the LME packets wrongly show as binding. Small readers mainly, since they over-obey. Eval: precision and recall on a labeled set of rule statements, plus the count of rule lines per packet.

Also fix the labels. "matched 5" on a message with no 5 and "matched dash" on messages with no dash mean the labels are not the reason an item came in. Either compute them from real term overlap or drop them. Design mock and real output have also drifted: M2 shows "superseded" and "source" fields the builder does not emit.

Builder bugs I can see in the outputs
- S5 (both profiles): referent 100 and "Latest results you gave: 100" are not in the packet or the raw turns.
- S6 claude: "it" resolved to 7.5 (hike miles) for "multiply it by 3". The rent chain ended at $20,880. The small profile says "unsure" for the same input, so the resolver is inconsistent across profiles.
- S8: "Latest results you gave: 1.2" is a GB download size from a raw turn, not a shard size. Retrieval ran, found nothing, and the packet does not say "no match".
- S3 claude: the gate did not close on "thanks!!".
- Labels "matched 5" (S1 claude) and "matched dash" (S1 small, S2, S3) name words the new message does not contain.
- "Latest results: 7.5" appears in S2, S3, S6 and S7, including the coding request in S7.
- Rule detection is inverted. "Remember to..." chat lines become "Standing rules", while the real "from now on always write typescript" rule in S7 is not in any rules section.
- The 0.3 confidence cutoff is effectively off. Packets include items at 0.31 to 0.46.
- Superseded facts are not filtered. Both Sweet Baby Ray's entries remain beside the June correction.
- The same dog-bed turn is repeated two or three times in the temporal packets.
- Whole sessions share one timestamp (for example 2023/05/29 19:41 on six turns), so ordering must be inferred from text.
- No "now" anchor in any real LME packet.
- Retrieval outputs no "nothing found" state, so silence in S8 and the iPad case is ambiguous.
- Small packets are always at about 2.4K, so the "stops when unlikely to help" rule is not working.
- The notice names search_history for small, but the design leaves tool lists per profile, so availability is unverified.
- The design says evals will decide labels and the trust note. None of the samples show those evals, so the choices are untested for now.

Where I disagree with the design
- "Every item carries a confidence score" is a keyword-overlap score, not a relevance or truth estimate. Calling it confidence will mislead readers, especially small ones.
- "Labels stay only if they beat plain retrieval" is a good rule, but the current labels are already wrong, so the evidence needs to come before the labels, not after.
- "Pinned rules sit before the packet" does not match the builder, which puts rules inside the packet only when present.
- The ~3K small budget in plan.md is a reasonable ceiling, but the builder fills to 2.5K every time. Ask for the smaller packet first and grow it only where evals show recall loss.
- Two real and useful behaviors should be kept and tested: the rejected-answer placeholder in S4 ("[an answer the user rejected, left out]") worked well, and the rent-share answer came through correctly. Keep both.
