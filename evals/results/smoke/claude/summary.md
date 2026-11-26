# Smoke run: 12 LongMemEval_S dev questions, claude profile

Backend: subagents on a Claude plan, reader claude-sonnet-5-5, judge claude-opus-5-5, no tools for any arm. Token counts are estimates of the prompt alone. Cost and latency are not comparable with API runs, and this sample is small.

| Arm | Accuracy | 95% interval | Errors | Reader input tokens | Packet or context tokens | Searches | Cost / question | Total cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| packet | 83.3% | 58.3% to 100.0% | 0 | 6,097 | 6,003 | 0.0 | $0.0147 | $0.18 |
| bare | 8.3% | 0.0% to 25.0% | 0 | 121 | 34 | 0.0 | $0.0022 | $0.03 |

Paired against bare, same questions:

| Arm | Questions | Accuracy difference | 95% interval |
| --- | --- | --- | --- |
| packet | 12 | +75.0 | +50.0 to +91.7 |
