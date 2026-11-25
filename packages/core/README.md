# @long-con/core

The engine. Every front end (CLI, web, anything later) is a thin layer over this package, so behaviour and evals stay identical across them.

Planned modules, in build order (see [docs/architecture.md](../../docs/architecture.md) for the design):

| Module | Job |
| --- | --- |
| `log` | Append-only turn log. Permanent turn IDs, never edited. The source of truth. |
| `spans` | Pointers into the log: turn ID plus a sentence or character range. |
| `sessions` | Splits the log into sessions on gaps of 30 minutes or more. Display only. |
| `sorter` | Links each span to a thread: an existing one, NEW, or the unsorted inbox. Picks, never invents. |
| `registers` | Open loops, results, lists and rules, tagged when a turn is written. |
| `packet` | Builds the context packet for every turn. |
| `recall` | Fills gaps mid-turn by injecting a forced recall as a tool result. |
| `providers` | Model API adapters. Frontier first. |

Everything except `log` is a cache that can be rebuilt from the log.

The data formats (log, IDs, spans, links) are the least reversible decision in the project. They get designed and reviewed by hand before any code depends on them.
