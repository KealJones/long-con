# History storage

Where the log lives, how it syncs, and how it's deleted and encrypted. Still open: the current options are in [open-questions.md](../open-questions.md#history-storage-and-encryption).

## The original plan: a git repo (superseded)

History synced to a GitHub repo you own, one writer per file: the client only appended to the log, and a background worker only wrote derived files (threads, links, labels). The appeal was memory you can read and diff.

Problems that came up:

- **Wrong home for regular users.** Non-developers don't have, or want, a GitHub repo for their chats.
- **Access is too broad.** The app would need repo access that reaches far more than one chat history.
- **Deletes are painful.** Removing something means rewriting git history.
- **Actions is slow.** Background jobs take minutes, so real-time sorting couldn't live there anyway.

The earlier lean, before this was rejected, was to encrypt on the device before pushing and delete by rewriting history.

## The direction now: a hosted service with accounts

A normal service with sign-in, where the log syncs and lookups hit a local copy, so speed isn't the point of the backend.

Leading option: its own backend on Cloudflare, with Workers for the API and D1 for storage. Deletes become row deletes.

Still to pick: encrypt on the device (only you can read it, the packet is built on the device, a lost password loses history) or on the server (server-side packet building and background features, recoverable accounts). Current lean: on the device.
