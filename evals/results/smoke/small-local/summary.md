# Smoke run: 12 LongMemEval_S dev questions, small-local profile

Backend: subagents on a Claude plan, reader claude-haiku-5-5, judge claude-opus-5-5, no tools for any arm. Token counts are estimates of the prompt alone. Cost and latency are not comparable with API runs, and this sample is small.

| Arm | Accuracy | 95% interval | Errors | Reader input tokens | Packet or context tokens | Searches | Cost / question | Total cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| packet | 58.3% | 33.3% to 83.3% | 0 | 2,471 | 2,376 | 0.0 | $0.0016 | $0.02 |
| bare | 8.3% | 0.0% to 25.0% | 0 | 121 | 34 | 0.0 | $0.0012 | $0.01 |

Paired against bare, same questions:

| Arm | Questions | Accuracy difference | 95% interval |
| --- | --- | --- | --- |
| packet | 12 | +50.0 | +25.0 to +75.0 |
