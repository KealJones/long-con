# Web chat

A bare-bones chat page on top of [`@long-con/core`](../../packages/core): one input box plus history. Every message gets a fresh packet built from the whole chat, and each turn's packet sits behind a toggle so you can see what the model was given.

- **Your key, your browser.** Paste an Anthropic API key in Settings. It's kept in this browser's localStorage and sent only to `api.anthropic.com`.
- **History stays local too,** in localStorage, as core's `Session` shape with one session per day so retrieved history carries dates.
- **Claude profile, always packets.** The profile's `switchAt` would send a short chat whole; here the packet is always used, since seeing it is the point. No search tool yet, so the packet doesn't mention one.

```sh
npm install
npm run dev -w @long-con/web     # local dev server
npm run build -w @long-con/web   # static site in apps/web/dist
```

Pushes to `main` that touch `apps/web` or `packages/core` deploy to GitHub Pages (`.github/workflows/pages.yml`).
