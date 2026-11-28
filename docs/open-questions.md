# Open questions

Each has a current lean. None is settled until it moves to [decisions.md](decisions.md).

## History storage and encryption

Storage is either/or: GitHub sync (built in the web app) for people who want history in a repo they own, and a hosted service with accounts for everyone else. Leading option: its own backend on Cloudflare (Workers plus D1), where deleting history is a row delete rather than a git history rewrite. Lookups hit a local copy either way, so the backend is about sync, accounts and deletes, not speed.

Where encryption happens is the real choice:

| | Encrypt on the device | Encrypt on the server |
| --- | --- | --- |
| Who can read history | Only you | The service, under its keys |
| Where the packet is built | On the device (the server only sees ciphertext) | On the server, close to the model call |
| Lost password | Lost history | Recoverable |
| Server-side features (background sorting, welcome-back) | Harder: needs the device online, or a key you hand over | Straightforward |

Lean: on the device. Pending a pick. Background in [research/history-storage.md](research/history-storage.md).

## Topic window vs fully fresh packet

The last few turns always ride along raw, with the count set per model profile (it can be zero). The web app now widens that window back over earlier turns that share words with it, up to 2K tokens (`topicTokens`). Still open: whether that beats the fixed window. LongMemEval can't say, since its question always comes in a fresh session, so it waits on the pain-mined set.

## Sticky packets

Could the packet itself be mostly cacheable? Items retrieved on earlier turns keep their place, in time order, across turns. New items are appended at the end, and items drop only when the topic changes. Then most of the packet is an unchanged prefix, which saves cost on Claude and prefill time on local models. The tradeoffs: stale items ride along longer, and the budget fills faster. Not decided; worth testing once the basic packet works.

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
