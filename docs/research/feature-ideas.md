# Feature ideas

From a harness brainstorm (2026-11-14) that started as ideas for Squiggle and became the seed of Long Con. Ideas only; none is scheduled.

## Carried into the plan

1. **Retroactive corrections.** Later, recheck old answers with fresh searches and own up when one was wrong: "Last week I said X; that's wrong, here's why." The model tags claims that could change or that it was unsure about, and only those get rechecked, as a periodic background job. The correction shows on the original message with a badge.
2. **Your corrections become an eval suite.** Every "no, that's wrong" or "don't do that" is saved as a test case. When the model or prompt changes, replay the history of complaints and score it: a personal benchmark, and proof it gets better.
3. **Contradiction catcher.** Keep a decision log. When you circle back to the opposite of something you decided: "On the 10th you decided the opposite. Changing your mind, or forgot?"
4. **Speculative lookups.** While you're still talking, guess where you're heading and start searches early.
5. **Linked updates.** A later correction ("it's actually the 24th") is tied to the thing it corrects when it's said, not discovered later.

## Parked

- **Crux finder** (brainstorm mode). Brainstorm voices must name the exact point they disagree on, ending with the one test or fact that would settle it.
- **Pre-mortem replies.** Before answering, imagine the reader getting annoyed, write down the objection, and fix the answer first.

## Demo and proof, when it's ready

- **Demo moment:** ramble about three projects in one breath and watch it split them up; next day ask "where were we on X?" and it nails it; then a correction badge appears.
- **Proof:** sorting accuracy on real messy transcripts, "pick up where we left off" after a week of chats, and correction-suite scores across model swaps.

## Superseded parts of the original brainstorm

- **A light front model that only routes,** with heavy work on background workers. Replaced by a strong conversational front model with cheap side work around it.
- **Per-project state files in a git repo,** updated by workers. State is now a rebuildable cache over the append-only log, and storage is moving to a hosted service.
- **Free compute on the user's own GitHub Actions minutes or a self-hosted runner.** Superseded by the hosted-service direction. (Lesson kept: Actions bills by wall-clock time, so jobs should call APIs rather than run a model on the runner.)
- **GitHub Models as a free tier.** Retired on 2026-07-30.
