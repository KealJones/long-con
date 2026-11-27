# Web chat

A bare-bones chat page on top of [`@long-con/core`](../../packages/core): one input box plus history. Every message gets a fresh packet built from the whole chat, and each turn's packet sits behind a toggle so you can see what the model was given.

- **Your key, your browser.** Paste an Anthropic API key in Settings. It's kept in this browser's localStorage and sent only to `api.anthropic.com`.
- **History stays local too,** in localStorage, as core's `Session` shape with one session per day so retrieved history carries dates.
- **Claude profile, always packets.** The profile's `switchAt` would send a short chat whole; here the packet is always used, since seeing it is the point.
- **Tools, like Squiggle's.** A `bash` tool on [just-bash](https://github.com/vercel-labs/just-bash) (cat, grep, sed, awk, jq, pipes and the rest), with Squiggle's custom commands `curl`, `wiki`, `node`, `bc` and `man`. `/home` is kept in this browser between chats; `/tmp` lives for the page. Beside it: `search_history` (core's search, the same one the packet uses) and Anthropic's own `web_search` and `web_fetch`, which reach sites that turn a browser's `curl` away. No `git` or `gh` yet. Each answer shows its tool calls behind a toggle.

```sh
npm install
npm run dev -w @long-con/web     # local dev server
npm run build -w @long-con/web   # static site in apps/web/dist
```

Pushes to `main` that touch `apps/web` or `packages/core` deploy to GitHub Pages through the `gh-pages` branch (`.github/workflows/pages.yml`). Every pull request gets a preview at `kealjones.com/long-con/pr-preview/pr-<number>/`, linked in a PR comment and removed on close (`pr-preview.yml`), and `ci.yml` typechecks, tests and builds it.
