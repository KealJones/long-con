# Evals

Phase 1. These are the goal posts: every packet builder is judged here before anything else gets built on it.

## The question

Does a fresh packet each turn remember as well as the alternatives, for fewer tokens?

The benchmark is **Long Con versus compaction**, not versus a huge context window. A million tokens only delays the problem. The win is never reaching the moment where you have to say "reread our transcript" or "look at our past chats".

## Four arms, same replayed chats

| Arm | What the model sees each turn |
| --- | --- |
| `packet` | The Long Con context packet |
| `compaction` | The running transcript, summarized whenever it passes a budget (the classic approach) |
| `full` | The plain full long conversation, as long as it fits |
| `bare` | Only the new message and the lookup tools, no packet. Shows what the packet saves and when it hurts |

## Metrics

| Metric | What it catches |
| --- | --- |
| Canary recall | Facts planted in old history, checked directly |
| False-memory rate | Confident claims about things never said, or rejected and superseded ideas brought back as current. Worse than forgetting. |
| Packet recall vs plain retrieval | If the answer lives in span X, is X in the packet? Tracked for the baseline and every sorter version. |
| Packet misses | Model tool calls right after the packet, a sign it was missing or wrong |
| Needless searches | Searches when the packet already held the answer, to check the left-out-history notice doesn't make the model over-search |
| Harm rate | Questions that pass with no packet and fail with it. A wrong pull costs more than a missing one |
| Wasted lookups | Lookups the builder ran that nothing in the answer used |
| Tool calls and turns saved | Against the `bare` arm at the same accuracy |
| Tokens per turn | Cost, and fit inside ~3K tokens for small models |
| Cost per turn with caching | Real cost with prompt caching on, since cached history is cheap and a packet only wins past a certain length |
| Time to first token | For local models, where caching is about speed |
| Wrong-item acceptance | How often the model uses a packet item that's wrong |
| Right-item rejection | How often the model ignores or overrides a packet item that's right. Watched closely with the trust note on |
| Sorter split/merge | Over-splitting and over-merging reported separately (overlapping B-cubed precision and recall), scored at decision time |

## Test sets

1. **Pain-mined (primary).** Search a real chat export for moments like "look at our past chats", "you forgot", "reread" and "we already decided". Each hit is a real memory failure, and the thing that was forgotten is the right answer. Replay up to that moment through each arm and check whether it would have held.
2. **Interleaved export.** Take real past chats and interleave them into one fake endless stream, then score how well the sorter splits them back. Those chats were sorted by hand when they happened, so the labels come free. Make it harder: strip each chat's opening turn and the assistant's topic restatements, shuffle at turn level rather than by timestamp (chats rarely overlap in time), and splice sentences from two chats into single messages. Ground truth is imperfect, since several chats can be one project and one chat can drift.
3. **Canaries.** Known facts planted in real conversations on purpose. See [canaries/](canaries).
4. **Real labels.** After a week of real use, hand-label about 200 Long Con turns at span level.
5. **Public benchmarks.** LongMemEval, BEAM and LoCoMo, run as packet plus one message. See [memory-benchmarks.md](../docs/research/memory-benchmarks.md).
6. **Trick set.** Cases built to fool the packet, since wrong context hurts more than none:
   - **Sloppy wording:** paraphrases, typos, slang and half-sentences for something that was said precisely.
   - **Lexical traps:** exact, precise wording that matches the wrong thing better than the right one.
   - **Stale facts:** something said, then changed or rejected later. Only the newest version is right.
   - **Look-alike names:** near-duplicates, misspellings and misheard names ("Mackie" written "Macie").
   - **No answer:** nothing relevant exists, so the right answer is "we never talked about that".
   - **Distractors:** segments planted to look relevant but answer a different question.

   Every case runs on both large and small readers, with the trust note on and off.

## Reader ladder

The builder and the reader are measured separately. The earlier automated packets (1-3/12) used LFM3 1.7B as the reader, so they can't tell a bad packet from a weak reader.

Every builder runs with three readers, strongest first:

1. **Claude Opus:** tests the builder alone.
2. **Claude Haiku:** how a smaller frontier model fares on the same packets.
3. **LFM3 1.7B:** the small-model track.

Each reader reports accuracy against packet size, next to packet recall.

## Per-model sweeps

Each model profile gets its own settings, so each reader sweeps them:

- **Raw-turn window:** how many recent turns ride along raw.
- **Switch threshold:** how long the history gets before packets replace the plain chat, from turn one up.

The result for each model is where the packet starts beating the full chat on accuracy, cost and speed. That point becomes the profile's default. Expect it to be late for Claude and early for small local models.

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

## Running it

```
evals/scripts/fetch-longmemeval.sh      # LongMemEval_S, about 265 MB, checked by sha256
npm run cli -- eval recall              # free: is the evidence in the packet?
npm run cli -- eval estimate            # free: what a real run would cost
npm run cli -- eval run                 # paid: needs ANTHROPIC_API_KEY, refuses past --max-cost (default $5)
npm test                                # unit tests for the core and the harness
```

The dev slice is the 50 question ids in [slices/longmemeval-s-dev50.json](slices/longmemeval-s-dev50.json), stratified by question type with a fixed seed. The other 450 are held out. Real runs write every answer, judge verdict and token count to `evals/runs/<time>/`.

What the harness does today:

- **Arms:** all four answer each question with the same system prompt and reader (Claude Haiku 5.5 by default). `full` gets every past chat. `compaction` folds chats into a running summary each time the transcript passes 30K tokens, written by the reader model. `packet` gets the core packet (Claude profile, 8K tokens) plus a search tool. `bare` gets only the left-out-history notice plus the same search tool. Each tool-using arm can search up to three times.
- **Judge:** LongMemEval's own per-type judge prompts, word for word, read by Claude Opus 5.5 instead of the paper's GPT-4o. Scores compare across our arms, not with published numbers.
- **Packet builder v1:** rule resolver, registers, BM25 over size-based segments (all words fused with the user's words only), whole segments fitted to the budget. No embeddings and no topic splitting yet.

First results: [results/longmemeval-s-dev50-recall.md](results/longmemeval-s-dev50-recall.md) and [results/longmemeval-s-dev50-estimate.md](results/longmemeval-s-dev50-estimate.md).

## Data stays out of git

Real exports, replays, canary answer keys, downloaded benchmarks and run outputs go in `evals/data/` and `evals/runs/`, which are git-ignored. Summaries of public-benchmark runs go in `evals/results/`. This repo is public, and canaries only work if no model has seen them.

## Still open

- **Scoring spec:** what counts as a pass for each canary and test. Written by a person, not by the model that builds the packet, so the builder doesn't grade its own work.
- **Eval data:** the real chat export hasn't been requested yet.
