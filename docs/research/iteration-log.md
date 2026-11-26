# Iteration log

One entry per idea tried by the hourly packet R&D loop. Newest run first. Numbers are dev unless marked held-out. Backlog: [prefetch-ideas-ranked.md](prefetch-ideas-ranked.md).

## Run 5: 2026-11-26, 1:17 PM Arizona

Baseline is main at 4467724 (end of run 4). Every number is dev and tuning-grade; one question is 2.1 points. FI is false inclusions per prompt, with retrieved tokens in brackets. Nothing was kept this run, so main is unchanged. Each tried idea sits on its own branch on GitHub for inspection.

### Tally expansion (category words for counting questions): dropped

- **Sources:** [Voorhees, query expansion with WordNet](https://trec.nist.gov/pubs/trec2/papers/txt/21.txt), [Improving Query Expansion Using WordNet](https://arxiv.org/pdf/1309.4938.pdf).
- **Tried:** a hand-written table of about 60 category nouns and their members (siblings: brother, sister; pets: dog, cat). In tally mode only, a member stands in for a missing query word at a lower weight; the bar stays on the original words. WordNet (one hop of hyponyms) was also measured.
- **Numbers:** claude unchanged (its best weight found the siblings question but added tier-3 FI). small-local 66.0 → 68.1% at 1,432 tokens, tier-3 FI 1.06 → 1.04.
- **Review (Opus 5.5):** valid numbers, but the one gained question was won only by "vinyl" under "album", the exact word in that question's evidence, and the loop already knew the question. Without it there is no gain. WordNet found nothing and added FI on both profiles.
- **Branch:** `loop/tally-expansion`. **Next:** drop filler words ("total", "number") from tally scoring, which is what blocks the siblings question.

### P26. Key denoising: not kept (near miss on claude)

- **Sources:** [SeCom](https://arxiv.org/abs/2502.05589).
- **Tried:** the all-words index reads a denoised key per unit; the rendered text is unchanged. Modes: drop stock assistant sentences ("Certainly", "I hope this helps"), keep the first N words of each assistant turn, or keep only assistant sentences sharing a word with the user turn before them.
- **Numbers (claude, boilerplate mode):** recall held at 80.9%; tokens 4,499 → 4,516; FI 10.86 / 12.18 / 10.15 → 10.53 / 12.10 / 9.00 (tier-2 retrieved tokens 3,280 → 3,290, tier-2 empty rate 44 → 42%). On small-local boilerplate removal lost a question and raised tier-2 FI. Truncating assistant turns cut FI but lost 1-5 questions on both.
- **Why not kept:** the packet grew slightly and tier 2 got one more non-empty prompt, so it fails the keep rule's letter despite the tier-3 drop. No gate refit was needed (CV AUROC 0.946 vs 0.943).
- **Branch:** `loop/p26-key-denoise`. **Next:** denoise only the gate's score features, keeping ranking on full text.

### Filler words out of the relevance bar: dropped

- **Sources:** [Cummins et al., query performance prediction](https://www.dcs.gla.ac.uk/~ronanc/papers/cumminsSIGIR11.pdf), [Lucene coordination factor](https://www.elastic.co/guide/en/elasticsearch/guide/current/practical-scoring-function.html).
- **Tried:** time and filler words ("year", "ago", "total", "ever") out of the bar's score and ceiling, so a never-matching word stops emptying short questions. Variants: out of the ceiling only; words with no match in the history out; and the filler bar only on counting and "how long ago" questions. Tier 1t (12 time-phrase off-history prompts from the P07 branch) was added to the scorer on the branch.
- **Numbers (small-local; claude unchanged in every variant that could keep its trips question):**
  - Filler bar at 0.27: recall held at 66.0%, tokens 1,425 → 1,359, tier-1 FI 1.43 → 0.97, but tier 2 1.18 → 1.20 (309 → 326).
  - Ceiling only: tier-1t FI 0.21 → 0.75. No-match words out: tier-1 empty rate 73.6 → 35.5%.
  - Counting and "ago" questions only: at 0.25-0.26 +1 question but tier-2 FI up to 1.40-1.64; at 0.27 recall even and tier 2 still one unit up.
- **Why dropped:** every setting adds tier-2 FI, which comes from counting questions run against other histories.
- **Branch:** `loop/filler-ceiling`. **Next:** weight filler words down instead of dropping them; merge tier 1t into main's scorer on its own.

### Next ideas

Tier 1t into main's scorer as a measurement change, filler words down-weighted in tally scoring (helps the siblings question), P26 on gate features only, P18 date labels, P04 rerank once a model can be downloaded here (huggingface.co still refuses), held-out check of the dev-tuned bars at a milestone.

## Run 4: 2026-11-26, 12:17 PM Arizona

Baseline is main at ba8e40b (end of run 3). Every number is dev and tuning-grade; one question is 2.1 points and the 95% interval is about ±12. FI is false inclusions per prompt on the should-be-empty tiers, with retrieved tokens where units change size. No paid runs this time.

**Net for the run (free recall), before → after:**

| | claude | small-local |
| --- | --- | --- |
| All evidence | 80.9 → 80.9% | 63.8 → 66.0% |
| Mean packet tokens | 4,499 → 4,499 | 1,831 → 1,425 |
| Tier 1/2/3 FI | 10.86 / 12.24 / 10.21 → 10.86 / 12.18 / 10.15 | 1.72 / 1.90 / 1.26 → 1.43 / 1.18 / 1.06 |
| Tier 1/2/3 retrieved tokens | 3,258 / 3,287 / 2,670 → 3,258 / 3,280 / 2,663 | 470 / 526 / 344 → 392 / 309 / 267 |
| Answerable precision | 10.3 → 10.3% | 21.2 → 24.8% |
| Answerable packets left empty | 0 → 0% | 4.3 → 14.9% |

### Tally gate: kept

- **Sources:** [Choppy](https://arxiv.org/abs/2004.13012), [Learning to Truncate Ranked Lists](https://arxiv.org/pdf/2102.12793), [Relevance Filtering for Embedding-based Retrieval](https://arxiv.org/pdf/2408.04887).
- **Changed:** a counting-question piece comes in only when a segment holding its turn passes the profile's own unit gate, so no new number was tuned. With the gate, small-local runs tally mode too. `evals/loop/fit-tally-gate.ts` and `evals/results/tally-gate-sweep.md` hold the sweep.
- **Numbers:** claude unchanged but for tier 2/3 FI 12.24 / 10.21 → 12.18 / 10.15. small-local recall held at 63.8%, tokens 1,831 → 1,511, multi-session packets 1,590 → 664 tokens, FI 1.72 / 1.86 / 1.17, precision 21.2 → 23.6%.
- **Review (Opus 5.5):** valid with fixes, numbers reproduced, no leaks, no hidden win-for-loss swaps. On counting questions a unit changes from a segment to a user-turn piece, so small-local's claim rests on retrieved tokens (526 / 344 → 475 / 274); FI counts and precision are secondary. Unit weights saw every dev label: in-sample, CV-checked only for the tally part. The reused 0.01 isn't the best bar (0.005 gives small-local 66.0%). Also: small-local abstention packets drop 1,029 → 417 tokens, 3 of 8 knowledge-update questions now trigger tally mode, and pieces carry user turns only, which no reader eval has checked.
- **Pushed:** fa93f0c.

### P17. Stemming and fusion hygiene: Porter for small-local kept

- **Sources:** [Snowball English stemmer](https://snowballstem.org/algorithms/english/stemmer.html), [Cormack et al., RRF](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf), [Trotman et al., BM25 variants](https://www.cs.otago.ac.nz/homepages/andrew/papers/2014-2.pdf).
- **Changed:** a per-profile stemmer (`stemmer@2.0.1`, Porter 1980, MIT, no dependencies). small-local uses Porter with minScore 0.25; claude keeps the suffix stripper. Search, notes, tally pieces, the search_history tool and the plain-BM25 baseline all use the profile's stemmer.
- **Sweeps (on main with the tally gate):** Porter gains two dev questions (68.1%) at every bar from 0.20 to 0.24, but adds tier 2/3 FI at 0.23 and below and tier 3 FI at 0.24 (1.17 → 1.26). Only 0.25 adds no FI anywhere: +1 question, FI 1.43 / 1.18 / 1.06. The suffix stripper's best bar (0.22) holds 63.8% with FI 1.54 / 1.32 / 1.17, so Porter at 0.25 beats it on every count. On claude Porter added FI at every bar that kept recall. RRF k, list weights and BM25 k1/b moved nothing.
- **Review (Opus 5.5):** valid with fixes. The recall gain comes from Porter and the FI cut from the bar, not both from each. Fixes made: the comment says which does what, the baseline BM25 uses the profile's stemmer, and a test states that a two-word count where one word never matches ("concerts ... this year") comes back empty on small-local.
- **Caveats:** 0.25 is the cliff edge (0.24 keeps a second question), and 7 of 47 answerable small-local packets now come back empty (was 2). That fits "empty over wrong", but a filler-word fix (year, week, ago never matching) would likely win some back.
- **Pushed:** b3e8923.

### P07. Event dates and a time-range boost: dropped

- **Sources:** [LongMemEval](https://arxiv.org/abs/2410.10813) (time-aware query expansion), [SmartSearch](https://arxiv.org/pdf/2603.15599).
- **Tried:** `dates.ts` resolves "last Saturday", "two weeks ago", "in March" and the like to day ranges against the message date and dates events in user turns against their session's date. The phrase leaves the keyword query and in-range units get a boost.
- **First numbers:** claude +1 question (83.0%) with fewer tokens and FI. The review (valid with fixes) found the gain rests on 3 dev questions with a time phrase and that tier 1 held no time phrase, so it couldn't show the risk.
- **New probes:** tier 1t, 12 hand-written off-history prompts with time phrases, dev split only. The boost raised claude's tier-1t FI from 7.04 to 10.71. Kept out of the bar and the unit gate it found no question, and stripping the phrase alone raised tier-1t FI to 8.00. The +1 question came from the bar lift, not the dates.
- **Kept for later:** branch `loop/p07-event-dates` on GitHub (timeBoost 0) holds `dates.ts`, tier 1t and the reproducible sweep (`evals/results/p07-time-boost-sweep.md`). P18 (dates as labels on retrieved units) can start from it.

### Next ideas

Filler time words left out of the bar's ceiling (P17's next idea; it would also cover the empty two-word counts), query expansion inside tally mode for vocabulary misses ("siblings" vs "3 sisters"), P18 date labels with tier 1t as its abstention check, paired repeat of the reader arms (waiting on a decision about the trust line), P04 rerank, held-out check of the dev-tuned bars at a milestone.

## Run 3: 2026-11-26, 11:17 AM Arizona

Baseline is main at 9635787 (end of run 2). Every number is dev and tuning-grade. This run also took three asks ahead of the backlog: share one search function between the packet and the search_history tool, a reader arm that gets the packet as tool calls, and reader ablations of the trust note and the rules register. Reader runs are paid (Claude Haiku 5.5 reader, Claude Opus 5.5 judge, 50 dev questions, one repeat, $0.32-0.34 each). With 50 questions the 95% interval is about ±12 points, so only differences in searches and tokens are clear; accuracy differences below are noise.

**Net for the run (free recall), before → after:**

| | claude | small-local |
| --- | --- | --- |
| All evidence | 80.9 → 80.9% | 66.0 → 63.8% |
| Mean packet tokens | 4,549 → 4,499 | 2,173 → 1,831 |
| Tier 1/2/3 FI | 12.38 / 12.78 / 10.68 → 10.86 / 12.24 / 10.21 | 3.47 / 3.94 / 2.79 → 1.72 / 1.90 / 1.26 |
| Answerable precision | 10.2 → 10.3% | 17.6 → 21.2% |

### Reader arms: packet as tool calls, trust note off, rules register off (paid)

- **Changed:** `evals/src/arms.ts` arms `packet-tools` (retrieved units arrive as an assistant search_history call and its result; the head stays a short packet block), `packet-notrust` (no "best guess" trust line), `packet-norules` (no standing-rules register). Optional `standingRules` profile flag.
- **Numbers (claude, GitHub runs 4 and 5 on f5c8645):**

| Arm | Accuracy | Searches / question | Reader input tokens / question |
| --- | --- | --- | --- |
| packet | 78% | 1.6 | 18,040 |
| packet-tools | 76% | 0.3 | 7,604 |
| packet-notrust | 84% | 0.5 | 8,522 |
| packet-norules | 80% | 1.6 | 16,875 |

- **Read:** the trust line makes the reader search about three times as often and doubles its input, with no accuracy gain. Tool-call delivery cuts searches and tokens about as much. The rules register changes nothing measurable (21 of 50 dev packets carry rules). Runs are separate and unpaired (the artifacts couldn't be downloaded here), so the 2-6 point accuracy gaps are noise.
- **Next:** a paired repeat of packet vs packet-notrust vs packet-tools before changing the default.

### Shared search for the packet and the search_history tool: kept

- **Changed:** `searchHistory` moved into core on top of `searchUnits` (same two-index fusion, same gate features, same unit format). The tool returns the profile's `searchResults` best units; units the packet would leave out come back marked low confidence instead of dropped. The eval's plain-BM25 copy is gone.
- **Numbers (GitHub run 6 on 70ff2c5, with P31 and P03 in):** bare 72% (1.6 searches, 3,927 reader tokens), packet 80% (1.5 searches). Run 3 with the plain-BM25 tool had bare 72%, packet 76%. Free recall is unchanged (the packet path didn't move).

### P31. Interest notes, rule noter: kept as the requested feature (neutral on scores)

- **Sources:** prefetch-ideas-ranked.md P31; [LongMemEval](https://arxiv.org/pdf/2410.10813); [Preference-Aware Memory Update](https://arxiv.org/html/2510.09720v1); docs/research/people.md.
- **Changed:** `notes.ts`: dated notes from user turns ("my favorite", "obsessed with", "I'm into", "switched to", "no longer"...), skipping questions, hypotheticals and sensitive topics; newest value wins, history kept. A Notes section behind the absolute bar, needing 2 shared words and 0.5 of the message's IDF weight, at most 3 topics. `empty-rate.ts` counts a shown note as a unit unless its source turn is already in a shown segment.
- **Numbers:** recall and false inclusions unchanged on both profiles (claude 4,549 → 4,551 tokens, small-local 2,173 → 2,170); zero notes on any tier 1-3 prompt. Note recall 2/8 knowledge-update and 0/3 preference questions; both hits were already in the packet. Note precision 56/60 real interests on a sample labeled by the noter's author after the rules were frozen (a first check, not an independent one). 14 ms for a 616-turn history.
- **Review (Opus 5.5):** valid with fixes. The first scorer counted a note twice when its turn was already in a shown segment, which made precision look higher; fixed, and precision is unchanged.
- **Kept because** the notes were asked for and add no false inclusions; the keep rule's gain test doesn't apply to it. Dev evidence is mostly counts and possessions, not interest wording.
- **Next:** quantity and possession notes ("currently 25 titles"), the model noter (arm B) and remember tool, and a reader run testing a note in place of a segment on small-local.

### P03. Logistic unit gate: kept

- **Sources:** prefetch-ideas-ranked.md P03; [Towards Trustworthy Reranking](https://arxiv.org/pdf/2402.12997); [Relevance Filtering for Embedding-based Retrieval](https://arxiv.org/pdf/2408.04887); [ChunkRAG](https://arxiv.org/pdf/2410.19572).
- **Changed:** `gate.ts`: a logistic model over 10 ranking features; units under `unitGate` (claude 0.002, small-local 0.01) stay out. The P02 bar still decides empty or not; tally pieces skip the gate. `evals/loop/fit-gate.ts` fits and sweeps.
- **Numbers (shipped weights, in-sample):** claude 80.9% at 4,499 tokens, FI down slightly. small-local 66.0 → 63.8% (one multi-session question) at 1,831 tokens, FI roughly halved, precision 17.6 → 21.2%. Leave-one-type-out CV: 4,458 / 1,821 tokens, same recall.
- **Review (Opus 5.5):** valid with fixes; no leakage, numbers reproduced. Leave-one-type-out is a loose holdout, since tier prompts cross folds; grouped-by-question CV keeps the direction with a 10-20% smaller FI cut (small-local FI 1.79 / 1.90 / 1.30). Tau was picked on the same sweep. Fixed: commit states in-sample vs CV; `candidates()` takes the profile.
- **Next:** a gate for tally pieces (they cause most of claude's remaining FI); claude tau 0.004 is an option (FI 6.26 / 9.72 / 7.11 at 4,102 tokens for one question); held-out check of both taus.

### Next ideas

P17 stemming and fusion hygiene (in flight at write time), paired repeat of the reader arms, tally-piece gate, P04 rerank of the expanded pool, P19 empty-packet line, held-out check of the P02 bars and P03 taus at a milestone.

## Run 2: 2026-11-26, 10:19 AM Arizona

First run with the dataset (from the repo's release copy; huggingface.co still refuses) and with push access. Baseline is main at 979834c. Every number is dev, and every setting below was tuned on the same dev slice, so these are tuning numbers until held-out confirms them. FI is false inclusions per prompt on the should-be-empty tiers. The run also queued interest notes (P31) ahead of P04.

**Net for the run, before → after:**

| | claude | small-local |
| --- | --- | --- |
| All evidence in packet | 78.7 → 80.9 | 68.1 → 66.0 |
| Evidence turns | 86.2 → 87.6 | 77.8 → 74.6 |
| Mean packet tokens | 5,700 → 4,549 | 2,273 → 2,173 |
| Tier 1 / 2 / 3 empty rate | 8.1 / 0 / 0% → 45.3 / 44.0 / 51.1% | 8.1 / 0 / 0% → 59.4 / 58.0 / 68.1% |
| Tier 1 / 2 / 3 FI | 19.71 / 26.00 / 25.68 → 12.38 / 12.78 / 10.68 | 7.47 / 9.20 / 8.81 → 3.47 / 3.94 / 2.79 |
| Answerable precision | 8.7 → 10.2% | 17.8 → 17.6% |

### P02. Absolute relevance gate: kept

- **Sources:** prefetch-ideas-ranked.md P02; prefetch-survey/abstention-and-new-ideas.md; [BMX](https://arxiv.org/pdf/2408.06643); [Selection Is Retrieval, Abstention Is Not](https://arxiv.org/pdf/2609.18672).
- **Changed:** `bm25.ts` gets `idf()` and `ceiling()`; each unit's score is also taken as a share of the most any unit could score on the query; when the best unit is under `profile.minScore` (claude 0.17, small-local 0.2) the packet retrieves nothing. The 0.3 relative cutoff still decides otherwise.
- **Tried and dropped in the sweep:** the bar on every unit (claude lost 6.4 points at 0.1, 27.6 at 0.2); an anchor check requiring every rare word in one unit (all-evidence fell to 21%, 12 questions empty, since comparisons spread names over chats); IDF coverage (worse than the score bar at equal recall).
- **Numbers:** claude all-evidence 78.7 → 78.7 at 5,700 tokens; tier 1-3 empty 8.1 / 0 / 0% → 45.3 / 44.0 / 51.1%, FI 19.71 / 26.00 / 25.68 → 12.38 / 14.34 / 12.34. small-local 68.1 → 66.0 (one question; d6233ab6 and gpt4_7ca326fa come back empty), 2,273 → 2,173 tokens, empty 59.4 / 58.0 / 68.1%, FI 7.47 / 9.20 / 8.81 → 3.47 / 3.94 / 2.79. small-local's lead over plain BM25 is now +8.5 (+0.0 to +19.1).
- **Review (Opus 5.5):** valid with fixes; every number reproduced, no labels used, normalization can't exceed 1, tier 1 uses all 1,250 probes. Fixed: recall results regenerated. Caveats carried here: the gate is all-or-nothing, so a packet that isn't empty holds as many weak units as before (claude tier 3 about 25 FI per non-empty packet); both bars were tuned on the scored questions and claude's 0.17 is one notch from a cliff (0.18 loses a question), so the bars need a held-out check before anyone quotes them.
- **Next:** P19 "searched, found nothing" line when the gate fires; a lower per-unit bar below the top unit; the normalized score as P03's main feature.

### P06. Tally mode for counting questions: kept on claude, off on small-local

- **Sources:** prefetch-ideas-ranked.md P06; [LongMemEval](https://arxiv.org/html/2410.10813v2).
- **Changed:** `tally.ts`: a counting detector on the message text, and one piece per matching user turn (the whole turn up to 150 tokens, else its best sentence ±1), at least 0.4 of the top score. It runs only after the gate passes. `tallyPieces` per profile: claude unlimited, small-local 0 (off). Non-counting messages build byte-identical packets.
- **Numbers (claude, on top of P02):** all-evidence 78.7 → 80.9, multi-session 45.5 → 54.5 at 1,765 tokens for that type, mean 5,700 → 4,549 tokens, tier 2 / 3 FI 14.34 / 12.34 → 12.78 / 10.68, retrieved tokens on tier 3 3,649 → 2,801. Evidence chats found 94.1 → 93.5. small-local with tally on would have been 68.1 → 70.2 but tier 3 FI 8.81 → 9.19 even at the best cap (12), so it stays off.
- **Review (Opus 5.5):** valid with fixes; numbers reproduced, no labels, recall credits only whole turns, byte-identical claim checked on 152 packets. Caveats: the recall gain is one question (bf659f65), within noise; FI counts compare one-turn pieces with 400-token segments, so retrieved tokens are the fairer view; the 0.4 share and the cap were swept on dev. The detector misses "how many times", "count the…" and "name every…", the "you" exclusion drops "can you list all…", and it fires on "every morning" or "total runtime"; those errors cost recall rather than inflate it.
- **Next:** query expansion inside tally mode (misses are vocabulary: "siblings" vs "3 sisters"); fix the stemmer so "wedding" and "weddings" match (P17); a better detector.

### P05. Zero-model contextual prefix: reverted

- **Sources:** prefetch-ideas-ranked.md P05; [Anthropic contextual retrieval](https://www.anthropic.com/engineering/contextual-retrieval); [free contextual chunk headers](https://dev.to/kartikeyraj/free-contextual-chunk-headers-heading-aware-chunking-for-hybrid-retrieval-560); [arXiv 2608.00824](https://arxiv.org/pdf/2608.00824).
- **Tried:** the session's opening words and top tf-idf words added to each unit's indexed text, in the all-words index, the user index or both.
- **Numbers (best, opening 20 words in the all-words index):** claude 78.7 → 80.9 but 5,700 → 6,304 tokens, FI up 0.3-0.6, precision 8.7 → 7.9%; small-local 68.1 → 72.3 at +46 tokens, FI flat. Multi-session stayed at 45.5% in every variant, so the hypothesis is falsified. In the user index it cost temporal and preference 8-31 points.
- **Why reverted:** claude adds tokens and false inclusions; the shared prefix lifts a matched chat's other units over the cutoff.
- **Next:** the prefix as a tie-break bonus between chats, not indexed text; small-local only, after more questions.

### P08. Rule PRF plus entity second hop: reverted

- **Sources:** prefetch-ideas-ranked.md P08; prefetch-survey/fusion-rerank-and-query.md; [SmartSearch](https://arxiv.org/html/2603.15599); [RM3 and HyDE feedback](https://arxiv.org/html/2511.19349v1).
- **Tried:** words shared by 2+ of the top 10 units at weight 0.5 and user-written names from the top 3 at 2.5, searched again and fused; reorder only, so it can't add a unit the question didn't match. With and without a ranking-agreement gate.
- **Numbers:** claude unchanged (78.7, 5,699 tokens); small-local 68.1 → 70.2, turns 77.8 → 81.6, but tier 3 FI 8.81 → 8.87. One question, and false inclusions up, so it fails the keep rule.
- **Finding:** 9 of claude's 14 missed evidence turns share no word with the question. Feedback reaches 8 of them, but at 0.02-0.14 of the top score, so letting them in would let in far more junk.
- **Next:** a reranker on the expanded pool (P04), since feedback finds the evidence but ranks it low.

### Next ideas

P31 interest notes (rule noter first, free), P19 empty-packet line, P03 logistic gate on the normalized score, P04 rerank of the expanded pool, P17 stemming fix, a held-out check of the P02 bars at a milestone.

## Run 1: 2026-11-25, 8:17 PM Arizona

**Blocked:** LongMemEval couldn't be downloaded (huggingface.co is not reachable from the loop's environment), so no chat-recall numbers this run. The loop worked only on items that need no dataset. The push to GitHub was also refused (the repository isn't in the loop's authorized set), so the commits below were made locally and wait for that access. They were rebuilt on 2026-11-26 from the run's own log and re-scored to the same numbers before being pushed.

### P01. Should-be-empty set and empty-rate metric: kept (measurement)

- **Sources:** prefetch-ideas-ranked.md P01; prefetch-evals.md.
- **Changed:** `evals/sets/should-be-empty/tier1.json` (46 off-history prompts, 25 dev / 21 held-out), `evals/loop/empty-rate.ts` (tiers 1-3 headline, `_abs` tier 4 informational), a synthetic fixture haystack and tests. No builder change.
- **Numbers:** fixture smoke test only, not a benchmark. Both profiles: T1 empty 64%, 0.43 false inclusions per prompt; T2 0% empty, 1.00; T3 0% empty, 1.33. Answerable precision 42.9%. This confirms the relative cutoff alone rarely abstains.
- **Review (Opus 5.5):** valid with fixes. Fixed: near-copy chats now dropped from tiers 2-3 by the `evidenceGroups` rule, tier 4 out of the headline, one history per `_abs` twin, core imported as `@long-con/core`, builder-coupled test removed.
- **Next:** run on real data as soon as the dataset is reachable; it is the yardstick for P02 and P03.

### P13. Identifier-exact `path:line` from a symbol index: kept (new source, not yet wired into the packet)

- **Sources:** prefetch-ideas-ranked.md P13 and P21; prefetch-survey/beyond-chat.md.
- **Changed:** `packages/core/src/symbols.ts` (regex index for TS/JS, Python, Go; one definition gives `path:line` plus the whole block, 2-3 give pointers, more or none give nothing; no fuzzy matching), `evals/sets/code-pathline/` (90 prompts over this repo at 2f04267, gold spans from the TypeScript syntax tree), `evals/loop/code-pathline.ts`, `evals/results/code-pathline.md`.
- **Numbers, exact-name prompts (a spec check, not proof of usefulness):** claude dev block hit 21/21, IoU 0.95, wrong-line 0, empty right 17/17, false inclusions 0, 279 tokens per non-empty packet; held-out 15/15, IoU 0.90, 5/5, 0, 287. small-local dev 18/21 hits (3 over the 400-token cap became pointers), 0 wrong lines, 0 false inclusions, 195 tokens; held-out 11/15 (4 pointers), 150 tokens.
- **Numbers, harder prompts (plain-language, misspelled, lone PascalCase, non-symbols):** abstained correctly on 22/22 should-be-empty, 0 false inclusions; lone PascalCase symbols found 1/5.
- **Review (Opus 5.5):** valid with fixes; all 42 original labels checked. Fixed: gold spans and IoU, file recall, non-empty token mean, harder subset, results doc says plainly the exact-name set only checks the spec.
- **Next:** signature plus pointer for blocks over the small-local cap; wire it into the packet as its own section with a fresh disk read; test on a second repo with prompts written by someone other than the resolver's author.

### P12. URL to file with a line range: reverted (measurement not trustworthy, adds false inclusions)

- **Sources:** prefetch-ideas-ranked.md P12 and P21; prefetch-survey.md (Squiggle prior art).
- **Tried:** landmark extraction with no new dependencies, failure detection, BM25 section scoring with a coverage bar, 12 synthetic pages and 44 prompts.
- **Numbers:** claude dev hit@1 86%, IoU 0.56, abstain 86%, 0.10 false inclusions per prompt, 22% of cleaned-page tokens; held-out 90%, 0.70, 80%, 0.07. small-local similar. Failure pages abstained 100%.
- **Review (Opus 5.5):** valid arithmetic, but the fixtures' chrome classes and paywall text match the extractor's rules almost one for one, pages are shared across splits, and most prompts reuse the gold line's words. So the chrome-noise and failure numbers are close to circular, and the source still adds false inclusions (lexical traps like "gluten free", "bumblebees sting").
- **Next:** build the URL set first, from real CC-licensed pages labeled before any extractor exists, split by page with a fixed seed; then retry with an anchor-term check and a tie-break-only static embedding.

### Next ideas for the loop

P02 absolute relevance gate and P03 logistic gate (need the dataset), P05 contextual prefix, P06 tally mode, P07 event-date index. Without the dataset: rebuild the URL set from real pages (P21), P20 working set plus depth-2 tree.
