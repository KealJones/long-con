# Novel memory designs

Can we invent a kind of memory nobody has built? Asked on 2026-11-27 (on a call): get agents thinking like great inventors to propose new memory designs, have them fact-check themselves against prior art, and drop anything that is even remotely like existing work. This is the result. Nothing here has been built or measured.

## Short answer

Five agents, each thinking like a different inventor (Einstein, Fermi, Shannon, McClintock, Hopper), proposed 19 designs and searched prior art for each. Two fresh skeptic agents then tried to kill the four strongest. **Two designs survive**, in the sense that no one was found doing the whole thing, though each is built from parts that exist separately:

1. **Silenced-aside pool:** a user sentence the next assistant reply ignored goes into its own small index with its own bar.
2. **Frame-swap admission test:** a model-written index label for a value ("32 → age") is kept only if the model gives the same label when the sentence is moved into a different message from the same user's history.

Everything else is a near miss (the closest work is named below) or dead. The agents also kept converging on the same three ideas (the assistant's reply as a key for the user's sentence, a sentence's residual against its own message's topic, and a separate pool for asides), which is a sign these are the natural moves and therefore already published in some form.

## The problem the designs aim at

The 9 dev misses left at 80.9% all-evidence recall (hybrid BM25 + potion-base-8M meaning search, per-chat 3σ bar):

1. Parents at a Queen show (question: "Who did I go with to the music event last Saturday?")
2. 12 tomato saplings ("What gardening-related activity did I do two weeks ago?")
3. 3 sisters ("What is the total number of siblings I have?")
4. "I'm 32" in an age question inside a Europe-travel message ("How many years older is my grandma than me?")
5. Weddings attended
6. Projects led
7. Work time before NovaTech
8. Instant Pot / Air Fryer: right messages, wrong slices
9. iPhone 13 Pro: half-found preference

Misses 1-4 are side remarks buried in a message about something else. 5-7 need facts from several sessions. Constraints the designs had to respect: no phrase or stopword lists, precision and abstention first ("I'd rather have nothing than incorrect stuff"), cheap deterministic compute with model calls only where needed, raw messages stay the source of truth.

## What the replies actually do (checked on the data)

Several designs hinge on whether the assistant's reply picked up the side remark. Checked on LongMemEval_S for the evidence turns of the misses:

| Miss | Evidence sentence | Did the next reply echo it? |
| --- | --- | --- |
| 1 Queen | "...saw them live with Adam Lambert ... with my parents" | Yes for Queen, no for parents |
| 2 Tomato | "I just planted 12 new tomato saplings today" | Yes ("Congratulations on planting your new tomato saplings!") |
| 3 Sisters | "I come from a family with 3 sisters" | **No** |
| 3 Brother | "I have a brother" | Yes |
| 4 Age | "do you think 32 is considered young or old" | Yes ("32 is a great age... At 32, you're still young") |
| 6 Projects | "I led the data analysis team" | Yes ("experience leading a data analysis team") |
| 7 NovaTech | "I've been working professionally for 9 years" | **No** |
| 8, 9 | Instant Pot, Air Fryer, iPhone 13 Pro | Yes, they were the main topic |

So the reply splits asides into two groups: echoed (the reply restated them, often in words closer to a later question, like "age") and silenced (the reply ignored them, and nothing else in the log repeats them). The two surviving and nearest designs work on those two groups.

## Survivors

### S1. Silenced-aside pool (McClintock)

- **Mechanism:** at write time, score each user sentence's uptake: the highest static-embedding cosine from the sentence to any sentence of the next assistant reply, plus overlap of rare terms. A sentence with low uptake is "silenced": the conversation never took it up. Copy it, raw and keyed on its own words only, into a small aside index with its own per-chat relative bar computed over that small pool. A weak one-word match ("sisters", "working") can clear the bar there, while in the main index it loses to the host message's topic. When a host message is shown, any of its silenced sentences that match the question are pinned into the slice.
- **Misses targeted:** 3 (sisters) and 7 (the 9 years before NovaTech) are both silenced in the data. Not 1, 2 or 4, which were echoed.
- **Cost:** a sentence-by-sentence cosine matrix per turn at write time (microseconds); one extra small index pass per query. No model call, no lists.
- **Closest prior art:**
  - [Demszky et al. 2021, Measuring Conversational Uptake](https://arxiv.org/abs/2106.03873): the uptake metric itself, used to evaluate teacher talk, never to select what to index.
  - [IBM US9002843, extraction of off-topic part from conversation](https://patents.google.com/patent/US9002843B2/en): finds chit-chat in call transcripts by the ratio of how often the customer uses a word to how often the agent does, over sliding windows, to remove it. A corpus-wide word-ratio, not a per-turn reply comparison, and used to discard, not to index. Full claims not read (scanned PDF). **This is the "remotely like it" risk.**
  - [Missed utterance resolutions, US11996098](https://patents.google.com/patent/US11996098) and [orphaned utterance detection, US20160055240](https://patents.google.com/patent/US20160055240A1/en): flag turns the assistant failed to handle, by errors or a classifier. Not meaning overlap, not memory.
  - [SGMem](https://arxiv.org/html/2509.21212v1): sentence-level indexing with a kNN graph; no reply signal, no aside pool.
- **Verdict:** survives as a whole. Both skeptic and inventor found nobody routing sentences into a separate index by whether the reply ignored them.

### S2. Frame-swap admission test (Einstein)

- **Mechanism:** at write time, for value-bearing spans in user sentences (numbers and number words, found by token shape), a small model names the relation (32 → "age", 3 → "sisters / siblings", 12 → "tomato saplings planted"). A label becomes a hidden index key only if (a) the value appears verbatim in the raw sentence and (b) the label is the same when the sentence is transplanted into a different, randomly chosen message from the user's own history and the model is asked again. A label that came from the host topic rather than the sentence (32 → "SPF" in a skincare message) fails the swap and is dropped. Labels are keys only; the raw sentence is what's shown. This is a direct answer to the worry that a model would invent false questions or facts: a label has to survive a test designed to catch the host topic leaking in.
- **Misses targeted:** 4 (age), 3 (sisters), 2 (saplings), 7 (years worked), and the tally side of 5-6 where a count is stated. Not 1 (no value) or 8.
- **Cost:** two small-model calls per value-bearing user sentence at write time (a minority of sentences); nothing extra at query time. This is the one survivor that needs a model, so it would be a labeled ablation like P16.
- **Closest prior art:**
  - [Eywa](https://arxiv.org/abs/2605.30771): stores raw turns and requires hard values in extracted facts to match the source. Covers check (a).
  - [Doc2Query--](https://arxiv.org/abs/2301.03266): filters generated index keys before indexing, by relevance score, not invariance.
  - [The Illusion of Robustness](https://www.alphaxiv.org/abs/2607.12963) and [LLMorph](https://arxiv.org/html/2511.02108v1): add irrelevant context and measure whether model outputs flip. Evaluation and testing only, not a filter.
  - [Contextual entrainment](https://arxiv.org/abs/2505.09338) and [failure of contextual invariance](https://arxiv.org/pdf/2603.23485): document the host-context leak this test catches; no filter proposed.
  - [Entity replacement in relation extraction](https://arxiv.org/abs/2305.13551): swaps the entity, not the surrounding context.
  - Known: LongMemEval fact-augmented keys, Mem0, SelfCheckGPT (sampling consistency, not context swap).
- **Verdict:** the combination survives (context-swap stability used as the admission test for memory keys). Every part exists, so under the strictest reading it is a near miss. Unpublished product internals (Mem0, Zep, Supermemory) could already do something like it.

## Near misses

Each was not found as a whole, but something close exists. Ranked by how useful they look.

| Design (thinker) | Mechanism in one line | Misses | Closest existing work | How it differs |
| --- | --- | --- | --- | --- |
| Echo keys / reply as witness / source map (Fermi, Einstein, Hopper) | Attach the specific reply sentence that echoed a user sentence as extra keys for it, gated by beating the reply's other sentences | 4, 2, 6, 8, 9 | [LongMemEval](https://arxiv.org/abs/2410.10813) round-level keys; [resp2ctxt](https://arxiv.org/pdf/2301.05508); [Seo, Croft & Smith 2009](https://maroo.cs.umass.edu/pub/web/getpdf.php?id=866) reply smoothing in forums; cQA answer-based expansion; anchor text | Sentence-to-sentence, within one turn pair, not whole rounds or posts. It is S1's other half: echoed sentences get the reply's words, silenced ones get their own pool. A toy check found the gain on "how old am I" small with potion (0.19 vs 0.14 for unrelated text) |
| Residual keys: innovation keys, bubble chamber, frame transport, transposon excision (Shannon, Fermi, Einstein, McClintock) | Store each sentence's vector minus its own message's or session's mean, so an aside isn't swamped by its host's topic | 1-3, 8 | [GEM](https://arxiv.org/abs/1810.00438) (word residual against its window); [LEACE / The Medium Is Not the Message](https://aclanthology.org/2025.emnlp-main.1634.pdf); [CDE](https://arxiv.org/abs/2410.02525); [Pooling and Semantic Shift](https://arxiv.org/pdf/2603.21437) names the drowned-minority-sentence problem (fix: chunking); [Fernández, Losada & Azzopardi 2011](https://link.springer.com/content/pdf/10.1007/s10791-010-9146-4.pdf) for the lexical twin | Per-message or per-session residual as a retrieval key. The skeptic showed frame transport's query-side projection does nothing (the residual is already orthogonal to the frame, so only a per-session scale changes), so only the stored residual matters. Shannon's toy on 8 made-up messages widened margins for sisters (0.50 vs 0.18) and tomatoes (0.47 vs 0.13) but not age ("old" and "32" sit at cosine 0.28 in potion) |
| Builder self-test and hoist (Hopper) | At write time, query the real builder with a weakly-connected clause's own rare terms; if its message doesn't come back, hoist the raw clause into its own index and re-probe | 1-3, 9 | [MemDream](https://arxiv.org/pdf/2609.34545) probes its memory with its own pipeline, names a "buried" failure class and repairs by extracting the fact into a new node, then re-probes; [ARGUS](https://arxiv.org/abs/2602.09616); [Chunk Coverage](https://arxiv.org/pdf/2607.18155) | Deterministic, at write time, probe from the clause's own words, fix by moving raw text rather than an LLM writing new text. MemDream is close enough that this is the weakest near miss |
| Injection-recovery calibration (Fermi) | Plant synthetic asides into shadow copies of the user's own messages and refit the gate and veto bars per user by how many are recovered | 1-4 (via bars) | [Artificial Needles](https://arxiv.org/pdf/2406.19292); [GPL](https://arxiv.org/pdf/2112.07577); [Ground Truth First](https://www.alphaxiv.org/abs/2607.21962); e-discovery salting | Online per-user calibration of abstention bars; making the asides needs a model or templates |
| Paralog families (McClintock) | From a tally seed hit, align word-class "skeletons" across sessions (Smith-Waterman) with a shuffled-null threshold for abstention | 5-7, 9 | [Set expansion for list QA](https://aclanthology.org/D08-1099/) (SEAL/DIPRE); [EMem](https://arxiv.org/pdf/2511.17208v2) | Learned skeletons and a null-model bar, applied to personal memory |
| Skeleton siblings (Hopper) | Drain-style log-template mining over user sentences; count distinct sessions per template | 5-7 | [Drain](https://arxiv.org/pdf/1806.04356); EMem; TraceMem | Delexicalized similarity graph; chat rarely repeats phrasing |
| Def-use slicing (Hopper) | When a sentence is shown, include the earlier sentences that define its rare words; pointer if it won't fit | 8, 9 | [Durrett et al. 2016](https://arxiv.org/pdf/1603.08887) anaphoricity constraints; [CLAP](https://arxiv.org/pdf/2508.06941) | Lexical def-use instead of coreference |

## Dead

| Design (thinker) | Killed by |
| --- | --- |
| Antibody repertoire: a fixed bank of generic questions selected by scoring (McClintock) | [Query association](https://ideas.repec.org/a/bla/jamist/v55y2004i7p637-650.html) (Scholer & Williams 2004); doc2query; [immune-inspired IR](https://arxiv.org/pdf/1804.02628) |
| Hole equivalence: index a value as a sentence with a hole the question fills (Einstein) | [Prager et al. 2000, predictive annotation](https://aclanthology.org/A00-1021/) |
| Constant pool: every number with its unit word (Hopper) | [Qsearch](https://mpi-inf.mpg.de/departments/databases-and-information-systems/research/yago-naga/quantity-search/qsearch); [Numbers Matter!](https://arxiv.org/html/2407.10283v1); US9830378 |
| Capture-recapture count guard: estimate missed items from channel overlap (Fermi, Shannon) | [Capture-recapture recall estimation in IR](https://link.springer.com/doi/10.1007/s10791-009-9107-y); [Estimating Omissions from Searches](https://arxiv.org/pdf/1205.1150); TAR stopping rules |
| Turbo exchange: pass only new terms between BM25 and meaning channels (Shannon) | Iterated cross-channel PRF: Rocchio, RM3, [Vector-PRF](https://arxiv.org/abs/2205.00235) |

## If any of this gets tried

The cheapest test is free and needs no model: compute uptake for every user sentence in the dev haystacks, then (a) put the silenced ones in their own pool with their own bar (S1) and (b) add echo sentences as keys for the echoed ones (the echo near miss). Together they cover both groups in the table above. Measure all-evidence recall and false inclusions on the should-be-empty tiers, as every loop run does. S2 needs model calls at write time and is a labeled ablation. Borrow, not invent: [QB-Norm](https://arxiv.org/abs/2112.12777) hubness correction with the user's own past questions as the query bank, for the "noise sits at cosine 0.6" problem.

Known limit across every design: miss 4 ("I'm 32" against "how many years older is my grandma") has no deterministic bridge with potion-base-8M. Only the echo keys (when the reply said "age") or a model label (S2) reach it.

## How this was done

- One general-purpose agent per thinker, each given the system, the 9 misses, the constraints and a list of known prior art (doc2query, HyDE, MemGPT, A-MEM, Zep, Mem0, RAPTOR, GraphRAG, ColBERT, SPLADE, HippoRAG, Threader, proposition indexing, contextual retrieval and others). Each ran at least four searches per design and graded it dead, near miss or survives.
- Two fresh skeptic agents, given only the design descriptions, ran about 30 searches each against the four strongest (uptake routing, builder self-test, frame transport, frame-swap labels).
- Not checked: Google Scholar and Google Patents full text directly, GitHub code search, paywalled full texts, the full claims of US9002843 and US11727703 (scanned PDFs), and the full MemDream paper. No design was run on the dev set. No paid model calls.
