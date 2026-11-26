# code-pathline: identifier-exact symbol lookup

Set: `evals/sets/code-pathline` (90 prompts over this repo at 2f04267: 63 exact-name, 27 harder). Scorer: `node --experimental-strip-types evals/loop/code-pathline.ts`. Free, no model calls. Block caps: claude 1500 tokens, small-local 400 (its `segmentTokens`); packet ceilings come from the profiles. 177 definitions indexed in about 160 ms.

Gold spans (`path:line-endLine`) come from the TypeScript compiler's syntax tree at the commit, not from the regex index. Every one of the 54 gold end lines matches what the index returns. Block IoU falls below 1 only because a returned block also carries the comment lines right above the definition (15 of the 54 have them), which the gold span leaves out.

## What the exact-name prompts measure

The exact-name prompts check that the spec is implemented: a name with code shape, backticks, call parens or a kind word resolves to one block, two or three pointers, or nothing. The same author wrote these labels and the resolver, so a perfect score says the code does what the design says. It does not say the source is useful on real prompts. How often real messages name a symbol exactly is still unmeasured.

| profile / split | prompts | block hit | mean block IoU | pointer only (over cap) | file recall | wrong-line | empty right | pointer sets exact | false incl./prompt | mean tokens, non-empty (n) | mean tokens, all |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| claude / dev | 40 | 100.0% (21/21) | 0.952 | 0.0% (0/21) | 100.0% (27/27) | 0.0% (0/21) | 100.0% (17/17) | 100.0% (3/3) | 0.000 | 279 (23) | 160 |
| claude / held-out | 23 | 100.0% (15/15) | 0.896 | 0.0% (0/15) | 100.0% (22/22) | 0.0% (0/15) | 100.0% (5/5) | 100.0% (3/3) | 0.000 | 287 (18) | 225 |
| small-local / dev | 40 | 85.7% (18/21) | 0.951 | 14.3% (3/21) | 100.0% (27/27) | 0.0% (0/18) | 100.0% (17/17) | 100.0% (3/3) | 0.000 | 195 (23) | 112 |
| small-local / held-out | 23 | 73.3% (11/15) | 0.858 | 26.7% (4/15) | 100.0% (22/22) | 0.0% (0/11) | 100.0% (5/5) | 100.0% (3/3) | 0.000 | 150 (18) | 118 |

## Harder prompts

Written and labeled before any run: plain-language questions about a symbol that don't name it, sloppy or misspelled names, code-shaped words that aren't definitions here (all labeled empty, since an exact-only source should abstain), and lone PascalCase words that are real symbols (labeled with their block; a miss is reported, not excused).

| profile / split | prompts | block hit | mean block IoU | pointer only (over cap) | file recall | wrong-line | empty right | pointer sets exact | false incl./prompt | mean tokens, non-empty (n) | mean tokens, all |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| claude / dev | 18 | 25.0% (1/4) | 1.000 | 0.0% (0/4) | 25.0% (1/4) | 0.0% (0/1) | 100.0% (14/14) | n/a | 0.000 | 399 (1) | 22 |
| claude / held-out | 9 | 0.0% (0/1) | n/a | 0.0% (0/1) | 0.0% (0/1) | n/a | 100.0% (8/8) | n/a | 0.000 | 0 (0) | 0 |
| small-local / dev | 18 | 25.0% (1/4) | 1.000 | 0.0% (0/4) | 25.0% (1/4) | 0.0% (0/1) | 100.0% (14/14) | n/a | 0.000 | 399 (1) | 22 |
| small-local / held-out | 9 | 0.0% (0/1) | n/a | 0.0% (0/1) | 0.0% (0/1) | n/a | 100.0% (8/8) | n/a | 0.000 | 0 (0) | 0 |

Reading it: abstention held on all 22 should-be-empty hard prompts, with no false inclusions. Lone PascalCase symbols are missed 4 of 5 times (`Session`, `Pending`, `Turn`, `Registers`); only `Bm25` hits, through the letters-then-digits rule. That miss is by design, to keep "Profile the build" empty, and a capitalized-word rule tied to the index would need its own empty prompts before it ships. The small-local block that hit (`Bm25`, 399 tokens) sits just under the 400 cap.

Other caveats: held-out has few should-be-empty exact-name prompts (5). Dev scored the same on its first run, and nothing was tuned before the held-out or harder runs.

## The packet's Code section (v2 prompts)

`buildPacket` takes an optional `code` source (a `SymbolIndex` the caller builds from its workspace). The section is short: one definition gives `path:line` plus its signature (at most 4 lines, no body), two or three give pointers, anything else gives no section. It spends the packet's own budget and sits behind no history bar. Scorer: `evals/loop/code-pathline.ts --packet`, which builds each packet with an empty history, with and without the source. Before (no source) every row is 0 hits and 100% empty, so only the after rows are shown.

148 v2 prompts: 85 coding asks over this repo at 004acd7 that name a symbol (75 one definition, 9 two or three, 3 more than three), 15 over picomatch 4.0.7 read from node_modules, and 48 should-be-empty coding prompts (17 names that don't exist here, 20 generic programming questions naming standard-library calls such as `JSON.stringify`, `add()` on a Set or `lookup()` on a dict, 11 prose). Gold spans come from the TypeScript syntax tree; two picomatch functions assigned to properties (`picomatch.makeRe`, `utils.escapeRegex`) were labeled by hand. Split by FNV-1a of the id, as before. The same author wrote these prompts and the fixes below, after reading the resolver.

| group / profile / split | prompts | signature hit | pointer only | pointer sets exact | wrong-line | empty right | mean Code tokens, non-empty (n) | mean Code tokens, all |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| this repo, names a symbol / claude / dev | 57 | 100.0% (50/50) | 0.0% (0/50) | 85.7% (6/7) | 0.0% (0/64) | 100.0% (1/1) | 72 (55) | 70 |
| this repo, names a symbol / claude / held-out | 28 | 100.0% (24/24) | 0.0% (0/24) | 100.0% (2/2) | 0.0% (0/29) | 100.0% (2/2) | 71 (26) | 66 |
| this repo, names a symbol / small-local / dev | 57 | 100.0% (50/50) | 0.0% (0/50) | 85.7% (6/7) | 0.0% (0/64) | 100.0% (1/1) | 72 (55) | 70 |
| this repo, names a symbol / small-local / held-out | 28 | 100.0% (24/24) | 0.0% (0/24) | 100.0% (2/2) | 0.0% (0/29) | 100.0% (2/2) | 71 (26) | 66 |
| picomatch, names a symbol / claude / dev | 9 | 100.0% (8/8) | 0.0% (0/8) | 100.0% (1/1) | 0.0% (0/10) | n/a | 57 (9) | 57 |
| picomatch, names a symbol / claude / held-out | 6 | 66.7% (4/6) | 0.0% (0/6) | n/a | 0.0% (0/4) | n/a | 57 (4) | 38 |
| picomatch, names a symbol / small-local / dev | 9 | 100.0% (8/8) | 0.0% (0/8) | 100.0% (1/1) | 0.0% (0/10) | n/a | 57 (9) | 57 |
| picomatch, names a symbol / small-local / held-out | 6 | 66.7% (4/6) | 0.0% (0/6) | n/a | 0.0% (0/4) | n/a | 57 (4) | 38 |
| should-be-empty coding prompts / claude / dev | 29 | n/a | n/a | n/a | n/a | 100.0% (29/29) | 0 (0) | 0 |
| should-be-empty coding prompts / claude / held-out | 19 | n/a | n/a | n/a | n/a | 100.0% (19/19) | 0 (0) | 0 |
| should-be-empty coding prompts / small-local / dev | 29 | n/a | n/a | n/a | n/a | 100.0% (29/29) | 0 (0) | 0 |
| should-be-empty coding prompts / small-local / held-out | 19 | n/a | n/a | n/a | n/a | 100.0% (19/19) | 0 (0) | 0 |

The first dev run, with the resolver as it was, scored 92.0% signature hits, an 11.1% wrong-line rate (8 of 72 named lines) and 89.7% empty on should-be-empty (3 of 29 got code). Five fixes, each from a dev miss: only top-level statements define (code inside the symbols test's template string had been indexed as a second `buildPacket`, `Profile`, `Bm25.search` and `HISTORY_NOTICE`); `const x = require(...)` is a binding, not a definition; a word let in only by call parens can't name a method (`add()`, `search()`, `lookup()` in generic questions), which also turns the `add()` pointer prompt into an empty miss; a kind word must fit ("question type" no longer points at `question()` helpers); and a backticked SHOUTED name isn't dropped as an English word (`DATA`). Held-out was run once, after the fixes. The v1 tables above are unchanged by them. The two picomatch held-out misses are the property-assigned functions, which a regex over declarations doesn't see: empty, not wrong.
