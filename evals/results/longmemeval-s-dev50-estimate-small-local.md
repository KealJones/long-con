# Cost estimate: 50 LongMemEval_S dev questions × 1 run(s), small-local profile

Reader claude-haiku-5-5, judge claude-opus-5-5. Token counts are estimates (about 3.5 characters per token). A real run lands between the two tables: readers search when they need to, not always or never. The --max-cost check uses the ceiling. Cost caveats: Haiku 5.5 bills prompts over 100K tokens at 5x, which every full-history call crosses; prompt caching isn't modeled, though in a long chat a cached history costs about a tenth; each question pays for its own compaction summaries, which a real chat spreads over many turns.

## Ceiling: every arm that can search uses every search it's allowed. Total **$18.42**

| Arm | Reader input tokens | Summarizer input tokens | Packet or context tokens | Searches | Cost / question | Total cost |
| --- | --- | --- | --- | --- | --- | --- |
| full | 287,052 | 0 | 141,475 | 1.0 | $0.1497 | $7.48 |
| compaction | 8,602 | 406,425 | 8,469 | 0.0 | $0.1042 | $5.21 |
| compaction-search | 17,846 | 406,425 | 8,469 | 1.0 | $0.1052 | $5.26 |
| packet | 5,447 | 0 | 2,285 | 1.0 | $0.0049 | $0.24 |
| bare | 839 | 0 | 34 | 1.0 | $0.0044 | $0.22 |

## Floor: no arm searches. Total **$14.74**

| Arm | Reader input tokens | Summarizer input tokens | Packet or context tokens | Searches | Cost / question | Total cost |
| --- | --- | --- | --- | --- | --- | --- |
| full | 143,278 | 0 | 141,475 | 0.0 | $0.0775 | $3.88 |
| compaction | 8,602 | 406,425 | 8,469 | 0.0 | $0.1042 | $5.21 |
| compaction-search | 8,676 | 406,425 | 8,469 | 0.0 | $0.1042 | $5.21 |
| packet | 2,491 | 0 | 2,285 | 0.0 | $0.0045 | $0.23 |
| bare | 205 | 0 | 34 | 0.0 | $0.0043 | $0.22 |
