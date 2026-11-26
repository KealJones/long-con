# Tally-mode query expansion sweep (dev slice)

`node --experimental-strip-types --no-warnings evals/loop/tally-expand.ts --weights 0,0.3,0.5,0.7,0.8,0.9,1`. w is a member's weight against the category word it stands in for (0 is off). In tally mode the pieces and the segments their gate checks are searched with the members; the absolute bar stays on the user's own words. FI is false inclusions per prompt, with mean retrieved tokens. Flips are multi-session all-evidence changes against w=0.

Shipped: claude 0 (off), small-local 0.9.

## Hand table (packages/core/src/expand.ts)

| Profile | w | All evidence | Turns | Tokens | Multi-session (tokens) | Tier 1 / 2 / 3 FI (retrieved tokens) | Precision | Flips |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| claude | 0 | 80.9% | 87.6% | 4,499 | 54.5% (1,765) | 10.86 / 12.18 / 10.15 (3,258 / 3,280 / 2,663) | 10.3% | |
| claude | 0.3 | 80.9% | 87.6% | 4,504 | 54.5% (1,788) | 10.86 / 12.18 / 10.15 | 10.3% | |
| claude | 0.5 | 80.9% | 87.6% | 4,504 | 54.5% (1,788) | 10.86 / 12.18 / 10.17 (… / 2,664) | 10.3% | |
| claude | 0.7 | 80.9% | 88.7% | 4,515 | 54.5% (1,834) | 10.86 / 12.18 / 10.26 (… / 2,672) | 10.4% | |
| claude | 0.8 | 80.9% | 88.7% | 4,522 | 54.5% (1,865) | 10.86 / 12.18 / 10.28 (… / 2,674) | 10.3% | |
| claude | 0.9 | 83.0% | 89.7% | 4,523 | 63.6% (1,866) | 10.86 / 12.18 / 10.28 (… / 2,674) | 10.4% | 8e91e7d9 + |
| claude | 1 | 83.0% | 89.7% | 4,523 | 63.6% (1,866) | 10.86 / 12.18 / 10.28 (… / 2,674) | 10.4% | 8e91e7d9 + |
| small-local | 0 | 66.0% | 72.2% | 1,425 | 36.4% (651) | 1.43 / 1.18 / 1.06 (392 / 309 / 267) | 24.8% | |
| small-local | 0.3 | 66.0% | 72.2% | 1,425 | 36.4% (649) | 1.43 / 1.18 / 1.06 | 24.8% | |
| small-local | 0.5 | 66.0% | 72.2% | 1,423 | 36.4% (641) | 1.43 / 1.18 / 1.06 | 24.9% | |
| small-local | 0.7 | 66.0% | 72.2% | 1,427 | 36.4% (655) | 1.43 / 1.18 / 1.06 | 24.7% | |
| small-local | 0.8 | 68.1% | 72.9% | 1,432 | 45.5% (679) | 1.43 / 1.18 / 1.06 | 24.8% | bf659f65 + |
| small-local | 0.9 | 68.1% | 72.9% | 1,432 | 45.5% (680) | 1.43 / 1.18 / 1.04 (… / 266) | 24.8% | bf659f65 + |
| small-local | 1 | 68.1% | 72.9% | 1,434 | 45.5% (686) | 1.43 / 1.18 / 1.04 (… / 266) | 24.7% | bf659f65 + |

Claude's added tier-3 units are mostly the evidence-ablated siblings question pulling in other turns that mention "my sister" or "my brother", plus "vacation" turns for the road-trip question. In "what is the total number of siblings", the filler words "total" and "number" carry the top pieces (word problems), so a member needs at least 0.9 of the category word's weight to clear the 0.4 share cut.

## WordNet 3.1, one hop of hyponyms, first noun sense (not shipped)

`wordnet-db@3.1.14` (MIT package, WordNet license data, 34 MB unpacked), parsed offline into a lemma to one-hop-hyponym table (11,258 nouns). One hop misses the useful members ("sibling" gives twin, triplet...; "pet" gives nothing), and it expands every noun in the query ("attend", "watch", "list").

| Profile | w | All evidence | Tokens | Multi-session | Tier 1 / 2 / 3 FI | Precision |
| --- | --- | --- | --- | --- | --- | --- |
| claude | 0.5 | 80.9% | 4,504 | 54.5% | 10.86 / 12.20 / 10.26 | 10.3% |
| claude | 1 | 80.9% | 4,541 | 54.5% | 10.86 / 13.06 / 10.96 | 10.0% |
| small-local | 0.5 | 66.0% | 1,428 | 36.4% | 1.43 / 1.22 / 1.11 | 24.3% |
| small-local | 1 | 66.0% | 1,460 | 36.4% | 1.43 / 1.30 / 1.17 | 22.9% |
