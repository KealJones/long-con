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
