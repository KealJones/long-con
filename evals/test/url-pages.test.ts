// The URL set: the frozen canonical converter, the stored renderings that gold ranges point into, and the page split.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalLines, canonicalText } from "../loop/canonical-text.ts";
import { readPage } from "@long-con/core";
import {
  asksExact,
  bm25Windows,
  goldRanges,
  landmarkSections,
  loadPages,
  loadPrompts,
  pageHtml,
  pageRendering,
  pageSplits,
  score,
  SECTION_HIT_TOKENS,
  sharesRareWord,
  toCanonical,
  wholePage,
  type Candidate,
} from "../loop/url-pages.ts";

test("canonical converter strips tags line by line and keeps text order", () => {
  const html = `<html><head><title>T &amp; U</title><style>p{color:red}</style><script>var x = "<p>no</p>";</script></head>
<body><!-- a <p>comment</p> --><nav><a href="/">Home</a> <a href="/b">B</a></nav>
<h2 id="x">Intro <span>part</span></h2><p>One   two<br>three&nbsp;&lt;b&gt; &#8212; &#x41;</p>
<pre>line a
   line b</pre>
<table><tr><th>k</th><td>v</td></tr></table><svg><text>chart</text></svg><template><p>hidden</p></template><p></p><h3></h3></body></html>`;
  assert.deepEqual(canonicalLines(html), ["T & U", "Home B", "## Intro part", "One two", "three <b> — A", "line a", "line b", "| k | v"]);
  assert.equal(canonicalText("<p>a</p><p>b</p>"), "a\nb\n");
  assert.deepEqual(canonicalLines("plain text, no tags\n\n404"), ["plain text, no tags", "404"]);
});

test("every stored rendering is exactly what the frozen converter makes of the stored page", () => {
  for (const page of loadPages()) assert.equal(pageRendering(page.id), canonicalText(pageHtml(page.id)), page.id);
});

test("the split is by page, fixed, covers every page once, and puts content and failure pages on both sides", () => {
  const pages = loadPages();
  const splits = pageSplits(pages);
  assert.deepEqual(pageSplits([...pages].reverse()), splits);
  assert.equal(splits.size, pages.length);
  for (const side of ["dev", "held-out"] as const) {
    const ids = pages.filter((p) => splits.get(p.id) === side);
    assert.ok(ids.some((p) => p.failure) && ids.some((p) => !p.failure), side);
  }
  const held = pages.filter((p) => splits.get(p.id) === "held-out").map((p) => p.id).sort();
  assert.deepEqual(held, ["crates-serde", "gem-rack-versions", "go-strings", "node-dev-prod", "node-env-vars", "node-learn-404", "node-path"]);
});

test("prompts: unique ids, known pages, every gold range inside the rendering and its section, gold text and stored flags match", () => {
  const pages = new Map(loadPages().map((p) => [p.id, p]));
  const prompts = loadPrompts();
  assert.equal(new Set(prompts.map((p) => p.id)).size, prompts.length);
  for (const p of prompts) {
    const page = pages.get(p.page);
    assert.ok(page, p.id);
    assert.equal(p.gold === null, p.kind !== "answer", p.id);
    if (page.failure) assert.equal(p.kind, "abstain-failure", p.id);
    const lines = pageRendering(p.page).split("\n").slice(0, -1);
    assert.equal(p.asksExact, asksExact(p.prompt), p.id);
    if (!p.gold) {
      assert.equal(p.sharesRareWord, false, p.id);
      continue;
    }
    const ranges = goldRanges(p.gold);
    for (const { lines: [a, b], section: [s, e] } of ranges) assert.ok(1 <= s && s <= a && a <= b && b <= e && e <= lines.length, p.id);
    assert.equal(lines[p.gold.lines[0] - 1], p.goldText, p.id);
    assert.equal(p.sharesRareWord, sharesRareWord(p.prompt, lines, ranges.map((g) => g.lines)), p.id);
  }
});

test("scorer: alternate gold ranges count, and a span over the token cap gets no section hit", () => {
  const [p] = loadPrompts().filter((x) => x.id === "pypi-requests-1");
  const alt: Candidate = () => ({ lineStart: 206, lineEnd: 207 });
  const s = score(alt, [p!]);
  assert.deepEqual([s.sectionHits, s.covered, s.iouSum], [1, 1, 1]);
  const huge = score(() => ({ lineStart: 1, lineEnd: 1184 }), [p!]);
  assert.ok(huge.tokens > SECTION_HIT_TOKENS);
  assert.deepEqual([huge.sectionHits, huge.covered], [0, 1]);
});

test("scorer: the whole page covers every gold range and never abstains; BM25 windows abstain on a wordless prompt", () => {
  const prompts = loadPrompts().filter((p) => p.page === "node-blog-v22");
  const whole = score(wholePage, prompts);
  assert.equal(whole.covered, whole.answerable);
  assert.equal(whole.answerableEmpty, 0);
  assert.equal(whole.abstain["abstain-topic"].right, 0);
  assert.equal(bm25Windows()(pageHtml("node-blog-v22"), "and the of it"), null);
  const hit = bm25Windows()(pageHtml("node-blog-v22"), "Maglev compiler short-lived CLI programs");
  assert.ok(hit && hit.lineStart <= 25 && hit.lineEnd >= 26);
});

test("P12: every extracted line of every page maps, in order, onto the canonical rendering", () => {
  assert.deepEqual(toCanonical(["b", "x", "d"], ["a", "b", "c", "d"]), [2, -1, 4]);
  for (const page of loadPages()) {
    const map = toCanonical(readPage(pageHtml(page.id)).lines.map((l) => l.text), canonicalLines(pageHtml(page.id)));
    assert.ok(map.every((n) => n > 0), page.id);
  }
});

test("P12: dev failure pages abstain, and a range comes back in canonical line numbers", () => {
  const pages = new Map(loadPages().map((p) => [p.id, p]));
  const dev = pageSplits(loadPages());
  for (const p of loadPrompts().filter((x) => x.kind === "abstain-failure" && dev.get(x.page) === "dev")) assert.equal(landmarkSections()(pageHtml(p.page), p.prompt, pages.get(p.page)!.status), null, p.id);
  const got = landmarkSections()(pageHtml("node-blog-v22"), "Maglev compiler short-lived CLI programs", 200);
  assert.ok(got && got.lineStart <= 25 && got.lineEnd >= 26);
});
