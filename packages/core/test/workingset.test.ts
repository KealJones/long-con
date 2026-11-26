// The working-set section: files the chat names, resolved against the workspace, and the folders around them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPacket, estimateTokens, PROFILES, workingSet, type Session } from "../src/index.ts";

const workspace = [
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

test("a named file is marked in its folder, with its parent and the parent's other folders", () => {
  const ws = workingSet(["I changed packages/core/src/packet.ts:92 so the budget holds"], workspace, 300);
  assert.deepEqual(ws.items, ["packages/core/src/packet.ts"]);
  assert.match(ws.text, /^packages\/core\/src\/: \*packet\.ts profiles\.ts text\.ts$/m);
  assert.match(ws.text, /^packages\/core\/: src\/ test\/ package\.json$/m);
  assert.match(ws.text, /^packages\/core\/test\/: packet\.test\.ts$/m, "the sibling test folder answers 'where are the tests'");
  assert.doesNotMatch(ws.text, /evals/, "folders nowhere near the working set stay out");
});

test("diffs, ./ and absolute paths, partial paths and folders all resolve", () => {
  const ws = workingSet(
    ["--- a/README.md\n+++ b/README.md", "see ./evals/loop/empty-rate.ts and /home/me/repo/packages/core/src/text.ts", "core/src/profiles.ts", "what else is in evals/loop/?"],
    workspace,
    300,
  );
  assert.deepEqual(ws.items, ["README.md", "evals/loop/empty-rate.ts", "packages/core/src/text.ts", "packages/core/src/profiles.ts", "evals/loop/"]);
});

test("paths that aren't in the workspace, and names with several matches, give nothing", () => {
  for (const text of ["my src/app.tsx crashes on load", "main.ts throws", "bump package.json", "check config.yaml", "use JSON.stringify and e.g. Node.js", "and/or input/output"]) {
    const ws = workingSet([text], workspace, 300);
    assert.equal(ws.text, "", text);
    assert.deepEqual(ws.items, [], text);
  }
});

test("the section stays under its cap, and keeps the working-set file when a folder is long", () => {
  const big = [...workspace, ...Array.from({ length: 40 }, (_, i) => `packages/core/src/zz${String(i).padStart(2, "0")}.ts`)];
  const ws = workingSet(["fix packages/core/src/packet.ts"], big, 80);
  assert.ok(ws.tokens <= 80, `${ws.tokens} tokens`);
  assert.match(ws.text, /\*packet\.ts/);
  assert.match(ws.text, /\+\d+ more/);
  assert.equal(workingSet(["fix packages/core/src/packet.ts"], big, 20).text, "", "nothing fits, so no section");
});

const session: Session = {
  id: "now",
  turns: [
    { role: "user", content: "the packet builder drops notes, look at packages/core/src/packet.ts" },
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
  const plain = buildPacket({ history: [], message: "fix packages/core/src/packet.ts", profile: PROFILES.claude });
  const tiny = { ...PROFILES.claude, packetTokens: plain.tokens + 10 };
  const packet = buildPacket({ history: [], message: "fix packages/core/src/packet.ts", profile: tiny, workspace });
  assert.ok(packet.tokens <= tiny.packetTokens, `${packet.tokens} > ${tiny.packetTokens}`);
  assert.equal(estimateTokens(packet.text), packet.tokens);
});
