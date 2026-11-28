# @beep/core

The engine. Every front end (CLI, web, anything later) is a thin layer over this package, so behaviour and evals stay identical across them.

## Built so far

The first packet builder, for the evals. It works on plain sessions of turns, not the log, which doesn't exist yet.

| File | Job |
| --- | --- |
| `packet.ts` | `buildPacket`: gate, resolve, registers, search, fit, in that order. Whole segments only, oldest first, each with its date, confidence and why. Stops below the profile's confidence cutoff, so the packet is the smallest one that still has what's needed. |
| `resolver.ts` | Rules for follow-ups like "multiply that by 32" or "the second one". Says unsure rather than guessing. |
| `registers.ts` | Rules the user gave, recent results, recent answers, and answers the user rejected. |
| `segments.ts`, `bm25.ts`, `text.ts` | Segments capped per profile (a longer turn splits at paragraph breaks and is marked as part of one), BM25 search, word handling. |
| `profiles.ts` | The Claude and small local profiles. |
| `prompt.ts` | Fixed prompt order: system, packet, recent turns, message. |

Tests in `test/` check what lands in the packet by its words, not how it's laid out.

## Planned

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
