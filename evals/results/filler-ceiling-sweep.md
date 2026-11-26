# Filler words out of the absolute bar: dev sweep

The absolute bar (packet.ts) asks whether the best unit's BM25 score reaches `minScore` of the most any unit could
score on the query. A query word that matches nothing ("year" in "how many concerts have I been to this year?") still
counts in that ceiling, so short counting and "how long ago" questions came back empty on small-local (7 of 47
answerable dev packets). Dev slice only, 47 answerable questions (one question = 2.1 points). Cells under each tier are
empty rate / false inclusions per prompt / mean retrieved tokens. Tier 1t is 12 off-history prompts that name a time
("last Saturday", "two weeks ago"), run on all 50 histories (borrowed from the P07 branch).

Variants of `barCeiling` (all still search and rank on every word; only the bar changes):

- **all**: today's bar.
- **filler, ceiling only**: a fixed list of time and filler words (year, week, ago, ever, recently, last, past, total...)
  left out of the ceiling, their matches still counted in the score. Dropped: time words then carry units over the bar.
- **filler** (kept in code): the same words left out of score and ceiling alike.
- **unseen**: words no unit in this history holds left out (score unchanged, since they match nothing).

## small-local (Porter)

| Setting | All evidence | Turns | Tokens | Empty answerable | Tier 1 | Tier 1t | Tier 2 | Tier 3 | Precision |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | ---: |
| all 0.25 (main) | 66.0 | 72.2 | 1,425 | 7 | 73.6 / 1.43 / 392 | 96.0 / 0.21 / 55 | 72.0 / 1.18 / 309 | 76.6 / 1.06 / 267 | 24.8 |
| all 0.26 | 66.0 | 71.1 | 1,370 | 9 | 75.8 / 1.37 / 376 | 96.8 / 0.17 / 44 | 76.0 / 1.10 / 300 | 76.6 / 1.06 / 267 | 25.2 |
| all 0.27 | 63.8 | 69.0 | 1,321 | 10 | 77.4 / 1.33 / 362 | 97.5 / 0.14 / 35 | 80.0 / 1.00 / 263 | 78.7 / 1.02 / 254 | 25.9 |
| filler, ceiling only 0.25 | 68.1 | 75.4 | 1,514 | 3 | 77.6 / 1.06 / 298 | 84.0 / 0.75 / 190 | 56.0 / 1.92 / 485 | 70.2 / 1.21 / 302 | 23.8 |
| filler, ceiling only 0.28 | 63.8 | 70.0 | 1,310 | 8 | 82.6 / 0.94 / 261 | 90.3 / 0.47 / 120 | 68.0 / 1.36 / 337 | 74.5 / 1.00 / 247 | 26.2 |
| filler, ceiling only 0.30 | 63.8 | 70.0 | 1,295 | 9 | 85.6 / 0.85 / 235 | 93.2 / 0.35 / 89 | 72.0 / 1.28 / 320 | 74.5 / 1.00 / 247 | 26.4 |
| filler, ceiling only 0.32 | 61.7 | 67.9 | 1,259 | 10 | 86.9 / 0.81 / 223 | 94.8 / 0.26 / 67 | 78.0 / 1.18 / 310 | 80.9 / 0.83 / 202 | 26.4 |
| filler, ceiling only 0.35 | 57.4 | 61.2 | 1,133 | 14 | 88.8 / 0.76 / 206 | 97.2 / 0.17 / 41 | 88.0 / 0.66 / 168 | 83.0 / 0.68 / 160 | 26.6 |
| filler, ceiling only 0.40 | 48.9 | 51.2 | 938 | 19 | 90.6 / 0.70 / 187 | 98.8 / 0.08 / 19 | 94.0 / 0.40 / 98 | 83.0 / 0.68 / 160 | 26.8 |
| filler 0.25 | 68.1 | 75.4 | 1,464 | 4 | 77.6 / 1.06 / 298 | 94.8 / 0.24 / 64 | 60.0 / 1.68 / 439 | 72.3 / 1.15 / 286 | 24.7 |
| filler 0.26 | 68.1 | 74.3 | 1,408 | 6 | 79.8 / 1.00 / 282 | 95.7 / 0.22 / 57 | 68.0 / 1.40 / 371 | 76.6 / 1.06 / 267 | 25.1 |
| **filler 0.27 (branch)** | 66.0 | 72.2 | 1,359 | 7 | 81.4 / 0.97 / 270 | 96.7 / 0.18 / 46 | 74.0 / 1.20 / 326 | 76.6 / 1.06 / 267 | 25.7 |
| filler 0.28 | 63.8 | 70.0 | 1,295 | 9 | 82.6 / 0.94 / 261 | 97.2 / 0.16 / 41 | 78.0 / 1.10 / 306 | 80.9 / 0.74 / 166 | 26.4 |
| filler 0.29 | 63.8 | 70.0 | 1,295 | 9 | 84.2 / 0.89 / 246 | 97.5 / 0.15 / 38 | 80.0 / 1.06 / 291 | 80.9 / 0.74 / 166 | 26.4 |
| filler 0.31 | 61.7 | 67.9 | 1,259 | 10 | 86.2 / 0.83 / 230 | 97.7 / 0.14 / 35 | 84.0 / 0.82 / 238 | 85.1 / 0.62 / 127 | 26.4 |
| unseen 0.25 | 66.0 | 72.2 | 1,441 | 6 | 35.5 / 2.13 / 591 | 73.5 / 1.17 / 292 | 42.0 / 2.52 / 665 | 51.1 / 1.64 / 403 | 24.6 |

Which empty answerable packets fill (filler at 0.25 and 0.27 alike): "how many days ago did I attend a networking event"
(evidence, now complete), "total number of days in Japan and Chicago" (1 evidence unit of 5, still incomplete) and
"who did I go with to the music event last Saturday" (2 units, no evidence: a wrong fill). At 0.27 the higher bar also
empties three packets main fills: the Bandung restaurant question (complete on main), and two preference questions
(1 and 0 evidence units). Net all-evidence is unchanged; it is a swap, not a pure fill.

## claude (suffix stripper)

| Setting | All evidence | Turns | Tokens | Tier 1 | Tier 1t | Tier 2 | Tier 3 | Precision |
| --- | ---: | ---: | ---: | --- | --- | --- | --- | ---: |
| all 0.17 (main) | 80.9 | 87.6 | 4,499 | 45.3 / 10.86 / 3,258 | 71.7 / 7.04 / 2,031 | 44.0 / 12.18 / 3,280 | 51.1 / 10.15 / 2,663 | 10.3 |
| filler, ceiling only 0.17 | 80.9 | 87.6 | 4,499 | 49.3 / 9.87 / 2,963 | 48.2 / 13.11 / 3,786 | 36.0 / 13.20 / 3,504 | 42.6 / 11.70 / 3,005 | 10.3 |
| filler, ceiling only 0.19 | 78.7 | 85.5 | 4,333 | 58.9 / 8.14 / 2,439 | 61.2 / 9.76 / 2,822 | 46.0 / 10.80 / 2,846 | 51.1 / 9.87 / 2,611 | 10.3 |
| filler, ceiling only 0.21 | 76.6 | 83.3 | 4,166 | 67.8 / 6.69 / 1,994 | 71.5 / 7.07 / 2,049 | 54.0 / 9.76 / 2,585 | 59.6 / 7.91 / 2,075 | 10.5 |
| filler, ceiling only 0.23 | 74.5 | 80.1 | 3,881 | 75.3 / 5.36 / 1,585 | 80.3 / 4.82 / 1,398 | 62.0 / 7.52 / 1,976 | 63.8 / 7.06 / 1,893 | 10.9 |
| filler 0.17 | 78.7 | 85.5 | 4,332 | 49.4 / 9.85 / 2,957 | 68.3 / 7.82 / 2,282 | 40.0 / 12.08 / 3,193 | 46.8 / 10.79 / 2,828 | 10.3 |
| filler 0.19 | 74.5 | 81.2 | 3,998 | 58.9 / 8.14 / 2,439 | 80.0 / 4.82 / 1,412 | 48.0 / 10.26 / 2,691 | 55.3 / 8.72 / 2,306 | 10.5 |
| unseen 0.17 | 80.9 | 87.6 | 4,499 | 13.2 / 15.01 / 4,511 | 28.0 / 17.84 / 5,103 | 16.0 / 16.72 / 4,432 | 21.3 / 15.47 / 3,931 | 10.3 |

On claude, filler loses "the order of the three trips I took in the past three months": with "past" and "months" out,
"order three trip took earliest latest" no longer clears the bar, yet those time words are in the evidence. Claude keeps "all".
