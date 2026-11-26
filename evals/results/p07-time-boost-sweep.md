# P07 time-range boost sweep (LongMemEval_S dev slice, 50 questions)

Questions naming a time: 3 of 47 answerable. Tier 1t: 12 prompts on each dev history.

## claude

| Boost | All-evidence | Turns | Mean tokens | Temporal all-evidence | t1t empty | t1t FI (retr tok) | t2 empty | t2 FI (retr tok) | t3 empty | t3 FI (retr tok) | Precision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| off (main) | 80.9% | 87.6% | 4499 | 76.9% | 71.7% | 7.04 (2031) | 44.0% | 12.18 (3280) | 51.1% | 10.15 (2663) | 10.3% |
| stripping only, no boost | 80.9% | 87.6% | 4333 | 76.9% | 58.8% | 8.00 (2396) | 46.0% | 11.60 (3119) | 53.2% | 9.79 (2567) | 10.4% |
| 0.25, stripped | 80.9% | 87.6% | 4336 | 76.9% | 58.8% | 8.03 (2400) | 46.0% | 11.60 (3119) | 53.2% | 9.79 (2570) | 10.4% |
| 0.5, stripped | 80.9% | 87.6% | 4335 | 76.9% | 58.8% | 8.04 (2402) | 46.0% | 11.60 (3119) | 53.2% | 9.79 (2570) | 10.4% |
| 0.75, stripped | 80.9% | 87.6% | 4337 | 76.9% | 58.8% | 8.05 (2407) | 46.0% | 11.60 (3119) | 53.2% | 9.79 (2570) | 10.4% |
| 1, stripped | 80.9% | 87.6% | 4337 | 76.9% | 58.8% | 8.05 (2407) | 46.0% | 11.60 (3119) | 53.2% | 9.79 (2569) | 10.4% |
| 2, stripped | 80.9% | 87.6% | 4337 | 76.9% | 58.8% | 8.06 (2407) | 46.0% | 11.60 (3119) | 53.2% | 9.79 (2569) | 10.4% |
| 1, words kept | 80.9% | 87.6% | 4500 | 76.9% | 71.7% | 7.21 (2062) | 44.0% | 12.24 (3282) | 51.1% | 10.23 (2690) | 10.3% |
| 2, words kept | 80.9% | 87.6% | 4500 | 76.9% | 71.7% | 7.21 (2063) | 44.0% | 12.24 (3282) | 51.1% | 10.23 (2690) | 10.3% |

## small-local

| Boost | All-evidence | Turns | Mean tokens | Temporal all-evidence | t1t empty | t1t FI (retr tok) | t2 empty | t2 FI (retr tok) | t3 empty | t3 FI (retr tok) | Precision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| off (main) | 63.8% | 72.5% | 1511 | 61.5% | 88.0% | 0.61 (153) | 58.0% | 1.86 (475) | 68.1% | 1.17 (274) | 23.6% |
| stripping only, no boost | 63.8% | 71.8% | 1494 | 61.5% | 78.2% | 0.60 (172) | 60.0% | 1.58 (409) | 68.1% | 1.15 (266) | 23.3% |
| 0.25, stripped | 63.8% | 71.8% | 1494 | 61.5% | 78.2% | 0.60 (172) | 60.0% | 1.58 (409) | 68.1% | 1.15 (266) | 23.3% |
| 0.5, stripped | 63.8% | 71.8% | 1494 | 61.5% | 78.2% | 0.60 (172) | 60.0% | 1.58 (409) | 68.1% | 1.15 (266) | 23.3% |
| 0.75, stripped | 63.8% | 71.8% | 1494 | 61.5% | 78.2% | 0.60 (172) | 60.0% | 1.58 (409) | 68.1% | 1.15 (266) | 23.3% |
| 1, stripped | 63.8% | 71.8% | 1494 | 61.5% | 78.2% | 0.60 (172) | 60.0% | 1.58 (409) | 68.1% | 1.15 (266) | 23.3% |
| 2, stripped | 63.8% | 71.8% | 1494 | 61.5% | 78.2% | 0.60 (172) | 60.0% | 1.58 (409) | 68.1% | 1.15 (266) | 23.3% |
| 1, words kept | 63.8% | 72.5% | 1512 | 61.5% | 88.0% | 0.61 (153) | 58.0% | 1.86 (475) | 68.1% | 1.17 (276) | 23.4% |
| 2, words kept | 63.8% | 72.5% | 1512 | 61.5% | 88.0% | 0.61 (153) | 58.0% | 1.86 (475) | 68.1% | 1.17 (275) | 23.4% |

FI is false inclusions per prompt; retr tok is mean retrieved tokens. Stripped: the time phrase leaves the keyword query (shipped). Words kept and stripping only: control arms. The boost lifts confidence and rank only; the absolute bar and the unit gate see unboosted scores. Rows from the earlier boost, which also lifted those, are in this file at commit a19371c.
