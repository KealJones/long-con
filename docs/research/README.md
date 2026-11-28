# Research

| Doc | What's in it |
| --- | --- |
| [context-packet-experiments.md](context-packet-experiments.md) | The experiments behind the core bet: 12/12 with hand-built packets, 1-3/12 with automated small-model packets |
| [prior-art.md](prior-art.md) | Who has tried per-turn context rebuilding: papers, products, open source, reference resolution, and why weak retrieval results look like weak retrievers |
| [threader.md](threader.md) | Threader's retrieval end to end, its ablations, what to copy, and where it agrees or disagrees with Long Con's design |
| [memory-benchmarks.md](memory-benchmarks.md) | Long-term memory benchmarks to beat with one message and a packet, top scores, and which to target first |
| [prefetch.md](prefetch.md) | Doing the model's lookups before it asks: speculative tools, file and line prefetch, compression, reference resolution, names, benchmarks and work-saved metrics, and challenges to the plan |
| [prefetch-survey.md](prefetch-survey.md) | Every way the packet can prefetch, by area and by kind of prompt, with cost, browser and Cloudflare fit and expected gain per profile; Squiggle prior art; URL-to-file design; the abstention gate. Evidence in [prefetch-survey/](prefetch-survey/) |
| [prefetch-ideas-ranked.md](prefetch-ideas-ranked.md) | The ranked, testable backlog the packet R&D loop works from |
| [prefetch-evals.md](prefetch-evals.md) | New eval sets: should be empty, code path:line, non-memory prompts, URL prefetch, and the paired work-saved eval |
| [agent-benchmarks.md](agent-benchmarks.md) | Public coding-agent, code-search and web-lookup benchmarks for the packet: three to pull down (ContextBench, SWE-QA-Pro, BrowseComp-Plus), how to report zero-tool solves, costs, and what was skipped |
| [model-providers.md](model-providers.md) | Front model and picker, key paths, free providers, key safety |
| [history-storage.md](history-storage.md) | Why git storage was dropped, and the hosted-service options |
| [feature-ideas.md](feature-ideas.md) | Brainstormed features, what's carried into the plan, what's superseded |
| [packet-critique.md](packet-critique.md) | Fable 5.2, Opus 5.5 and Haiku 5.5 critique real packets as small and large readers: agreements, disagreements, builder bugs, ranked changes and evals, raw reviews attached |
| [people.md](people.md) | What to remember about a person, which personality frameworks hold up, how accurately people and LLMs read others, personal CRM data models and cadence, sales evidence, privacy, and ranked takeaways for people cards and interest notes. Evidence in [people/](people/) |
| [novel-memory-designs.md](novel-memory-designs.md) | 19 memory designs from five inventor-style agents, each checked against prior art: two survivors (silenced-aside pool, frame-swap admission test), near misses with the closest work named, and what was dropped |
