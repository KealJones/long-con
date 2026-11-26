# Prefetch ideas, ranked

The backlog the hourly packet R&D loop works from. Each idea is a testable change with a hypothesis and the measurement that settles it. Sources and reasoning: [prefetch-survey.md](prefetch-survey.md) and its appendices. Eval sets: [prefetch-evals.md](prefetch-evals.md).

Written 2026-11-26. **Nothing here has been measured yet**: every hypothesis is a guess from papers and the current dev numbers.

## Rules for the loop

- **Dev only.** Tune and compare on the dev slices. Never inspect or tune on held-out; held-out is scored at milestones only.
- **Both profiles.** Every run reports `claude` and `small-local`.
- **Free evals only.** Recall and the new no-model sets. Paid reader runs only at milestones, on the user's go-ahead.
- **Precision next to recall.** Every run reports all-evidence recall, mean packet tokens, per-type rows (multi-session, temporal, preference), and, once the should-be-empty set exists, empty-packet rate and false inclusions per prompt.
- **Keep rule.** A change is kept only if it raises recall or cuts tokens **without raising false inclusions**. With n=47, treat a change under about 4 points as noise unless it repeats on a second slice.
- **Needs data.** The loop needs `evals/data/longmemeval` downloaded (it's empty in a fresh checkout). If the download fails, the loop works on items marked *no data needed* and logs that it couldn't measure.
- **Log** every run in `iteration-log.md` (the loop creates it), and update the Status column here.

## How ideas are ranked

Score = expected gain × confidence ÷ cost, roughly. Measurement and safety items come first because everything else is judged by them. Status is one of: *open*, *running*, *kept*, *dropped*, *blocked*.

| # | ID | Idea | Profile it helps most | Cost | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | P01 | Should-be-empty set and empty-rate metric | Both (measurement) | Low | kept |
| 2 | P02 | Absolute relevance gate (normalized BM25, coverage, anchor) | small-local | Low | kept (score bar only) |
| 3 | P03 | Logistic gate on ~9 features, τ per profile | small-local | Low | kept (run 3) |
| 3b | P31 | Interest notes: background noter plus remember tool (queued ahead of P04 on 2026-11-26) | Both | Medium | rule noter kept (run 3); model noter and remember tool open |
| 4 | P04 | Cross-encoder rerank of top 40-60 | small-local | Medium | open |
| 5 | P05 | Zero-model contextual prefix in the index | Both | Low | dropped (retry as tie-break) |
| 6 | P06 | Tally mode for counting questions | Both | Low | kept (claude only) |
| 7 | P07 | Event-date index and time-range boost | Both | Low | open |
| 8 | P08 | Rule PRF plus entity second hop | Both | Low | dropped |
| 9 | P09 | Preference spans with category keys | small-local | Low | folded into P31 |
| 10 | P10 | Message-level dense channel with its own floor | Both | Medium | open |
| 11 | P11 | Static embedder for small-local | small-local | Low | open |
| 12 | P12 | URL to file with a line range | Both | Medium | dropped (retry with real pages) |
| 13 | P13 | Identifier-exact `path:line` from a symbol index | Both | Medium | kept (not wired) |
| 14 | P14 | Work-saved paired eval | Both (measurement) | Medium | open |
| 15 | P15 | Pointer tier for medium confidence | small-local | Low | open |
| 16 | P16 | Fact keys and predicted questions at write time | small-local | Medium | open |
| 17 | P17 | Fusion hygiene: RRF k, weights, BM25F, stemming | Both | Low | open |
| 18 | P18 | Prefetched date arithmetic labels | small-local | Low | open |
| 19 | P19 | "Searched, found nothing" line | Both | Low | open |
| 20 | P20 | Working set plus depth-2 tree | Both | Low | open |
| 21 | P21 | Code, non-memory and URL eval sets | Both (measurement) | Medium | open |
| 22 | P22 | Novelty-gated web search | small-local | Medium | open |
| 23 | P23 | Ratcheted raw window plus sticky tier | claude (cost) | Low | open |
| 24 | P24 | Subject index and person cards | Both | Medium | open |
| 25 | P25 | Open-loop speculation between turns | Both | Medium | open |
| 26 | P26 | Key denoising (SeCom) | Both | Low | open |
| 27 | P27 | Conformal τ | Both | Low | blocked (needs ~100 empty prompts) |
| 28 | P28 | Phrase graph plus PageRank, gated | claude | Medium | open |
| 29 | P29 | Source gate trained on packet misses | Both | Medium | blocked (needs real use) |
| 30 | P30 | Citations as labels, per-user refit | Both | Low | blocked (needs real use) |

## The ideas

### P01. Should-be-empty set and empty-rate metric

- **Hypothesis:** today's builder returns a non-empty packet on about 100% of should-be-empty prompts, because the cutoff is relative.
- **Change:** add to `eval recall` four tiers of should-be-empty prompts on the dev haystacks: (1) 30-50 hand-written off-history prompts, (2) cross-haystack (question A on history B), (3) **evidence-ablated** (each answerable dev question on its own history with `answer_session_ids` removed), (4) LongMemEval `_abs` in dev (3). Report empty rate per tier, false inclusions per prompt and packet precision. Later grow to the 300-prompt set in prefetch-evals.md.
- **Measure:** the numbers above, both profiles, no builder change.
- **Cost:** a few hours of code, no model calls. *No data needed* for tier 1's prompts; tiers 2-4 need the dataset.

### P02. Absolute relevance gate

- **Hypothesis:** a single threshold on ceiling-normalized top score × IDF coverage, plus an anchor-term check (rarest query term and every name or number must match), raises the empty rate on tiers 1-2 above 70% and cuts false inclusions on tier 3 by a third, while costing under 2 points of all-evidence recall on the 47 answerable questions.
- **Change:** in `packet.ts`, compute normalized score (score ÷ Σ idf·(k1+1) over query terms), coverage and anchor hit per candidate. Drop units below the bar; keep the 0.3 relative cutoff as a second filter.
- **Measure:** P01 tiers, recall, tokens, both profiles. Sweep the bar.
- **Cost:** low, under 1 ms per turn.

### P03. Logistic gate, τ per profile

- **Hypothesis:** at equal recall, precision@packet rises and mean packet tokens fall at least 20% on claude; on small-local, trading up to 5 points of recall halves false inclusions. Ranking agreement (top-5 overlap of the two rankings) is the strongest query-level feature.
- **Change:** fit ten weights (features in the survey's gate section) on the ~940 labeled top-20 candidates from the answerable dev questions, with leave-one-type-out cross-validation. Pick τ per profile: claude loses ≤2 points of recall, small-local ≤5.
- **Measure:** AURC, gate AUROC, empty rate per tier, recall, tokens.
- **Cost:** low; fit offline.

### P31. Interest notes: background noter plus remember tool

- **Why it's here:** asked for directly on 2026-11-26: any expressed interest, preference or change of one should be remembered, by the harness on its own or by the model through a tool. Queued ahead of P04. Folds in P09, which only marks preference sentences at query time.
- **Hypothesis:** a dated note store (topic, value, date, source turn; newest wins, older values kept as history) lifts knowledge-update and preference all-evidence on both profiles at a fraction of the tokens, since one line can replace a 400-token segment. A rule-based noter catches most cases for free; a cheap-model noter catches more at some false-note cost.
- **Change:** arm A, a free rule noter (first-person interest and change patterns, "my favorite", "obsessed with", "I've been loving", "switched to", "I'm into", "I prefer", "no longer") run after each saved turn. Arm B, a small-model noter on the same turns (paid or plan usage, each run under $1 and logged in the paid-runs ledger). Arm C, a remember tool the model calls mid-turn, measurable only in a reader run. The packet gets a short "Notes" section of the matching notes, newest value first, before retrieved history; the source turn stays reachable.
- **Measure:** knowledge-update and preference rows (all-evidence counts the note's source turn), packet tokens, and note precision: on a hand-labeled sample of saved notes, the share that are real interest. Should-be-empty tiers must not gain false inclusions from notes. Dev has few preference questions (e.g. 18bc8abd). The rest of LongMemEval_S is the held-out split, so a bigger check needs new labeled histories, not those questions.
- **Cost:** medium (arm A is free; arm B needs a small paid or plan-usage run).

### P04. Cross-encoder rerank of the top 40-60

- **Hypothesis:** small-local all-evidence 70.2% → 77-82%; claude +2-5 points at the same or fewer tokens. The reranker's probability also works as an abstention floor.
- **Change:** rerank fused candidates, then fit. Arms: bge-reranker-base (the Workers AI model, run locally for the eval), jina-reranker-v1-tiny, ms-marco-MiniLM-L-6-v2, Qwen3-Reranker-0.6B. Keep the top 2 BM25 units as a floor so multi-session keeps its second piece.
- **Measure:** recall, per-type rows, tokens, latency per arm, empty rate with a probability floor.
- **Falsified if:** tiny rerankers score at or below the baseline (as MiniLM did on LoCoMo).
- **Cost:** medium (model download, ONNX in Node for evals).

### P05. Zero-model contextual prefix

- **Hypothesis:** multi-session all-evidence +3-6 points.
- **Change:** prepend date, topic label, the session's opening user question and linked names to each segment's **indexed** text only. The rendered packet is unchanged.
- **Measure:** recall per type, tokens, false inclusions (a prefix can make everything match common words).
- **Cost:** low, index time only.

### P06. Tally mode for counting questions

- **Hypothesis:** multi-session all-evidence 45% → 60%+ on claude and 55%+ on small-local, at equal or smaller packets.
- **Change:** a rule detects "how many / total / list all / every / different" and retrieves one best sentence per session for the counted noun phrase (BM25 on the user view), dated, deduplicated and budget-capped, replacing 2-3 whole segments.
- **Measure:** recall on multi-session, tokens. Kill if recall rises but sentences drop needed detail (then try sentence ±1).
- **Cost:** low.

### P07. Event-date index and time-range boost

- **Hypothesis:** temporal all-evidence 76.9% → 82-85% (claude), 69.2% → 75-78% (small-local), no change elsewhere.
- **Change:** chrono-node resolves dates in each user sentence against the session time at write time (`said_at`, `about[]`). At query time, parse the question's time phrase against the question date and add a soft score bonus to in-range segments. Split "between A and B" questions into two quotas.
- **Measure:** temporal recall, other types unchanged, tokens.
- **Cost:** low.

### P08. Rule PRF plus entity second hop

- **Hypothesis:** +2-6 points all-evidence, mostly temporal and multi-session, at zero model cost.
- **Change:** content words in ≥2 of the top 10 units are re-searched at weight 0.5; known names found in the top hits are re-searched at higher weight. Only when the two first-pass rankings agree.
- **Measure:** recall, false inclusions (drift on turns whose first pass was wrong).
- **Cost:** low.

### P09. Preference spans with category keys

- **Hypothesis:** preference all-evidence +20 points on small-local and +10 on claude, other types within 1 point. Dev has only 3 preference questions, and the other 27 in LongMemEval_S are held out, so confirming it needs new labeled data.
- **Change:** a regex marks first-person preference sentences ("I love / prefer / hate / my favourite / I usually") with a coarse category. A recommend/suggest intent rule pulls the top 3-5 for the question's category as short cards.
- **Measure:** preference recall, tokens.
- **Cost:** low.

### P10. Message-level dense channel with its own floor

- **Hypothesis:** all-evidence +3 points at both budgets, mostly preference and multi-session. With an absolute cosine floor and "never fills an empty packet", the empty rate stays at the BM25-gate level.
- **Change:** embed each message at write time; a segment's dense score is its best message (max-sim). Fuse as a third RRF ranking. Control arm: one vector per segment.
- **Measure:** recall per type, empty rate, false inclusions, latency.
- **Cost:** medium (embedding the dev haystacks once, locally).

### P11. Static embedder for small-local

- **Hypothesis:** Model2Vec potion-retrieval-32M gets at least half of a transformer embedder's gain at under 5% of its latency, with no GPU contention with LFM3.
- **Change:** P10 with potion vs arctic-embed-xs or bge-small vs EmbeddingGemma q4.
- **Measure:** recall, latency per message.
- **Cost:** low after P10.

### P12. URL to file with a line range

- **Hypothesis:** on the URL set, section hit@1 ≥ 0.7 and line-range overlap ≥ 0.5, abstain accuracy ≥ 0.9 on failures, extraction noise lower than raw body text; matches full-page accuracy on claude at ≤30% of the tokens.
- **Change:** port Squiggle's `contentRoot`, `dropChrome`, `pageText` and `pageCard` into `packages/core` with tests; heading sections scored by BM25 with title and heading-path prefix against the message plus recent topic; 8-20 line window; packet entry as in the survey. Defuddle fallback; `Accept: text/markdown` first.
- **Measure:** the URL eval set (P21), and scenario A of P14 for URL tasks.
- **Cost:** medium. *No LongMemEval data needed.*

### P13. Identifier-exact `path:line`

- **Hypothesis:** on coding prompts that name a symbol, block hit ≥ 0.9 with a wrong-line rate of 0, and first-hop grep or read calls drop ≥50% in P14.
- **Change:** a symbol index (regex per language first, tree-sitter tags later). One definition: `path:line` plus the enclosing function. Two or three: pointers only. More: nothing.
- **Measure:** code path:line set (P21): file recall, block hit, wrong-line rate, tokens.
- **Cost:** medium. *No LongMemEval data needed.*

### P14. Work-saved paired eval

- **Hypothesis:** in scenario A the packet saves at least a third of tool calls and wall time with no correctness loss; in B1 a fresh re-read beats the stale read; in C harm rate and extra tool calls are zero once the gate exists.
- **Change:** build the harness in prefetch-evals.md section 5: tasks frozen from pinned public repos, `claude -p` with stream-JSON, record-and-replay for fetches, alternating arm order, deterministic checks or a blind judge, paired bootstrap intervals.
- **Measure:** correctness, tool calls by kind, bytes read, tokens, wall time, re-fetches, harm.
- **Cost:** medium to build; about 100 runs of 20-60K plan tokens per pass, so nightly, not hourly. *No LongMemEval data needed.*

### P15. Pointer tier

- **Hypothesis:** whole units for high confidence, one-line pointers for medium, nothing for low keeps recall within a point while cutting small-local tokens and harm.
- **Change:** needs P03's probability. Render medium units as "date, topic, one line, where to read it".
- **Measure:** recall counting pointers, tokens, false inclusions; harm in a milestone paid run.
- **Cost:** low after P03.

### P16. Fact keys and predicted questions at write time

- **Hypothesis:** +5-9% relative recall, concentrated in multi-session, at no query-time cost.
- **Change:** a small model writes 1-3 user facts and 2-3 likely questions per segment; a BM25 self-check drops weak ones; all indexed, none shown. Every fact must quote its source span. Run as a labeled ablation, since the headline claims zero model calls at ingest.
- **Measure:** recall, false inclusions.
- **Cost:** medium (plan-usage model calls for the dev haystacks, once).

### P17. Fusion hygiene

- **Hypothesis:** 0-2 points total. If none moves, freeze the lexical side.
- **Change:** one run each: RRF k ∈ {10, 20, 60}; 0.7/0.3 weighted RRF; BM25F with up-weighted user words instead of two rankings; Porter stemming; k1/b at 0.9/0.4. Also each ranking alone versus fused.
- **Measure:** recall, tokens.
- **Cost:** low.

### P18. Prefetched date arithmetic

- **Hypothesis:** temporal answer accuracy rises without changing recall, more for small-local.
- **Change:** label each dated packet item with its delta to the question date and weekday.
- **Measure:** free part: tokens added. Real effect needs a milestone paid run with identical items with and without labels.
- **Cost:** low.

### P19. "Searched, found nothing" line

- **Hypothesis:** raises correct abstention for both readers on tiers 3-4 versus a silent empty packet, with no loss on answerable questions.
- **Change:** when the gate empties the packet, add one fixed line.
- **Measure:** milestone paid run, on and off.
- **Cost:** low.

### P20. Working set plus depth-2 tree

- **Hypothesis:** on follow-up coding turns, list-directory and find-file calls drop ≥40% in P14.
- **Change:** track files named, pasted or edited in the last N turns with hashes; a depth-2 tree of their folders under 300 tokens in the sticky tier.
- **Measure:** P14 scenario A and B tasks.
- **Cost:** low.

### P21. Code, non-memory and URL eval sets

- **Hypothesis:** not a gain; makes P12, P13, P20, P22 and P24 measurable.
- **Change:** build sets 2-4 in prefetch-evals.md with dev and held-out splits fixed by seed.
- **Cost:** medium, plan usage only. *No LongMemEval data needed.*

### P22. Novelty-gated web search

- **Hypothesis:** on new-term and post-cutoff questions, small-local accuracy +15 points; on popular-fact and false-premise questions accuracy doesn't fall, because the detector doesn't fire.
- **Change:** an unknown-word or fresh-topic detector (lexicon miss after the alias register, freshness cue, rare proper noun) triggers a top-3 snippet search.
- **Measure:** free part: detector precision and recall on a labeled prompt set. Accuracy needs a milestone run.
- **Cost:** medium.

### P23. Ratcheted raw window plus sticky tier

- **Hypothesis:** cache reads exceed 70% of input tokens over a long session on claude, versus far less with a sliding window, at equal recall.
- **Change:** raw window grows to a cap then resets; stable packet parts sit behind their own cache breakpoint; clock line at the very end.
- **Measure:** simulated cache hits over a replayed long session (no API needed to count prefix stability).
- **Cost:** low.

### P24. Subject index and person cards

- **Hypothesis:** on person-centric prompts, packet-miss tool calls halve versus plain retrieval.
- **Change:** an alias table of people (names, relation words, user-confirmed merges only) pointing at mention spans; a 40-80 token card of dated pointers, no traits.
- **Measure:** the non-memory set's person cases (P21), source precision.
- **Cost:** medium.

### P25. Open-loop speculation

- **Hypothesis:** on "yes, go" turns, the needed result is already in the packet at least 60% of the time, with under 2 wasted lookups per offer.
- **Change:** when a reply ends with an offer, pre-run the read-only lookups it names during idle time.
- **Measure:** replay of real history once it exists; until then, a small synthetic set.
- **Cost:** medium.

### P26. Key denoising

- **Hypothesis:** +1-3 points lexical, larger for dense.
- **Change:** strip filler and low-information tokens from indexed text by rules; render the original.
- **Measure:** recall, tokens.
- **Cost:** low.

### P27. Conformal τ

- **Hypothesis:** a conformal threshold holds false inclusions under the chosen rate on held-out should-be-empty prompts, where a hand-picked τ drifts.
- **Blocked until:** the should-be-empty set has about 100 dev prompts (P01 grown).
- **Cost:** low.

### P28. Phrase graph plus PageRank, gated

- **Hypothesis:** +3-8 points multi-session on claude on top of P06, near zero elsewhere.
- **Change:** a noun-phrase to span graph, walked from the query's phrases, fused by RRF, only for multi-session and "what do I know about X" queries.
- **Kill if:** single-session types drop.
- **Cost:** medium.

### P29. Source gate trained on packet misses

- **Hypothesis:** macro-F1 ≥ 0.75 for "which source, including none", under 5 ms in the browser.
- **Blocked until:** real turns with packet-off first tool calls exist as labels.
- **Cost:** medium.

### P30. Citations as labels, per-user refit

- **Hypothesis:** after a few hundred real turns, a gate refit on cited and uncited units beats the dev-fitted gate on real prompts.
- **Blocked until:** real use. Design the logging now.
- **Cost:** low.

## Not recommended

- HyDE, query2doc and multi-query: a model call per turn, weak once reranked.
- Listwise LLM rerankers: seconds per turn.
- Full knowledge graphs (GraphRAG, LightRAG, Graphiti, Mem0g): expensive to build, tie or lose on lookups, and entity merging has wiped facts.
- Late interaction (ColBERT) and code embedders as primary channels: heavy, or weak at repo level.
- Profile summaries for advice turns: raise sycophancy; use episodes and people cards.
