# Cost estimate: 50 LongMemEval_S dev questions × 1 run(s), small-local profile

Reader claude-haiku-5-5, judge claude-opus-5-5. Token counts are estimates (about 3.5 characters per token). A real run lands between the two tables: readers search when they need to, not always or never. The --max-cost check uses the ceiling. Cost caveats: Haiku 5.5 bills prompts over 100K tokens at 5x, which every full-history call crosses; prompt caching isn't modeled, though in a long chat a cached history costs about a tenth; each question pays for its own compaction summaries, which a real chat spreads over many turns.

## Ceiling: every arm that can search uses every search it's allowed. Total **$18.42**

| Arm | Reader input tokens | Summarizer input tokens | Packet or context tokens | Searches | Arm cost / question | Judge cost / question | Total cost, judge included |
| --- | --- | --- | --- | --- | --- | --- | --- |
| full | 287,052 | 0 | 141,475 | 1.0 | $0.1458 | $0.0039 | $7.48 |
| compaction | 8,626 | 406,425 | 8,493 | 0.0 | $0.1003 | $0.0039 | $5.21 |
| compaction-search | 17,921 | 406,425 | 8,506 | 1.0 | $0.1013 | $0.0039 | $5.26 |
| packet | 5,352 | 0 | 2,285 | 1.0 | $0.0010 | $0.0039 | $0.24 |
| bare | 839 | 0 | 34 | 1.0 | $0.0005 | $0.0039 | $0.22 |

## Floor: no arm searches. Total **$14.74**

| Arm | Reader input tokens | Summarizer input tokens | Packet or context tokens | Searches | Arm cost / question | Judge cost / question | Total cost, judge included |
| --- | --- | --- | --- | --- | --- | --- | --- |
| full | 143,278 | 0 | 141,475 | 0.0 | $0.0736 | $0.0039 | $3.88 |
| compaction | 8,626 | 406,425 | 8,493 | 0.0 | $0.1003 | $0.0039 | $5.21 |
| compaction-search | 8,714 | 406,425 | 8,506 | 0.0 | $0.1003 | $0.0039 | $5.21 |
| packet | 2,491 | 0 | 2,285 | 0.0 | $0.0006 | $0.0039 | $0.23 |
| bare | 205 | 0 | 34 | 0.0 | $0.0004 | $0.0039 | $0.22 |
