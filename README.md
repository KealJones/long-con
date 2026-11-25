# Long Con

One endless chat that never compacts.

A normal chat resends the whole conversation every turn until it has to be summarized, and summaries lose things: a standing rule, a date that changed, a decision from last week. Long Con never sends the transcript. Every turn, the model gets a fresh, small **context packet** built from a lossless log of everything said: your rules, the state of the threads the new message touches, and the raw words from the past that matter.

The bet: a good packet beats classic compaction, and matches the full long conversation on recall, at a fraction of the tokens.

## Status

Early. Phase 1 is the eval harness: the goal posts every packet builder is judged against. Nothing in the core is built yet.

| Step | What | State |
| --- | --- | --- |
| 1 | Eval harness, canary set and scorer, run from the CLI | next |
| 2 | Core log, session splitter and sorter | planned |
| 3 | Packet builder v1 on a frontier model, tuned until it beats compaction | planned |
| 4 | Web app on the same core | planned |
| 5 | Small-model track with ~3K-token packets | planned |
| 6 | Mac app, only if the web app hits a wall | maybe |

Evidence so far: hand-built packets let a frontier model pass 12/12 recall tests at about 7% of the words of the full history. Automated packets with a 1.7B model passed 1 to 3 of 12. The idea holds; the packet builder is the hard part. See [docs/research/context-packet-experiments.md](docs/research/context-packet-experiments.md).

## Layout

```
packages/
  core/        the engine: log, splitter, sorter, registers, packet builder
apps/
  cli/         command-line front end (runs the evals first)
evals/         replay harness, canaries, scorer; real chat data stays out of git
docs/
  plan.md            what we're building and in what order
  architecture.md    how a turn works, end to end
  decisions.md       decisions made, with dates
  open-questions.md  what's still undecided
  research/          experiments, prior art, providers, ideas
```

One shared core with thin front ends. The CLI comes first because phase 1 is evals; a web app comes next. Other front ends may live in their own repos later and depend on `@long-con/core`.

## Running

Requires Node 22.6 or newer. No dependencies to install yet.

```sh
npm run cli -- help
```

## License

[Apache-2.0](LICENSE)
