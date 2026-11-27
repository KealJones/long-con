"""Writes chats.json, the P20 current-project set. Hand-written chats; this script only keeps them in one readable place.
Run from the repo root: python3 evals/sets/working-set-mixed/make.py"""
import json

U, A = "user", "assistant"
LC = "/home/user/long-con"
TP = "/home/user/code/tidepool"


def c(id, kind, turns, message, gold=(), allowed=None, active="long-con"):
    # allowed: the active workspace's files the chat really names for that workspace. Any other starred file is wrong.
    return dict(id=id, kind=kind, active=active, turns=[list(t) for t in turns], message=message, gold=list(gold),
                allowed=list(allowed if allowed is not None else gold))


chats = [
    # named: the window ties the file to the active workspace, the follow-up needs it again
    c("mx-named-bm25-tool", "named", [(U, "in long-con, bm25 scores look flat on short docs"), (A, f"Reading {LC}/packages/core/src/bm25.ts: b is 0.75 and k1 is 1.2, so length normalization is strong.")], "try b at 0.5 and rerun", ["packages/core/src/bm25.ts"]),
    c("mx-named-resolver-bare", "named", [(U, "long con question, the resolver drops pronouns way too early"), (A, "That's in resolver.ts. The first pass strips 'it' before the lookup runs."), (U, "yeah that's the one")], "move that strip after the lookup", ["packages/core/src/resolver.ts"]),
    c("mx-named-tally-home", "named", [(U, "working in ~/long-con today. the tally gate feels too loose"), (A, "packages/core/src/tally.ts reads tallyGate from the profile; it's 0.002 on claude.")], "show me where tally.ts applies it", ["packages/core/src/tally.ts"]),
    c("mx-named-readme-root", "named", [(U, "the Long Con README intro still says Swingset lol"), (A, "README.md line 1 is '# Swingset'. I'll change it to Long Con.")], "also fix the second paragraph while ur in there", ["README.md"]),
    c("mx-named-diff-segments", "named", [(U, "long-con: segments split mid sentence on long turns"), (A, "Here's the fix:\n\n```diff\n--- a/packages/core/src/segments.ts\n+++ b/packages/core/src/segments.ts\n@@ -40,7 +40,7 @@\n-  const parts = turn.content.split(/\\n/);\n+  const parts = turn.content.split(/\\n\\s*\\n/);\n```"), (U, "cool")], "actually revert that, the old split was fine", ["packages/core/src/segments.ts"]),
    c("mx-named-web-style", "named", [(U, "the long-con web app's style.css has dark mode colors wrong"), (A, "apps/web/src/style.css sets --bg under prefers-color-scheme but has no data-theme override.")], "add the override", ["apps/web/src/style.css"]),
    c("mx-named-ci-abs", "named", [(U, "what node does ci use"), (A, f"Read {LC}/.github/workflows/ci.yml: it runs npm test on node 22.")], "add node 24 to the matrix", [".github/workflows/ci.yml"]),
    c("mx-named-eval-recall", "named", [(U, "in the long con repo eval recall prints the readable row wrong"), (A, "evals/src/recall.ts formats that row with toFixed(0); the others use one decimal.")], "make it match the others", ["evals/src/recall.ts"]),
    c("mx-named-long-window", "named", [(U, "ok long-con stuff. notes.ts pulls way too many interest notes"), (A, "packages/core/src/notes.ts keeps every 'I like' sentence, even hypotheticals."), (U, "what counts as hypothetical"), (A, "Sentences with 'would', 'if' or 'might' before the like."), (U, "hm ok"), (A, "Want me to filter those?"), (U, "wait first what does the coverage bar do"), (A, "noteCoverage is the share of the message's idf weight a note group must cover, 0.5 on both profiles."), (U, "ok that's fine"), (A, "So just the hypothetical filter then.")], "yeah do the filter", ["packages/core/src/notes.ts"]),
    c("mx-named-cli-tail", "named", [(U, "long-con's eval cli ignores --profile"), (A, "apps/cli/src/main.ts passes args through, but cli.ts in evals/src reads the profile from an env var.")], "make cli.ts read the flag", ["evals/src/cli.ts"]),
    # sibling: tied, the follow-up needs a file near the named one
    c("mx-sib-bm25-tests", "sibling", [(U, "long-con: add an idf floor to packages/core/src/bm25.ts"), (A, "Added Math.max(idf, 0.01) in score().")], "now add a test in the core test folder", ["packages/core/test/"], ["packages/core/src/bm25.ts", "packages/core/test/"]),
    c("mx-sib-packet-test", "sibling", [(U, "in long con the packet puts code before the working set, flip them"), (A, f"Swapped codeLines and fileLines in {LC}/packages/core/src/packet.ts.")], "update the packet test so it checks the order", ["packages/core/test/packet.test.ts"], ["packages/core/src/packet.ts", "packages/core/test/packet.test.ts"]),
    c("mx-sib-web-chat", "sibling", [(U, "long-con web: rename .bubble to .msg in apps/web/src/style.css"), (A, "Renamed the selector in style.css.")], "and the chat view code that sets that class", ["apps/web/src/chat.ts"], ["apps/web/src/style.css", "apps/web/src/chat.ts"]),
    c("mx-sib-split-urlpages", "sibling", [(U, "change the split seed handling"), (A, f"Edited {LC}/evals/loop/split.ts so splitOf takes an optional seed.")], "the url-pages scorer calls it too, update that call", ["evals/loop/url-pages.ts"], ["evals/loop/split.ts", "evals/loop/url-pages.ts"]),
    c("mx-sib-tally-profiles", "sibling", [(U, "long-con tally gate: packages/core/src/tally.ts uses the profile value right"), (A, "Yes, tallySearch reads profile.tallyGate.")], "then change the small-local number where it's set", ["packages/core/src/profiles.ts"], ["packages/core/src/tally.ts", "packages/core/src/profiles.ts"]),
    c("mx-sib-recall-test", "sibling", [(U, "Long Con: evals/src/recall.ts, round the readable row to one decimal"), (A, "Done, it uses toFixed(1) now.")], "fix the recall test to match", ["evals/test/recall.test.ts"], ["evals/src/recall.ts", "evals/test/recall.test.ts"]),
    c("mx-sib-plan-decisions", "sibling", [(U, "long-con's docs/plan.md should say P20 is retried"), (A, "Added a line under Next in docs/plan.md.")], "log the reason in the decisions doc too", ["docs/decisions.md"], ["docs/plan.md", "docs/decisions.md"]),
    c("mx-sib-ci-pages", "sibling", [(U, "bump node"), (A, f"Set node 24 in {LC}/.github/workflows/ci.yml.")], "the pages workflow pins node too, bump it", [".github/workflows/pages.yml"], [".github/workflows/ci.yml", ".github/workflows/pages.yml"]),
    c("mx-sib-segments-gate", "sibling", [(U, "long-con: packages/core/src/segments.ts now caps units at 400 tokens"), (A, "Yes, segmentTokens comes from the profile.")], "the gate features read unit length too, check that file", ["packages/core/src/gate.ts"], ["packages/core/src/segments.ts", "packages/core/src/gate.ts"]),
    c("mx-sib-cli-package", "sibling", [(U, "long con cli entry is apps/cli/src/main.ts right"), (A, "Yes, it dispatches eval, chat and packet.")], "add a bin entry in that app's package.json", ["apps/cli/package.json"], ["apps/cli/src/main.ts", "apps/cli/package.json"]),
    # mixed: both projects in the window, the follow-up is about the active one
    c("mx-mix-plan-packet", "mixed", [(U, "in long-con, packet.ts adds the working set before the notes"), (A, "Yes, packages/core/src/packet.ts puts fileLines right after codeLines."), (U, "ok switching to tidepool for a sec, its docs/plan.md needs a next section"), (A, "Added '## Next' to tidepool's plan.")], "back to long-con, move the working set after the notes", ["packages/core/src/packet.ts"]),
    c("mx-mix-ci-run", "mixed", [(U, f"{TP}/.github/workflows/ci.yml fails on the deploy step"), (A, "The deploy step needs the pages token in its env."), (U, "fixed. now in long-con evals/src/run.ts crashes on an empty slice"), (A, "run.ts reads slice.ids[0] without checking the length.")], "add the check", ["evals/src/run.ts"]),
    c("mx-mix-tsconfig-pkg", "mixed", [(U, "my blog's ./tsconfig.json has strict off, turn it on"), (A, "Set strict: true in the blog's tsconfig."), (U, "thx. long-con's root ./package.json needs a lint script"), (A, "Added 'lint': 'tsc --noEmit' to package.json.")], "wire that lint into the long-con ci", ["package.json"]),
    c("mx-mix-text", "mixed", [(U, "tidepool's src/text.ts slugify drops accents"), (A, "Use normalize('NFD') before the replace."), (U, "nice. long-con has packages/core/src/text.ts too, does its tokenizer fold accents"), (A, "contentWords lowercases but keeps accents.")], "make it fold them like the blog one", ["packages/core/src/text.ts"]),
    c("mx-mix-vite-gate", "mixed", [(U, "tidepool's vite.config.ts needs base set for gh pages"), (A, "Set base: '/tidepool/' in the config."), (U, f"and for long-con, {LC}/packages/core/src/gate.ts has a stale comment"), (A, "Line 12 still says the weights are from run 2.")], "update it", ["packages/core/src/gate.ts"]),
    c("mx-mix-back", "mixed", [(U, "tidepool's docs/plan.md says rss is done, it isn't"), (A, "Moved rss back under Todo."), (U, "ok back in long-con: packages/core/src/registers.ts recentAnswers"), (A, "It's 2 on claude and 1 on small-local.")], "drop claude to 1", ["packages/core/src/registers.ts"]),
    c("mx-mix-same-turn", "mixed", [(U, "compare long-con's packages/core/src/bm25.ts with the bm25 in my search side project, lib/bm25.ts"), (A, "The side project floors idf at 0.01; long-con doesn't floor it.")], "port the floor into long-con's", ["packages/core/src/bm25.ts"]),
    # switched: tied to the active workspace earlier, then the window moves to another project's files
    c("mx-sw-index-html", "switched", [(U, "long-con web app: chat.ts scroll jumps on every token"), (A, "apps/web/src/chat.ts calls scrollIntoView on each token."), (U, "fix that later. different project now: my blog's index.html is missing og tags"), (A, "Add og:title and og:image to the head.")], "also add a twitter card meta", [], ["apps/web/src/chat.ts"]),
    c("mx-sw-abs-cli", "switched", [(U, "in long-con, cap the groups in notes.ts"), (A, "packages/core/src/notes.ts groupNotes has no cap yet; I'll add one."), (U, f"cool. now {TP}/src/cli.ts, the build command"), (A, "tidepool's build command skips drafts.")], "make cli.ts include drafts behind a flag", [], ["packages/core/src/notes.ts"]),
    c("mx-sw-rel-arch", "switched", [(U, "long-con: tally.ts drops counting words now right"), (A, "Yes, packages/core/src/tally.ts strips them before ranking pieces."), (U, "ok over in tidepool, src/feed.ts builds the rss wrong"), (A, "feed.ts sorts by updated date instead of published.")], "also fix docs/architecture.md there, it describes the old feed", [], ["packages/core/src/tally.ts"]),
    c("mx-sw-forget-name", "switched", [(U, "long-con: prompt.ts says 'packet' twice in the system line"), (A, "packages/core/src/prompt.ts repeats it; I'll trim one."), (U, "ok forget long-con for now, on my portfolio site the style.css grid breaks on mobile"), (A, "The grid uses fixed 300px columns; use minmax.")], "paste the fixed css", [], ["packages/core/src/prompt.ts"]),
    c("mx-sw-scraper-pkg", "switched", [(U, f"{LC}/packages/core/src/chat.ts, where does it trim the history"), (A, "trimHistory near the top keeps the last 40 turns."), (U, "k. unrelated, the scraper repo's ./package.json start script has a typo"), (A, "It says 'nod index.js'.")], "fix ./package.json", [], ["packages/core/src/chat.ts"]),
    c("mx-sw-chat-test", "switched", [(U, "long con: evals/test/judge.test.ts is slow"), (A, "It builds the whole fixture per test."), (U, "meh. switching to my discord bot project, its test/chat.test.ts is flaky"), (A, "It waits on a real timer.")], "use fake timers in chat.test.ts", [], ["evals/test/judge.test.ts"]),
    c("mx-sw-vite-abs", "switched", [(U, "long-con: apps/web/src/main.ts mounts twice in dev"), (A, "StrictMode double-invokes the effect in main.ts."), (U, "fine. /home/user/code/scraper/vite.config.ts now, the proxy is wrong"), (A, "The proxy target points at port 3000; the api runs on 8080.")], "fix the target in vite.config.ts", [], ["apps/web/src/main.ts"]),
    c("mx-sw-garden-plan", "switched", [(U, "Long Con docs: add the P20 retry to docs/research/iteration-log.md"), (A, "Added a run 10 entry for it."), (U, "great. now my garden app, its plan.md is a mess"), (A, "It mixes dates and features in one list.")], "split plan.md into dates and features", [], ["docs/research/iteration-log.md"]),
    c("mx-sw-other-repo-ci", "switched", [(U, f"{LC}/evals/loop/empty-rate.ts takes forever"), (A, "It builds every tier on every history; --tier1-histories caps it."), (U, "ok. other repo question: my blog's .github/workflows/ci.yml caches nothing"), (A, "There's no actions/cache step.")], "add the cache step to .github/workflows/ci.yml", [], ["evals/loop/empty-rate.ts"]),
    c("mx-sw-diff-readme", "switched", [(U, "long-con: symbols.ts misses arrow functions"), (A, "packages/core/src/symbols.ts only looks at function declarations."), (U, "later. dotfiles repo, update the readme install line"), (A, "```diff\n--- a/README.md\n+++ b/README.md\n@@ -1,3 +1,3 @@\n-curl -L dots.sh | sh\n+git clone https://example.com/dots && ./dots/install\n```")], "also mention the macOS step in README.md", [], ["packages/core/src/symbols.ts"]),
    c("mx-sw-model", "switched", [(U, "in long-con, evals/src/estimate.ts prices are old"), (A, "estimate.ts reads prices from evals/src/model.ts."), (U, "unrelated: model.ts in my ml repo loads the weights twice"), (A, "load() runs in the constructor and again in init().")], "cache it in model.ts", [], ["evals/src/estimate.ts", "evals/src/model.ts"]),
    c("mx-sw-old-checkout", "switched", [(U, "long-con's packages/core/src/gate.ts has new weights"), (A, "UNIT_WEIGHTS were refit in run 5."), (U, "what did /home/user/long-con-old/packages/core/src/packet.ts do for the gate back then"), (A, "That checkout used a single minScore check in packet.ts.")], "show me that old packet.ts check", [], ["packages/core/src/gate.ts"]),
    c("mx-mix-scraper-then-lc", "mixed", [(U, "scraper's cli.ts exits 0 on errors"), (A, "main() never sets process.exitCode."), (U, "ok and long-con's evals/src/cli.ts has the same bug"), (A, "It catches and logs without setting the exit code.")], "fix the long-con one", ["evals/src/cli.ts"]),
    c("mx-mix-blog-style-lc-chat", "mixed", [(U, "blog: style.css dark mode is too dark"), (A, "--bg is #000; try #111."), (U, f"cool. long-con side: {LC}/apps/web/src/chat.ts renders markdown twice"), (A, "render() runs on each token and again at the end.")], "only render once at the end", ["apps/web/src/chat.ts"]),
    c("mx-mix-two-plans", "mixed", [(U, "garden app plan.md is done for now"), (A, "Okay."), (U, "long-con's docs/plan.md though needs the run 10 picks"), (A, "Next still lists P13 and P26.")], "replace those with the run 10 picks", ["docs/plan.md"]),
    # active workspace is tidepool (a second, made-up project); long-con talk is the other project here
    c("mx-tp-named", "named", [(U, "tidepool: posts come out in the wrong order"), (A, f"{TP}/src/feed.ts sorts by updated date.")], "sort by published in feed.ts", ["src/feed.ts"], active="tidepool"),
    c("mx-tp-sib-deploy", "sibling", [(U, "in tidepool src/feed.ts now writes rss.xml"), (A, "Yes, feed.ts writes it to dist/.")], "make the deploy script copy it", ["scripts/deploy.sh"], ["src/feed.ts", "scripts/deploy.sh"], active="tidepool"),
    c("mx-tp-sw-text", "switched", [(U, "in tidepool, src/render.ts escapes html twice"), (A, "render.ts calls escape() in the template and again in the helper."), (U, "also long-con's packages/core/src/text.ts has an estimateTokens off by one"), (A, "It rounds down on the last partial word.")], "fix the text.ts one first", [], ["src/render.ts"], active="tidepool"),
    c("mx-tp-empty-plan", "empty", [(U, f"{LC}/docs/plan.md is stale"), (A, "Its Next section still lists P13.")], "update plan.md with the run 9 picks", [], [], active="tidepool"),
    c("mx-tp-empty-bare", "empty", [(U, "long con's src/text.ts and README.md both need the new name"), (A, "Both still say Swingset.")], "do text.ts first", [], [], active="tidepool"),
    # empty: nothing ties the window to the active workspace; names collide with its files
    c("mx-empty-style", "empty", [(U, "my portfolio's style.css has a media query that never fires"), (A, "Check the units; em queries use the browser's default size.")], "paste a fixed style.css"),
    c("mx-empty-cli", "empty", [(U, "cli.ts in my scraper exits 0 on errors"), (A, "main() catches and logs but never sets the exit code.")], "make cli.ts exit 1"),
    c("mx-empty-plan", "empty", [(U, "plan.md for the garden app is a mess"), (A, "It mixes dates and features in one list.")], "reorganize plan.md by month"),
    c("mx-empty-docs-plan", "empty", [(U, "in the other repo docs/plan.md lists done items as todo"), (A, "Three items under Todo are already merged.")], "move them to a done section in docs/plan.md"),
    c("mx-empty-ci", "empty", [(U, "my blog's .github/workflows/ci.yml runs twice per push"), (A, "It triggers on both push and pull_request for the same branch.")], "dedupe the triggers in .github/workflows/ci.yml"),
    c("mx-empty-pkg", "empty", [(U, "./package.json in the scraper has the wrong node engine"), (A, "engines.node says >=16.")], "bump ./package.json to 22"),
    c("mx-empty-abs-arch", "empty", [(U, "/home/user/code/scraper/docs/architecture.md describes the old queue"), (A, "It still talks about the Redis queue.")], "rewrite that section for sqlite"),
    c("mx-empty-diff-tsconfig", "empty", [(U, "dotfiles repo, turn on noUncheckedIndexedAccess"), (A, "```diff\n--- a/tsconfig.json\n+++ b/tsconfig.json\n@@ -3,6 +3,7 @@\n     \"strict\": true,\n+    \"noUncheckedIndexedAccess\": true,\n```")], "revert that, too noisy"),
    c("mx-empty-old-checkout", "empty", [(U, "/home/user/long-con-old/packages/core/src/packet.ts had a simpler gate"), (A, "That checkout's packet.ts used a single minScore check.")], "what did the old gate look like exactly"),
    c("mx-empty-vite", "empty", [(U, "side project: the dev server ignores the port in vite.config.ts"), (A, "Make sure it's under server.port.")], "still on 5173, fix vite.config.ts"),
    c("mx-empty-notes", "empty", [(U, "my notes app's notes.ts crashes on empty input"), (A, "parse() calls lines[0].trim() without a check.")], "guard notes.ts"),
    c("mx-empty-model", "empty", [(U, "model.ts in my ml repo loads the weights twice"), (A, "load() runs in the constructor and again in init().")], "cache it in model.ts"),
    c("mx-empty-chat-test", "empty", [(U, "test/chat.test.ts in the bot project times out"), (A, "It awaits a real 5 second timer.")], "shorten it"),
    c("mx-empty-index", "empty", [(U, "in my other monorepo packages/core/src/index.ts exports way too much"), (A, "It re-exports every internal module.")], "trim packages/core/src/index.ts to the public api"),
    c("mx-empty-nocode", "empty", [(U, "need a name for the cat"), (A, "Biscuit, Miso, or Pixel?")], "something shorter"),
    c("mx-empty-judge", "empty", [(U, "judge.ts in the grading tool gives everyone a B"), (A, "The rubric weights sum to more than 1.")], "normalize them in judge.ts"),
]

TIDEPOOL = ["README.md", "LICENSE", ".gitignore", "package.json", "tsconfig.json", "vite.config.ts", "index.html", "docs/plan.md", "docs/architecture.md", ".github/workflows/ci.yml", "src/main.ts", "src/cli.ts", "src/feed.ts", "src/render.ts", "src/text.ts", "src/chat.ts", "src/style.css", "test/feed.test.ts", "test/chat.test.ts", "scripts/deploy.sh", "content/posts/hello.md", "public/favicon.svg"]

ids = [x["id"] for x in chats]
assert len(ids) == len(set(ids))
out = {
    "note": "P20 current-project set: hand-written chats that mix projects. Split by evals/loop/split.ts splitOf(id). tidepool is a made-up second project.",
    "workspaces": {"long-con": {"root": LC, "name": "long-con", "commit": "bbf0298"}, "tidepool": {"root": TP, "name": "tidepool", "files": TIDEPOOL}},
    "chats": chats,
}
with open("evals/sets/working-set-mixed/chats.json", "w") as f:
    json.dump(out, f, indent=1)
    f.write("\n")
print(len(chats))
