# Prior art

## Research

- **Conversation disentanglement** is an established area, mostly built on IRC logs. The classic approach is link prediction ("what is this turn replying to?") followed by clustering into threads. Useful for linking a turn back to an older thread. [arXiv 2112.05346](https://arxiv.org/html/2112.05346v1)
- **Threader** (September 2026) is the closest match to the storage design. It keeps raw interactions as first-class memory, cuts them into topic-coherent segments with a tiny BERT that decides CONTINUE or SEGMENT per turn, and retrieves raw evidence at query time. It found LLM-rewritten memory gets lossy as chats grow and costs 2 to 21 times the input tokens to build. It doesn't link segments back to older threads; that part is Long Con's to build. [arXiv 2609.33226](https://arxiv.org/html/2609.33226)
- **Summary-only memory underperforms** on long-term conversation benchmarks. [ICLR 2025](https://proceedings.iclr.cc/paper_files/paper/2025/file/e56f394bbd4f0ec81393d767caa5a31b-Paper-Conference.pdf)

## Products

| Product | What it does | Where Long Con differs |
| --- | --- | --- |
| Dots (OpenAI) | Always-on agent with its own cloud computer | You still name or juggle threads; memory is held by the vendor |
| Grok Bot (xAI) | Always-on agents, a team of named bots | Managing named bots is still juggling; vendor-held memory |

**Long Con:** one thread forever that sorts itself, full-detail recall from a lossless log you own, and resurfacing of what you forgot.
