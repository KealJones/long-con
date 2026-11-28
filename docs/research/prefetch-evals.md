# New eval sets for prefetch

The current free eval asks one question: is the evidence for a LongMemEval question inside the packet? That measures recall on chat memory and nothing else. It can't see a packet that pulls in junk, a turn that should have gotten nothing, a file line, a fetched page, or the work a packet saves an agent. These sets fill those gaps. Every one is built and scored on plan usage (subagents and `claude -p`) or with no model at all. No paid API calls.

Written 2026-11-26. Survey: [prefetch-survey.md](prefetch-survey.md). Backlog: [prefetch-ideas-ranked.md](prefetch-ideas-ranked.md).

## Rules for every set

- **Dev and held-out from day one.** Each set is split by a fixed seed when it's built. The hourly loop tunes on dev only. Held-out is scored at milestones and never inspected.
- **Both profiles.** Every set runs at the `claude` and `small-local` profile settings, since the right threshold and budget differ.
- **Gold is fixed before the builder runs.** Labels come from how the case was made (a planted fact, a known line), checked by a subagent that never sees a packet.
- **Precision is reported next to recall.** Recall without the false-inclusion rate rewards stuffing.
- **Frozen inputs.** Repos are pinned to a commit. Fetched pages are saved as fixtures, so a site changing never moves a score.

## Metrics added to the recall check

| Metric | Meaning | Good direction |
| --- | --- | --- |
| Empty-packet rate on should-be-empty prompts | Share of those prompts where the builder retrieved nothing | Up |
| False inclusions per prompt | Retrieved units with no gold relevance, averaged | Down |
| Packet precision | Share of retrieved units (or tokens) that are gold-relevant | Up |
| Selective risk at coverage | Rank prompts by the builder's own confidence; at each coverage level, the share of included packets that are wrong. Summarized as the area under that curve (AURC) | Down |
| Wasted tokens | Packet tokens on prompts whose gold is empty | Down |
| Source precision and recall | For multi-source prompts: did the packet draw from the right sources (chat, file, URL, people card, none)? | Up |

The existing all-evidence recall stays the headline for answerable prompts. A change is kept only if it raises recall or cuts tokens **without raising false inclusions** on the empty set.

## 1. Should be empty

The set the plan's trick set gestures at, built at scale. Each prompt has gold "nothing relevant in history". Built on the existing LongMemEval_S dev haystacks so no new histories are needed: for each dev question's history, a subagent writes prompts in five families, and a second subagent checks the BM25 top 20 for that history and confirms none answers the prompt.

| Family | Example | Trap |
| --- | --- | --- |
| General knowledge | "What's the boiling point of ethanol?" | Any match is a false inclusion |
| New topic | "Help me plan a garden" in a history with no gardening | Common words ("plan", "help") match everything |
| Lexical trap | History has "Python the snake at the zoo"; prompt asks about Python scripts | Rare shared word, different meaning |
| Near miss | History has the sister's dog; prompt asks about the brother's dog | Right topic, wrong person |
| Small talk and acks | "thanks", "lol ok", "sounds good" | The gate should skip these outright |

Size: 300 prompts (60 per family), split 150 dev and 150 held-out. Paired with the 47 answerable dev questions, this gives the selective-risk curve: one threshold setting, two numbers (recall on answerable, empty rate on empty).

LongMemEval's own `_abs` abstention questions count too, but only the 3 in the dev slice. The rest sit in held-out.

## 2. Code path:line

Gold is a file and a line span. Built from pinned public repos: this repo first, then KealJones/squiggle, then any other public repo of the user's.

1. A script lists every exported function, class and top-level constant with its file and line span (a regex per language to start; tree-sitter later).
2. A subagent writes three questions per symbol: one that names it ("where is `buildPacket` defined?"), one that describes it in plain words ("where does the packet drop weak matches?"), and one sloppy one ("the thing that throws out low scores, where's that").
3. Gold: the symbol's file and span. A packet item hits if it includes an overlapping span.

| Metric | Why |
| --- | --- |
| File recall @packet | The cheap part; ContextBench puts file recall around 0.7 |
| Block hit | The enclosing function or block is in the packet |
| Line exactness | When a quoted line is claimed, is it the right line? Only allowed with proof (typed path:line or exact symbol) |
| Wrong-line rate | Quoted lines that are wrong. Must stay at zero |
| Tokens | Repo context is expensive; whole blocks plus pointers should stay small |

About 150 symbols across two repos gives 450 questions. Free to build and score.

## 3. Non-memory prompts

Prompts where the best context isn't in chat history: a pasted URL, a file the user named, an unknown entity, a family or advice question with a people card, a plan that depends on today's date. Each case is a small fixture: a short history, a workspace (a few files, saved pages, a people card), and a prompt. Gold is the set of sources that should contribute, which can be empty.

| Case type | Gold source |
| --- | --- |
| "What does this page say about rate limits? https://…" | The saved page, the rate-limit section |
| "Why does `npm test` fail?" with an error pasted | The file and line the error names |
| "Should I go to my cousin's wedding or the conference?" | People card for the cousin, calendar facts, past related turns |
| "What's Bricolage Grotesque?" | None from history; a web lookup is the model's call |
| "Remind me what we decided about storage" | Chat history, decision turns |

Scored on source precision and recall, false inclusions and tokens. 100 cases, half dev. Built by subagents from templates, then hand-checked once by a person, since source labels are judgment calls.

## 4. URL prefetch

Tests the URL-to-file feature in [prefetch-survey.md](prefetch-survey.md#url-prefetch-to-a-file-with-a-line-range). Fixtures are saved HTML pages under open licenses (Wikipedia and MDN, which are CC BY-SA, plus open-source project docs and READMEs), stored with the URL they came from.

Each case: a page, a recent topic (the last few turns), a new message with the URL, and gold: the heading and line range of the section that answers it, or "abstain".

| Case type | Expected |
| --- | --- |
| Clear answer in one section | Path, that section's range, short excerpt |
| Answer split over two sections | Both ranges, or the higher one plus the section map |
| Page off topic for the conversation | Path and section map only, no excerpt |
| 404, error page, paywall stub, login wall | One line saying the fetch failed. Never the error page as content |
| Script-only page with an empty body | Same as a failure, or a rendered fallback if one ran |
| Page with heavy navigation and link lists | Extraction keeps the article text only |

Metrics: extraction noise (share of saved text that is navigation, footer or link lists, judged against a hand-marked main region), section hit at 1, line-range overlap (intersection over union with gold), abstain accuracy, excerpt tokens. 80 pages, half dev. Free.

## 5. Work saved, paired with and without the packet

The one-to-one test: the same task, the same agent, run twice, once with the packet and once without, counting the work each run does. It shows what the packet actually saves and where it hurts.

### Scenarios

| Scenario | Setup | What it shows |
| --- | --- | --- |
| **A. Found by prefetch** | The needed fact or location exists only in a file or a URL. The chat never mentioned it. The packet found it (file line, page section) | Pure prefetch value: does a head start save reads and searches? |
| **B. Stale read** | The chat discussed the file earlier and the agent read it then, but that read has gone stale. Three variants: B1 the file changed since the read; B2 the read is outside the raw-turn window (and outside the packet-off arm's context); B3 the read was compacted away | Whether the packet's fresh re-read beats an old read or a summary of it. B1 also catches a packet that serves stale lines |
| **C. Control, should be empty** | Nothing in history, files or URLs helps. The packet should be empty | Harm: a packet that pulls in look-alike junk slows or misleads the agent |

### Building tasks from real repos, cheaply

1. Pin a public repo at a commit (this repo, KealJones/squiggle, other public repos of the user's).
2. For **A**: pick a symbol or config value from the code-path set. A subagent writes a task whose answer depends on it ("what's the small profile's packet ceiling, and where is it set?", or a one-line change to make) plus a deterministic check (an expected string, or a grep that passes after the right edit). The synthetic chat history before the task is about something nearby and never names the file.
3. For **B**: the synthetic history includes the earlier discussion and the agent's earlier read of the file. B1 then applies a commit that moves or changes the code before the task. B2 places the read far enough back to fall out of the raw window. B3 replaces the read with a compaction summary.
4. For **C**: tasks about things absent from the repo and the history ("what's the capital of Peru?", "explain CRDTs briefly"), checked by keyword.
5. Freeze each task as a folder: repo commit, history file, final message, check script, gold answer.

Start with 10 tasks per scenario (50 counting B's three variants), one repeat, and grow once the harness is stable.

### Running

- **Agent (superseded):** the harness must drive Beep's own agent loop, not `claude -p`, since every entry point runs the same code; see [agent-benchmarks.md](agent-benchmarks.md#same-code-as-the-product). Original plan: `claude -p` on a Claude plan (Claude Code in non-interactive mode), with stream-JSON output, so every tool call and token count is logged. One run per arm, in a fresh temp checkout.
- **Tools:** Read, Grep, Glob, Edit, Write, Bash (read-only commands for answer tasks), and WebFetch for URL tasks through a record-and-replay cache, so both arms see byte-identical pages.
- **Packet arm:** the packet built for the final message, injected as a block before the message. **No-packet arm:** the left-out-history notice only.

### Fairness rules

- Same model and version, same system prompt except the packet block, same tools and permissions, same turn and time caps.
- Same repo commit, fresh checkout per run, no shared caches between arms.
- Arm order alternates per task (packet first on odd tasks), so warm caches or rate limits don't favor one side.
- Fixed task order and seed. Repeats are full reruns, never resumed.
- Deterministic checks decide correctness where they exist. Otherwise a blind judge (a separate subagent) grades the final answer against gold with the transcript scrubbed of anything that names the arm or the packet.
- Tasks are split dev and held-out when frozen. The loop tunes on dev only.
- Results are paired: per task, packet minus no-packet, with a bootstrap 95% interval and a sign test. A win needs the interval to clear zero.

### What's measured, per run

| Measure | From |
| --- | --- |
| Correct (check or blind judge) | Check script, judge |
| Tool calls by kind: reads, greps, globs, edits, writes, shell, fetches | Stream log |
| Bytes and lines read | Read results |
| Turns until the final answer | Stream log |
| Input, output and cache tokens | Stream log usage |
| Wall time, and time to the first correct tool call | Timestamps |
| Re-fetches of what the packet already held | Reads of a path:range the packet included |
| Harm | Pass without packet, fail with it |

Headline per scenario: paired correctness change, tool calls saved, tokens saved and wall time saved. Scenario C's headline is harm rate and extra tool calls, which should both be zero.

Cost: each agent run is roughly 20K to 60K tokens of plan usage. 50 tasks times two arms is about 100 runs per pass, so it runs nightly, not hourly.
