# Web chat

A bare-bones chat page on top of [`@beep/core`](../../packages/core): one input box plus history. Every message gets a fresh packet built from the whole chat, and each turn's packet sits behind a toggle so you can see what the model was given.

- **Your key, your browser.** Paste an Anthropic API key in Settings. It's kept in this browser's localStorage and sent only to `api.anthropic.com`.
- **History stays local too,** in localStorage, as core's `Session` shape with one session per day so retrieved history carries dates.
- **Claude profile, always packets.** The profile's `switchAt` would send a short chat whole; here the packet is always used, since seeing it is the point. The profile's last 6 turns of today go along word for word after it, and each packet chip says how many did. Otherwise it runs exactly the claude profile the evals run, embedding veto included: potion-base-8M is fetched from Hugging Face at the revision the evals pin, checked against the same sha256 sums, and a send waits for it. The "best guess" trust note is off in that profile.
- **Tools, like Squiggle's.** A `bash` tool on [just-bash](https://github.com/vercel-labs/just-bash) (cat, grep, sed, awk, jq, pipes and the rest), with Squiggle's custom commands `curl`, `wiki`, `node`, `bc` and `man`. `/home` is kept in this browser between chats; `/tmp` lives for the page. Beside it: `search_history` (core's search, the same one the packet uses) and Anthropic's own `web_search` and `web_fetch`, which reach sites that turn a browser's `curl` away. No `git` or `gh` yet. Each answer shows its tool calls behind a toggle.
- **Saves to GitHub, like Squiggle.** Sign in with GitHub in Settings (device flow through Squiggle's relay and GitHub App: one tap copies the code and opens GitHub). It then finds your chats repo on its own (one with its `.beep.json` marker, else one named like `beep-chats`), or makes `beep-chats`, or lets you pick one; public repos are refused. After every message it commits `days/<date>.md` (the day as you'd read it, with each packet and the tool calls) and `turns/<date>/<n>.json` (the exact packet, model, tool calls and answer). Deleting here doesn't delete from the repo.

```sh
npm install
npm run dev -w @beep/web     # local dev server
npm run build -w @beep/web   # static site in apps/web/dist
```

Pushes to `main` that touch `apps/web` or `packages/core` deploy to GitHub Pages through the `gh-pages` branch (`.github/workflows/pages.yml`). Every pull request gets a preview at `kealjones.com/beep/pr-preview/pr-<number>/`, linked in a PR comment and removed on close (`pr-preview.yml`), and `ci.yml` typechecks, tests and builds it.
