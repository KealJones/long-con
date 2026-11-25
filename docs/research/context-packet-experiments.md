# Context packet experiments

Experiments that tested the core bet before this repo existed: can a model answer the newest message from a small packet as well as from the whole conversation? Full write-ups, data and grades are in [lm-experiments](https://github.com/KealJones/lm-experiments) ([site](https://kealjones.com/lm-experiments)).

## 1. Hand-built packets, frontier model: the idea holds

[context-packets](https://github.com/KealJones/lm-experiments/tree/main/experiments/context-packets), 2026-11-06.

A front layer read the whole chat and wrote a ~350-word packet (gist, what the vague words in the new message point to, only the facts that matter). A fresh model answered from just that packet.

- 16 test conversations: 8 messy (5,000 to 6,500 words, casual, three topics jumping around, each hiding a trap such as a fact changed in a throwaway line), 4 clean baselines, 4 "divide that by 3" follow-ups. Plus 6 hand-written noisy packets.
- Packet builders: Opus, Sonnet, Haiku, same prompt. Answerers: Opus and Haiku. One blind Opus grader per test.

| Answerer, and what it saw | Words seen (avg) | Tests 1-12 |
| --- | --- | --- |
| Opus, full history | 5,375 | 11/12 |
| Opus, Opus-built packet | 363 | 12/12 |
| Opus, Haiku-built packet | 358 | 11/12 |
| Haiku, full history | 5,375 | 11/12 |
| Haiku, Opus-built packet | 363 | 10/12 |

Takeaways:

- **The packet lost nothing that mattered,** at about 7% of the words. Every trap survived compression.
- **The front layer is where it breaks.** Failures behind a weaker builder's packet traced straight back to the packet: a hedge in the packet became a hedge in the answer. The answerer trusts the packet.
- **Junk in the packet barely mattered.** No model was fooled by noisy or wrong retrieval.

## 2. Automated packets, small model: the builder is the gap

[whiteboard](https://github.com/KealJones/lm-experiments/tree/main/experiments/whiteboard) and [notes-search](https://github.com/KealJones/lm-experiments/tree/main/experiments/notes-search), 2026-11-10 onward. LFM3 1.7B on llama.cpp, Squiggle's 4K window.

The packet was the last exchange plus the top lines of notes the model keeps itself, found by BM25, embeddings, a hybrid, or a model-written query. Retrieval over the raw chat had already failed: throwaway corrections share no words with the later question.

| Packet | Best run, tests 1-12 |
| --- | --- |
| Whole notes (over the 4K window) | 1/12 |
| BM25 on the raw message | 2/12 |
| Hybrid (BM25 + embeddings) | 3/9 |
| LFM3 writes the query, then BM25 | 2/12 |
| *Reference: LFM3 with the full chat* | *5/12* |
| *Reference: Opus-built packet (experiment 1)* | *12/12* |

What went wrong, across five runs (about $2.23 of GPU time):

- **Retrieval works** (milliseconds; embeddings found 59% of answer facts in noisy notes). **Note-taking doesn't.** The small model appends instead of changing a fact, so stale lines outnumber the correction ("Saturday the 14th" four times, "Sunday the 22nd" once).
- Prompt layout matters: putting notes in a tool result and edits in a tool call cut note-pass cost 4x and let a correction reach the answer, but the model still rarely edited and often replied in prose instead of calling the tool.
- Every small-model packet scored worse than giving the small model the whole chat.

## What this means for Long Con

- Frontier first. The idea works when the packet builder is strong.
- Don't ask a model to maintain prose notes. Keep the log lossless and make structure deterministic where possible: dialogue acts and registers tagged at write time, a harness-side resolver for "that", "go", "all that".
- Measure packet recall separately from answer quality, since the answerer trusts whatever the packet says.

## Context-packet playbook (summary)

A deep-research pass on building packets landed on the same direction:

- A harness-side deterministic resolver for references, rather than asking the model.
- Tag each turn's dialogue act when it's written.
- Registers for open loops, results, lists and rules.
- Threader-style views over user turns, assistant turns and whole turns, returning the answer rather than the question.

The full playbook wasn't carried into this repo; only this summary.
