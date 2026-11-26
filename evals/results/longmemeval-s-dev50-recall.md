# Packet recall: LongMemEval_S dev slice

47 answerable questions of the 50-question dev slice (3 abstention questions have no evidence to find). Full history averages 139,782 tokens per question. Builder: BM25 only (no embeddings yet), size-based segments. No model calls. "All evidence in packet" means every labeled evidence turn is in it.

These are tuning numbers, not results: the segment cap and the cutoff were picked on this same slice, so they flatter the builder. With 47 questions, one question moves "All evidence in packet" by 2.1%. Intervals are 95% bootstraps over questions. Two limits: an evidence chat with no labeled turn isn't counted, and recall leaves out what a reader would find by searching.

## Each profile at its own settings

| Profile | Budget ceiling | Evidence chats found | Evidence turns found | All evidence in packet | 95% interval | Mean packet tokens | Largest packet |
| --- | --- | --- | --- | --- | --- | --- | --- |
| claude | 8,000 | 93.5% | 87.6% | 80.9% | 70.2% to 91.5% | 4,549 | 7,982 |
| claude: plain BM25 top-k | 8,000 | 93.0% | 85.1% | 76.6% | 63.8% to 87.2% | 7,886 | 8,000 |
| small-local | 2,500 | 84.9% | 74.6% | 66.0% | 53.2% to 78.7% | 2,173 | 2,494 |
| small-local: plain BM25 top-k | 2,500 | 87.1% | 69.7% | 57.4% | 42.6% to 72.3% | 2,474 | 2,499 |

Packet against plain BM25 top-k on the same questions:

| Profile | All-evidence difference | 95% interval | Questions only the packet gets whole | Questions only BM25 gets whole |
| --- | --- | --- | --- | --- |
| claude | +4.3 | +0.0 to +10.6 | 2 | 0 |
| small-local | +8.5 | +0.0 to +19.1 | 5 | 1 |

Plain BM25 top-k is the baseline: the same units ranked by BM25 over all words and filled to the same ceiling, with nothing else. It also shows what ranking by the user's words adds, which suits LongMemEval, where 95% of the dev slice's evidence turns are user turns, and may not carry over to real chats.

## What the reader takes in per question

System prompt, search tool definition, packet and question; then the same plus one search result. Room for the answer is kept out of the window.

| Profile | Context window | First call, mean | First call, largest | With one search, mean | With one search, largest | Fits with room to answer |
| --- | --- | --- | --- | --- | --- | --- |
| claude | 200,000 | 4,528 | 8,148 | 5,396 | 9,343 | 50 of 50 |
| small-local | 6,000 | 2,309 | 2,672 | 2,610 | 3,092 | 50 of 50 |

## Recall against packet size

![Recall against packet size](longmemeval-s-dev50-recall.svg)

### claude (segment cap 400, cutoff 0.3)

| Budget ceiling | Fixed: all evidence | Fixed: mean tokens | Adaptive: all evidence | Adaptive: mean tokens |
| --- | --- | --- | --- | --- |
| 1,000 | 48.9% | 888 | 48.9% | 859 |
| 1,500 | 63.8% | 1,309 | 66.0% | 1,244 |
| 2,000 | 68.1% | 1,727 | 70.2% | 1,631 |
| 2,500 | 68.1% | 2,113 | 70.2% | 1,964 |
| 3,000 | 72.3% | 2,487 | 74.5% | 2,269 |
| 4,000 | 74.5% | 3,256 | 76.6% | 2,825 |
| 6,000 | 74.5% | 4,781 | 78.7% | 3,812 |
| 8,000 | 76.6% | 6,270 | 80.9% | 4,549 |

Smallest ceiling within 2 points of its own 8K score: fixed 8,000, adaptive 8,000.

### small-local (segment cap 400, cutoff 0.3)

| Budget ceiling | Fixed: all evidence | Fixed: mean tokens | Adaptive: all evidence | Adaptive: mean tokens |
| --- | --- | --- | --- | --- |
| 1,000 | 46.8% | 921 | 46.8% | 885 |
| 1,500 | 59.6% | 1,398 | 61.7% | 1,320 |
| 2,000 | 63.8% | 1,880 | 66.0% | 1,770 |
| 2,500 | 63.8% | 2,356 | 66.0% | 2,173 |
| 3,000 | 66.0% | 2,823 | 68.1% | 2,558 |
| 4,000 | 68.1% | 3,784 | 70.2% | 3,260 |
| 6,000 | 70.2% | 5,692 | 72.3% | 4,476 |
| 8,000 | 72.3% | 7,560 | 74.5% | 5,367 |

Smallest ceiling within 2 points of its own 8K score: fixed 8,000, adaptive 8,000.

## By question type

### claude

| Type | Questions | Evidence turns found | All evidence in packet | Mean packet tokens |
| --- | --- | --- | --- | --- |
| knowledge-update | 8 | 100.0% | 100.0% | 3,937 |
| multi-session | 11 | 72.7% | 54.5% | 1,765 |
| single-session-assistant | 6 | 100.0% | 100.0% | 3,079 |
| single-session-preference | 3 | 83.3% | 66.7% | 7,970 |
| single-session-user | 6 | 100.0% | 100.0% | 4,996 |
| temporal-reasoning | 13 | 82.1% | 76.9% | 6,964 |

### small-local

| Type | Questions | Evidence turns found | All evidence in packet | Mean packet tokens |
| --- | --- | --- | --- | --- |
| knowledge-update | 8 | 93.8% | 87.5% | 2,271 |
| multi-session | 11 | 64.4% | 45.5% | 2,152 |
| single-session-assistant | 6 | 83.3% | 83.3% | 2,106 |
| single-session-preference | 3 | 16.7% | 0.0% | 1,653 |
| single-session-user | 6 | 100.0% | 100.0% | 2,271 |
| temporal-reasoning | 13 | 69.2% | 61.5% | 2,237 |
