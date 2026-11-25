# Evals

Phase 1. These are the goal posts: every packet builder is judged here before anything else gets built on it.

## The question

Does a fresh packet each turn remember as well as the alternatives, for fewer tokens?

The benchmark is **Long Con versus compaction**, not versus a huge context window. A million tokens only delays the problem. The win is never reaching the moment where you have to say "reread our transcript" or "look at our past chats".

## Three arms, same replayed chats

| Arm | What the model sees each turn |
| --- | --- |
| `packet` | The Long Con context packet |
| `compaction` | The running transcript, summarized whenever it passes a budget (the classic approach) |
| `full` | The plain full long conversation, as long as it fits |

## Metrics

| Metric | What it catches |
| --- | --- |
| Canary recall | Facts planted in old history, checked directly |
| False-memory rate | Confident claims about things never said. Worse than forgetting. |
| Packet recall vs plain retrieval | If the answer lives in span X, is X in the packet? Tracked for the baseline and every sorter version. |
| Tokens per turn | Cost, and fit inside ~3K tokens for small models |
| Sorter split/merge | Over-splitting and over-merging reported separately (overlapping B-cubed precision and recall), scored at decision time |

## Test sets

1. **Pain-mined (primary).** Search a real chat export for moments like "look at our past chats", "you forgot", "reread" and "we already decided". Each hit is a real memory failure, and the thing that was forgotten is the right answer. Replay up to that moment through each arm and check whether it would have held.
2. **Interleaved export.** Take real past chats and interleave them into one fake endless stream, then score how well the sorter splits them back. Those chats were sorted by hand when they happened, so the labels come free. Make it harder: strip each chat's opening turn and the assistant's topic restatements, shuffle at turn level rather than by timestamp (chats rarely overlap in time), and splice sentences from two chats into single messages. Ground truth is imperfect, since several chats can be one project and one chat can drift.
3. **Canaries.** Known facts planted in real conversations on purpose. See [canaries/](canaries).
4. **Real labels.** After a week of real use, hand-label about 200 Long Con turns at span level.
5. **Public benchmarks.** LongMemEval, BEAM and LoCoMo, run as packet plus one message. See [memory-benchmarks.md](../docs/research/memory-benchmarks.md).

## When evals run

Not every benchmark on every change. Three tiers, cheapest first:

| Tier | When | What | Cost |
| --- | --- | --- | --- |
| **Recall check** | Every packet-builder change | Is the evidence in the packet? No answering model, no judge. Our canaries plus LongMemEval's labeled evidence sessions and turns, and packet size | Free, deterministic, minutes |
| **Dev run** | Before merging a builder change | Answers and judging on a fixed dev slice: pain-mined set, canaries, resolver tests, and about 50 stratified LongMemEval_S questions | Small; one reader and one judge call per question |
| **Full run** | Milestones and any public claim | Full LongMemEval_S, BEAM, LoCoMo (audited key), each arm, several runs with standard deviation; LongMemEval_M and BEAM-10M as stretch | The expensive one, so rare |

Rules that keep the numbers honest:

- **Tune on dev, report on held-out.** The full-run questions are never looked at while tuning, so the builder can't overfit to them.
- **No benchmark-specific prompts.** The same packet builder and reader prompt run everywhere.
- **Recall before accuracy.** If a change doesn't raise packet recall or cut packet size, it doesn't need a dev run.
- **Track accuracy against packet size,** since a lean packet trades recall for tokens (see [threader.md](../docs/research/threader.md)).

## Data stays out of git

Real exports, replays, canary answer keys and run outputs go in `evals/data/` and `evals/runs/`, which are git-ignored. This repo is public, and canaries only work if no model has seen them.

## Still open

- **Scoring spec:** what counts as a pass for each canary and test. Written by a person, not by the model that builds the packet, so the builder doesn't grade its own work.
- **Eval data:** the real chat export hasn't been requested yet.
