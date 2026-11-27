# Packet recall: LongMemEval_S dev slice

47 answerable questions of the 50-question dev slice (3 abstention questions have no evidence to find). Full history averages 139,782 tokens per question. Builder: BM25 search, size-based segments, and a static-embedder veto on the units the gate keeps (embedModel in each profile). No model calls. "All evidence in packet" means every labeled evidence turn is in it.

These are tuning numbers, not results: the segment cap and the cutoff were picked on this same slice, so they flatter the builder. With 47 questions, one question moves "All evidence in packet" by 2.1%. Intervals are 95% bootstraps over questions. Two limits: an evidence chat with no labeled turn isn't counted, and recall leaves out what a reader would find by searching.

## Each profile at its own settings

| Profile | Budget ceiling | Evidence chats found | Evidence turns found | All evidence in packet | 95% interval | Mean packet tokens | Largest packet |
| --- | --- | --- | --- | --- | --- | --- | --- |
| claude | 8,000 | 92.1% | 86.5% | 78.7% | 66.0% to 89.4% | 3,567 | 7,972 |
| claude: pointers as found | | | 87.6% | 80.9% | | | |
| claude: readable (pointers open in 3 searches) | | | | 80.9% | | | |
| claude: plain BM25 top-k | 8,000 | 93.0% | 85.1% | 76.6% | 63.8% to 87.2% | 7,886 | 8,000 |
| small-local | 2,500 | 77.8% | 72.2% | 66.0% | 53.2% to 78.7% | 1,351 | 2,497 |
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
| claude | 200,000 | 3,530 | 8,145 | 4,355 | 9,006 | 50 of 50 |
| small-local | 6,000 | 1,447 | 2,654 | 1,741 | 3,075 | 50 of 50 |

## Recall against packet size

![Recall against packet size](longmemeval-s-dev50-recall.svg)

### claude (segment cap 400, cutoff 0.3)

| Budget ceiling | Fixed: all evidence | Fixed: mean tokens | Adaptive: all evidence | Adaptive: mean tokens |
| --- | --- | --- | --- | --- |
| 1,000 | 51.1% | 862 | 51.1% | 828 |
| 1,500 | 61.7% | 1,242 | 63.8% | 1,180 |
| 2,000 | 68.1% | 1,648 | 70.2% | 1,549 |
| 2,500 | 68.1% | 2,003 | 70.2% | 1,865 |
| 3,000 | 72.3% | 2,305 | 74.5% | 2,098 |
| 4,000 | 74.5% | 2,963 | 76.6% | 2,572 |
| 6,000 | 74.5% | 4,182 | 76.6% | 3,245 |
| 8,000 | 76.6% | 5,255 | 78.7% | 3,567 |

Smallest ceiling within 2 points of its own 8K score: fixed 8,000, adaptive 8,000.

### small-local (segment cap 400, cutoff 0.3)

| Budget ceiling | Fixed: all evidence | Fixed: mean tokens | Adaptive: all evidence | Adaptive: mean tokens |
| --- | --- | --- | --- | --- |
| 1,000 | 46.8% | 706 | 46.8% | 686 |
| 1,500 | 53.2% | 970 | 55.3% | 946 |
| 2,000 | 61.7% | 1,220 | 63.8% | 1,175 |
| 2,500 | 63.8% | 1,421 | 66.0% | 1,351 |
| 3,000 | 63.8% | 1,615 | 66.0% | 1,501 |
| 4,000 | 66.0% | 1,897 | 66.0% | 1,711 |
| 6,000 | 66.0% | 2,200 | 66.0% | 1,837 |
| 8,000 | 66.0% | 2,340 | 66.0% | 1,837 |

Smallest ceiling within 2 points of its own 8K score: fixed 4,000, adaptive 2,500.

## By question type

### claude

| Type | Questions | Evidence turns found | All evidence in packet | Mean packet tokens |
| --- | --- | --- | --- | --- |
| knowledge-update | 8 | 93.8% | 87.5% | 3,538 |
| multi-session | 11 | 72.7% | 54.5% | 1,116 |
| single-session-assistant | 6 | 100.0% | 100.0% | 2,919 |
| single-session-preference | 3 | 83.3% | 66.7% | 5,761 |
| single-session-user | 6 | 100.0% | 100.0% | 3,863 |
| temporal-reasoning | 13 | 82.1% | 76.9% | 5,316 |

### small-local

| Type | Questions | Evidence turns found | All evidence in packet | Mean packet tokens |
| --- | --- | --- | --- | --- |
| knowledge-update | 8 | 87.5% | 87.5% | 1,341 |
| multi-session | 11 | 58.3% | 36.4% | 588 |
| single-session-assistant | 6 | 100.0% | 100.0% | 2,004 |
| single-session-preference | 3 | 16.7% | 0.0% | 960 |
| single-session-user | 6 | 100.0% | 100.0% | 1,851 |
| temporal-reasoning | 13 | 61.5% | 61.5% | 1,560 |
