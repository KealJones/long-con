# Iteration log

One entry per idea tried by the hourly packet R&D loop. Newest run first. Numbers are dev unless marked held-out. Backlog: [prefetch-ideas-ranked.md](prefetch-ideas-ranked.md).

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
