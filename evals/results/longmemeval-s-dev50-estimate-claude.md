# Cost estimate: 50 LongMemEval_S dev questions × 1 run(s), claude profile

Reader claude-haiku-5-5, judge claude-opus-5-5. Token counts are estimates (about 3.5 characters per token). A real run lands between the two tables: readers search when they need to, not always or never. The --max-cost check uses the ceiling. Cost caveats: Haiku 5.5 bills prompts over 100K tokens at 5x, which every full-history call crosses; prompt caching isn't modeled, though in a long chat a cached history costs about a tenth; each question pays for its own compaction summaries, which a real chat spreads over many turns.

## Ceiling: every arm that can search uses every search it's allowed. Total **$17.54**

| Arm | Reader input tokens | Summarizer input tokens | Packet or context tokens | Searches | Arm cost / question | Judge cost / question | Total cost, judge included |
| --- | --- | --- | --- | --- | --- | --- | --- |
| full | 580,136 | 0 | 141,475 | 3.0 | $0.2928 | $0.0039 | $14.84 |
| compaction | 19,176 | 156,049 | 18,926 | 0.0 | $0.0248 | $0.0039 | $1.43 |
| compaction-search | 84,076 | 156,049 | 18,939 | 3.0 | $0.0314 | $0.0039 | $0.64 |
| packet | 29,755 | 0 | 5,717 | 3.0 | $0.0035 | $0.0039 | $0.37 |
| bare | 7,154 | 0 | 34 | 3.0 | $0.0013 | $0.0039 | $0.26 |

## Floor: no arm searches. Total **$6.08**

| Arm | Reader input tokens | Summarizer input tokens | Packet or context tokens | Searches | Arm cost / question | Judge cost / question | Total cost, judge included |
| --- | --- | --- | --- | --- | --- | --- | --- |
| full | 143,278 | 0 | 141,475 | 0.0 | $0.0736 | $0.0039 | $3.88 |
| compaction | 19,176 | 156,049 | 18,926 | 0.0 | $0.0248 | $0.0039 | $1.43 |
| compaction-search | 19,264 | 156,049 | 18,939 | 0.0 | $0.0248 | $0.0039 | $0.31 |
| packet | 5,959 | 0 | 5,717 | 0.0 | $0.0010 | $0.0039 | $0.24 |
| bare | 205 | 0 | 34 | 0.0 | $0.0004 | $0.0039 | $0.22 |
