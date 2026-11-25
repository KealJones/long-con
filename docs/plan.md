# Plan

## Thesis

Long Con is one endless chat that never compacts. Each turn, the model gets a fresh, small context packet built from a lossless log of everything said. It wins if it beats classic compaction and matches the full long conversation on recall, at a fraction of the tokens.

## Why it can work

Hand-built packets with a frontier model passed 12/12 recall tests at about 7% of the words of the full history. Automated packets with a small model (LFM3 1.7B) passed 1 to 3 of 12. The idea holds, and the packet builder is the hard part. Details in [research/context-packet-experiments.md](research/context-packet-experiments.md).

## Decided

- **Model:** frontier first, on Claude API credits. A small model is a later track.
- **Small-model packet:** about 3K tokens, since 3K is already over half a small model's context.
- **Phase 1:** evals first, as goal posts every packet change is judged against.
- **Shape:** one shared core engine with thin front ends. Command line first, web app next, Mac app last if ever.
- **Repo:** its own repo, so the git history shows how it evolved.

The full log, with dates and what each decision replaced, is in [decisions.md](decisions.md).

## Build order

1. **Evals.** Replay harness, canary set and scorer, run from the command line. First milestone: one real chat scored on all three arms (packet, compaction, full chat). See [evals/README.md](../evals/README.md).
2. **Core log.** Append-only log, session splitter, sorter.
3. **Packet builder v1** on a frontier model, tuned against the evals until it beats compaction. The first packet is plain retrieval plus pinned rules with no sorter; the sorter has to beat that baseline to earn its place.
4. **Web app.** The first real chat screen, on the same core.
5. **Small-model track.** About 3K-token packets, free model paths first.
6. **Mac app.** Last, only if the web app hits a wall.

After a week of real use: real-time sorting, the welcome-back message and sidebar, hooks, auto-captured rules, side threads, resurfacing, automatic merge and split, retroactive corrections.

## Who builds what

| Piece | Approach | Why |
| --- | --- | --- |
| Data formats: log, IDs, spans, links | Designed carefully, reviewed by hand | Least reversible decision |
| Sorter, merge and split | Strongest available model | Novel; no known answer |
| Packet builder and retrieval baseline | Strongest available model | Judgment about what goes in each turn |
| Status lines, welcome-back, rule capture | Strongest available model | Product judgment |
| Eval scoring spec | Written by a person, with model help | The builder shouldn't grade its own work |
| Chat UI, log writer, sync | Faster model | Plumbing |
| Export importer, interleaver, sentence splicer | Faster model | Scripting |

## Biggest risk

Sorter accuracy, and "where we left off" labels drifting. Prove the sorter on real transcripts before building the welcome-back message and sidebar.
