# Cost estimate: 50 LongMemEval_S dev questions, claude profile

Reader claude-haiku-5-5, judge claude-opus-5-5. Token counts are estimates (about 3.5 characters per token), and every arm that can search is assumed to use every search it's allowed, so this is a ceiling. Cost caveats: Haiku 5.5 bills prompts over 100K tokens at 5x, which every full-history call crosses; prompt caching isn't modeled, though in a long chat a cached history costs about a tenth; each question pays for its own compaction summaries, which a real chat spreads over many turns. Estimated total: **$29.54**.

| Arm | Reader input tokens | Packet or context tokens | Searches | Cost / question | Total cost |
| --- | --- | --- | --- | --- | --- |
| full | 1,006,482 | 141,475 | 3.0 | $0.5099 | $25.49 |
| compaction | 18,222 | 17,979 | 0.0 | $0.0287 | $1.44 |
| compaction-search | 131,460 | 17,979 | 3.0 | $0.0402 | $2.01 |
| packet | 26,984 | 5,718 | 3.0 | $0.0071 | $0.36 |
| bare | 4,170 | 34 | 3.0 | $0.0049 | $0.24 |
