# Packet recall: LongMemEval_S dev slice

47 answerable questions of the 50-question dev slice (3 abstention questions have no evidence to find). Full history averages 139,782 tokens per question. Builder: BM25 only (no embeddings yet), size-based segments. No model calls. "All evidence in packet" means every labeled evidence turn is in it.

These are tuning numbers, not results: the segment cap and the cutoff were picked on this same slice, so they flatter the builder. With 47 questions, one question moves "All evidence in packet" by 2.1%. Intervals are 95% bootstraps over questions. Two limits: an evidence chat with no labeled turn isn't counted, and recall leaves out what a reader would find by searching.

## Each profile at its own settings

| Profile | Budget ceiling | Evidence chats found | Evidence turns found | All evidence in packet | 95% interval | Mean packet tokens | Largest packet |
| --- | --- | --- | --- | --- | --- | --- | --- |
| claude | 8,000 | 93.5% | 87.6% | 80.9% | 70.2% to 91.5% | 4,499 | 7,986 |
| claude: plain BM25 top-k | 8,000 | 93.0% | 85.1% | 76.6% | 63.8% to 87.2% | 7,886 | 8,000 |
| small-local | 2,500 | 79.7% | 72.5% | 63.8% | 51.1% to 76.6% | 1,511 | 2,482 |
| small-local: plain BM25 top-k | 2,500 | 87.1% | 69.7% | 57.4% | 42.6% to 72.3% | 2,474 | 2,499 |

Packet against plain BM25 top-k on the same questions:

| Profile | All-evidence difference | 95% interval | Questions only the packet gets whole | Questions only BM25 gets whole |
| --- | --- | --- | --- | --- |
| claude | +4.3 | +0.0 to +10.6 | 2 | 0 |
| small-local | +6.4 | -4.3 to +17.0 | 5 | 2 |

Plain BM25 top-k is the baseline: the same units ranked by BM25 over all words and filled to the same ceiling, with nothing else. It also shows what ranking by the user's words adds, which suits LongMemEval, where 95% of the dev slice's evidence turns are user turns, and may not carry over to real chats.

## What the reader takes in per question

System prompt, search tool definition, packet and question; then the same plus one search result. Room for the answer is kept out of the window.

| Profile | Context window | First call, mean | First call, largest | With one search, mean | With one search, largest | Fits with room to answer |
| --- | --- | --- | --- | --- | --- | --- |
| claude | 200,000 | 4,472 | 8,148 | 5,297 | 9,059 | 50 of 50 |
| small-local | 6,000 | 1,611 | 2,650 | 1,889 | 3,074 | 50 of 50 |

## Recall against packet size

![Recall against packet size](longmemeval-s-dev50-recall.svg)

### claude (segment cap 400, cutoff 0.3)

| Budget ceiling | Fixed: all evidence | Fixed: mean tokens | Adaptive: all evidence | Adaptive: mean tokens |
| --- | --- | --- | --- | --- |
| 1,000 | 48.9% | 887 | 48.9% | 859 |
| 1,500 | 61.7% | 1,309 | 63.8% | 1,244 |
| 2,000 | 68.1% | 1,727 | 70.2% | 1,630 |
| 2,500 | 68.1% | 2,114 | 70.2% | 1,962 |
| 3,000 | 72.3% | 2,489 | 74.5% | 2,265 |
| 4,000 | 74.5% | 3,257 | 76.6% | 2,826 |
| 6,000 | 74.5% | 4,773 | 78.7% | 3,807 |
| 8,000 | 76.6% | 6,215 | 80.9% | 4,499 |

Smallest ceiling within 2 points of its own 8K score: fixed 8,000, adaptive 8,000.

### small-local (segment cap 400, cutoff 0.3)

| Budget ceiling | Fixed: all evidence | Fixed: mean tokens | Adaptive: all evidence | Adaptive: mean tokens |
| --- | --- | --- | --- | --- |
| 1,000 | 46.8% | 755 | 46.8% | 738 |
| 1,500 | 57.4% | 1,047 | 59.6% | 1,018 |
| 2,000 | 61.7% | 1,347 | 63.8% | 1,300 |
| 2,500 | 61.7% | 1,589 | 63.8% | 1,511 |
| 3,000 | 66.0% | 1,807 | 66.0% | 1,678 |
| 4,000 | 66.0% | 2,129 | 66.0% | 1,889 |
| 6,000 | 66.0% | 2,459 | 66.0% | 2,063 |
| 8,000 | 66.0% | 2,630 | 66.0% | 2,096 |

Smallest ceiling within 2 points of its own 8K score: fixed 3,000, adaptive 3,000.

## By question type

### claude

| Type | Questions | Evidence turns found | All evidence in packet | Mean packet tokens |
| --- | --- | --- | --- | --- |
| knowledge-update | 8 | 100.0% | 100.0% | 3,950 |
| multi-session | 11 | 72.7% | 54.5% | 1,765 |
| single-session-assistant | 6 | 100.0% | 100.0% | 3,079 |
| single-session-preference | 3 | 83.3% | 66.7% | 7,165 |
| single-session-user | 6 | 100.0% | 100.0% | 4,996 |
| temporal-reasoning | 13 | 82.1% | 76.9% | 6,961 |

### small-local

| Type | Questions | Evidence turns found | All evidence in packet | Mean packet tokens |
| --- | --- | --- | --- | --- |
| knowledge-update | 8 | 93.8% | 87.5% | 1,536 |
| multi-session | 11 | 59.8% | 36.4% | 664 |
| single-session-assistant | 6 | 83.3% | 83.3% | 2,063 |
| single-session-preference | 3 | 0.0% | 0.0% | 672 |
| single-session-user | 6 | 100.0% | 100.0% | 1,867 |
| temporal-reasoning | 13 | 69.2% | 61.5% | 1,988 |
