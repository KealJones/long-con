# Open questions

Each has a current lean. None is settled until it moves to [decisions.md](decisions.md).

## History storage and encryption

GitHub storage is out for regular users. The replacement is a normal hosted service with accounts. Leading option: its own backend on Cloudflare (Workers plus D1), where deleting history is a row delete rather than a git history rewrite. Lookups hit a local copy either way, so the backend is about sync, accounts and deletes, not speed.

Where encryption happens is the real choice:

| | Encrypt on the device | Encrypt on the server |
| --- | --- | --- |
| Who can read history | Only you | The service, under its keys |
| Where the packet is built | On the device (the server only sees ciphertext) | On the server, close to the model call |
| Lost password | Lost history | Recoverable |
| Server-side features (background sorting, welcome-back) | Harder: needs the device online, or a key you hand over | Straightforward |

Lean: on the device. Pending a pick. Background in [research/history-storage.md](research/history-storage.md).

## Topic window vs fully fresh packet

Keep a small window of the current topic's recent turns, or build a fully fresh packet every turn? Lean: keep a small one, and eval both.

## Voice in v1

Read-aloud and dictation, with live status (heard, thinking, working). Lean: no, add it later.

## Eval data

Request a real chat export so the evals run on real history.

## Scoring spec

What counts as a pass for each canary and test. Written by a person, not by the model that builds the packet.

## Model keys and providers

Which sign-in and key paths ship first, and which free providers to offer. See [research/model-providers.md](research/model-providers.md).

## Tagline

Still needed.
