# Iteration log

One entry per idea tried by the hourly packet R&D loop. Newest run first. Numbers are dev unless marked held-out. Backlog: [prefetch-ideas-ranked.md](prefetch-ideas-ranked.md).

## Run 10: 2026-11-26, 7:18 PM Arizona

Baseline is main at bbf0298 (builder as in run 9). Dev numbers only, tuning-grade. FI is false inclusions per prompt, retrieved tokens in brackets. No paid runs. Nothing changed main's packets this run. A claude stemmer fix was still running when this was written and gets its own entry.

### P28. Phrase graph plus personalized PageRank, gated: not kept

- **Sources:** [HippoRAG](https://arxiv.org/abs/2405.14831), [HippoRAG 2](https://arxiv.org/abs/2502.14802).
- **Tried:** `phrasegraph.ts`, a rule-based phrase chunker (content words and adjacent pairs) and a phrase-to-unit graph walked by personalized PageRank from the message's phrases (seeds weighted by specificity, damping 0.5, 10 iterations, phrases in over 5% of units dropped as hubs), fused with the BM25 rankings by RRF. Only for messages a rule written before scoring marks as aggregation ("what do I know", "so far", "across all", counting words): 9 of 13 multi-session dev questions, no single-session ones. Up to 2 extra units come in whole, behind the score bar.
- **Numbers:** no new evidence on either profile, and every per-type row unchanged. claude tokens 3,949 → 4,107, t2 FI 9.52 → 9.76, t3 7.17 → 7.47, precision 11.4 → 11.0%. small-local tokens 1,425 → 1,569, t2 FI 1.18 → 1.34, t3 1.00 → 1.13, precision 24.9 → 23.0%. A walk-only variant did the same.
- **Why not kept:** every multi-session evidence turn claude misses shares no word with the question, and the walk ranks those turns 70th to 400th of about 480. Without model-written triples or synonym edges, a word graph sees what BM25 already sees. Branch `loop/p28-phrase-graph` (fa9de0c, off by default).
- **Next:** the suffix stemmer splits "weddings" from "wedding", which causes two of one question's misses; the rest need meaning (an embedding channel, once a model can be downloaded).

### P17. BM25F with up-weighted user words: not kept (run 9 idea, finished in run 10)

- **Sources:** [Robertson, Zaragoza and Taylor 2004](https://ir.webis.de/anthology/2004.cikm_conference-2004.6), [Pérez-Iglesias et al.](https://arxiv.org/abs/0911.5046).
- **Tried:** a `Bm25F` index (user and assistant fields, each with its own length normalization and weight, summed before one saturation) to order units, three ways: replacing the two-ranking RRF, replacing it but keeping today's confidence, and as a third RRF list. Sweep: user weight 1 to 5, b user 0.3 to 0.75, b assistant 0.3 to 1.0. The bar and unit gate kept their features, so nothing was refit. Results in `evals/results/p17-bm25f-sweep.md` on the branch.
- **Numbers (best of each):** replacing (3 : 0.75 : 0.5) cut claude FI (t1 7.09 → 6.77, t3 7.17 → 6.49) but lost a whole question and both pointer finds (78.7 / 80.9 → 76.6 / 76.6%); small-local lost 4 or more questions at every setting (66.0 → 57.4% at its best replace). As a third list, claude held whole recall but lost the pointer find and added FI on every tier; small-local stayed one question short.
- **Why not kept:** a loss on both profiles. One saturation lets a long assistant answer that repeats the query words max out a unit whether or not the user turn matches; RRF gives the user-word ranking its own vote. The lexical side looks done. Branch `loop/p17-bm25f` (0eecf39).
- **Next:** pick pointers by gate probability instead of rank, so the 3-pointer cap is less order-sensitive; an embedding list (P04/P10) once a model can be downloaded.

### P20 retry. Working set with a current-project signal: not kept

- **Sources:** [Agentless](https://arxiv.org/html/2407.01489v2), [LocAgent](https://arxiv.org/pdf/2503.09089), [Cline multi-root workspaces](https://docs.cline.bot/features/multiroot-workspace.md), a Cursor forum thread on multi-root path links.
- **Tried:** the caller names the active workspace (root, name, files). A path from the chat counts only after a turn ties the window to it (its name, its root folder's name, or an absolute path under its root); a path outside it, a `../` path, or a top folder the workspace lacks unties it until the next tie. Absolute paths outside the root never resolve. New hand-written set `evals/sets/working-set-mixed/` (63 chats, 34 dev and 29 held out by the shared hash split, held-out not run), with a wrong-items metric. Memory packets byte-identical to main on both profiles.
- **Numbers (dev, first try → retry):** named earlier 4/6 → 5/6 (small-local 3/6 → 4/6), nearby 4/4, mixed window 7/7, should-be-empty 6/12 → 12/12, wrong items 15 → 3, section tokens 168 → 176. On the run 7 set, whose chats never name the repo: named earlier 5/7 → 0/7, nearby 13/13 → 1/13.
- **Review (Opus 5.5):** valid with fixes; every number reproduced, byte-identity confirmed with a separate hash. But 15 of the 17 tied dev chats tie by naming the repo in a user turn, so those rows show the resolver works once tied, not that ties happen. 9 of the 12 should-be-empty chats can't get a section by construction. Items from before an untie are kept, so all 5 dev switched chats still carry a stale section of about 188 tokens while the user is on another project, which no metric scored. The claim that tool output ties real windows is untested, since turns carry text only.
- **Why not kept:** recall on windows that don't name the workspace collapses, and switched chats keep a stale section, a false inclusion. Branch `loop/p20-current-project` (1ad4bef).
- **Next:** an untie drops what came before it; seed the tie from the session's own working directory (the caller knows it); pass the user's other workspace names so a switch said in words unties; score stale sections as wrong items.

## Run 9: 2026-11-26, 5:18 PM Arizona (ran through the 6:17 wake)

Baseline is main at 826beb2 (P15 pointer tier on claude). Dev numbers only, tuning-grade; one question is 2.1 points. FI is false inclusions per prompt, retrieved tokens in brackets. No paid runs. BM25F (P17) finished in run 10.

### P15 follow-ups: readable recall row kept (measurement); pointer grid changes nothing

- **Sources:** run 8's P15 entry and review; [Stability Regularized Cross-Validation](https://arxiv.org/html/2505.06927v1) on how small-dev picks read better in-sample than they are.
- **Changed:** `eval recall` prints "claude: readable (pointers open in 3 searches)" for profiles with pointers on, using the same `searchUnits` path and top-N as the real search tool; `pointer-sweep.ts` calls the shared code. Every other number is unchanged and small-local output is byte-identical. Claude readable is 80.9%, equal to pointers-as-found.
- **Grid (claude, gate 0.003 to 0.008 by 0.001, cap 0 to 4, plus no cap):** no setting beats main (0.004, cap 3) under the keep rule. Cap 0 at 0.004 cuts t1 FI 7.09 → 5.79 (t3 7.17 → 6.47) at the same 78.7% whole recall but loses the pointers-as-found question. 0.007 with cap 0 halves FI (t1 3.46, t3 4.00) and saves about 870 tokens for one more question (76.6%). With no cap, every gate reaches 80.9% readable but FI returns to pre-P15 levels. Each pointer costs about +0.4 to 0.5 t1 FI. A rule fixed before looking picks 0.004 with cap 0 in-sample; leave-one-type-out CV picks it in five of six folds (held-out readable 74.5%).
- **Review (Opus 5.5):** valid with one fix (a pointer now has to match its unit's end as well as its start, since pieces of a split turn share a start; no number moved). Readable is stricter than the real reader loop, which can run more than one search per round. It measures what is reachable, not what a model searches.
- **Pushed:** 27a2f20. Grid branch `loop/p15-readable-grid` (78eca4f).
- **Next:** a reader run on whether models open pointers; if they don't, cap 0 replaces cap 3. The 0.004 to 0.007 gap costs only one preference question, which is a policy call.

### P24. Person index and cards: not kept

- **Sources:** [EnSIMem](https://arxiv.org/pdf/2609.27279), [A Simple Yet Strong Baseline for Long-Term Conversational Memory](https://arxiv.org/pdf/2511.17208), [Event-Centric Memory with Query-Aware Graph Augmentation](https://arxiv.org/pdf/2610.11920), docs/research/people.md.
- **Tried:** `people.ts`, an optional source. An alias table from user turns only ("my sister", "my sister Emma", "Emma, my sister"), merged only on exact matches or stated links; a name tied to two relations names nobody. A message naming a known person gets an 80-token card of dated pointers with search words, never traits or private words. No card for unknown or ambiguous names or for bare relations like "my friend". New probe set `evals/sets/person-probes/` (30 made-up names and rare relations, 22 dev and 8 held out unseen; 1,037 dev pairs).
- **Numbers:** abstention held: no card on any of 1,037 probe pairs or 1,850 tier 1/1t prompts. Only 5 of 47 answerable dev questions name a relation (rule fixed before scoring); cards fired on 2 and brought no evidence. Tier 2 FI rose on both profiles (claude 9.52 → 9.58, small-local 1.18 → 1.24) from cards on another history. Recall unchanged; tokens +2 and +5.
- **Why not kept:** a small regression with no gain. LongMemEval has too few person questions to test what P24 is for (fewer tool calls on person prompts). Branch `loop/p24-person-index` (ca843ac).
- **Next:** test on real person cases in long histories (the P21 non-memory set), hold cards behind the history bar so tier 2 can't trip them, and match lowercase names.

## Run 8: 2026-11-26, 4:17 PM Arizona

Baseline is main at 49379d0 (P26 gate keys and the URL set in). Dev numbers only unless marked held-out, tuning-grade; one question is 2.1 points. FI is false inclusions per prompt, retrieved tokens in brackets. No paid runs.

**Net for the run, before → after (claude; small-local packets byte-identical):**

| | claude |
| --- | --- |
| All evidence, whole units | 80.9 → 78.7% |
| All evidence, pointers counted (readable in 3 searches) | 80.9% |
| Mean packet tokens | 4,472 → 3,949 |
| Tier 1 / 1t / 2 / 3 FI | 10.52 / 6.73 / 12.06 / 9.28 → 7.09 / 4.99 / 9.52 / 7.17 |
| Tier 1 / 1t / 2 / 3 retrieved tokens | 3,167 / 1,938 / 3,272 / 2,366 → 1,700 / 1,217 / 2,299 / 1,521 |
| Answerable precision | 10.5 → 11.4% |

### P15. Pointer tier: kept on claude, off on small-local

- **Sources:** the prefetch survey's pointer section; [Anthropic, effective context engineering](https://anthropic.com/engineering/effective-context-engineering-for-ai-agents); [ACC-RAG](https://arxiv.org/pdf/2507.22931); [AttnComp](https://arxiv.org/pdf/2509.17486).
- **Changed:** units the unit gate lets in with gate probability under `pointerGate` render as one line (date, first 8 words, the unit's 4 rarest words as a `search_history` query) instead of whole. Selection is unchanged and charged at whole cost, so a pointer can't let in a unit that wouldn't come in whole (a first version charged only the pointer and FI rose on every tier). Past `maxPointers`, medium units drop. Off without a search tool. claude: 0.004, cap 3. `eval recall` adds a "pointers as found" row; `empty-rate.ts` counts pointers as inclusions and splits whole and pointer FI and tokens. Sweep in `evals/loop/pointer-sweep.ts`.
- **Readable recall** (sweep only): every missing evidence turn has a pointer, pointers needed fit the profile's search rounds, and each pointer's query brings its unit back in the search tool's top results. All 27 answerable pointers on claude come back in the top 3.
- **small-local, not taken:** 0.05 with no cap halves tokens (1,425 → 752) at the same FI, but whole all-evidence falls 66.0 → 46.8% (63.8% readable in one search). That bets a 1.7B model runs the pointer search, so it waits for a reader run. Packets are byte-identical to main (SHA-256 over all 2,047 dev and probe packets).
- **Review (Opus 5.5):** valid, no code fixes; every claude number and the small-local hash reproduced; no label leak (pointer text reads only the unit and the history's IDF). Caveats: the whole FI cut comes from the cap; with no cap FI equals main's. In effect it raises the unit gate to 0.004 (one whole question lost) and spends 3 pointers to keep that one question readable, about +0.6 to 1.3 FI per prompt over dropping medium units outright. The gain is one question in 47, inside the interval. Settings are in-sample on dev. "Readable" means a pointer could be opened; no reader run shows a model opens it. Precision counts an evidence pointer as an evidence unit, which is generous.
- **Pushed:** 8ced698, results 984b0b6.
- **Next:** a reader run on whether pointers get opened (the small-local question hangs on it), readable recall inside `eval recall`, better pointer queries (rare words read as noise).

### P12. URL reading, retried on the real-page set: not kept

- **Sources:** run 1's P12 entry (Squiggle's body, article and landmark approach); the P21 set above.
- **Tried:** `urlpage.ts` with `readPage` (the `<main>` or `role=main` landmark when it holds 20% of the text, else a lone `<article>`, else the body; drops nav, aside, top-level header and footer, hidden nodes and link-only lists; nothing by class name; flags HTTP 400+, near-empty and JavaScript-only pages as failures) and `pickRange` (BM25 over heading sections with the title and heading path as prefix, a 16-line window that must hold the section's rarest query word, an abstain bar at 0.35 of the message's IDF weight, then trimmed to lines with query words, 8 at least). Not wired into `buildPacket`, so memory packets are unchanged.
- **Dev (settings picked here):** hit@1 33 → 49%, IoU 0.10 → 0.14, hard subset at 3 lines 29 → 43%, abstain right 13 → 14 of 15 (every failure page abstains), wrong ranges 10 of 23 → 5 of 24, 200 → 152 tokens per non-empty. Bar 0.30 hits more (54%) with 7 wrong; 0.40 hits 38% with 4 wrong; 0.35 was picked for fewer wrong ranges.
- **Held-out, run once after freezing:** hit@1 12% for both, IoU 0.08 vs 0.06, abstain 10/11 for both, 3 wrong of 5 returned vs 5 of 7. P12 leaves 76% of answerable held-out prompts empty, and a post-freeze look at why was blocked. One held-out prompt is about 6 points.
- **Why not kept:** the dev gain didn't carry to held-out, so it fails the wiring bar. The URL set's held-out split is now spent for tuning. Known miss: two answers on the gem page sit in an `<aside>` outside `<main>`. Branch `loop/p12-url-retry` (c259066).
- **Next:** read labeled asides, a static-embedding tie-break for vocabulary gaps, more hosts and a second labeler before the next held-out look.

### Tally gate keys: not kept

- **Sources:** run 6's P26 entry; [SeCom](https://arxiv.org/abs/2502.05589); Bendersky and Croft on verbose-query reduction.
- **Tried:** (a) P26's denoising for tally pieces. P26's key only edits assistant turns and pieces are user sentences, so the closest real version drops user sentences that match the boilerplate pattern from the piece index. (b) The tally gate's segment features computed on the question minus its counting words, behind a profile flag.
- **Numbers:** (a) claude recall unchanged, tier 2 lost 2 false units, tier 3 retrieved tokens +54; small-local no change. (b) claude tier 2 +1 false unit (+128 retrieved tokens). small-local passes by one packet: tokens 1,425 → 1,422, tier 2 retrieved 309 → 308, precision 24.9 → 25.0%, no per-question flips.
- **Why not kept:** both fail on claude, and the small-local pass is one packet and costs a second segment search in the browser. Claude's 0.002 tally gate rarely binds. Branch `loop/tally-gate-keys` (0bd429d).

## Run 7: 2026-11-26, 3:17 PM Arizona

Baseline is main at 58113b9. Dev numbers only, tuning-grade. No paid runs. The pointer tier (P15) landed in run 8.

### P21. URL eval set from real pages: kept (measurement)

- **Sources:** run 1's P12 entry (why the synthetic set was circular); prefetch-evals.md URL set spec.
- **Built:** `evals/sets/url-pages/`, 18 real pages fetched as raw HTML on 2026-11-26 (nodejs.org, pkg.go.dev, pypi.org, rubygems.org, plus 4 failure pages: a 404 with site chrome, a bare NOT_FOUND, a JS-only shell, a bot-challenge page). The proxy refused Wikipedia, MDN and other docs hosts, so 9 of 18 pages are from nodejs.org. A frozen tag-stripping converter (`evals/loop/canonical-text.ts`) was committed before any page was fetched. 82 prompts: 56 answerable with gold line ranges (alternates where the page answers twice), 26 should-abstain. Split by page, stratified content vs failure, by FNV-1a (now shared in `evals/loop/split.ts`; code-pathline's split is unchanged). License texts in `NOTICE`.
- **Dev baselines (untuned):** whole page: section hit 3% (a span over 1,500 tokens gets no section hit), 0/15 abstain right, 7,225 tokens. BM25 over 15-line windows with a 0.5 bar: hit 33%, IoU 0.10, 13/15 abstain right, 200 tokens per non-empty. Hard subset (no rare word shared with the gold): 21 dev prompts at the 3-line cutoff, 14 at 5 lines.
- **Review (Opus 5.5):** valid with fixes; commit order verified, all 56 labels checked. Fixes made: alternate gold ranges for four prompts, one-entry sections for the rack version page, the token cap on section hits, a second rare-word cutoff and an exact-number flag, NOTICE, stored gold-line text, pinned held-out pages.
- **Limits:** one labeler; prompts share at least one content word with the gold in 51 of 56; held-out not run.
- **Pushed:** 1f13420. **Next:** retry P12 (landmark extraction plus section scoring) against this set.

### P20. Working set plus depth-2 tree: not kept

- **Sources:** [Agentless](https://arxiv.org/html/2407.01489v2), [LocAgent](https://arxiv.org/pdf/2503.09089).
- **Tried:** `workingset.ts` finds paths named in the message and last N turns, keeps only those in a caller-passed workspace file list, and renders a depth-2 tree under a token cap (claude 300, small-local 150). Optional input, so memory packets stay byte-identical. Eval: 60 hand-written coding chats about this repo.
- **Numbers (dev):** files named earlier 7/7, nearby files 13/13 (small-local 12/13), should-be-empty 10/10, under the cap.
- **Review 1 (Opus 5.5):** valid with fixes. The nearby-file group is a mechanics check (sibling is defined as the tree's reach; the repo has 235 files). A held-out output was read and a rule tightened afterward, which lowered held-out (claude 9/9 → 8/9, small-local 8/9 → 7/9); that split is spent. Blocking: 9 of 13 natural mentions of another project's files (style.css, cli.ts, plan.md) listed this repo's file.
- **Fix tried:** a bare name counts only when the chat also writes a whole path in this workspace. Collision chats 10/10 empty, named-earlier 7/7 → 5/7.
- **Review 2 (Opus 5.5):** the collision chats split perfectly on that rule by construction. Whole-path collisions (`docs/plan.md`, `.github/workflows/ci.yml`, `./package.json`, a root-file diff, absolute paths into another checkout) and mixed-project windows still leak, and Long Con is one endless chat across projects.
- **Why not kept:** the should-be-empty check doesn't hold on realistic collisions. Branch `loop/p20-working-set` (d16751c).
- **Next:** a current-project signal (the caller names the active workspace, or paths count only after the chat names that workspace), plus a wrong-items metric and multi-turn mixed-project chats.

## Run 6: 2026-11-26, 2:18 PM Arizona

Baseline is main at 004acd7 (end of run 5). Dev numbers only, tuning-grade; one question is 2.1 points. FI is false inclusions per prompt, retrieved tokens in brackets. No paid runs.

**Net for the run, before → after (claude; small-local changed only on tier 3):**

| | claude | small-local |
| --- | --- | --- |
| All evidence | 80.9 → 80.9% | 66.0 → 66.0% |
| Mean packet tokens | 4,499 → 4,472 | 1,425 → 1,425 |
| Tier 1 / 1t / 2 / 3 FI | 10.86 / 7.04 / 12.18 / 10.15 → 10.52 / 6.73 / 12.06 / 9.28 | 1.43 / 0.21 / 1.18 / 1.06 → 1.43 / 0.21 / 1.18 / 1.00 |
| Tier 1 / 1t / 2 / 3 retrieved tokens | 3,258 / 2,031 / 3,280 / 2,663 → 3,167 / 1,938 / 3,272 / 2,366 | 392 / 55 / 309 / 267 → 392 / 55 / 309 / 263 |
| Answerable precision | 10.3 → 10.5% | 24.8 → 24.9% |

### Tier 1t in the main scorer: kept (measurement)

- **Changed:** the 12 dev-only off-history prompts that name a time ("last Saturday", "in March"), from the P07 branch, are now a tier in `empty-rate.ts`. Tiers 1-4 unchanged.
- **Baseline:** claude 71.7% empty, FI 7.04 (2,031); small-local 96.0%, 0.21 (55).
- **Pushed:** 7c48039.

### Counting words out of tally piece ranking: kept

- **Sources:** [Bendersky and Croft, key concepts in verbose queries](https://maroo.cs.umass.edu/pub/web/getpdf.php?id=810), [Lo, He and Ounis, automatic stopword lists](https://eprints.gla.ac.uk/14094).
- **Changed:** tally piece ranking drops the counting-question grammar words ("total", "altogether", "combined", "list", "every", "different", "number", "count"), taken from the tally regex, not from dev evidence. The bar and segment search still see the whole question.
- **Numbers:** recall unchanged on both; claude 4,499 → 4,486 tokens, tier 2 12.18 → 12.10, tier 3 10.15 → 9.94; small-local tier 3 1.06 → 1.00. Weight 0.3 instead of dropping was slightly worse; a document-frequency weighting lost 1-3 claude questions.
- **Review (Opus 5.5):** valid; all numbers reproduce, no leak. Only 4 counting questions move. Most of the FI drop is "total number of siblings", whose packet now comes back empty (it had no evidence found before either; answerable-empty goes 0 → 2.1% on claude, 14.9 → 17.0% on small-local). The road-trips question got worse on claude (3 → 8 units). The 1,000-token budget row went 48.9 → 51.1%. A packet-level test was added.
- **Also learned:** the siblings question can't be won this way; "sibling" never appears in that history's user turns.
- **Pushed:** 6356f27.

### P13. Code `path:line` wired into the packet: kept

- **Changed:** `buildPacket` takes an optional symbol index and adds a short Code section: `path:line` plus signature for one definition, pointers for two or three, nothing for more. Five resolver fixes from dev misses (top-level statements only, `require` bindings aren't definitions, bare calls don't match methods, kind words must match, backticked all-caps names count). 148 new prompts about this repo and picomatch, gold from the TypeScript syntax tree.
- **Numbers:** this repo dev 50/50 signature hits, picomatch 8/8, wrong lines 0, should-be-empty 29/29. Held-out (run once after the fixes): 24/24, 4/6, 0 wrong, 19/19. Memory packets byte-identical with no code source.
- **Review (Opus 5.5):** valid with fixes; all 111 gold spans match the syntax tree. Held-out exercises only one of the five fixes, and two fixes trade recall for no wrong lines on phrasings the set never asks ("lookup() returns duplicates", "the Segment class" on an interface). Fixes made: a signature hit must match the gold's first source line, a test for backticked all-caps names, and the caveats in `code-pathline.md`. The code set's held-out is spent.
- **Pushed:** 58113b9.

### P26 on the gate only: kept (claude)

- **Sources:** [SeCom](https://arxiv.org/abs/2502.05589), [Cummins et al., query performance prediction](https://www.dcs.gla.ac.uk/~ronanc/papers/cumminsSIGIR11.pdf).
- **Changed:** on claude, a third BM25 index over boilerplate-free text, scored at the full text's length, feeds the bar, the absolute and matched-share unit-gate features and the tally gate. Ranking stays on full text. small-local stays off (at its bar it added tier-3 FI or lost a question).
- **Numbers:** claude recall held, tokens 4,486 → 4,472, FI t1 10.86 → 10.52, t1t 7.04 → 6.73, t2 12.10 → 12.06, t3 9.94 → 9.28. Shipped unit-weight AUROC 0.9496 → 0.9492, no refit.
- **Review (Opus 5.5):** valid; numbers reproduce, small-local byte-identical, no leak (the phrase list drops the same share of sentences on dev and the rest of the dataset). The gain is mostly the bar flipping whole packets to empty, both ways (tier 1: 15 closed, 5 opened); tier 2 is negligible and tier 3 is about one question net; four tier-1t probes went from empty to about 30 units. The search tool's found flag also uses the key. Dev has only 4 assistant-turn evidence turns, so recall on single-session-assistant questions is untested.
- **Pushed:** e6d89cd (re-measured on main after the merge, same numbers).

### Next ideas

P12 retry against the real-page URL set; a current-project signal for P20; P26's key on the tally piece index; the counting-word drop applied to the gate's features in tally mode; P18 date labels with tier 1t as the check; P04 rerank once a model can be downloaded here.

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
