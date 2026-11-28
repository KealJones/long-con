# Evals

Phase 1. These are the goal posts: every packet builder is judged here before anything else gets built on it.

## The question

Does a fresh packet each turn remember as well as the alternatives, for fewer tokens?

The benchmark is **Beep versus compaction**, not versus a huge context window. A million tokens only delays the problem. The win is never reaching the moment where you have to say "reread our transcript" or "look at our past chats".

## Five arms (plus packet variants), same replayed chats

| Arm | What the model sees each turn |
| --- | --- |
| `packet` | The Beep context packet |
| `compaction` | The running transcript, summarized whenever it passes a budget (the classic approach), with no tools |
| `compaction-search` | The same summary plus the search tool |
| `full` | The plain full long conversation, as long as it fits |
| `bare` | Only the new message and the lookup tools, no packet. Shows what the packet saves and when it hurts |

Three packet variants run only when `--arms` names them. Each changes one thing, so pair it against `packet`:

| Arm | What changes from `packet` |
| --- | --- |
| `packet-tools` | The retrieved units arrive as if the model had searched for them itself: an assistant `search_history` call with the builder's query, then a `tool_result` holding the units, before the question. The head (left-out notice, trust note, registers) stays a short `<packet>` block first, since it describes the context rather than being a search hit, and the user's standing rules shouldn't read as tool output. Same words, order and token count otherwise. A closed gate shows no call; an open one that kept nothing shows "No matches.", the tool's own empty result |
| `packet-notrust` | No "best guess" trust note (`trustNote: false`). The claude profile has it off since 2026-11-27, matching the web chat, so on claude this is the same as `packet` |
| `packet-norules` | No standing-rules register (`standingRules: false`). On the dev slice, 21 of 50 packets carry one on both profiles |

## Metrics

The full list we aim to track. The harness computes only what [What the harness does today](#what-the-harness-does-today) lists; the rest are planned.

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
4. **Real labels.** After a week of real use, hand-label about 200 Beep turns at span level.
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
| **Full run** | Milestones and any public claim | Full LongMemEval_S, BEAM, LoCoMo (audited key), each arm, several runs, with intervals that cover run-to-run noise; LongMemEval_M and BEAM-10M as stretch | The expensive one, so rare |

Rules that keep the numbers honest:

- **Tune on dev, report on held-out.** The full-run questions are never looked at while tuning, so the builder can't overfit to them.
- **No benchmark-specific prompts.** The same packet builder and reader prompt run everywhere.
- **Recall before accuracy.** If a change doesn't raise packet recall or cut packet size, it doesn't need a dev run.
- **Track accuracy against packet size,** since a lean packet trades recall for tokens (see [threader.md](../docs/research/threader.md)).

## Running it

```
evals/scripts/fetch-longmemeval.sh                        # LongMemEval_S, about 265 MB, checked by sha256
evals/scripts/fetch-embedders.sh                          # potion-base-8M and potion-retrieval-32M (model2vec, MIT), about 155 MB, checked by sha256; recall and empty-rate use them for the profiles' embedding veto, and skip it with a warning when absent
npm run cli -- eval recall                                # free: is the evidence in the packet? Every profile
npm run cli -- eval estimate --profile small-local        # free: what a real run would cost
npm run cli -- eval run --limit 12 --no-tools --arms packet,bare   # on a Claude plan, through subagents
npm test                                                  # unit tests for the core and the harness
```

Every setting comes from the model's profile in [packages/core/src/profiles.ts](../packages/core/src/profiles.ts): context window, switch threshold, packet ceiling, confidence cutoff, raw-turn window, segment cap, tools and search size. `--profile` picks one; `claude` is the default and `small-local` is sized for LFM3 1.7B in the browser. The reader is whatever `--reader` names (Claude Haiku 5.5 by default), so a small-local run measures that reader on small-model packets, not LFM3 itself, and its `full` arm still sends the whole history, more than a 6K window could hold.

The dev slice is the 50 question ids in [slices/longmemeval-s-dev50.json](slices/longmemeval-s-dev50.json), stratified by question type with a fixed seed. `--split held-out` runs the rest, for headline numbers only, minus any question that shares evidence with dev: an `_abs` twin of a dev question, or one whose evidence chat shares an evidence turn word for word, or at least half its turns, with a dev question's. That leaves 437, with 13 left out of both. `eval recall` refuses held-out, so tuning never looks at it. Nothing else enforces this: run held-out only for headline numbers. The overlap runs both ways as filler: some dev evidence chats appear in held-out histories, and some held-out evidence chats appear in dev histories. Neither gives answers away, but held-out isn't fully independent of what tuning looked at. Grouping matches turns word for word, so a held-out question can still ask about the same event as a dev question through reworded evidence (one clear case among the 437, a few weaker ones). `--limit n` takes a stratified pick of either. `--repeats n` runs every question n times.

The loader sorts each question's chats by date before anything else sees them, since the benchmark's file order isn't time order for 211 of 500 questions and a real chat log always is; every arm gets the same order. Some benchmark chats are dated after the question's own date (76 questions); that's the benchmark's data and is the same for every arm.

### Two ways to answer

- **On a Claude plan (`--backend subagent`, the default):** each reader and judge prompt is written to `pending/` in the run's folder (default `evals/results/smoke/<profile>/`). A subagent answers each one from that file alone into `answers/` under the same name, and the same command run again picks the answers up: first the readers, then the judge, then the summary. Use it for iteration. It needs `--no-tools`, since a file can't run a search, and refuses to start without it. Its `pending/` prompts hold the gold answers, so git ignores them. Token counts are estimates of the prompt alone, and cost and latency don't compare with API runs.
- **On the API (`--backend api`):** needs `ANTHROPIC_API_KEY` and refuses to start if the estimate passes `--max-cost` (default $5). During the run it stops starting new answers once real spending reaches the same cap; answers already running finish, so it can go over by a few, and the summary says so if it stopped early. Use it for headline numbers.

### The paid run in GitHub Actions

The **Evals (paid)** workflow in [.github/workflows/evals.yml](../.github/workflows/evals.yml) runs only when someone presses **Run workflow** on the repo's Actions tab. It reads the `ANTHROPIC_API_KEY` repository secret. Inputs: profile, arms, question count, split, repeats, max cost (default $2), reader and judge. The run stops before any call if its estimate is over the cap, and stops starting new answers once it has really spent the cap. The summary table lands on the run's page and every answer and verdict is attached as an artifact. Nothing is committed back.

### What the harness does today

- **Arms:** all five (and the packet variants) answer each question with the same system prompt and reader (Claude Haiku 5.5 by default). `full` gets every past chat. `compaction` folds chats into a running summary each time the transcript passes the profile's `compactAt`, written by the reader model, and gets no tools: the classic approach. The summary is asked to stay within about a third of `compactAt` (7,500 words on claude, well under the 16K output cap, since a cut-off summary fails both compaction arms) and to keep what the assistant recommended or answered as well as what the user said, and a last fold leaves only the summary when what's left is too big. The length is asked for, not forced: a summary that runs long gives compaction more than `compactAt`, and the packet-or-context column shows what each arm really got. On small-local, a 2,500-token `compactAt` means about one summary call per chat, so its compaction and `full` numbers describe a reader with a bigger window than the target model's. `compaction-search` is the same summary plus the search tool. `packet` gets the core packet once history passes the profile's switch point (below it, the whole chat). `bare` gets only the left-out-history notice. Every arm but `compaction` gets the same search tool with the same number of rounds, or none with `--no-tools`, and every arm without the whole history is told it was cut and, when it has the tool, that the tool reaches all of it. On the last round the tool stays defined but the reader can only answer (`tool_choice: none`; not yet checked against the live API). The packet variants run the same reader loop. `packet-tools` always defines the tool, since the API needs it for a `tool_use` in the history; with `--no-tools` it's defined with `tool_choice: none`, so it's the one arm whose prompt shows a tool then, and the subagent backend renders its call and result as plain lines. The ablations drop their part in the builder, so the few tokens it frees go back to the packet's budget.
- **What `packet` against `bare` measures:** the whole builder, its own retrieval included. The packet ranks with two fused BM25 indexes and a cutoff and fills up to its ceiling before the reader starts; the shared search tool runs the same fused search (`searchHistory` in core) and returns the profile's `searchResults` best units per round, marking the ones the packet would have left out as low confidence instead of dropping them. So a gap between them is the builder's cutoff, budget and up-front hand-over, not a different ranking. Runs before Nov 26, 2026 used plain BM25 for the tool, so their `bare` numbers aren't comparable.
- **Summary:** accuracy with a 95% bootstrap interval over questions (repeats averaged per question first), errors, reader input tokens (every reader call, tool results included: the headline token number), summarizer input tokens, the packet or summary size (over answers that didn't fail; estimated at about 3.5 characters a token, while reader and summarizer input are what the API billed), searches, the arm's own cost per question (reader and summarizer), the judge's cost per question, the same job for every arm, and the run's total with the judge. Below it, each arm paired against `bare` and against `packet` on the same questions, with its own interval. A failed call, the reader's or the judge's, counts as wrong, keeps the answer and what it cost, including a cut-off call's billed output. The exception is an API outage that outlasts the client's 10 retries (a rate limit, overload, server error, timeout, refused key or lost connection): it's left out of accuracy, the per-question token and cost averages and the paired tables, still counts in the run's total, and is counted in its own column, since outages hit the arms with the biggest prompts hardest. If any arm has outages, its accuracy covers fewer questions, so trust the paired tables. The reader gets at most one search per round. Cost uses list prices, Haiku's over-100K-token price included, with no caching. The two compaction arms share one summary per question, so they differ only in the tool; each reports the summary's cost as its own, and the run's total and its spending cap count it once. An empty answer counts as an error. With no tools, no prompt mentions a tool, except `packet-tools`' own call. A run refuses a reader or judge with no price, or an estimate with any errors.
- **Recall baseline:** next to each profile's packet, plain BM25 top-k over the same segments filled to the same ceiling, with bootstrap intervals and a paired difference. On claude the packet beats it by one question of 47, which isn't a shown gain; small-local's gap is larger. The recall numbers are tuning numbers: the segment cap and cutoff were picked on the same dev slice.
- **Judge:** LongMemEval's own per-type judge prompts, word for word, read by Claude Opus 5.5 instead of the paper's GPT-4o, with the same output cap as every other call. A verdict passes only if it starts with "yes". Scores compare across our arms, not with published numbers. The benchmark's rubric is lenient ("contains the correct answer"), and abstention questions, which a refusal passes, count in headline accuracy; per-type accuracy is in summary.json. The judge's temperature is left at the default (the paper used 0) and it gets a one-line system prompt the original doesn't have; a reply that starts with "no" is a fail, and one that starts with neither is a judge error, in the Errors column. The judge isn't checked against the paper's GPT-4o judge or human labels, and its lenient rubric credits an answer that names several candidates, which can help an arm that sees more of them.
- **Statistics:** 50 dev questions, one run by default, and each arm compared with both `bare` and `packet` with no correction for making several comparisons. Treat dev gaps under about 12 points as noise, and go by the printed paired intervals; headline claims need held-out and repeats.
- **Packet ceiling:** retrieved history always fits the ceiling, but standing rules from the chat are added without a cap, so a history full of them could push a packet over. No LongMemEval question does (the largest header is under 400 tokens).
- **Packet builder v1:** rule resolver, registers, BM25 over segments capped per profile (all words fused with the user's words only). Weak matches below the profile's cutoff stay out, so the ceiling isn't a target. An absolute bar (`minScore`) leaves the packet empty when even the best unit scores under that share of the most any unit could score on the query; it's all-or-nothing, so a packet that isn't empty carries as many weak units as before. No embeddings and no topic splitting yet.
- **No leaks:** LongMemEval's session ids name the evidence sessions, so the loader renames every session `chat-N` and packets show no ids at all.

Results: [recall](results/longmemeval-s-dev50-recall.md), estimates for [claude](results/longmemeval-s-dev50-estimate-claude.md) and [small-local](results/longmemeval-s-dev50-estimate-small-local.md), and subagent smoke runs in [results/smoke/](results/smoke), which are a pipeline check from an older version, not results.

## Data stays out of git

Real exports, replays, canary answer keys, downloaded benchmarks and run outputs go in `evals/data/` and `evals/runs/`, which are git-ignored. Summaries of public-benchmark runs go in `evals/results/`. This repo is public, and canaries only work if no model has seen them.

## Still open

- **Scoring spec:** what counts as a pass for each canary and test. Written by a person, not by the model that builds the packet, so the builder doesn't grade its own work.
- **Eval data:** the real chat export hasn't been requested yet.
