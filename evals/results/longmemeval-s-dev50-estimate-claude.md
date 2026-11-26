# Cost estimate: 50 LongMemEval_S dev questions × 1 run(s), claude profile

Reader claude-haiku-5-5, judge claude-opus-5-5. Token counts are estimates (about 3.5 characters per token). A real run lands between the two tables: readers search when they need to, not always or never. The --max-cost check uses the ceiling. Cost caveats: Haiku 5.5 bills prompts over 100K tokens at 5x, which every full-history call crosses; prompt caching isn't modeled, though in a long chat a cached history costs about a tenth; each question pays for its own compaction summaries, which a real chat spreads over many turns.

## Ceiling: every arm that can search uses every search it's allowed. Total **$18.66**

| Arm | Reader input tokens | Summarizer input tokens | Packet or context tokens | Searches | Cost / question | Total cost |
| --- | --- | --- | --- | --- | --- | --- |
| full | 580,083 | 0 | 141,475 | 3.0 | $0.2967 | $14.83 |
| compaction | 18,222 | 157,087 | 17,979 | 0.0 | $0.0287 | $1.44 |
| compaction-search | 80,155 | 157,087 | 17,979 | 3.0 | $0.0351 | $1.75 |
| packet | 30,778 | 0 | 5,717 | 3.0 | $0.0075 | $0.38 |
| bare | 7,154 | 0 | 34 | 3.0 | $0.0052 | $0.26 |

## Floor: no arm searches. Total **$7.21**

| Arm | Reader input tokens | Summarizer input tokens | Packet or context tokens | Searches | Cost / question | Total cost |
| --- | --- | --- | --- | --- | --- | --- |
| full | 143,278 | 0 | 141,475 | 0.0 | $0.0775 | $3.88 |
| compaction | 18,222 | 157,087 | 17,979 | 0.0 | $0.0287 | $1.44 |
| compaction-search | 18,296 | 157,087 | 17,979 | 0.0 | $0.0287 | $1.44 |
| packet | 5,959 | 0 | 5,717 | 0.0 | $0.0049 | $0.24 |
| bare | 205 | 0 | 34 | 0.0 | $0.0043 | $0.22 |
