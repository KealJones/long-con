# Working set plus depth-2 tree (P20)

> **Superseded by the current-project retry** (`working-set-mixed.md`): `workspace` is now `{ root, name, files }`, and paths count only once the window ties them to it, so the whole-path rule below is gone. On this set, whose chats never name the repo, dev now gets named earlier 0/7 and nearby 1/13 on both profiles, should-be-empty 20/20. The rest of this page is the first try.

`buildPacket` takes an optional `workspace`: the caller's file paths, relative to the workspace root. Paths in the message and the current session's latest turns (20 on claude, 8 on small-local) are resolved against it. The section lists folder lines (`dir/: names`, working-set names marked `*`): each item's folder, then its parent, then the parent's other subfolders, while they fit under the profile's cap (300 tokens on claude, 150 on small-local, title line included). No paths, no workspace, or nothing fitting means no section.

Resolution rules:

- **Whole paths:** an exact workspace path with a folder in it, a diff `a/`/`b/` or `./` form, an absolute path ending in one, or a folder path with a slash in it.
- **Bare names and tails** (`bm25.ts`, `src/text.ts`, `docs/`): they resolve only when exactly one workspace file ends with them, and they count only when the same chat also writes out a whole path. A bare name is just as likely another project's file.
- **Dropped:** anything not in the list, or matching several files (`index.ts`, or `package.json` even though the root has one).

Without a workspace, memory packets are byte-identical to main: SHA-256 over all 2,047 dev and probe packet texts per profile (the 50 dev recall questions plus every empty-rate probe, tiers 1, 1t, 2, 3, 4 and answerable). This holds with no current session and with the history's last session as the current one.

## The set

Scorer: `evals/loop/working-set.ts` over `evals/sets/working-set/chats.json`. It has 60 hand-written coding chats about this repo at 58113b9, and the workspace is read from git at that commit. This repo has only 235 files, so the trees here are small and crowded folders are rare.

- **Split:** FNV-1a of `20261126:id`, with a third held out.
- **Gold:** the path the follow-up turn needs.
- **Listed paths not in the workspace:** read back from the section's text. This is 0 by construction, since only resolved paths are rendered. It checks the renderer, not the resolver.
- **"Near a named file"** is a mechanics check, not a test of judgment. Its gold is defined as within the tree's reach (the named file's folder, its parent, or the parent's other subfolders), so it shows the tree lists what it should and fits the cap.
- **Collision chats:** 15 chats about another project's files whose names exist here (`style.css`, `vite.config.ts`, `src/text.ts` and so on) were added after review. Before the whole-path rule, all 10 on dev got a section built from this repo.
- **Relabel:** the gold for `sib-estimate-from-run` was moved to `evals/src/model.ts`, where the price table lives.

## Dev

| group / profile | chats | gold in section | gold in working set alone | listed paths not in the workspace (0 by construction) | empty right | mean / max section tokens (n) | cap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| named earlier / claude | 7 | 71.4% (5/7) | 57.1% (4/7) | 0 of 206 | n/a | 186 / 260 (5) | 300 |
| named earlier / small-local | 7 | 71.4% (5/7) | 57.1% (4/7) | 0 of 157 | n/a | 136 / 146 (5) | 150 |
| near a named file / claude | 12 | 100.0% (13/13) | 0.0% (0/13) | 0 of 415 | n/a | 164 / 270 (12) | 300 |
| near a named file / small-local | 12 | 92.3% (12/13) | 0.0% (0/13) | 0 of 308 | n/a | 117 / 148 (12) | 150 |
| further away / claude | 2 | 0/2 | 0/2 | 0 of 97 | n/a | 237 / 260 (2) | 300 |
| further away / small-local | 2 | 0/2 | 0/2 | 0 of 56 | n/a | 142 / 148 (2) | 150 |
| should be empty: no paths, or paths not here / both | 10 | n/a | n/a | n/a | 100.0% (10/10) | 0 | |
| should be empty: another project's files / claude | 10 | n/a | n/a | n/a | 100.0% (10/10), was 0/10 | 0 | 300 |
| should be empty: another project's files / small-local | 10 | n/a | n/a | n/a | 100.0% (10/10), was 0/10 | 0 | 150 |

The whole-path rule costs 2 of 7 "named earlier" golds on dev, on both profiles: the chats that name only `bm25.ts` and only `core/src/resolver.ts`. Before it, both came back (7/7). No rule built from the code's own logic kept them and also kept the collision chats empty: the bare name in the first chat reads exactly like the collision chats. Anchoring on the repo's name would need a new input, and neither chat names the repo. So P20 **doesn't meet the keep bar as it stands**: no wrong inclusions, but named golds lost.

## Held-out (spent for P20)

Held-out has been run three times, and it is spent for P20: these numbers are a report, not for tuning.

| run | claude, near a named file | small-local, near a named file | named earlier | should be empty (both profiles) |
| --- | --- | --- | --- | --- |
| 1: first run | 9/9 | 8/9 | 1/1 | 3/3 |
| 2: after the `package.json` rule (made after reading a held-out miss) | 8/9 | 7/9 | 1/1 | 3/3 |
| 3: after the whole-path rule, frozen on dev | 8/9 | 7/9 | 1/1 | 3/3, collisions 5/5 |

The `package.json` rule cost `sib-root-tsconfig`, where the user did mean the root file. small-local's other held-out miss (`sib-arms-test`), like its dev miss (`sib-recall-test`), is the sibling `evals/test/` line cut by the 150-token cap. The "further away" golds (`evals/sets/code-pathline/prompts.json`, `docs/research/prefetch-survey/beyond-chat.md`, `.github/workflows/ci.yml`) are past depth 2 by design.

## Limits

- The same author wrote the chats and the resolver; held-out is small (19 chats).
- A whole path from another project that also exists here (`docs/plan.md`) still resolves. So does a diff of a root-level file (`a/README.md`).
- Coverage only shows the path is in the section. Whether a reader makes fewer find-file calls needs P14.
