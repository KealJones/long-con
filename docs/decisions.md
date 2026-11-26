# Decisions

Newest first. Each entry says what was decided and, where it matters, what it replaced.

## 2026-11-25

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
