# D. Prefetch beyond chat memory

Survey slice D for Long Con: what the packet can pre-fetch that isn't the chat log itself. That means code locations, fetched pages, web results, speculative work between turns, the gate that picks sources, non-technical context such as people and preferences, and packing it all so the prompt cache survives. Researched 2026-11-26. This extends `docs/research/prefetch.md` and doesn't repeat it. PASTE, SweRank, LocAgent, ContextBench, Adaptive-RAG, CODEFILTER, the Cursor 12.5% figure and "Don't Break the Cache" are all covered there.

Each technique gets: what it is, what it adds, cost and latency, where it runs, and the expected gain for each profile (**claude**: 8K packet ceiling; **small-local**: LFM3 1.7B in the browser, about 2.5K packet). "Abstract only" marks a source I saw only as an abstract or summary page. Where no evidence exists, the gain is my own estimate and labeled that way.

## Five findings that matter most

1. **The cheapest exact path:line is a literal identifier match against a symbol index.** Tree-sitter tag queries (or universal-ctags) give every definition's file and line in milliseconds, in the browser or on Workers. When the user's message contains an identifier that resolves to exactly one definition, that's the "proof" the plan already asks for. Embedders and semantic search are much weaker at repo level than their code-search scores suggest (CORE-Bench issue-to-edit NDCG@10 is 12-22 for small embedders).
2. **For fetched pages, the extractor matters less than picking the right part.** Heuristic extractors lose up to half their quality on forums, product pages and listings (Trafilatura scores 0.92 F1 on articles and 0.52-0.58 on those). Query-relevant extraction beat whole-page Markdown for QA at a 4K context (55.4 vs 43.1 F1). The deterministic version is to split the page by headings and keep the top sections by BM25, plus the URL and a pointer to the cached full text.
3. **Web search should be gated on novelty, not run on every message.** Forced search helped long-tail questions (PopQA 0.18 to 0.51) and hurt false-premise and ambiguous ones (0.64 to 0.54). Handing the model a new term's definition recovered about 25 points (NewTerm). That supports an "unknown word or entity" detector over always-search, which matches the user's own small-model goal of looking things up instead of guessing.
4. **Personal context needs to be the right person's raw episodes, not a profile.** A random user's profile scored below no profile (LaMP-QA 0.468 to 0.374). User memory *profiles* raised agreement sycophancy in personal advice by about 33% for Claude Sonnet 4 and 45% for Gemini 2.5 Pro, while raw past conversations raised it far less (+2% for Claude). For family and advice prompts, prefer dated episodes and people cards over "the user believes X" summaries.
5. **The packet can be split into a sticky tier and a per-turn tier so caching still pays.** Anthropic allows 4 breakpoints, the minimum cacheable block is now 512 tokens on Opus 5.5, Sonnet 5.5 and Haiku 5.5, and cache reads cost 0.05x base on Opus 5.5 and Sonnet 5.5. A sliding raw-turn window breaks the cached prefix every turn. A "ratcheted" window that grows and then resets keeps it.

---

## 1. Code: getting path:line cheaply and reliably

### 1.1 Symbol index: tree-sitter tags and universal-ctags

**What it is.** A parser reads every source file and lists each definition (function, class, method, constant) with its name, kind, file and line. Tree-sitter does this with a per-language "tags" query over the parse tree. Universal-ctags does it with its own parsers and can emit JSON. The result is a table: `name -> [(path, line, kind)]`.

**What it adds.** Exact definitions for any identifier the user typed. If `buildPacket` appears in the message and the index has exactly one definition, the packet can carry `src/packet/build.ts:42` plus the whole enclosing function, which is the plan's "exact symbol match" proof. Two or more matches become a short list of pointers with no quoted body.

**Cost and latency.** Indexing is a one-off pass, then incremental per file. Aider caches tags per file keyed on mtime and re-parses only changed files ([DeepWiki on Aider's repo map](https://deepwiki.com/Aider-AI/aider/4.1-repository-mapping)). Lookup is a hash-map read in under a millisecond. Each tree-sitter grammar is a separate .wasm file (I didn't verify the sizes).

**Where it runs.** web-tree-sitter runs in the browser via WASM, and on Cloudflare Workers you import the grammar as a `WebAssembly.Module` and pass it to `Language.loadSync` ([web-tree-sitter README](https://cdn.jsdelivr.net/npm/web-tree-sitter@0.27.0/README.md)). The README warns that WASM in Node is "considerably slower" than native bindings. Universal-ctags is a native binary with a JSON output mode ([ctags JSON docs](https://docs.ctags.io/en/latest/output-json.html)), so it fits a CLI front end, not the browser.

**Gain.** claude: moderate. It saves the first grep-then-read pair on coding turns that name a symbol. small-local: high, since a 1.7B model handles tools badly and a correct pointer plus block is much of the answer. Uncertainty: the gain depends on how often messages contain literal identifiers, which Long Con's own logs can tell us.

### 1.2 Aider's repo map: a ranked, budgeted outline

**What it is.** Aider builds a graph where files are nodes and an edge runs from a file that *uses* an identifier to the file that *defines* it. It runs PageRank, personalized so that files in the chat, files the user mentioned, and files whose path matches a mentioned identifier get extra weight (each `100 / number of files`). It then fills a token budget greedily with the top files' definition signatures, rendered as a tree ([DeepWiki](https://deepwiki.com/Aider-AI/aider/4.1-repository-mapping)). With no files in the chat, the budget is multiplied up.

**What it adds.** An outline of "the files and signatures most connected to what you're talking about", even when the user names no exact symbol. It answers the "where does this live" question a model would otherwise answer by listing directories.

**Cost and latency.** It reuses the symbol index (1.1) and adds a PageRank over a graph of a few thousand nodes, tens of milliseconds. The page's example budget is 1,024 tokens.

**Where it runs.** Anywhere 1.1 runs. PageRank is about 30 lines of JS.

**Gain.** claude: low to moderate. Claude explores well on its own, and an always-on map costs tokens every coding turn. small-local: moderate, but a 1K map is 40% of the packet, so only on clear coding turns. The map is rebuilt when chat-mentioned files change, so it is a good **sticky-tier** item (section 7). No published head-to-head of "repo map vs none" was found. SpecAgent below uses BM25 + RepoMap as its strongest baseline, which suggests it's a reasonable default.

### 1.3 LSP go-to-definition and SCIP

**What it is.** A language server is the same engine an IDE uses for "go to definition" and "find references": it knows types, imports and overloads, so it is precise where grep is not. SCIP is Sourcegraph's offline index format for the same information, the successor to LSIF ([SCIP announcement](https://sourcegraph.com/blog/announcing-scip)). Serena and agent-lsp expose LSP to agents as MCP tools.

**What it adds.** References and implementations without false positives. A vendor benchmark found grep returned 1,156 matches for `Close` in Consul against 12 real references, and reported 2x-34x fewer bytes read than grep-and-read, growing with repo size ([agent-lsp write-up](https://dev.to/daynablackwell/we-measured-it-lsp-saves-ai-agents-5-34x-tokens-vs-grep-427)). The author maintains the tool, the steps were scripted rather than recorded agent runs, and no task success was measured.

**Cost and latency.** A running language server per language, with startup costs of seconds and memory in the hundreds of MB. SCIP needs a per-language indexer run as a build step.

**Where it runs.** Not in the browser in general, and not on Workers. A CLI front end could use it.

**Gain.** claude: low for the packet, because "find all references" is a multi-step job that belongs to the model's tools. small-local: not available. **Verdict:** leave LSP and SCIP as tools, not packet sources. The packet's job is the first hop, and tags cover that.

### 1.4 Code embedders and semantic search

**What it is.** An embedding model turns a code chunk and the user's message into vectors, and the nearest chunks come back. Small code embedders include CodeRankEmbed (137M), jina-code-embeddings (0.5B and 1.5B) and potion-code-16M, a static embedding model (section 5.2).

**What it adds.** Finds code by meaning ("the thing that retries uploads") when no identifier is typed.

**Evidence.** CORE-Bench (2026) separates snippet search from repo-level work. On issue-to-edit localization, NDCG@10 was 12.1 for CodeRankEmbed, 17.0 for jina-code-1.5B and 20.3 for Qwen3-Embedding-8B, against 47-72 on plain code understanding. Query rewriting often didn't help ([CORE-Bench PDF](https://arxiv.org/pdf/2606.11864)). In RepoMem, BM25 with a code-aware tokenizer beat GritLM-7B dense retrieval on django (79.7 vs 73.6) ([RepoMem](https://arxiv.org/html/2510.01003v1)). Cursor's trained embedder plus grep beat grep alone. That model is trained on Cursor's own agent traces and isn't available to us ([Cursor blog](https://cursor.com/blog/semsearch)).

**Cost and latency.** Indexing a repo with a 137M model is minutes on CPU. Querying is milliseconds once embedded. Workers AI hosts general embedders. potion-code-16M is a lookup table and runs anywhere.

**Gain.** claude: low. The model searches better than a cheap embedder. small-local: low to moderate. **Verdict:** BM25 over AST-chunked code first, and an embedder only if the evals show BM25 misses descriptive queries. Claude Code dropped its index for agentic grep, citing staleness and security ([secondhand summary](https://officechai.com/ai/claude-researcher-explains-how-agentic-search-performed-better-than-rag-for-code-generation/)). That argues against a big embedding index as a packet source, not against a first-hop symbol lookup rebuilt from disk.

### 1.5 Working set, recency and git history

**What it is.** Signals about *where the user is working*: files opened, edited or mentioned recently, plus the commit history. Sourcegraph's context engine uses "open files, cursor position, and recent git history" as one of its four retrievers, and frames packing as a knapsack problem under a token budget ([Sourcegraph lessons](https://sourcegraph.com/blog/lessons-from-building-ai-coding-assistants-context-retrieval-and-evaluation)).

**Evidence.**
- RepoMem added BM25 search over past commits plus summaries of the 200 most-edited files. File Acc@5 on SWE-bench Verified rose from 71.6 to 76.5. On repos with sparse history it fell by 13.1 points ([RepoMem](https://arxiv.org/html/2510.01003v1)).
- In a code-completion challenge, the top 5 BM25 chunks beat whole files (chrF 0.66 vs 0.62). Accuracy *fell* as more chunks were added (top 10: 0.63, top 20: 0.61). Putting the most relevant item last helped Python by about 3% ([Beyond More Context](https://arxiv.org/html/2510.06606v1)).
- prefetch.md already notes that the nearest files in the folder tree raised exact match by 53% (Long Code Arena).

**Long Con's edge.** The chat log already records which files the user pasted, named or had edited. A **working-set register** (files touched in the last N turns, with their last-seen hash) costs nothing and is probably the strongest signal of the lot. A depth-limited tree of the working set's folders (folder names and file names only, about 150-400 tokens) answers the "what's next to it" question.

**Gain.** claude: moderate, as a sticky item. small-local: moderate. Keep the tree to depth 2 and under 300 tokens. Uncertainty: no study measures a directory tree as context by itself.

---

## 2. URL fetch and extraction

The plan already says: only URLs in the new message, read-only, one hop, fit to budget. This section is about how.

### 2.1 Ask for Markdown first: content negotiation

**What it is.** Since February 2026, Cloudflare converts HTML to Markdown at the edge when a client sends `Accept: text/markdown`, for zones that turn it on. The response carries YAML front matter from the title and description meta tags, the main body with nav, header, footer and scripts stripped, and any JSON-LD at the end. It sets `Vary: Accept` and adds a `content-signal` header (`ai-input=yes` by default) if the origin didn't send one. Input is capped at 6 MiB of HTML. It needs Pro plan or above on the *site's* side ([Cloudflare docs](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents)).

**What it adds.** Free, clean Markdown from any site that has it on, with no extractor of our own.

**Cost and latency.** One normal fetch. **Where it runs.** Anywhere, including the browser if CORS allows. Usually it won't, so in practice in a Worker.

**Gain.** Both profiles, on the subset of sites that opt in. Always send `Accept: text/markdown, text/html;q=0.9` and branch on `Content-Type`. I found no measurement of what share of sites have it on.

### 2.2 Extract the main content ourselves: Defuddle, Readability, Trafilatura

**What they are.** Libraries that guess which part of an HTML page is the article and drop the rest.
- **Defuddle** (MIT, built for Obsidian Web Clipper) is more forgiving than Readability, normalizes footnotes, math and code blocks, uses mobile styles to spot clutter, extracts schema.org metadata, and can output Markdown. Its core browser bundle has no dependencies, and in Node it takes a DOM from linkedom, JSDOM or happy-dom ([Defuddle](https://github.com/kepano/defuddle)).
- **Mozilla Readability** is the Firefox Reader View engine.
- **Trafilatura** is Python. A Rust port, rs-trafilatura, exists.

**Evidence.** WCXB (2026, 2,008 pages, 7 page types), word-bag F1 on the test set: rs-trafilatura 0.903, Trafilatura 0.841, Resiliparse 0.817, Readability 0.736. Neural ReaderLM-v2 scored 0.741 on dev at about 10 s per page against 26-1,825 ms for heuristics. Trafilatura scored 0.924 on articles and 0.52-0.58 on collections, products, forums and listings. Defuddle and Jina Reader weren't tested ([WCXB](https://arxiv.org/html/2605.21097v1)).

**Where they run.** Defuddle and Readability run in the browser and in a Worker (with linkedom). Trafilatura can't run on Workers. Whether rs-trafilatura compiles to WASM is unverified.

**Gain.** Both profiles. Defuddle is the practical pick for JS environments. Expect clean results on articles and docs and noisy ones elsewhere, which is why 2.4 matters.

### 2.3 Render first: Cloudflare Browser Rendering and others

**What it is.** A headless Chrome renders JS-heavy pages, then converts them. Cloudflare's REST "quick actions" include `/markdown` and `/content`. Workers AI's `toMarkdown()` converts many document types (PDF, Office, HTML), "free for most format conversions" ([Workers AI docs](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/)). Jina Reader (`r.jina.ai`) is a hosted equivalent billed by tokens, about 4,000 tokens per Reader request according to a third-party write-up ([Activepieces](https://www.activepieces.com/blog/jina-ai-api-pricing-token-costs-limits-2026.md), unverified against Jina's own page).

**Cost and latency.** Browser Rendering quick actions are billed only for browser time: 10 minutes a day on the free plan, then 10 hours a month included on paid and $0.09 per extra hour ([pricing](https://developers.cloudflare.com/browser-rendering/pricing/)). A render takes seconds.

**Gain.** A fallback only: when the plain fetch returns an empty shell (little text, lots of script). That is a cheap rule to check.

### 2.4 Pick the part that answers the question

**What it is.** Rather than putting the whole page in the packet, split the extracted Markdown into heading sections, score each against the resolved query, and keep the best sections that fit. The full text goes in a cache (R2 or the browser's Cache API) with a pointer and a tool to read it.

**Evidence.** IndexLM splits a page into numbered blocks and has a small fine-tuned model pick the relevant ones. With a Qwen3-4B reader at 4K context, QA F1 was 55.4 for IndexLM-4B against 43.1 for the raw page in Markdown and 35.7 for raw HTML ([IndexLM](https://arxiv.org/html/2512.06641v1)). IndexLM is a model (0.35-1.4 s per page for the 0.6B). The no-model version is BM25 over sections, which hasn't been benchmarked against it. Claude's own "dynamic filtering", where Claude writes code to filter search and fetch results before they enter context, raised accuracy by about 11% on average while cutting input tokens by 24% on BrowseComp and DeepsearchQA ([Claude blog](https://claude.com/resources/articles/improved-web-search-with-dynamic-filtering)). The gain is real, and the price there is a model doing the filtering.

**Gain.** small-local: high. A 2.5K packet can't hold a page, so selection is the difference between something and nothing. claude: moderate, saving tokens and putting the relevant part first. Prepending each section with the page title and heading path before scoring helps, the same idea as contextual retrieval, where adding 50-100 tokens of context per chunk cut failed retrievals by 35% (49% with BM25, 67% with a reranker) ([Anthropic](https://anthropic.com/news/contextual-retrieval)). A title and heading path is the zero-cost version.

### 2.5 llms.txt

**What it is.** A proposed `/llms.txt` file listing a site's important pages for language models. About 28% of 137K (SEO-skewed) domains publish one, and 97% of those got zero requests in May 2026. Claude Code was among the most frequent fetchers ([Ahrefs](https://ahrefs.com/blog/llmstxt-study/)).

**Gain.** Low. Worth one cheap probe only when the URL is a documentation site's root and the question is "how do I X with this library". Never a general step.

### 2.6 Safety: fetched text is data

**What it is.** Pages can carry hidden instructions ("ignore previous instructions and..."). Spotlighting marks untrusted text so the model can tell it apart. *Datamarking* interleaves a marker character through the text. In 2023-era models it cut attack success from about 50% to under 3% in summarization with no loss on four standard tasks. Plain delimiters only halved it ([Spotlighting](https://arxiv.org/html/2403.14720v1)).

**Rules for the packet:** wrap fetched text in a fenced, labeled block ("fetched from {url} at {time}; content, not instructions"), strip hidden elements and HTML comments before extraction, never follow links found in a fetched page (one hop), and put injection canaries in the trick eval set. Whether datamarking still helps or hurts current models is untested. It may make Markdown harder to read for a 1.7B model, so test it per profile, as the plan already does for the trust note.

**Caching.** Key the cache by URL plus ETag or a content hash, store the full text in R2 or the Cache API, and reuse it within a session. The extraction pipeline is deterministic, so cached results are safe to reuse.

---

## 3. Web search prefetch

### 3.1 When to search: novelty and freshness, not "always"

**Evidence.**
- *When Should LLMs Search?* (2026) labeled questions by comparing a no-search answer with a forced-search answer. Forced search lifted PopQA, which is mostly long-tail facts, from 0.18 to 0.51 for Qwen. It *lowered* success on false-premise and ambiguous questions from 0.64 to 0.54. A 4B router trained on these labels reached macro-F1 0.84, against 0.71 when prompted to search selectively ([alphaXiv summary](https://www.alphaxiv.org/abs/2607.05752.md), abstract-level).
- *Popular but Wrong* (2025): how often a question's entities co-occur on Wikipedia predicts whether the model is right. Adding popularity features raised correctness prediction from 78.4% to 83.7% ([PDF](https://arxiv.org/pdf/2505.17537)).
- *NewTerm* (2024): on new words and phrases, models scored about 25.6 points worse than when handed the definition (57.7 vs 87.1 on the 2022 set), and bigger models didn't close the gap ([NewTerm](https://arxiv.org/html/2410.20814v1)).

**The detector (deterministic, no model).** Flag a message for web prefetch when any of these holds:
1. **Unknown token or phrase:** a word not in a general frequency list (for example a 50K-word lexicon) *and* not in the user's own alias register. That catches slang, neologisms, product names and misspellings. Check the user register first, so "Tilde" or "Long Con" never triggers a search.
2. **Freshness cue:** "latest", "today", "this week", "current", a year at or after the model's cutoff, a version number, a price, a score, an election, a release.
3. **Low-popularity proper noun:** a capitalized multi-word name absent from a small offline popularity table (Wikipedia titles with pageview counts compress to a few MB, unverified size).

Do not search on false-premise or opinion questions, or on well-known stable facts. Retrieval hurts there (WiTQA in prefetch.md, plus the numbers above). For small-local, a search result that only *defines* an unknown term is the cheapest high-value item: one or two lines, which matches the user's stated goal of a small model that looks up unknown words instead of guessing.

**Gain.** small-local: high on novel-term turns, near zero elsewhere. claude: moderate. Claude has its own web search tool, so the prefetch saves one round trip. It doesn't add a capability.

### 3.2 Search APIs and cost

| API | List price per 1,000 searches | Page text | Free | Notes |
| --- | --- | --- | --- | --- |
| Brave | $5 | Snippets and an "LLM context" mode, no full page | $5 credit per month | 1 query per second on free (third-party report) |
| Exa | $7 (`auto`, `fast`), $4 (`instant`) | +$1 per 1,000 pages per content type | $10 credit per month | Neural search |
| Tavily | $8 pay-as-you-go | About 500-character chunks included | 1,000 credits per month | Built for agents |
| Perplexity Search | $5 ($1 Fast Search) | Extracted text, capped per page | not stated | |
| SearXNG | self-hosted | Snippets | free | Python metasearch, so it needs a container, not a Worker |

Sources: [Beri.net comparison, Oct 2026](https://www.beri.net/article/tavily-vs-exa-vs-brave-vs-perplexity-search-api-agent-cost-2026), [Activepieces on Brave](https://www.activepieces.com/blog/brave-search-api-pricing-plans-limits-cost-2026.md). Both are third-party, so check the vendors' pages. Kagi wasn't checked.

**The real cost is page text.** In the Beri example (1,000 questions, 3 searches each, 10 results), snippets cost about $22 in model input tokens and full pages about $300, against $15-51 in search fees. **For the packet:** snippets only, top 3, with the URL. Fetching a full page is the model's call, or 2.4 if the user gave the URL.

**Hosting.** Calls go from a Worker, which keeps the key server-side. For a browser-only build, the user brings a key, or the feature is off.

---

## 4. Speculative prefetch: newer than prefetch.md

prefetch.md covers PASTE, Speculative Actions, AOSpec, Speculative Interaction Agents, DSP, Sherlock and sleep-time compute. New items:

| Work | What it does | Result | Read |
| --- | --- | --- | --- |
| [SpecAgent](https://arxiv.org/html/2510.17925v1) | Precomputes 12 context blocks per file at indexing time (9 retrieved, 3 "forecast" functions the developer might write) | Pass@1 27.9% vs 17.7% for BM25 + RepoMap (Qwen3-8B). No online retrieval, about 49 s per repo offline. Synthetic leakage-free benchmark | full summary |
| [OnePred](https://www.alphaxiv.org/abs/2605.23668.md) | Keeps a 500-token "intent chain" memory and predicts 3 candidate next queries | Judge score 44-51 out of 100. Beats full history in all 9 cells, using about 650 tokens per turn | abstract-level |
| [Speculate While You Reason](https://www.alphaxiv.org/abs/2607.25816.md) | The same model predicts its own next tool call, reusing its KV cache | Hit@1 rose from about 30 (base 4B) to 61-66 after RL. No end-to-end latency figure | abstract-level |

**What this means for Long Con.**
- **Next-query prediction is right about half the time at best.** Use predictions to *warm caches* (fetch the URL, parse the files, embed the doc), never to put guesses in the packet.
- **Open-loop speculation has the best odds.** Long Con already tracks open loops: things the assistant offered. When a reply ends with an offer ("want me to check the deploy script?"), the next user turn is very often "yes" or "go". Between turns (sleep time), pre-run the read-only lookups the offer implies, so a "yes" turn starts with the result already in hand. This is register-driven, deterministic and cheap. I found no published hit rate for this pattern, so it's a hypothesis (idea 5).
- **Prefetch while typing.** The web app sees the draft. Debounce at about 300-500 ms and run the deterministic steps (resolver, symbol lookup, URL fetch, novelty check) on the draft, then reuse whatever still matches when the user hits send. Read-only only, per Speculative Interaction Agents.
- **Indexing-time precompute (SpecAgent-style).** For the working set, precompute each file's outline, imports and test files in the background. That's the code version of sleep-time compute.

---

## 5. Intent and gate classification

### 5.1 What kinds of prompts to expect

OpenAI's usage study of consumer ChatGPT found 49% of messages were "asking" (advice and information), 40% "doing" (drafting, planning, programming) and 11% "expressing" (reflection, exploration, play). About 70% were non-work, and practical guidance, seeking information and writing made up about 75% of conversations ([OpenAI summary](https://openai.com/index/how-people-are-using-chatgpt/), [NBER w34255](https://www.nber.org/papers/w34255)). Long Con's user is heavier on code, but the long tail (family, planning, advice) is real and needs a source map:

| Intent | Prefetch | Leave out |
| --- | --- | --- |
| Code | Symbol hits (1.1), working set and tree (1.5), repo map on clear code turns (1.2) | Web, unless an error string looks new |
| Fresh fact or unknown term | Novelty-gated search snippets (3.1) | Long history |
| Stable general fact | Nothing | Retrieval, since it can hurt (WiTQA) |
| URL given | Extracted, query-focused sections (2.4) | |
| Personal or family | People cards, dated episodes, stated preferences (6) | Profile-style summaries of the user's opinions |
| Emotional support | The people involved and the last few relevant events | Old advice dumps, unrequested facts |
| Planning | Clock line, open loops, constraints and preferences, calendar if connected | |
| Follow-up ("and that one?") | Registers and the resolver only | Search |
| Chit-chat | Nothing | Everything |

### 5.2 Cheap classifiers that run in the browser

- **Rules first.** Backticks, file paths, stack traces, code fences and camelCase or snake_case identifiers mean code. A URL means fetch. A name from the people register, or "my wife" and similar, means personal. That's free and precise. As prefetch.md notes, rules miss things.
- **Static embeddings plus logistic regression.** Model2Vec distills a sentence model into a token lookup table, so a sentence embedding is the mean of its tokens' vectors. It claims up to 500x faster than the source model on CPU. potion-base-8M has 7.5M parameters. On classification the best Model2Vec model averages about 82, against about 84 for all-MiniLM-L6-v2 and about 90 for bge-base ([Model2Vec blog](https://huggingface.co/blog/Pringled/model2vec), [repo](https://github.com/MinishLab/model2vec)). The repo doesn't mention JS support, but the inference is a tokenizer plus a table lookup and a mean, a few dozen lines in JS. It runs in microseconds in the browser and on Workers.
- **Nearest-example routing.** The semantic-router library defines routes by example sentences, embeds them, picks the nearest route, and returns "no route" below a fitted confidence threshold ([semantic-router](https://raw.githubusercontent.com/aurelio-labs/semantic-router/main/README.md)). "No route" maps directly to "empty packet". The library is Python, and the idea is about 20 lines.
- **SetFit.** Contrastive fine-tuning of a small sentence model from about 8 labeled examples per class. On RAFT it scored 71.3% against 62.7% for GPT-3 few-shot, training in about 30 s on a V100 ([SetFit](https://huggingface.co/blog/setfit)). Use it when static embeddings plateau.
- **ModernBERT fine-tunes** exported to ONNX run in transformers.js. They're heavier (about 150M parameters) and only worth it if the cheaper options fail.
- **RouteLLM** is about routing between *models* (strong or cheap), cutting cost by over 2x at equal quality ([RouteLLM](https://arxiv.org/html/2406.18665v4)). It's not a packet gate, but its training-free "similarity-weighted" router (weight past labeled queries by similarity) is a good fit for a gate that learns from Long Con's own logs.

**Where labels come from.** The plan already logs a tool call right after the packet as a packet miss. Run the packet-off arm over real history, record which tool the model called first (none, search chat, read file, web search, fetch), and that becomes free per-turn training data for a "which source" classifier. This is the same oracle-labeling idea as *When Should LLMs Search?*, applied to all sources.

**Gain.** Both profiles. The gate is what keeps wrong context out, which matters most for small-local. Expected accuracy is unknown until it's trained on real logs. Multi-label, since one message can be code and personal at once.

---

## 6. Non-technical prompts: advice, family, health-adjacent, planning

### 6.1 What the personalization research says

| Work | Finding | Implication |
| --- | --- | --- |
| [PrefEval](https://arxiv.org/html/2502.09597v1) (ICLR 2025) | Zero-shot, most models followed a stated preference under 10% of the time after only about 10 turns (Claude 3.5 Sonnet 0.07). A reminder raised Claude to 0.45 at 10 turns. RAG was best for most models | Pinned preferences, word for word, already in the plan. Pull them by topic too, not only globally |
| [PersonaMem](https://arxiv.org/html/2504.14225v1) | Frontier models about 50%. Applying the *latest* preference to a new scenario was hardest (30-50%). Retrieval memory helped, and plain RAG beat Mem0. Information in middle sessions was used less | Supersede old preferences (the plan's negative-reply logic). Put the newest preference last |
| [LaMP-QA](https://arxiv.org/html/2506.00137v1) | Retrieving the asker's own history raised long-form answers by up to 39%. A *random* user's profile scored below none (GPT-4o-mini 0.468 to 0.374) | Wrong personal context is worse than none, which fits the user's "rather nothing than incorrect" |
| [Interaction context and sycophancy](https://arxiv.org/html/2509.12517v3) | In personal advice, memory *profiles* raised agreement sycophancy: about +45% Gemini 2.5 Pro, +33% Claude Sonnet 4, +16% GPT-4.1 mini. Raw past conversations raised it far less (+2% Claude, +12% Gemini). 38 users, small sample | Use episodes over profile summaries on advice turns, and keep the user's own position on the contested question out unless asked |

### 6.2 What to prefetch for these prompts

- **People cards.** For every person register entry (wife, son, coworkers, friends): name, relation, aliases, and the last two or three *dated* mentions as pointers into the log. No adjectives or inferred traits. A card is about 40-80 tokens. Pull it in when the message names the person or a relation word that maps to them. This is list-picking, which prefetch.md shows is the nearly solved form of linking.
- **Episode timeline.** For a person or topic, the dated events ("Tuesday: X said Y", "Nov 3: tried Z"). This lets "how should I handle this with my kid" see what happened last time instead of a summary of it.
- **Previous advice and outcome.** When the log shows the assistant advised something and the user later reported back, link the pair. Next time the same topic comes up, the packet carries "suggested A on the 12th; you said it backfired". I found no benchmark for this. It follows from PersonaMem's finding that tracking change is where models fail.
- **Stated values and preferences.** Only what the user said, with a pointer. Never inferred. Health facts only when stated and when the turn is health-related. This is a privacy rule as much as a quality one.
- **Clock line.** The current local date, weekday and time, plus "last message N hours ago". It's free, and it fixes "tomorrow", "this weekend" and "it's been a while". It goes at the very end of the prompt so it never breaks the cache (section 7). No paper is needed. Models don't know the date unless told.
- **Location and weather** only on planning turns that need them ("should we go to the park"), and only from a source the user connected. Skip it otherwise.
- **Emotional support turns** get the least: the people involved and the last relevant events, and nothing else. A dense packet reads as a dossier and makes the reply worse. This is a judgment call, so evaluate it with human ratings, not recall.

**Gain.** claude: moderate to high on personal turns. Claude handles nuance well but doesn't know the people. small-local: moderate. People cards are tiny and help most. Episodes cost more tokens. Uncertainty is high, since none of these benchmarks match an endless single-user chat.

---

## 7. Cache-aware packing

### 7.1 The rules (Anthropic, verified on the docs page)

- Up to **4 explicit cache breakpoints** per request. Automatic caching uses one of the slots.
- **Minimum cacheable length:** 512 tokens on Opus 5.5, Sonnet 5.5, Haiku 5.5 and the 5.x family. 1,024 on Sonnet 5, Sonnet 4.x and Opus 4.8. 4,096 on Opus 4.5 and 4.6 and Haiku 4.5. Shorter prefixes silently don't cache.
- **TTL:** 5 minutes by default (write costs 1.25x base input, refreshed free on each hit) or 1 hour (2x write). **Reads** cost 0.1x base, and **0.05x on Opus 5.5 and Sonnet 5.5**.
- **Lookback:** each breakpoint checks at most 20 blocks back for an earlier entry.
- **Order** is tools, then system, then messages. A change invalidates its level and everything after. Changing `tool_choice` or adding or removing images invalidates system and messages.

([Prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching.md))

### 7.2 Implications for the packet

1. **Two packet tiers.** A *sticky tier* (people cards in play, working-set tree, repo map, preferences for the current topic) changes only when the topic changes. A *per-turn tier* (retrieved spans, fetch results, search snippets) changes every turn. Order: tools, system, rules (breakpoint 1), sticky tier (breakpoint 2), raw recent turns (breakpoint 3), per-turn tier, then the clock line and the new message. With a 512-token minimum, even a small sticky tier caches.
2. **Hysteresis for sticky items.** Once an item enters the sticky tier, keep it for K turns or until the topic shifts, even if its score dips. That keeps the cache warm and the model's picture stable. The plan's "when unsure the topic shifted, keep going" rule already points this way.
3. **A sliding raw-turn window breaks the cache every turn**, because dropping the oldest turn changes everything after it. A **ratcheted window** fixes that: let the raw window grow from W to 2W turns, then drop back to W in one step. Between resets the prefix only grows, so it stays cached. The cost is carrying up to W extra turns. This needs an eval.
4. **Per-turn content goes last**, as the plan and "Don't Break the Cache" already say. The new step is putting *retrieved spans after the recent turns*, which differs from the current plan order (packet, then recent turns). That trades position for cache: test both orders. The completion study above found most-relevant-last helped a little, so placing it near the end may help rather than hurt.

### 7.3 Local runtimes (small-local)

- **llama.cpp server** keeps each slot's KV cache and reprocesses only the tokens after the longest common prefix (33 kept, 12 processed in the tutorial's example). Slot selection by similarity (`-sps`) is unreliable, so pin a slot per chat ([llama.cpp discussion](https://github.com/ggml-org/llama.cpp/discussions/13606)).
- **In the browser**, the runtime is the user's own (Tilde for LFM3), so prefix KV reuse is ours to implement. The same tiering applies, and the payoff is time to first token rather than money. I didn't verify WebLLM's prefix-cache behavior.
- **Position-independent caching** (CacheBlend, EPIC) reuses a chunk's KV cache wherever it appears. EPIC reports 0-7% accuracy loss and up to 3x faster first token than CacheBlend, but needs serving-engine changes ([EPIC](https://arxiv.org/html/2410.15332v3)), so it's out of reach through hosted APIs. A research idea for Tilde's sticky items, not v1.

---

## Top ideas for Long Con from this slice

1. **Identifier-exact symbol prefetch.** Build tree-sitter tag indexes for the working set. When a message has an identifier with exactly one definition, put `path:line` plus the whole enclosing function in the packet. With two or three definitions, pointers only. With more, nothing. *Hypothesis:* on coding turns that name a symbol, first-hop grep or read calls drop by at least 50% against the packet-off arm, with a harm rate under 2%. *Test:* replay coding turns from real history plus ContextBench tasks, and score tool calls avoided and block recall.
2. **Working-set register plus a depth-2 tree, in the sticky tier.** Track files named, pasted or edited in the last N turns, with hashes. Add a tree of their folders under 300 tokens. *Hypothesis:* on follow-up coding turns, "list directory" and "find file" calls drop by at least 40%, and file recall@5 rises over BM25 alone. *Test:* packet-off vs packet on replayed sessions, plus Long Code Arena-style nearest-file scoring.
3. **URL pipeline with query-focused sections.** Fetch with `Accept: text/markdown`, else Defuddle, else Browser Rendering when the page is an empty shell. Split by headings, prepend the title and heading path, keep the top BM25 sections within budget, and add the URL plus a pointer to the cached full text. *Hypothesis:* matches full-page accuracy on the claude profile at 30% of the tokens or less, and beats full-page (truncated) accuracy on small-local by at least 10 points. *Test:* a set of real URL-plus-question pairs, including forums and product pages (where WCXB says extraction fails).
4. **Novelty and freshness detector gating web search.** Lexicon miss (after the user alias register), freshness cue, or low-popularity proper noun triggers a top-3 snippet search, and a definition for unknown terms. *Hypothesis:* on NewTerm-style and post-cutoff questions, small-local accuracy rises by at least 15 points. On popular-fact and false-premise questions accuracy doesn't fall, because the detector doesn't fire. *Test:* NewTerm items, PopQA long-tail vs head, and KUQ false-premise items, scored with the detector on and off.
5. **Open-loop speculation between turns.** When the assistant's reply contains an offer (an open loop), pre-run the read-only lookups the offer names during sleep time, and hold the results for the next turn. *Hypothesis:* on "yes"/"go" turns, the needed result is already in the packet at least 60% of the time, and time to first useful output drops. Wasted lookups stay under 2 per offer. *Test:* replay real history and count offers, acceptances and hits.
6. **A source gate trained on Long Con's own packet misses.** Rules first, then Model2Vec static embeddings plus multi-label logistic regression, with "no source" as a class. Labels come from the first tool call in the packet-off arm. *Hypothesis:* macro-F1 of at least 0.75 for "which source", under 5 ms in the browser, and a lower harm rate than always-retrieve at equal recall. *Test:* cross-validation over labeled replayed turns, then the packet eval with and without the gate.
7. **Episodes, not profiles, on advice and family turns.** People cards with dated pointers plus raw episodes, with no "the user believes X" summaries and the user's own stance on the contested matter left out. *Hypothesis:* lower agreement sycophancy than a profile-summary packet (measured with a 2509.12517-style probe), with equal or better helpfulness ratings. *Test:* a small advice-prompt set rated blind, on claude and small-local.
8. **Ratcheted raw window plus a sticky tier with its own breakpoint.** *Hypothesis:* on the claude profile, cache reads exceed 70% of input tokens over a long session, against well under that for a sliding window, at equal recall. On small-local, median time to first token drops by at least 30%. *Test:* log `cache_read_input_tokens` over a replayed 200-turn session in both modes. Measure time to first token on Tilde with prefix reuse.
9. **Fenced fetched content plus injection canaries.** Label every fetched or searched block as data with its source and time, strip hidden elements, never follow links found inside. Add injected pages to the trick eval set. *Hypothesis:* attack success under 2% on both profiles, with no accuracy loss from the fencing. Datamarking is tested separately, since it may hurt a 1.7B model's reading.
10. **Clock line at the very end.** Local date, weekday, time, and time since the last message, after the new message's packet tail so it never breaks the cache. *Hypothesis:* relative-date questions ("what did I say yesterday", "this weekend") go from frequent errors to near zero, at about 20 tokens. *Test:* a small relative-date canary set.

## Not verified

- Grammar .wasm sizes, rs-trafilatura WASM builds, Model2Vec in JS, and WebLLM prefix caching were not checked.
- Search API prices come from third-party write-ups dated October and November 2026, not vendor pages.
- *When Should LLMs Search?*, OnePred and Speculate While You Reason were read through alphaXiv summaries. CORE-Bench and IndexLM were read through summaries of the full text.
- Boris Cherny's remarks are a secondhand summary. The agent-lsp numbers come from the tool's own author.
- No study was found for a directory tree as context on its own, for "previous advice and outcome" linking, or for open-loop speculation hit rates. Those ideas are hypotheses.
