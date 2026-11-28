# Web chat

A bare-bones chat page on top of [`@beep/core`](../../packages/core): one input box plus history. Every message gets a fresh packet built from the whole chat, and each turn's packet sits behind a toggle so you can see what the model was given.

- **Your key, your browser.** Paste an Anthropic API key in Settings. It's kept in this browser's localStorage and sent only to `api.anthropic.com`.
- **History stays local too,** in localStorage, as core's `Session` shape with one session per day so retrieved history carries dates.
- **Claude profile, always packets.** The profile's `switchAt` would send a short chat whole; here the packet is always used, since seeing it is the point. No search tool yet, so the packet doesn't mention one.

```sh
npm install
npm run dev -w @beep/web     # local dev server
npm run build -w @beep/web   # static site in apps/web/dist
```

Pushes to `main` that touch `apps/web` or `packages/core` deploy to GitHub Pages through the `gh-pages` branch (`.github/workflows/pages.yml`). Every pull request gets a preview at `kealjones.com/beep/pr-preview/pr-<number>/`, linked in a PR comment and removed on close (`pr-preview.yml`), and `ci.yml` typechecks, tests and builds it.
