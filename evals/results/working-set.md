# Working set plus depth-2 tree (P20)

`buildPacket` takes an optional `workspace`: the caller's file paths, relative to the workspace root. Paths in the message and the current session's latest turns (20 on claude, 8 on small-local) are resolved against it: exact paths, diff `a/`/`b/` prefixes, `./` and absolute paths, partial paths and bare names that exactly one file ends with, and folders with a slash. Anything that doesn't resolve, or resolves to several files (`index.ts`, `package.json` in a monorepo), is dropped. The section lists folder lines (`dir/: names`, working-set names marked `*`): each item's folder, then its parent, then the parent's other subfolders, while they fit under the profile's cap (300 tokens on claude, 150 on small-local, title line included). No paths, no workspace, or nothing fitting means no section.

Without a workspace, memory packets are byte-identical: SHA-256 over all 2,047 dev and probe packet texts per profile (50 dev recall questions plus every empty-rate probe, tiers 1, 1t, 2, 3, 4 and answerable) matched main 58113b9 on both profiles.

Scorer: `evals/loop/working-set.ts` over `evals/sets/working-set/chats.json`: 45 hand-written coding chats about this repo at 58113b9, with the workspace read from git at that commit. Split by FNV-1a of `20261126:id`, a third held out. Gold is the path the follow-up turn needs; false paths are paths the section names that aren't in the workspace, read back from the section's text.

| group / profile / split | chats | gold in section | gold in working set alone | false paths (of listed) | empty right | mean / max section tokens (n) | cap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| named earlier / claude / dev | 7 | 100.0% (7/7) | 85.7% (6/7) | 0.0% (0/264) | n/a | 170 / 260 (7) | 300 |
| named earlier / small-local / dev | 7 | 100.0% (7/7) | 85.7% (6/7) | 0.0% (0/215) | n/a | 135 / 146 (7) | 150 |
| near a named file / claude / dev | 12 | 100.0% (13/13) | 0.0% (0/13) | 0.0% (0/415) | n/a | 164 / 270 (12) | 300 |
| near a named file / small-local / dev | 12 | 92.3% (12/13) | 0.0% (0/13) | 0.0% (0/308) | n/a | 117 / 148 (12) | 150 |
| further away / claude / dev | 2 | 0.0% (0/2) | 0.0% (0/2) | 0.0% (0/97) | n/a | 237 / 260 (2) | 300 |
| further away / small-local / dev | 2 | 0.0% (0/2) | 0.0% (0/2) | 0.0% (0/56) | n/a | 142 / 148 (2) | 150 |
| should be empty / claude / dev | 10 | n/a | n/a | n/a | 100.0% (10/10) | 0 / 0 (0) | 300 |
| should be empty / small-local / dev | 10 | n/a | n/a | n/a | 100.0% (10/10) | 0 / 0 (0) | 150 |
| named earlier / claude / held-out | 1 | 100.0% (1/1) | 100.0% (1/1) | 0.0% (0/29) | n/a | 131 / 131 (1) | 300 |
| named earlier / small-local / held-out | 1 | 100.0% (1/1) | 100.0% (1/1) | 0.0% (0/29) | n/a | 131 / 131 (1) | 150 |
| near a named file / claude / held-out | 9 | 88.9% (8/9) | 0.0% (0/9) | 0.0% (0/272) | n/a | 155 / 260 (8) | 300 |
| near a named file / small-local / held-out | 9 | 77.8% (7/9) | 0.0% (0/9) | 0.0% (0/223) | n/a | 124 / 137 (8) | 150 |
| further away / claude / held-out | 1 | 0.0% (0/1) | 0.0% (0/1) | n/a | n/a | 0 / 0 (0) | 300 |
| further away / small-local / held-out | 1 | 0.0% (0/1) | 0.0% (0/1) | n/a | n/a | 0 / 0 (0) | 150 |
| should be empty / claude / held-out | 3 | n/a | n/a | n/a | 100.0% (3/3) | 0 / 0 (0) | 300 |
| should be empty / small-local / held-out | 3 | n/a | n/a | n/a | 100.0% (3/3) | 0 / 0 (0) | 150 |

Reading it:

- The tree is what does the work: the working set alone holds none of the "near a named file" golds (sibling tests, the stemmer's file, a package manifest, the Vite config).
- small-local's 150-token cap drops the sibling `evals/test/` line after `evals/src/` and `evals/` (recall and arms tests). No cap was swept.
- "Further away" golds (`evals/sets/code-pathline/prompts.json`, `docs/research/prefetch-survey/beyond-chat.md`, `.github/workflows/ci.yml`) are past depth 2 by design.
- Held-out was run once, then one rule changed after reading a held-out miss: a bare name that matches the root file and others (`package.json`) now resolves to nothing, root included. Dev didn't move; held-out lost `sib-root-tsconfig` (the user did mean the root file), and `sib-ci-workflow`'s bare `README.md` no longer makes a root-only section. Held-out is used now and shouldn't be tuned against.
- The same author wrote the chats and the resolver; held-out is small (14 chats). This measures coverage and exactness, not whether a reader makes fewer find-file calls (P14).
- Known limit: a bare name that's unique here (`text.ts`) resolves even if the user meant another project's file. It's a real path, so it isn't a false path, but it can be the wrong one.
