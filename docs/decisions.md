# Decisions

Newest first. Each entry says what was decided and, where it matters, what it replaced.

## 2026-11-26

- **Every model, set per model profile.** Raw-turn window, switch threshold (packets from turn one allowed), packet token budget, gate on or off, and exposed tools are all per profile. Defaults: Claude (long windows, savings on token cost) and small local, e.g. LFM3 1.7B (short, de-duplicated context with junk turns dropped; caching is for speed through KV-cache prefix reuse, not cost).
- **Normal chat first, then packets.** A chat runs as a plain chat until history crosses the profile's threshold, then a per-turn gate decides whether retrieval runs. Replaces retrieval on every turn, since always retrieving can score below never retrieving.
- **The last few turns always ride along raw,** count set per profile.
- **Fixed prompt order:** stable system prompt and tools, then the packet, then recent turns and the new message. Replaces rules-first ordering inside the packet alone.
- **Whole segments and blocks,** never trimmed snippets. Replaces trimming to the hit messages plus a neighbor or two.
- **Line quotes need proof:** a path:line you typed or an exact symbol match, re-read fresh every turn.
- **The model's own recent answers join the registers.**
- **The resolver can say "unsure",** with a tiny trained resolver tested behind the rules.
- **Evals:** a fourth arm with no packet, a harm rate and wasted-lookup count, and per-model sweeps of the raw-turn window and switch threshold.

Evidence in [research/prefetch.md](research/prefetch.md).

## 2026-11-25

- **Every packet source is also a model tool:** labels, references, past questions and answers, open loops, registers, chat search, memory, facts and files. The packet is a head start, never the only path, so the model can look things up itself when the packet looks incomplete, irrelevant or wrong. Every packet also carries a one- or two-line notice that earlier history was left out, how far back it goes, and that the tools can search it. A tool call right after the packet is logged as a packet miss.
- **Providers:** v1 is Claude only, on your own Anthropic key. The free Cloudflare Workers AI demo is its own provider connection beside it.
- **Labels on every message:** a message can carry more than one topic label. Negative replies ("no", "that didn't work", "not that one") mark the idea or answer they reply to as rejected or superseded, so the packet leaves it out. Tagging rides on the reply call or a tiny classifier, never a separate model call per message. Labels stay only if they beat plain retrieval in the evals.
- **Name and repo: Long Con,** in its own repo so the git history shows how it evolved. Picked after a long search for a goofy everyday name that isn't crowded on GitHub or among AI products.
- **Front ends:** one shared core with thin front ends. Command line first (phase 1 is evals), web app next, Mac app last if ever. Other front ends may live in their own repos.
- **License:** Apache-2.0.
- **History storage moves off GitHub.** Syncing history to a git repo was the original plan. Rejected for regular users: GitHub is the wrong home for non-developers, and repo access is too broad. The replacement is a normal hosted service with accounts. Which service, and where encryption happens, is open: see [open-questions.md](open-questions.md).

## 2026-11-24

- **Frontier model first,** on Claude API credits. A small model is a stretch target, evaluated later.
- **Small-model packet target: about 3K tokens,** not 4 to 6K. 3K is already over half a small model's context.
- **Phase 1 is evals:** Long Con packet vs classic compaction vs the plain full long conversation, as goal posts.
- **Standalone project,** separate from Squiggle. Squiggle can reuse the core later.

## 2026-11-14 to 16 (original design)

- **One optional sidebar** (in play now, projects, open loops) replaces the earlier pair of a contextual sidebar and a project sidebar.
- **Welcome-back message** is the resurfacing channel. A separate "doors" start screen was dropped.
- **Last call, then archive** replaces snooze and mute. Silence archives, which is reversible.
- **Rule capture:** obvious scope applies at once, ambiguous scope asks once, every rule can be undone.
- **The front model is a strong conversational model,** not a light router in front of workers.
- **GitHub Models is out.** It was retired on 2026-07-30.
- **Background compute on GitHub Actions** (the user's own minutes or a self-hosted runner) is superseded by the hosted-service direction above.
