# Packet recall: LongMemEval_S dev slice

47 answerable questions of the 50-question dev slice (3 abstention questions have no evidence to find). Full history averages 139,782 tokens per question. Builder: BM25 only (no embeddings yet), size-based segments. No model calls. "All evidence in packet" means every labeled evidence turn is in it.

These are tuning numbers, not results: the segment cap and the cutoff were picked on this same slice, so they flatter the builder. With 47 questions, one question moves "All evidence in packet" by 2.1%. Intervals are 95% bootstraps over questions. Two limits: an evidence chat with no labeled turn isn't counted, and recall leaves out what a reader would find by searching.

## Each profile at its own settings

| Profile | Budget ceiling | Evidence chats found | Evidence turns found | All evidence in packet | 95% interval | Mean packet tokens | Largest packet |
| --- | --- | --- | --- | --- | --- | --- | --- |
| claude | 8,000 | 92.8% | 87.2% | 78.7% | 66.0% to 89.4% | 3,974 | 7,978 |
| claude: pointers as found | | | 88.3% | 80.9% | | | |
| claude: readable (pointers open in 3 searches) | | | | 80.9% | | | |
| claude: plain BM25 top-k | 8,000 | 93.7% | 86.5% | 78.7% | 66.0% to 89.4% | 7,884 | 8,000 |
| small-local | 2,500 | 77.8% | 72.2% | 66.0% | 53.2% to 78.7% | 1,425 | 2,497 |
| small-local: plain BM25 top-k | 2,500 | 85.9% | 72.5% | 59.6% | 44.7% to 72.3% | 2,476 | 2,499 |

Packet against plain BM25 top-k on the same questions:

| Profile | All-evidence difference | 95% interval | Questions only the packet gets whole | Questions only BM25 gets whole |
| --- | --- | --- | --- | --- |
| claude | +0.0 | -6.4 to +6.4 | 1 | 1 |
| small-local | +6.4 | -6.4 to +19.1 | 7 | 4 |

Plain BM25 top-k is the baseline: the same units ranked by BM25 over all words and filled to the same ceiling, with nothing else. It also shows what ranking by the user's words adds, which suits LongMemEval, where 95% of the dev slice's evidence turns are user turns, and may not carry over to real chats.

## What the reader takes in per question

System prompt, search tool definition, packet and question; then the same plus one search result. Room for the answer is kept out of the window.

| Profile | Context window | First call, mean | First call, largest | With one search, mean | With one search, largest | Fits with room to answer |
| --- | --- | --- | --- | --- | --- | --- |
| claude | 200,000 | 3,936 | 8,148 | 4,772 | 9,059 | 50 of 50 |
| small-local | 6,000 | 1,517 | 2,655 | 1,811 | 3,120 | 50 of 50 |

## Recall against packet size

![Recall against packet size](longmemeval-s-dev50-recall.svg)

### claude (segment cap 400, cutoff 0.3)

| Budget ceiling | Fixed: all evidence | Fixed: mean tokens | Adaptive: all evidence | Adaptive: mean tokens |
| --- | --- | --- | --- | --- |
| 1,000 | 51.1% | 872 | 51.1% | 844 |
| 1,500 | 61.7% | 1,269 | 63.8% | 1,205 |
| 2,000 | 68.1% | 1,667 | 70.2% | 1,574 |
| 2,500 | 68.1% | 2,043 | 70.2% | 1,896 |
| 3,000 | 72.3% | 2,392 | 74.5% | 2,177 |
| 4,000 | 74.5% | 3,057 | 76.6% | 2,660 |
| 6,000 | 74.5% | 4,230 | 76.6% | 3,423 |
| 8,000 | 76.6% | 5,459 | 78.7% | 3,974 |

Smallest ceiling within 2 points of its own 8K score: fixed 8,000, adaptive 8,000.

### small-local (segment cap 400, cutoff 0.3)

| Budget ceiling | Fixed: all evidence | Fixed: mean tokens | Adaptive: all evidence | Adaptive: mean tokens |
| --- | --- | --- | --- | --- |
| 1,000 | 46.8% | 719 | 46.8% | 699 |
| 1,500 | 53.2% | 1,014 | 55.3% | 980 |
| 2,000 | 57.4% | 1,270 | 59.6% | 1,219 |
| 2,500 | 63.8% | 1,500 | 66.0% | 1,425 |
| 3,000 | 63.8% | 1,731 | 66.0% | 1,614 |
| 4,000 | 63.8% | 2,117 | 66.0% | 1,890 |
| 6,000 | 66.0% | 2,606 | 66.0% | 2,140 |
| 8,000 | 66.0% | 2,872 | 66.0% | 2,191 |

Smallest ceiling within 2 points of its own 8K score: fixed 6,000, adaptive 2,500.

## By question type

### claude

| Type | Questions | Evidence turns found | All evidence in packet | Mean packet tokens |
| --- | --- | --- | --- | --- |
| knowledge-update | 8 | 93.8% | 87.5% | 3,490 |
| multi-session | 11 | 75.8% | 54.5% | 1,389 |
| single-session-assistant | 6 | 100.0% | 100.0% | 3,079 |
| single-session-preference | 3 | 83.3% | 66.7% | 5,853 |
| single-session-user | 6 | 100.0% | 100.0% | 4,545 |
| temporal-reasoning | 13 | 82.1% | 76.9% | 6,176 |

### small-local

| Type | Questions | Evidence turns found | All evidence in packet | Mean packet tokens |
| --- | --- | --- | --- | --- |
| knowledge-update | 8 | 87.5% | 87.5% | 1,367 |
| multi-session | 11 | 58.3% | 36.4% | 644 |
| single-session-assistant | 6 | 100.0% | 100.0% | 2,129 |
| single-session-preference | 3 | 16.7% | 0.0% | 960 |
| single-session-user | 6 | 100.0% | 100.0% | 1,991 |
| temporal-reasoning | 13 | 61.5% | 61.5% | 1,643 |
