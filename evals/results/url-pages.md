# url-pages: the URL set (P21), with trivial baselines

Set: `evals/sets/url-pages` (18 real pages fetched 2026-11-26, 82 prompts: 56 answerable, 26 should-abstain). Scorer: `node --experimental-strip-types --no-warnings evals/loop/url-pages.ts [--split dev|held-out|all] [--verbose]`, dev by default. Free, no model calls.

## How it's built

- **Pages:** raw HTML as fetched, with URL, date, license and attribution in `manifest.json`. 14 content pages (API docs, a long article, how-tos, a blog post, a release table, a version table, package pages with heavy sidebars and navigation) and 4 failure pages: a real 404 with full site chrome, a bare platform NOT_FOUND, a JS-only app shell, and a bot-challenge page served with HTTP 200 (its inline script and style bodies were emptied; its rendering is unchanged). 3 MB in all. License texts are in `NOTICE`.
- **Gold:** a line range in the page's canonical rendering (`pages/<id>.txt`), made by `evals/loop/canonical-text.ts`. That converter was committed before any page was fetched and is frozen: it strips tags line by line, keeps text order, and does no content detection, so no extractor's rules leak into the labels. A test checks every stored rendering still matches it, and each prompt stores its first gold line's text, which a test checks against the rendering.
- **Section:** each answerable prompt also names the smallest real section holding the answer (heading to the line before the next heading; a func block on pkg.go.dev; one version's entry on the rack version table).
- **Alternate gold:** where the page answers more than once, `gold.alt` lists the other ranges (4 prompts: requests' Python version and author, which repeat in the sidebar; rack's newest version, also first in the table; go-strings' zero-count split, which SplitAfterN states in the same words). The scorer takes the best match.
- **Abstain kinds:** 26 should-abstain prompts: 14 on the page's topic but not answered there, 4 off-topic, 8 on failure pages.
- **Hard prompts:** `sharesRareWord` marks prompts that share a word with a gold range that appears in at most 3 lines of the page. 25 of 56 do; the other 31 are the hard subset. At a 5-line cutoff the hard subset shrinks to 24 (dev: 21 at 3 lines, 14 at 5).
- **Exact asks:** `asksExact` marks prompts that name a number or version string (any digit): 8 answerable and 4 should-abstain (dev: 6 and 3). A digit match is easy for a lexical extractor and a trap when the number sits in the wrong row.
- **Split:** by page, never by prompt. Plain `splitOf` put 11 of 18 pages in held-out with only 1 failure page there, so the split is stratified: within content and failure pages, order by FNV-1a of the id and hold out every third. Dev: 11 pages, 54 prompts (39 answerable). Held-out: 7 pages, 28 prompts (17 answerable).

## Dev baselines

Section hit@1: the candidate's middle line falls in a gold section and the candidate is at most 1,500 tokens (`SECTION_HIT_TOKENS`, the claude block cap from code-pathline), so a whole-page span can't score a hit by where its midpoint lands. Line IoU is the best over gold ranges and counts an abstention as 0. Gold covered: the candidate holds every line of some gold range.

| candidate | section hit@1 | line IoU | gold covered | answerable empty | hard: hit / IoU | abstain right | tokens per non-empty | tokens per prompt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| whole canonical page | 3% | 0.01 | 100% | 0% | 5% / 0.01 (n=21) | 0% (topic 0/9, off 0/2, failure 0/4) | 7,225 | 7,225 |
| BM25 15-line windows, bar 0.5 | 33% | 0.10 | 36% | 46% | 29% / 0.08 (n=21) | 87% (topic 8/9, off 2/2, failure 3/4) | 200 | 85 |

Neither baseline was tuned: 15 lines and a 0.5 coverage bar (share of the prompt's distinct content words in the window) were fixed before the first run. The whole page's one section hit is gem-rails, the only dev page under the token cap (767 tokens), whose midpoint lands in the version list. BM25's one failure-page miss is the 404's not-found notice plus footer navigation (the module name and "packages"), the kind of false inclusion an extractor has to beat. Held-out was not run.

## Limits

- **Hosts:** the session proxy allowed only package-registry hosts. Wikipedia, MDN and go.dev were refused, so there is no encyclopedia page, and 9 of 18 pages come from nodejs.org.
- **Size:** 82 prompts over 18 pages, so one dev prompt is about 2.6 points; differences under about 5 points are noise.
- **One labeler:** the same person picked the pages, wrote the prompts and labeled them. Prompts avoid the gold line's words where a user would, but 25 of 56 still share a rare word.
- **No recent topic:** prompts carry no conversation history.
- **Two failure pages carry no open license:** the 3 KB challenge page and the 79-byte NOT_FOUND are kept as failure fixtures only.
- **The converter is dumb on purpose:** a code comment like `# .env file` renders as a heading-looking line, and a `>` inside an attribute leaks attribute text. Labels account for both; changing the converter means relabeling.
