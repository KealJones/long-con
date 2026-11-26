# Iteration log

One entry per idea tried by the hourly packet R&D loop. Newest run first. Numbers are dev unless marked held-out. Backlog: [prefetch-ideas-ranked.md](prefetch-ideas-ranked.md).

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
