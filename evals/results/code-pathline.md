# code-pathline: identifier-exact symbol lookup

Set: `evals/sets/code-pathline` (63 prompts over this repo at 2f04267). Scorer: `node --experimental-strip-types evals/loop/code-pathline.ts`. Free, no model calls. Block caps: claude 1500 tokens, small-local 400 (its `segmentTokens`); packet ceilings come from the profiles.

177 definitions indexed in about 150 ms.

| profile / split | prompts | block hit | pointer only (over cap) | wrong-line | empty right | pointer sets exact | false incl./prompt | mean tokens | mean tokens (non-empty) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| claude / dev | 40 | 100.0% (21/21) | 0.0% (0/21) | 0.0% (0/21) | 100.0% (17/17) | 100.0% (3/3) | 0.000 | 160 | 279 |
| claude / held-out | 23 | 100.0% (15/15) | 0.0% (0/15) | 0.0% (0/15) | 100.0% (5/5) | 100.0% (3/3) | 0.000 | 225 | 287 |
| small-local / dev | 40 | 85.7% (18/21) | 14.3% (3/21) | 0.0% (0/18) | 100.0% (17/17) | 100.0% (3/3) | 0.000 | 112 | 195 |
| small-local / held-out | 23 | 73.3% (11/15) | 26.7% (4/15) | 0.0% (0/11) | 100.0% (5/5) | 100.0% (3/3) | 0.000 | 118 | 150 |

Caveats: the same author wrote the labels and the resolver, so the set mostly tests the cases the design aims at. Dev scored this on the first run and nothing was tuned before the held-out run. Held-out has only 5 should-be-empty prompts. There are no descriptive or sloppy prompts ("where does the packet drop weak matches"): those need search, not an exact symbol match, and correctly get nothing here.
