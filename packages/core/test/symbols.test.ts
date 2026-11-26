// Identifier-exact symbol lookup: what a message that names code gets back, and what a message that doesn't is spared.
import { test } from "node:test";
import assert from "node:assert/strict";
import { identifiersIn, indexSource, lookupSymbols, SymbolIndex } from "../src/symbols.ts";

const ts = `// Packet helpers.
import { x } from "./x.ts";

/** Whole units only. */
export function buildPacket(input: { message: string }): string {
  const re = /[{(]+/g; // brackets in a regex don't count
  const s = "}}}";
  const t = \`\${input.message} {\${"}"}\`;
  return re.source + s + t;
}

export const HISTORY_NOTICE = (since: string) =>
  \`Retrieved from \${since} on.\`;

const LIMITS = { a: 1, b: { c: 2 } } satisfies Record<string, unknown>;

export interface Profile {
  name: string;
  packetTokens: number;
}

export type Resolution =
  | { status: "none" }
  | { status: "resolved"; referent: string };

export class Bm25<T> {
  private docs: T[] = [];

  add(item: T): void {
    if (item) {
      this.docs.push(item);
    }
  }

  search(query: string[], limit = Infinity): T[] {
    return this.docs.slice(0, limit);
  }
}

function search(history: string[]): string[] {
  return history;
}

export enum Mode { A, B }
`;

const py = `import os

def load_slice(path,
    seed=1,
):
    """Read it."""
    with open(path) as f:
        return f.read()

class Store:
    def get(self, key):
        return key

    async def put(self, key, value):
        pass

TOP = 1
`;

const go = `package core

// Index holds definitions.
type Index struct {
\tnames map[string]int
}

func NewIndex() *Index {
\treturn &Index{names: map[string]int{}}
}

func (ix *Index) Lookup(name string) int {
\treturn ix.names[name]
}

const MaxNames = 3
`;

const at = (defs: ReturnType<typeof indexSource>, name: string) => defs.filter((d) => d.name === name).map((d) => `${d.kind}:${d.line}-${d.endLine}`);

test("TS definitions come with their whole block, past braces in strings, templates and regexes", () => {
  const defs = indexSource("src/packet.ts", ts);
  assert.deepEqual(at(defs, "buildPacket"), ["function:5-10"]);
  assert.equal(defs.find((d) => d.name === "buildPacket")!.startLine, 4, "the doc comment above rides along");
  assert.deepEqual(at(defs, "HISTORY_NOTICE"), ["function:12-13"]);
  assert.deepEqual(at(defs, "LIMITS"), ["const:15-15"]);
  assert.deepEqual(at(defs, "Profile"), ["interface:17-20"]);
  assert.deepEqual(at(defs, "Resolution"), ["type:22-24"]);
  assert.deepEqual(at(defs, "Bm25"), ["class:26-38"]);
  assert.deepEqual(at(defs, "add"), ["method:29-33"]);
  assert.deepEqual(at(defs, "search"), ["method:35-37", "function:40-42"]);
  assert.equal(defs.find((d) => d.kind === "method" && d.name === "search")!.container, "Bm25");
  assert.deepEqual(at(defs, "Mode"), ["enum:44-44"]);
  assert.deepEqual(at(defs, "push"), [], "a call inside a method is not a definition");
  assert.deepEqual(at(defs, "re"), [], "locals stay out");
});

test("Python and Go basics", () => {
  const p = indexSource("lib/store.py", py);
  assert.deepEqual(at(p, "load_slice"), ["function:3-8"], "a signature over several lines doesn't end the block early");
  assert.deepEqual(at(p, "Store"), ["class:10-15"]);
  assert.deepEqual(at(p, "put"), ["method:14-15"]);
  assert.equal(p.find((d) => d.name === "get")!.container, "Store");

  const g = indexSource("core/index.go", go);
  assert.deepEqual(at(g, "Index"), ["type:4-6"]);
  assert.deepEqual(at(g, "NewIndex"), ["function:8-10"]);
  assert.deepEqual(at(g, "Lookup"), ["method:12-14"]);
  assert.equal(g.find((d) => d.name === "Lookup")!.container, "Index");
  assert.deepEqual(at(g, "MaxNames"), ["const:16-16"]);
});

test("identifiers need code shape, backticks, call parens or a kind word; English doesn't count", () => {
  const names = (m: string) => identifiersIn(m).map((i) => (i.qualifier ? `${i.qualifier}.${i.name}` : i.name));
  assert.deepEqual(names("where is buildPacket defined?"), ["buildPacket"]);
  assert.deepEqual(names("why is load_slice slow"), ["load_slice"]);
  assert.deepEqual(names("what does `stem` do"), ["stem"]);
  assert.deepEqual(names("is `Bm25.search` right"), ["Bm25.search"]);
  assert.deepEqual(names("why does tokenize() fail"), ["tokenize"]);
  assert.deepEqual(names("add a field to the Profile interface"), ["Profile"]);
  assert.deepEqual(names("the packet is too big and the profile is wrong"), []);
  assert.deepEqual(names("Profile the build, it is slow"), []);
  assert.deepEqual(names("open packages/core/src/packet.ts and README.md"), [], "paths and file names aren't symbols");
  assert.deepEqual(names("thanks, that worked!"), []);
});

const index = new SymbolIndex([
  { path: "src/packet.ts", text: ts },
  { path: "lib/store.py", text: py },
  { path: "core/index.go", text: go },
  { path: "a.ts", text: "export function get() {}\n" },
  { path: "b.ts", text: "export function get() {}\n" },
  { path: "c.ts", text: "export function get() {}\n" },
]);
const roomy = { blockTokens: 1500, packetTokens: 8000 };

test("one definition: path:line and the whole block", () => {
  const out = lookupSymbols("where is buildPacket defined?", index, roomy);
  assert.equal(out.items.length, 1);
  assert.match(out.text, /src\/packet\.ts:5 /);
  assert.match(out.text, /return re\.source \+ s \+ t;\n\}/, "the block runs to its closing brace");
  assert.ok(out.tokens > 0);
});

test("two or three definitions: pointers only, no body", () => {
  const out = lookupSymbols("what does `search` return", index, roomy);
  assert.deepEqual(out.items.map((i) => `${i.def.path}:${i.def.line}`), ["src/packet.ts:35", "src/packet.ts:40"]);
  assert.ok(out.items.every((i) => i.block === undefined));
  assert.doesNotMatch(out.text, /return/);
});

test("a qualifier, a kind word or a named file narrows several definitions to one", () => {
  assert.equal(lookupSymbols("is `Bm25.search` right", index, roomy).items[0]!.block !== undefined, true);
  assert.equal(lookupSymbols("the `get` method in store.py", index, roomy).items.length, 1);
});

test("more than three definitions, a typo or a wrong case: nothing", () => {
  assert.equal(lookupSymbols("what does `get` do", index, roomy).text, "", "four definitions of get");
  assert.equal(lookupSymbols("where is buildPackets defined", index, roomy).text, "");
  assert.equal(lookupSymbols("BuildPacket is broken", index, roomy).text, "");
  assert.equal(lookupSymbols("the packet is too big", index, roomy).text, "");
});

test("a block over the cap becomes a pointer; the packet ceiling is never passed", () => {
  const tight = lookupSymbols("where is buildPacket defined?", index, { blockTokens: 20, packetTokens: 8000 });
  assert.equal(tight.items.length, 1);
  assert.equal(tight.items[0]!.block, undefined);
  assert.match(tight.text, /src\/packet\.ts:5/);
  assert.equal(lookupSymbols("where is buildPacket defined?", index, { blockTokens: 1500, packetTokens: 5 }).text, "");
});
