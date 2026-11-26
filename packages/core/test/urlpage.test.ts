// A pasted URL's page: landmark extraction, failure detection, and the line range that answers a message, or none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlLines, pickRange, readPage } from "../src/urlpage.ts";

const filler = (topic: string, n: number) => Array.from({ length: n }, (_, i) => `<p>Plain sentence ${i} about ${topic} that pads the page to a real length.</p>`).join("\n");

const page = `<html><head><title>Widget Guide</title><script>var nav = "<nav>";</script></head><body>
<header><a href="/">Home</a> Site banner text</header>
<nav><ul><li><a href="/a">Alpha</a></li><li><a href="/b">Beta</a></li></ul></nav>
<main>
<article><header><h1>Widget Guide</h1></header>
<h2>Contents</h2><ul><li><a href="#i">Install</a></li><li><a href="#c">Configure</a></li><li><a href="#t">Troubleshoot</a></li></ul>
<h2 id="i">Install</h2>
${filler("installing", 6)}
<p>Run the installer with the --global flag to put the binary on your path.</p>
<h2 id="c">Configure</h2>
${filler("settings", 6)}
<p>Set retries in widget.toml; the default is three attempts with a backoff.</p>
<p class="x">Status: <i aria-hidden="true">*</i> stable</p>
<div hidden>Secret hidden copy</div>
<aside>Related reading sidebar</aside>
</article>
</main>
<footer>Copyright footer</footer>
</body></html>`;

test("htmlLines: one block per line, real headings get a level, '#' text in code does not", () => {
  const lines = htmlLines("<h2>Intro <b>part</b></h2><p>a&amp;b<br>c</p><pre># .env file\nX=1</pre><table><tr><th>k</th><td>v</td></tr></table><noscript>Enable JS</noscript>");
  assert.deepEqual(lines, [
    { text: "## Intro part", heading: 2 },
    { text: "a&b", heading: 0 },
    { text: "c", heading: 0 },
    { text: "# .env file", heading: 0 },
    { text: "X=1", heading: 0 },
    { text: "| k | v", heading: 0 },
  ]);
});

test("readPage keeps the main landmark and drops chrome, hidden nodes and link-only lists", () => {
  const r = readPage(page);
  const text = r.lines.map((l) => l.text);
  assert.equal(r.title, "Widget Guide");
  assert.equal(r.failure, undefined);
  assert.equal(text[0], "# Widget Guide"); // an article's own header stays
  for (const gone of ["Site banner text", "Alpha", "Contents", "Secret hidden copy", "Related reading sidebar", "Copyright footer"]) assert.ok(!text.some((t) => t.includes(gone)), gone);
  assert.ok(text.includes("## Install") && !text.includes("Troubleshoot"));
  assert.ok(text.includes("Status: stable"), "a dropped inline icon leaves its line whole");
});

test("readPage marks failures: an HTTP error, too little text, a script-only shell", () => {
  assert.equal(readPage(page, 404).failure, "HTTP 404");
  assert.equal(readPage("<html><body><p>Not found.</p></body></html>").failure, "too little readable text");
  const shell = `<html><body><noscript>Please enable JavaScript to continue.</noscript><div id="app">${"Loading the application shell now. ".repeat(8)}</div></body></html>`;
  assert.equal(readPage(shell).failure, "a script-only shell");
  assert.equal(pickRange(readPage(page, 404), "how do I install it globally?"), null);
});

test("pickRange points at the answering lines, inside their section", () => {
  const r = readPage(page);
  const got = pickRange(r, "which flag puts the installer binary on my path? https://example.com/guide");
  assert.ok(got);
  const lines = r.lines.slice(got.start - 1, got.end).map((l) => l.text);
  assert.ok(lines.some((l) => l.includes("--global")));
  assert.ok(got.end - got.start + 1 >= 8 && got.end - got.start + 1 <= 16);
  assert.deepEqual(got.path, ["Widget Guide", "Install"]);
  const retries = pickRange(r, "how many retries by default?");
  assert.ok(retries && r.lines.slice(retries.start - 1, retries.end).some((l) => l.text.includes("three attempts")));
});

test("pickRange abstains when the page doesn't answer", () => {
  const r = readPage(page);
  assert.equal(pickRange(r, "what's a good recipe for banana bread?"), null);
  assert.equal(pickRange(r, "does it support kubernetes helm charts and terraform modules?"), null);
  assert.equal(pickRange(r, "https://example.com/guide"), null);
});
