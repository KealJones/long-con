# Cost estimate: 50 LongMemEval_S dev questions, small-local profile

Reader claude-haiku-5-5, judge claude-opus-5-5. Token counts are estimates (about 3.5 characters per token), and every arm that can search is assumed to use every search it's allowed, so this is a ceiling. Cost caveats: Haiku 5.5 bills prompts over 100K tokens at 5x, which every full-history call crosses; prompt caching isn't modeled, though in a long chat a cached history costs about a tenth; each question pays for its own compaction summaries, which a real chat spreads over many turns. Estimated total: **$22.04**.

| Arm | Reader input tokens | Packet or context tokens | Searches | Cost / question | Total cost |
| --- | --- | --- | --- | --- | --- |
| full | 430,154 | 141,475 | 1.0 | $0.2212 | $11.06 |
| compaction | 8,602 | 8,469 | 0.0 | $0.1042 | $5.21 |
| compaction-search | 26,329 | 8,469 | 1.0 | $0.1060 | $5.30 |
| packet | 5,357 | 2,287 | 1.0 | $0.0049 | $0.24 |
| bare | 839 | 34 | 1.0 | $0.0044 | $0.22 |
