# Plan

## Thesis

Beep is one endless chat that never compacts. Each turn, the model gets a fresh, small context packet built from a lossless log of everything said. It wins if it beats classic compaction and matches the full long conversation on recall, at a fraction of the tokens.

## Why it can work

Hand-built packets with a frontier model passed 12/12 recall tests at about 7% of the words of the full history. Automated packets with a small model (LFM3 1.7B) passed 1 to 3 of 12. The idea holds, and the packet builder is the hard part. Details in [research/context-packet-experiments.md](research/context-packet-experiments.md).

## Decided

- **Model:** frontier first, on Claude API credits. A small model is a later track.
- **Small-model packet:** about 3K tokens, since 3K is already over half a small model's context. This is the small local profile's default budget.
- **Phase 1:** evals first, as goal posts every packet change is judged against.
- **Shape:** one shared core engine with thin front ends. Command line first, web app next, Mac app last if ever.
- **Repo:** its own repo, so the git history shows how it evolved.
- **Providers:** v1 is Claude only, on your own Anthropic key. The free Cloudflare Workers AI demo is its own provider connection beside it.
- **Every packet source is also a model tool:** labels, references, past questions and answers, open loops, registers, chat search, memory, facts and files. The packet is a head start, never the only path, so the model can look things up itself when the packet looks incomplete, irrelevant or wrong. Every packet also carries a one- or two-line notice that earlier history was left out, how far back it goes, and that the tools can search it. A tool call right after the packet is logged as a packet miss.
- **Labels on every message:** a message can carry more than one topic label. Negative replies ("no", "that didn't work", "not that one") mark the idea or answer they reply to as rejected or superseded, so the packet leaves it out. Tagging rides on the reply call or a tiny classifier, never a separate model call per message. Labels stay only if they beat plain retrieval in the evals.

- **Every model, set per model profile.** Beep is for all models, not just Claude. Each profile sets the raw-turn window, when packets switch on (from turn one if wanted), the packet token budget, whether the retrieval gate runs, and which tools the model gets. Two default profiles:
  - **Claude:** long windows. The win is token cost.
  - **Small local, e.g. LFM3 1.7B:** short, de-duplicated context with junk turns dropped, since small models fall apart on long, repetitive context. Caching is about speed here (reusing the prompt prefix's KV cache, as in llama.cpp), not cost.
- **Normal chat first, then packets.** A chat runs as a plain chat until its history crosses the profile's threshold, then switches to packets. After that, a gate decides on each turn whether retrieval runs at all. A turn that needs nothing gets the rules, the recent turns and the new message. The evals find the threshold for each model.
- **The last few turns always ride along raw,** so a follow-up like "and that one?" never depends on retrieval. How many is set per profile.
- **Fixed prompt order:** stable system prompt and tools first, then the packet, then the recent turns and the new message, so the cached prefix never breaks.
- **Minimal sufficient context:** the smallest packet that still has what's needed. The budget is a ceiling, not a target: the builder stops adding items once the next one is unlikely to help (a confidence cutoff set per profile), and drops duplicates and filler. Every change is judged on recall against packet size, so shrinking never comes at recall's expense.
- **Whole units in the packet:** retrieved history comes in as whole segments, and code as whole functions or blocks, never trimmed snippets. Each profile caps unit size; a turn too long for the cap splits at paragraph breaks and is marked as part of a longer turn, never cut mid-line. A quoted file line needs proof: a path:line you typed or an exact symbol match, re-read fresh from disk every turn.
- **Interest notes.** Any time the user expresses interest or a preference, or changes one ("my favorite", "obsessed with", "I've been loving", "switched to", "I'm into"), the harness saves a dated note: topic, value, date and source turn. The newest value wins and older ones stay as history, so the packet can answer with one line. Two paths get built and compared: a background noter that runs after each saved turn, and a remember tool the model can call mid-turn. The default to test is the noter always on, with the tool for explicit asks. Judged on knowledge-update and preference recall, and on how often a note is saved for something that wasn't real interest.
- **The model's own recent answers go in the registers,** so it doesn't contradict what it said a few turns ago.
- **The resolver can say "unsure"** instead of guessing, and a tiny trained resolver gets tested behind the rules, since rules alone miss about a third of follow-ups.
- **Every packet says it's a best guess.** One fixed line says the packet is the builder's best guess and not to rely on anything that looks wrong, but to use the tools instead. Each item carries a confidence score, its source, its date and why it was pulled in. The line is tested on and off per model, since it could also make a model ignore good context.
- **A trick eval set,** built to fool the packet: sloppy and paraphrased wording, exact wording that still pulls the wrong thing, stale or superseded facts, near-duplicate or misnamed names, questions with no answer anywhere, and distractor segments. Scored on both large and small models.
- **Evals get a no-packet arm** (only the message and the tools), plus a harm rate and a wasted-lookup count next to recall. Raw-turn window and switch threshold are swept per model.

The full log, with dates and what each decision replaced, is in [decisions.md](decisions.md). The evidence behind the packet-shape decisions is in [research/prefetch.md](research/prefetch.md).

## Build order

1. **Evals.** Replay harness, canary set and scorer, run from the command line. First milestone: one real chat scored on all four arms (packet, compaction, full chat, no packet). See [evals/README.md](../evals/README.md).
2. **Core log.** Append-only log, session splitter, sorter.
3. **Packet builder v1** on a frontier model, tuned against the evals until it beats compaction. The first packet is plain retrieval plus pinned rules with no sorter; the sorter has to beat that baseline to earn its place. Retrieval runs gate, resolver, registers, hybrid search over topic segments, then filter and fit (see [architecture.md](architecture.md#retrieval-order)). The Claude and small local profiles are tuned separately. Each builder is tested with a ladder of readers, so builder and reader are measured separately.
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
