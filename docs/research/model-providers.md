# Model providers and keys

Notes from mid-November 2026. Nothing here is verified against official pages yet (see the last section).

## Runtime roles

- **Front model:** a strong conversational model with general tools. The one you talk to.
- **Picker:** the same provider's cheap model (Haiku, Flash and the like) that grabs missing context each turn, racing the front model. A small local model as picker is a later experiment, probably too slow for now.

## Paths

- **Bring your own key** is always an option. Claude and ChatGPT are the main path. For Claude that means a Console API key or OpenRouter; there is no "sign in with Claude" for third-party apps.
- **OpenRouter** offers one-click sign-in with no pasted key. Filter out routes that train on your data.
- **Free paths,** for people without a key:
  - Groq: a candidate default free path (gpt-oss-120b as front, gpt-oss-20b as picker).
  - Cloudflare Workers AI.
  - Gemini, behind a privacy warning, since free tiers often train on what you send.
- The provider list lives in config, with a fallback chain.
- **Out:** GitHub Models, retired on 2026-07-30.

## Key safety

- The key never goes in synced history.
- Only one module can touch it.
- No third-party scripts, plus a strict Content Security Policy.
- Recommend a dedicated key with a spend cap.

## Later ideas

- Beep as a Claude.ai connector (v2).

## To verify before building on any of this

- OpenRouter's sign-in flow.
- Groq and Gemini free-tier terms, including training on inputs.
- Which providers allow calls straight from a browser.
- Anthropic's terms on third-party app sign-in.
