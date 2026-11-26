// The canonical plain-text rendering of a saved HTML page, which the URL set's gold line ranges point into.
// FROZEN: written before any URL extractor existed and never tuned against the set. Changing it moves every gold
// label, so a change means relabeling evals/sets/url-pages from scratch, not editing this file.
//
// Deliberately dumb: no main-content detection, no chrome removal. It drops what is never text (comments, script,
// style, template, svg), breaks lines at raw newlines and block tags, strips the remaining tags, decodes entities,
// collapses spaces and drops blank lines. Text order is kept. Headings get a "#" prefix per level, table cells a " | ".

const DROP = /<!--[\s\S]*?-->|<(script|style|template|svg)\b[\s\S]*?<\/\1\s*>/gi;
const BLOCK =
  /<\/?(?:address|article|aside|blockquote|br|caption|dd|details|dialog|div|dl|dt|fieldset|figcaption|figure|footer|form|header|hr|li|main|nav|ol|p|pre|section|summary|table|tbody|thead|tfoot|title|tr|ul)\b[^>]*>/gi;
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", copy: "©", reg: "®", trade: "™", times: "×", middot: "·", laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", deg: "°" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** The page as lines of plain text. Line n of the rendering is lines[n - 1]. */
export function canonicalLines(html: string): string[] {
  const text = html
    .replace(DROP, " ")
    .replace(/<h([1-6])\b[^>]*>/gi, (_, n: string) => `\n${"#".repeat(Number(n))} `)
    .replace(/<\/h[1-6]\s*>/gi, "\n")
    .replace(/<t[dh]\b[^>]*>/gi, " | ")
    .replace(BLOCK, "\n")
    .replace(/<[^>]*>/g, "");
  return text
    .split(/\r?\n/)
    .map((line) => decode(line).replace(/\s+/g, " ").trim())
    .filter((line) => line && !/^#+$/.test(line));
}

export const canonicalText = (html: string) => canonicalLines(html).join("\n") + "\n";
