# Packet recall: LongMemEval_S dev slice

47 answerable questions of the 50-question dev slice (3 abstention questions have no evidence to find). Full history averages 139,782 tokens per question. Builder: BM25 only (no embeddings yet), size-based segments, Claude profile. No model calls.

| Packet budget | Evidence chats found | Evidence turns found | All evidence in packet | Mean packet tokens | Share of full history |
| --- | --- | --- | --- | --- | --- |
| 2,000 | 56.1% | 48.2% | 25.5% | 1,830 | 1.3% |
| 4,000 | 75.8% | 65.1% | 44.7% | 3,813 | 2.7% |
| 8,000 | 87.6% | 81.4% | 72.3% | 7,799 | 5.6% |
| 16,000 | 90.7% | 86.2% | 76.6% | 15,765 | 11.3% |

### By question type, at the Claude profile's 8,000-token budget

| Type | Questions | Evidence chats found | Evidence turns found | All evidence in packet |
| --- | --- | --- | --- | --- |
| knowledge-update | 8 | 93.8% | 93.8% | 87.5% |
| multi-session | 11 | 68.9% | 59.8% | 36.4% |
| single-session-assistant | 6 | 100.0% | 100.0% | 100.0% |
| single-session-preference | 3 | 100.0% | 83.3% | 66.7% |
| single-session-user | 6 | 100.0% | 100.0% | 100.0% |
| temporal-reasoning | 13 | 85.4% | 74.4% | 69.2% |
