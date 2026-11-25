# Front ends

Each app is a thin face on [`@long-con/core`](../packages/core). No app holds logic another app would need; that goes in the core.

| App | State | Notes |
| --- | --- | --- |
| [`cli`](cli) | started | First, because phase 1 is evals. Later also a plain terminal chat. |
| `web` | planned | The first real chat screen. A web app also covers the Mac and phones. |
| `mac` | maybe | Only if the web app hits a wall. |

A front end with its own toolchain (for example a native Mac app) may live in its own repo and depend on the core instead of sitting here.

## The chat screen, for any front end

- One input box plus history. Nothing else is required.
- Optional sidebar: in play now, projects, open loops. Archived stays hidden behind a toggle.
- Side threads for tangents, never suggested.
- A welcome-back message after a long gap, with one wildcard thread you might have forgotten.
- Short status lines while it works. It never blocks you.

Details in [docs/architecture.md](../docs/architecture.md#chat-screen).
