# Prefetch survey: every way the packet can help, and when it should stay empty

Researched 2026-11-26. This doc is the map. The five appendices in [prefetch-survey/](prefetch-survey/) hold the evidence, sources and per-technique numbers. The ranked, testable backlog the hourly loop works from is [prefetch-ideas-ranked.md](prefetch-ideas-ranked.md). The new eval sets are in [prefetch-evals.md](prefetch-evals.md). It extends [prefetch.md](prefetch.md) and doesn't repeat it.

**New to search?** The visual explainer walks through keyword search, embeddings, fusion, reranking, query rewriting and abstention with a playground you can type into: [How search finds things](https://claude.ai/artifact/4YF5XZ1EeBqArRUaWP1dgE).

**Nothing here is measured yet.** The LongMemEval data couldn't be downloaded in this session (the proxy refused huggingface.co), so every "expected gain" below is a hypothesis drawn from papers and from the dev numbers already in [the recall results](../../evals/results/longmemeval-s-dev50-recall.md). The backlog turns each one into a measurement.

## The principle

For any prompt (code, a pasted URL, a file path, a family question, small talk) the builder asks: is there something I can look up now, cheaply and deterministically, that the model would otherwise have to go and find? If yes, the packet carries it, as a pointer the model can verify (`path:line`, a URL and a section, a dated chat turn). If not, or if the builder isn't sure, the packet carries nothing.

**An empty packet is a correct answer.** Wrong context costs more than none, and costs small models the most: in one study a small model's wrong-answer rate went from 10% to 66% when given insufficient context, and a random user's profile scored below no profile at all (LaMP-QA 0.468 to 0.374). So every technique below is judged on two numbers, recall on prompts that have an answer and the empty rate on prompts that don't.

## Top findings

1. **Today's builder can't return an empty packet.** The cutoff is relative (score ÷ top score ≥ 0.3), so once any word matches, the top unit always goes in. The gate only skips messages with no content words. Measuring how often it fills packets that should be empty is the first job, then an absolute gate (below).
2. **Keyword search already finds the evidence; ordering is the weak part.** BM25 is close to the ceiling for candidates on LongMemEval_S. What moves recall is a reranker that pulls gold from deep in the list (SmartSearch: rank 47 to rank 2), plus making the index smarter at write time. Tiny rerankers can hurt (MiniLM did on LoCoMo), so the reranker arm needs a control.
3. **The cheapest wins happen at write time, not per turn.** A contextual prefix on each segment (date, topic, the session's opening question), extracted fact keys and predicted questions are indexed but never shown. Papers report −49% retrieval failures (contextual retrieval) and +5-9% recall (fact keys). Zero query-time cost, which matters most for small-local.
4. **Semantic search fixes paraphrase and preference, but always returns something.** A dense channel needs its own absolute floor and should never fill an otherwise empty packet. Score per message (max-sim), not one vector per segment. Brute-force binary vectors are fast enough (100K×384 at 1 bit scanned in 2.4 ms), so no vector database is needed.
5. **The weak question types each have a deterministic fix.** Counting questions want a tally (one best sentence per session, deduplicated). Temporal questions want event dates parsed at write time and the arithmetic done by code. Preference questions want first-person preference spans keyed by category.
6. **Beyond chat, exact pointers beat fuzzy search.** A literal identifier that resolves to one definition in a symbol index is a proven `path:line`. A pasted URL becomes a saved file plus the section that matches the topic. Squiggle already does most of the extraction.
7. **Personal and advice turns want dated episodes and people cards, not profile summaries.** Profiles raised agreement sycophancy by about a third for Claude Sonnet 4 in personal advice; raw past conversations barely did.

## Techniques by area

Gain columns are expected, not measured: **H**igh, **M**edium, **L**ow, **—** none or not applicable. "Browser" means it runs in the small-local profile's tab beside LFM3; "CF" means a Cloudflare Worker, D1, Vectorize or Workers AI.

### Finding candidates ([lexical-and-semantic.md](prefetch-survey/lexical-and-semantic.md))

| Technique | In plain English | What it adds | Cost per turn | Browser | CF | claude | small |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BM25 (current) | Count rare shared words, discount long text | Exact names, numbers, terms | <1 ms | Yes | Yes | baseline | baseline |
| Stemming, BM25F fields, k1/b tuning | "running" matches "run"; weigh user words in one ranking | Small recall | ~0 | Yes | Yes | L | L |
| Trigram / phonetic channel | Match misspellings and odd names by letter chunks | Misnamed entities | ~1 ms | Yes | Yes | L | L-M |
| Dense embeddings, message-level max-sim | Turn text into a meaning vector; near vectors mean similar meaning | Paraphrase, preference | 5-30 ms (transformer), ~1 ms (static) | Yes | Workers AI | M | M |
| Static embedder (Model2Vec potion) | A lookup table of word vectors, averaged | Most of dense's gain, no GPU | ~1 ms | Yes | Yes | L | M |
| Binary vectors, brute force | 1 bit per dimension, scan everything, rescore the top 50 | Dense without a vector DB | 2-3 ms per 100K | Yes | Yes | — (enabler) | — (enabler) |
| Doc-only learned sparse (SPLADE-style) | Precomputed expanded word weights per segment | Paraphrase, keeps exact zeros | 0 at query time | Index only | Yes | L-M | L-M |
| Late interaction (ColBERT) | Compare every query word with every text word | Fine matching | Heavy | Poor | Poor | L | — |

### Ordering and choosing ([fusion-rerank-and-query.md](prefetch-survey/fusion-rerank-and-query.md))

| Technique | In plain English | What it adds | Cost per turn | Browser | CF | claude | small |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RRF (current, k=60) | Merge rankings by position, not raw score | Robust merge | ~0 | Yes | Yes | baseline | baseline |
| RRF k sweep, weighted RRF, score fusion | Tune how rankings combine | 0-2 pp | ~0 | Yes | Yes | L | L |
| Cross-encoder rerank of top 40-60 | A small model reads query and text together and scores relevance | Gold moves up; a calibrated probability | Tens of ms (CF), 0.1-3 s (browser, estimate) | WebGPU or WASM | bge-reranker-base | M | H |
| Rule pseudo-relevance feedback | Re-search with words shared by the top hits | +2-6 pp, temporal and multi-session | ~1 ms | Yes | Yes | M | M |
| Time-range boost | Parse "last spring", boost segments in range | Temporal | ~1 ms | Yes | Yes | M | M |
| Contextual prefix (deterministic) | Prepend date, topic and opening question to indexed text | Multi-session | 0 (index time) | Yes | Yes | M | M |
| Fact keys and predicted questions | Index short facts and likely questions per segment | +5-9% recall | 0 at query time; a model at write time | Idle LFM3 | Queue job | M | H |
| Alternate phrasing without a model | Alias table, synonym lists, PRF | Paraphrase | ~0 | Yes | Yes | L | L-M |
| HyDE, query2doc, multi-query | A model writes a fake answer or rewrites the query, then search | Weak once reranked | 1 model call | No | Possible | L | — |
| Key denoising (SeCom) | Strip filler from indexed text, render the original | +1-3 pp lexical, more for dense | 0 at query time | Yes | Yes | L | L-M |
| Listwise LLM rerank | A big model reorders the list | Too slow | Seconds | No | No | — | — |

### Structure and memory ([memory-and-graphs.md](prefetch-survey/memory-and-graphs.md))

| Technique | In plain English | What it adds | Cost per turn | Browser | CF | claude | small |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Tally mode | "How many" questions get one dated sentence per session | Multi-session counts | ~1 ms | Yes | Yes | M-H | H |
| Event-date index (chrono-node) | Resolve "last Tuesday" to a date when written | Temporal | 0 at query time | Yes | Yes | M | M |
| Prefetched date arithmetic | Label items "23 days before today" | Temporal answers | ~0 | Yes | Yes | L-M | M |
| Preference spans | Mark "I love / prefer / hate" sentences with a category | Preference | ~0 | Yes | Yes | M | H |
| Subject index and person cards | Alias table of people pointing at their mentions | Person-centric prompts | ~0 | Yes | Yes | M | M |
| Phrase graph plus PageRank | Noun phrases linked to spans, walked from the query | Multi-session (gated) | ms | Yes | Yes | L-M | L |
| Coarse supersession render | Show the old value next to the new, dated | "What was it before?" | ~0 | Yes | Yes | L | L |
| Full knowledge graphs (GraphRAG, Graphiti, Mem0g) | A model extracts entities and edges | Ties or loses on lookups, expensive | Heavy | No | No | — | — |

### Beyond chat ([beyond-chat.md](prefetch-survey/beyond-chat.md))

| Technique | In plain English | What it adds | Cost per turn | Browser | CF | claude | small |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Identifier-exact symbol index (tree-sitter tags) | List every definition's file and line; match identifiers in the message | Proven `path:line` | ms | Yes | Yes | H (coding) | H (coding) |
| Working set plus depth-2 tree | Files touched recently, and their folders | Fewer "find file" calls | ~0 | Yes | Yes | M | M |
| Code embedders | Semantic code search | Weak at repo level (NDCG@10 12-22) | 10s of ms | Yes | Yes | L | L |
| URL to file with a line range | Fetch, extract main text, save, point at the matching section | Pasted-link questions | One fetch | Yes | Yes | H | H |
| Novelty-gated web search | Search only for unknown words, fresh topics, long-tail names | Long-tail facts, new terms | One search when it fires | Via Worker | Yes | L-M | H |
| Open-loop speculation | When the reply offers to do something, pre-run its lookups | "Yes, go" turns | Idle time | Yes | Yes | M | M |
| Source gate | Classify which sources a prompt needs, "none" included | Fewer wasted lookups | <5 ms | Yes | Yes | M | M |
| Episodes and people cards for advice | Dated events and who's involved, no summaries | Personal turns, less sycophancy | ~0 | Yes | Yes | M | M |
| Clock line at the end | Local date, weekday, time since last message | Relative dates | ~20 tokens | Yes | Yes | M | M |
| Sticky tier and ratcheted raw window | Keep the cached prefix stable across turns | Cache reads, speed | 0 | Yes | Yes | H (cost) | M (speed) |
| Fenced fetched content | Label fetched text as data with source and time | Injection safety | 0 | Yes | Yes | must | must |

### Abstention ([abstention-and-new-ideas.md](prefetch-survey/abstention-and-new-ideas.md))

| Technique | In plain English | What it adds | Cost per turn | Browser | CF | claude | small |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Ceiling-normalized BM25 plus IDF coverage | Score ÷ the best score possible for this query; share of rare words matched | An absolute bar | <1 ms | Yes | Yes | M | H |
| Anchor-term check | Require the rarest query word and any name or number | Kills near misses | <1 ms | Yes | Yes | M | H |
| Logistic gate (Platt) on ~9 features | Ten weights turn features into P(relevant) | Tunable per profile | <1 ms | Yes | Yes | M | H |
| Query performance prediction (spike, agreement) | Did the search look like it worked? | Query-level signal | <1 ms | Yes | Yes | L | L |
| Reranker probability as a floor | Use the reranker's score as the bar | Calibrated gate | with rerank | WebGPU | Yes | M | H |
| Conformal threshold | Pick the bar so false inclusions stay under a set rate | A guarantee | ~0; needs ~100 calibration prompts | Yes | Yes | L-M | M |
| Pointer tier | Medium confidence gets a one-line pointer, not the text | Keeps recall, cuts tokens | 0 | Yes | Yes | M | H |
| "Searched, found nothing" line | Say so explicitly | Better abstention by the reader | ~10 tokens | Yes | Yes | L-M | M |
| NLI filter | A model checks the text entails an answer | Needs a candidate answer | One pass | Poor | Poor | L | L |

## What to prefetch, by kind of prompt

| Prompt | Prefetch | Abstain when |
| --- | --- | --- |
| **Code** ("where is buildPacket", a pasted stack trace, a file path) | Identifier-exact `path:line` plus the enclosing function; a typed `path:line` read fresh; the working-set register and a depth-2 tree; recent chat about that file | The identifier matches several definitions (pointers only) or none; no file is named and nothing in the working set matches |
| **A pasted URL** | The saved file, the section map, the best line range with a short excerpt (see below) | Fetch failed or the page is too short; no section clears the bar (path and map only) |
| **Factual / general knowledge** ("boiling point of ethanol") | Nothing from history. A definition or snippets only when the novelty detector fires on an unknown term or a fresh topic | Always, for history. This is the should-be-empty family |
| **"What did we decide / what did I say"** | Chat history: BM25 plus rerank, decision turns, supersession marks, dates | No unit clears the absolute gate. Then the "searched, found nothing" line, not a guess |
| **Personal, family, advice** | People cards for each named person, a dated episode timeline, earlier advice and how it went, stated preferences with pointers | The person isn't in the register; never a profile summary or an inferred trait |
| **Planning** ("this weekend", "should we go") | Clock line, relevant dated events and plans, location or weather only from a connected source | No dated plans match |
| **Counting and lists** ("how many trips") | Tally block: one dated sentence per session, deduplicated | Fewer than one match |
| **Small talk and acks** ("thanks", "lol ok") | Nothing; the gate skips retrieval | Always |
| **Follow-ups** ("yes, do it", "and the other one?") | Results of open-loop speculation, the last few raw turns already in context | Nothing was pre-run |

## Prior art in Squiggle

Squiggle (KealJones/squiggle at commit `51a3de3`) has two pieces worth porting.

**Fresh-context prefetch** (`app/src/prefetch.js`). Before each turn it embeds the message with all-MiniLM-L6-v2 in the browser, scores past items by meaning and by shared words, and uses **absolute** bars: 0.45 cosine for meaning and 0.34 for words (line 113). Names in the message gate which person-linked items can enter (`namesIn`, line 26; ranking at 118-151). Small talk is skipped (96-100). `render` (203-243) returns an empty string when nothing clears the bars. That's the abstention behavior Long Con lacks, already working in a 1.7B-model app. The bars were set by hand, so the backlog calibrates them instead of copying them.

**Page extraction** (`app/src/webpage.js`, `app/src/tools/web.js`), covered in the next section.

## URL prefetch to a file with a line range

When a message contains a URL, the builder reads the page before the model does, saves the readable text as a file, and the packet points at the exact lines that matter for the current topic. The model gets a path it can read or grep, a line range to start from, and a short excerpt, instead of a raw page or nothing.

### What Squiggle already does

| Piece | Where | What it does |
| --- | --- | --- |
| Find the content | `app/src/webpage.js:35-45` (`contentRoot`) | Reads the page the way a screen reader does. The `<main>` or `role=main` landmark is the content when it holds at least 20% of the page's text; else a lone `<article>` holding at least 30%; else `<body>` |
| Drop the chrome | `app/src/webpage.js:51-92` (`roleOf`, `linkList`, `dropChrome`) | Removes navigation, sidebars, banners, footers, search, menus and dialogs by ARIA role (explicit or implied by the tag, following HTML-AAM: an article's own header stays). Removes hidden elements, and lists of three or more items that are only links, together with their heading. This came from a real failure: a "related stars" link list next to a paragraph led a 1.7B model to invent who co-starred with whom |
| Text, one block per line | `app/src/webpage.js:98-109` (`pageText`) | Turns the parsed DOM into text with one paragraph, heading or list item per line, table cells joined by ` \| `. Works on a `DOMParser` document, where `innerText` would run every block together |
| The card | `app/src/webpage.js:7-26` (`pageCard`) | First real prose (skipping menus and captions) up to about 500 characters, plus the h1-h3 headings with the line number each starts on |
| The fetch | `app/src/tools/web.js:9-62` (`fetch_url`) | Direct fetch, falling back to a Worker relay (`worker/index.js`, 2 MB cap, 15 s timeout). Strips script, style, svg and hidden nodes (line 36). A 4xx or 5xx is reported as a failure, never as the page (41-43). For small models, a page over 1,500 characters is saved as `/web/<n>.txt` and the model gets the card plus "grep or read_file it with a line range" (46-53). Page text is wrapped as untrusted |
| Tests | `tests/webpage.test.js` | Six cases: landmarks, link-only lists, a too-small main landmark, a landmark wrapped around the content, web paths |

So Squiggle already saves the page to a file and hands over headings with line numbers. What it doesn't do is pick the section that matters for the current conversation.

### How it compares

| Extractor | Approach | Fit for Long Con |
| --- | --- | --- |
| Squiggle `pageText` | Accessibility landmarks and ARIA roles, link-list removal | Small, dependency-free, tested, runs in the browser and (with linkedom) a Worker. Strong on well-marked-up pages; falls back to the whole body on pages with no landmarks |
| Mozilla Readability | Scores DOM nodes by text and link density (Firefox Reader View) | Good on articles. Scored 0.736 word-bag F1 in the 2026 WCXB benchmark, below the others |
| Defuddle | Readability-like, more forgiving, uses mobile styles to spot clutter, outputs Markdown | The best JavaScript option on paper. Not in WCXB |
| Trafilatura (and rs-trafilatura) | Heuristics plus fallbacks, Python (Rust port) | Best measured: 0.841 (Python) and 0.903 (Rust) F1 in WCXB. Doesn't run on Workers; WASM unverified |
| `Accept: text/markdown` | Cloudflare converts HTML to Markdown at the edge for sites that opt in | Free and clean where available. Send it on every fetch and branch on the content type |
| Cloudflare Browser Rendering `/markdown` | Headless Chrome renders, then converts | Only for pages that come back as an empty script shell. 10 free minutes a day |
| Accessibility tree (rendered) | A real browser's computed accessibility tree | What Squiggle approximates without rendering. Only worth it inside Browser Rendering |

Every extractor degrades on forums, product pages and listings (Trafilatura falls from 0.92 F1 on articles to 0.52-0.58 there). That's the argument for picking sections, not trusting extraction to be clean.

**Recommendation:** port Squiggle's `contentRoot`, `dropChrome`, `pageText` and `pageCard` into `packages/core` as the default extractor, with its tests. Add Defuddle as the fallback when `contentRoot` lands on `<body>` and the text has high link density. Send `Accept: text/markdown, text/html;q=0.9` first, and use Browser Rendering only for empty shells.

### Choosing the line range

1. **Sections.** Split the saved text at headings (Squiggle's heading-to-line map). A page with no headings is split into windows of about 40 lines at blank lines.
2. **Score each section** against the resolved query: the new message's words (minus the URL) plus the recent topic's words, from the raw-turn window and the resolver. BM25 over sections, each prefixed with the page title and its heading path (the zero-cost version of contextual retrieval). Add embedding similarity once the dense channel exists.
3. **Narrow inside the best section** with a sliding window of 8 to 20 lines that maximizes the same score, so the pointer is a tight range, not a whole chapter.
4. **Packet entry:**
   - the saved path and the URL, fetch time and status
   - the section map: headings with line numbers (always, since it's a fact, not a guess)
   - the best range as `path:start-end` with its heading, and an excerpt of those lines, fenced as fetched content: about 400 tokens on the claude profile, 150 on small-local
   - a second range only if it scores close to the first
5. **The model's tools** (read with a line range, grep) reach the rest of the file.

### When to abstain

- **Fetch failed, 4xx or 5xx, login wall, paywall stub, empty shell after rendering:** one line saying the page couldn't be read and why. Never the error page as content.
- **Readable text under about 200 characters:** treat as a failure.
- **No section clears the absolute bar for the current topic:** the path and section map only, no excerpt. The user did paste the link, so the page is relevant, but a guessed excerpt isn't.
- **The message only shares the link with no question and no recent topic:** the card (opening prose plus section map), no range.

### Safety and freshness

- Fetched text is data. It's fenced and labeled with its source and time, hidden elements and comments are stripped before extraction, and links inside the page are never followed.
- Only URLs the user typed, read-only, one hop, size and time caps (Squiggle's 2 MB and 15 s).
- Cache by URL plus ETag or content hash. Re-fetch when the user re-pastes or asks, or when the cache is older than a day.

### Eval

The URL set in [prefetch-evals.md](prefetch-evals.md#4-url-prefetch), and scenario A of the paired work-saved eval for URL tasks.

## The abstention gate, in short

Full proposal in [abstention-and-new-ideas.md](prefetch-survey/abstention-and-new-ideas.md#the-proposal-an-absolute-relevance-gate-for-long-con).

- **Features**, all arithmetic on numbers the builder already has: ceiling-normalized BM25 for both rankings, IDF coverage, anchor hit (rarest term plus any name, number or quoted string), score spike, agreement between the two rankings, query specificity, a history-reference cue ("I", "you said", a known name), and the existing relative score.
- **Model:** a ten-weight logistic regression fitted on the 47 answerable dev questions (about 940 labeled candidate units). Its output is a probability; include a unit when it clears τ for the profile, keep the 0.3 relative cutoff as a second filter.
- **Free negatives:** off-history prompts, cross-haystack prompts, and the best one, **evidence-ablated** prompts: each answerable dev question against its own history with the answer sessions removed. The near misses stay, the answer is gone, so the correct packet is empty. 47 realistic hard negatives at no cost.
- **Picking τ:** claude may lose at most 2 points of recall (Claude abstains well on thin context). Small-local may trade up to 5 points for a big cut in false inclusions (small models are misled by any context). Switch to a conformal threshold once the should-be-empty set reaches about 100 prompts.
- **Dense and rerank channels** each get their own absolute floor and may add to a packet, never fill an empty one.

## Eval gaps

The current free eval only checks whether LongMemEval evidence lands in the packet. It can't see junk, empty-correct turns, code lines, pages, or saved work. [prefetch-evals.md](prefetch-evals.md) adds five sets, all built and scored on plan usage or with no model:

1. **Should be empty:** 300 prompts in five families (general knowledge, new topic, lexical trap, near miss, small talk), plus the evidence-ablated tier.
2. **Code path:line:** symbols from pinned public repos, three questions each (named, plain, sloppy), scored on block hit and wrong-line rate.
3. **Non-memory prompts:** 100 small fixtures with gold sources, which may be none.
4. **URL prefetch:** 80 saved open-license pages, scored on section hit, line overlap and abstain accuracy.
5. **Work saved, paired:** the same task run with and without the packet in `claude -p`, counting tool calls, bytes read, tokens, wall time and correctness. Scenarios: **A** the fact is only in a file or URL; **B** it was discussed but the read is stale (file changed, out of the raw window, or compacted away); **C** a should-be-empty control that measures harm. Fairness rules: same model, prompt, tools, caps and fresh checkout, alternating arm order, deterministic checks or a blind judge, paired bootstrap intervals.

New metrics next to recall: empty-packet rate, false inclusions per prompt, packet precision, selective risk (AURC), wasted tokens, and source precision and recall. A change is kept only if it raises recall or cuts tokens **without raising false inclusions**.

## Ideas nobody listed

- **The reader's citations are free relevance labels.** Ask the model to cite which packet items it used; uncited items and post-packet tool calls become training data for a per-user gate refit.
- **Pointers as a middle ground.** Between "include" and "nothing": a one-line pointer for medium-confidence units, so the model can read it if needed without the text taking space or misleading it.
- **Prefetch computation, not only text.** Date deltas, counts and tallies done by code before the turn, so a small model doesn't do arithmetic it gets wrong.
- **Open-loop speculation.** When the reply ends with an offer, the lookups it names run during idle time, ready for "yes".
- **Previous advice and its outcome.** Link "suggested A on the 12th" to "you said it backfired" so the next related turn sees both.
- **Ranking agreement as a free confidence signal.** When the all-words and user-words rankings agree on the top 5, the search probably worked; a 2026 study found agreement the best unsupervised predictor.
- **A bandit per user** that nudges τ from whether packets got used.
- **Knowledge-gap canaries and penalty-aware scoring** in the evals, so a gate that prevents wrong answers shows up even when plain accuracy hides it.
- **Cached KV for the stable parts** on small-local, so the sticky tier costs no prefill time.

## Not verified

- No measurements. LongMemEval couldn't be downloaded in this session, so every gain above is a hypothesis.
- Many 2026 papers were read through abstracts or page summaries, not in full; each appendix lists which.
- Browser latencies for rerankers, static embedders and forward-pass probes are estimates, not measured on a phone.
- Search API prices come from third-party write-ups, not vendor pages.
- No study was found for a directory tree as context on its own, for previous-advice linking, or for open-loop speculation hit rates.
- One fetched vendor page carried instructions addressed to AI agents. They were ignored.
