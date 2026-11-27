// The working-set section: files the chat names, resolved against the active workspace once the chat ties them to
// it, and the folders around them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPacket, estimateTokens, PROFILES, workingSet, type Session } from "../src/index.ts";

const files = [
  "README.md",
  "package.json",
  "apps/cli/src/main.ts",
  "apps/web/src/main.ts",
  "packages/core/package.json",
  "packages/core/src/packet.ts",
  "packages/core/src/profiles.ts",
  "packages/core/src/text.ts",
  "packages/core/test/packet.test.ts",
  "evals/loop/empty-rate.ts",
  "evals/loop/code-pathline.ts",
];
const workspace = { root: "/home/me/long-con", name: "long-con", files };

test("a named file is marked in its folder, with its parent and the parent's other folders", () => {
  const ws = workingSet(["in long-con I changed packages/core/src/packet.ts:92 so the budget holds"], workspace, 300);
  assert.deepEqual(ws.items, ["packages/core/src/packet.ts"]);
  assert.match(ws.text, /^packages\/core\/src\/: \*packet\.ts profiles\.ts text\.ts$/m);
  assert.match(ws.text, /^packages\/core\/: src\/ test\/ package\.json$/m);
  assert.match(ws.text, /^packages\/core\/test\/: packet\.test\.ts$/m, "the sibling test folder answers 'where are the tests'");
  assert.doesNotMatch(ws.text, /evals/, "folders nowhere near the working set stay out");
});

test("diffs, ./ and absolute paths under the root, partial paths and folders all resolve once tied", () => {
  const ws = workingSet(
    ["--- a/README.md\n+++ b/README.md", "see ./evals/loop/empty-rate.ts and /home/me/long-con/packages/core/src/text.ts", "core/src/profiles.ts", "what else is in evals/loop/?", "Long Con question"],
    workspace,
    300,
  );
  assert.deepEqual(ws.items, ["README.md", "evals/loop/empty-rate.ts", "packages/core/src/text.ts", "packages/core/src/profiles.ts", "evals/loop/"]);
});

test("paths that aren't in the workspace, and names with several matches, give nothing", () => {
  for (const text of ["my src/app.tsx crashes on load", "main.ts throws", "bump package.json", "check config.yaml", "use JSON.stringify and e.g. Node.js", "and/or input/output"]) {
    const ws = workingSet([text, "long-con"], workspace, 300);
    assert.equal(ws.text, "", text);
    assert.deepEqual(ws.items, [], text);
  }
});

test("nothing counts until the window ties it to this workspace, whole paths included", () => {
  for (const text of ["my side project's text.ts word-wraps dialogue", "packages/core/src/packet.ts in my other monorepo", "--- a/README.md", "./package.json", "/home/me/long-con-old/packages/core/src/packet.ts", "/home/me/blog/packages/core/src/text.ts", "~/longconference/README.md"]) {
    assert.equal(workingSet([text], workspace, 300).text, "", text);
  }
  // The name, any spelling, or a path under the root (home folder as ~ too) ties; a bare name never does.
  for (const tie of ["long-con", "Long Con", "LONGCON", "/home/me/long-con", "~/long-con/README.md"]) {
    assert.deepEqual(workingSet(["now packages/core/src/text.ts", tie], workspace, 300).items[0], "packages/core/src/text.ts", tie);
  }
  assert.deepEqual(workingSet(["now text.ts", "packages/core/src/packet.ts"], workspace, 300).items, []);
});

test("another project's path unties the window until the workspace is named again", () => {
  const away = (other: string) => workingSet(["fix text.ts there", other, "long-con: packages/core/src/packet.ts"], workspace, 300).items;
  for (const other of ["now /home/me/blog/src/feed.ts", "now ~/code/blog/src/feed.ts", "over in the blog, src/feed.ts", "../blog/text.ts"]) {
    assert.deepEqual(away(other), ["packages/core/src/packet.ts"], other);
  }
  // A folder this workspace has, or a URL, isn't leaving.
  assert.deepEqual(away("new file packages/core/src/feed.ts and https://example.com/a/b.html"), ["packages/core/src/text.ts", "packages/core/src/packet.ts"]);
  // Back again: a later tie brings paths in, and one turn that both leaves and names the workspace stays tied.
  assert.deepEqual(workingSet(["back in long-con, text.ts", "blog: /home/me/blog/a/b.ts", "long-con: packages/core/src/packet.ts"], workspace, 300).items, ["packages/core/src/text.ts", "packages/core/src/packet.ts"]);
  assert.deepEqual(workingSet(["port lib/bm25.ts into long-con's packages/core/src/text.ts"], workspace, 300).items, ["packages/core/src/text.ts"]);
});

test("the section stays under its cap, and keeps the working-set file when a folder is long", () => {
  const big = { ...workspace, files: [...files, ...Array.from({ length: 40 }, (_, i) => `packages/core/src/zz${String(i).padStart(2, "0")}.ts`)] };
  const ws = workingSet(["fix /home/me/long-con/packages/core/src/packet.ts"], big, 80);
  assert.ok(ws.tokens <= 80, `${ws.tokens} tokens`);
  assert.match(ws.text, /\*packet\.ts/);
  assert.match(ws.text, /\+\d+ more/);
  assert.equal(workingSet(["fix /home/me/long-con/packages/core/src/packet.ts"], big, 20).text, "", "nothing fits, so no section");
});

const session: Session = {
  id: "now",
  turns: [
    { role: "user", content: "the long-con packet builder drops notes, look at packages/core/src/packet.ts" },
    { role: "assistant", content: "Found it: the budget is spent before notes run." },
  ],
};

test("buildPacket: no workspace, or no paths in the chat, leaves the packet as it was", () => {
  for (const profile of [PROFILES.claude, PROFILES.smallLocal]) {
    const plain = buildPacket({ history: [session], message: "now add a test for it", profile, currentSessionId: "now" });
    assert.deepEqual(plain.workingSet, []);
    const noPaths = buildPacket({ history: [], message: "how do I sort an array in place?", profile, workspace });
    assert.equal(noPaths.text, buildPacket({ history: [], message: "how do I sort an array in place?", profile }).text);
  }
});

test("buildPacket: the current session's files come in, under the profile's cap", () => {
  for (const profile of [PROFILES.claude, PROFILES.smallLocal]) {
    const plain = buildPacket({ history: [session], message: "now add a test for it", profile, currentSessionId: "now" });
    const packet = buildPacket({ history: [session], message: "now add a test for it", profile, currentSessionId: "now", workspace });
    assert.deepEqual(packet.workingSet, ["packages/core/src/packet.ts"]);
    assert.match(packet.text, /packages\/core\/test\/: packet\.test\.ts/);
    assert.ok(packet.tokens - plain.tokens <= profile.workingSetTokens + 1, `${packet.tokens - plain.tokens} tokens`);
    assert.ok(packet.tokens <= profile.packetTokens);
  }
  // Files from turns older than the profile's window don't count.
  const old: Session = { ...session, turns: [...session.turns, ...Array.from({ length: 30 }, (_, i) => ({ role: "user" as const, content: `filler ${i}` }))] };
  assert.deepEqual(buildPacket({ history: [old], message: "and now?", profile: PROFILES.claude, currentSessionId: "now", workspace }).workingSet, []);
});

test("buildPacket: a tight packet budget drops the section rather than overflowing", () => {
  const message = "fix /home/me/long-con/packages/core/src/packet.ts";
  const plain = buildPacket({ history: [], message, profile: PROFILES.claude });
  const tiny = { ...PROFILES.claude, packetTokens: plain.tokens + 10 };
  const packet = buildPacket({ history: [], message, profile: tiny, workspace });
  assert.ok(packet.tokens <= tiny.packetTokens, `${packet.tokens} > ${tiny.packetTokens}`);
  assert.equal(estimateTokens(packet.text), packet.tokens);
});
