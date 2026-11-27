# Working set with a current-project signal (P20 retry)

Long Con is one chat across projects, so a file name in the window may belong to any of them. `buildPacket`'s optional `workspace` is now the active workspace: `{ root, name, files }`. A path in the window counts only after a turn ties the window to that workspace:

- **Ties:** the turn names the workspace (or its root folder's name), in any spelling ("long-con", "Long Con", "longcon"), or writes an absolute path under the root (`~/` for the home folder counts too). A bare file name or a relative path never ties.
- **Unties:** a turn that writes an absolute path outside the root (another checkout, `/home/user/long-con-old/` included), a `../` path, or a relative file path whose top folder this workspace doesn't have and that is no tail of a workspace file (`lib/bm25.ts`, `src/feed.ts` here). A turn that both unties and ties stays tied.
- Turns are read oldest first, so a chat can leave and come back. Absolute paths outside the root never resolve. The whole-path anchor from the first try is gone: inside a tied stretch, a bare name that matches exactly one workspace file counts.

Without a workspace, memory packets are byte-identical to main bbf0298: SHA-256 over all 1,997 dev and probe packet texts (the dev questions plus every empty-rate probe, tiers 1, 1t, 2, 3, 4 and answerable), per profile, with no current session and with the history's last session as current. All four digests match and 0 packets differ (claude d95cf711…/69f08c14…, small-local 5fc0ef1f…/93b315b8…). So recall and abstention numbers are main's run 9 baselines by construction.

## The set

`evals/sets/working-set-mixed/chats.json`, written by `make.py` beside it: 63 hand-written chats, a fresh set split by `evals/loop/split.ts` on the chat id (34 dev, 29 held-out). The active workspace is this repo at bbf0298 (281 files, from git) or a made-up 22-file static site, `tidepool`, whose names collide with this repo's (`docs/plan.md`, `.github/workflows/ci.yml`, `src/text.ts`, `package.json`).

- **named / sibling:** tied chats whose follow-up needs a named file, or one in the tree's reach.
- **mixed:** both projects in the window; the follow-up is about the active one.
- **switched:** tied earlier, then the window moves to another project's colliding files.
- **empty:** never tied: every collision the review listed (`style.css`, `cli.ts`, `plan.md`, `docs/plan.md`, `.github/workflows/ci.yml`, `./package.json`, a root-file diff, absolute paths into another checkout and into another project) plus a chat with no paths.
- **Wrong items:** starred files outside the chat's `allowed` list, the active-workspace files the chat really names for that workspace.

Held-out was never run.

## Dev

Before is the first try's resolver (d16751c, whole-path anchor, a file list only).

| | claude before | claude after | small-local before | small-local after |
| --- | --- | --- | --- | --- |
| Named earlier (6) | 4/6 | 5/6 | 3/6 | 4/6 |
| Nearby file (4) | 4/4 | 4/4 | 4/4 | 4/4 |
| Mixed window (7) | 7/7 | 7/7 | 7/7 | 7/7 |
| Should be empty (12) | 6/12 | 12/12 | 6/12 | 12/12 |
| Wrong items (chats with any), all 34 | 15 (14) | 3 (3) | 15 (14) | 3 (3) |
| Mean section tokens (sections) | 168 (26) | 176 (21) | 123 (25) | 127 (20) |

Misses: `README.md` (several in the repo, so a bare name never resolves) on both; on small-local, a chat tied 10 turns back, past its 8-turn window. The 3 wrong items are switches said only in words: "switching to tidepool for a sec", "other repo question: my blog's .github/workflows/ci.yml", "dotfiles repo" before a `a/README.md` diff.

**Cost on the first set** (`working-set.ts`, single-project chats that never name the repo): named earlier 5/7 → 0/7, nearby 13/13 → 1/13 on claude (12/13 → 1/13 small-local); should-be-empty stays 20/20. In a real window, tool output with absolute paths ties it; these chats have none.

## Sweep

A third tie, "a relative path with two or more folders whose file name is unique in the workspace", brought the first set back to 3/7 and 11/13 (10/13 small-local), but let `packages/core/src/index.ts` from another monorepo tie (empty 11/12, wrong items 4). Not kept: it is a guess from a path's shape, which the review's whole-path collisions rule out.

## Limits

- One author wrote the chats and the rules; the second project is made up.
- A switch said only in words ("my blog", "switching to tidepool") doesn't untie. A list of the user's other workspace names from the caller would catch the named ones.
- Naming the workspace in a turn that leaves it ("forget long-con for now, on my portfolio site...") ties it.
