# Packet recall: LongMemEval_S dev slice

47 answerable questions of the 50-question dev slice (3 abstention questions have no evidence to find). Full history averages 139,782 tokens per question. Builder: BM25 search, size-based segments, and a static-embedder veto on the units the gate keeps (embedModel in each profile). No model calls. "All evidence in packet" means every labeled evidence turn is in it.

These are tuning numbers, not results: the segment cap and the cutoff were picked on this same slice, so they flatter the builder. With 47 questions, one question moves "All evidence in packet" by 2.1%. Intervals are 95% bootstraps over questions. Two limits: an evidence chat with no labeled turn isn't counted, and recall leaves out what a reader would find by searching.

## Each profile at its own settings

| Profile | Budget ceiling | Evidence chats found | Evidence turns found | All evidence in packet | 95% interval | Mean packet tokens | Largest packet |
| --- | --- | --- | --- | --- | --- | --- | --- |
| claude | 8,000 | 92.1% | 86.5% | 78.7% | 66.0% to 89.4% | 3,578 | 7,982 |
| claude: pointers as found | | | 87.6% | 80.9% | | | |
| claude: readable (pointers open in 3 searches) | | | | 80.9% | | | |
| claude: plain BM25 top-k | 8,000 | 93.0% | 85.1% | 76.6% | 63.8% to 87.2% | 7,886 | 8,000 |
| small-local | 2,500 | 77.8% | 72.2% | 66.0% | 53.2% to 78.7% | 1,348 | 2,481 |
| small-local: plain BM25 top-k | 2,500 | 85.9% | 72.5% | 59.6% | 44.7% to 72.3% | 2,476 | 2,499 |

Packet against plain BM25 top-k on the same questions:

| Profile | All-evidence difference | 95% interval | Questions only the packet gets whole | Questions only BM25 gets whole |
| --- | --- | --- | --- | --- |
| claude | +2.1 | +0.0 to +6.4 | 1 | 0 |
| small-local | +6.4 | -6.4 to +19.1 | 7 | 4 |

Plain BM25 top-k is the baseline: the same units ranked by BM25 over all words and filled to the same ceiling, with nothing else. It also shows what ranking by the user's words adds, which suits LongMemEval, where 95% of the dev slice's evidence turns are user turns, and may not carry over to real chats.

## What the reader takes in per question

System prompt, search tool definition, packet and question; then the same plus one search result. Room for the answer is kept out of the window.

| Profile | Context window | First call, mean | First call, largest | With one search, mean | With one search, largest | Fits with room to answer |
| --- | --- | --- | --- | --- | --- | --- |
| claude | 200,000 | 3,543 | 8,145 | 4,376 | 9,057 | 50 of 50 |
| small-local | 6,000 | 1,446 | 2,650 | 1,743 | 3,096 | 50 of 50 |

## Recall against packet size

![Recall against packet size](longmemeval-s-dev50-recall.svg)

### claude (segment cap 400, cutoff 0.3)

| Budget ceiling | Fixed: all evidence | Fixed: mean tokens | Adaptive: all evidence | Adaptive: mean tokens |
| --- | --- | --- | --- | --- |
| 1,000 | 51.1% | 861 | 51.1% | 818 |
| 1,500 | 63.8% | 1,252 | 66.0% | 1,191 |
| 2,000 | 68.1% | 1,632 | 70.2% | 1,543 |
| 2,500 | 68.1% | 1,989 | 70.2% | 1,848 |
| 3,000 | 72.3% | 2,305 | 74.5% | 2,099 |
| 4,000 | 74.5% | 2,939 | 76.6% | 2,577 |
| 6,000 | 74.5% | 4,177 | 76.6% | 3,247 |
| 8,000 | 76.6% | 5,257 | 78.7% | 3,578 |

Smallest ceiling within 2 points of its own 8K score: fixed 8,000, adaptive 8,000.

### small-local (segment cap 400, cutoff 0.3)

| Budget ceiling | Fixed: all evidence | Fixed: mean tokens | Adaptive: all evidence | Adaptive: mean tokens |
| --- | --- | --- | --- | --- |
| 1,000 | 46.8% | 689 | 46.8% | 669 |
| 1,500 | 55.3% | 974 | 57.4% | 953 |
| 2,000 | 61.7% | 1,208 | 63.8% | 1,166 |
| 2,500 | 63.8% | 1,413 | 66.0% | 1,348 |
| 3,000 | 63.8% | 1,605 | 66.0% | 1,493 |
| 4,000 | 66.0% | 1,895 | 66.0% | 1,711 |
| 6,000 | 66.0% | 2,207 | 66.0% | 1,839 |
| 8,000 | 66.0% | 2,348 | 66.0% | 1,839 |

Smallest ceiling within 2 points of its own 8K score: fixed 4,000, adaptive 2,500.

## By question type

### claude

| Type | Questions | Evidence turns found | All evidence in packet | Mean packet tokens |
| --- | --- | --- | --- | --- |
| knowledge-update | 8 | 93.8% | 87.5% | 3,534 |
| multi-session | 11 | 72.7% | 54.5% | 1,115 |
| single-session-assistant | 6 | 100.0% | 100.0% | 2,920 |
| single-session-preference | 3 | 83.3% | 66.7% | 5,743 |
| single-session-user | 6 | 100.0% | 100.0% | 3,889 |
| temporal-reasoning | 13 | 82.1% | 76.9% | 5,351 |

### small-local

| Type | Questions | Evidence turns found | All evidence in packet | Mean packet tokens |
| --- | --- | --- | --- | --- |
| knowledge-update | 8 | 87.5% | 87.5% | 1,330 |
| multi-session | 11 | 58.3% | 36.4% | 592 |
| single-session-assistant | 6 | 100.0% | 100.0% | 1,992 |
| single-session-preference | 3 | 16.7% | 0.0% | 977 |
| single-session-user | 6 | 100.0% | 100.0% | 1,843 |
| temporal-reasoning | 13 | 61.5% | 61.5% | 1,558 |
