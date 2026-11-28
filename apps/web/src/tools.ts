// The model's tools, after Squiggle's (github.com/KealJones/squiggle, app/src/tools/bash.js): one `bash` tool on
// just-bash (a bash interpreter in TypeScript), with custom commands for what a shell in a browser can't do on its
// own. Plus search_history (core's search, the one the packet uses) and Anthropic's own web search and fetch.
//
// Files: /home is kept in this browser (localStorage) between chats; /tmp and the rest live for the page.
// shortcut: no git or gh yet (Squiggle's need isomorphic-git and a GitHub sign-in); add them if Keal wants them here.

import { searchHistory, type Profile, type Session } from "@beep/core";
import { calculate } from "./calc.ts";

export const FILES_KEY = "beep:files";

export const BASH_DESCRIPTION =
  "Run bash: pipes, cat, ls, grep, sed, awk, find, jq, the usual tools. Files: /home (kept in this browser), /tmp. " +
  "Custom commands: curl, wiki, node, bc (`man` lists them, `<command> --help` explains one).";

export const HELP: Record<string, string> = {
  all: `Custom commands here (each has --help):
  curl     curl URL: a web page as readable text (pipe it: curl URL | grep -i word)
  wiki     wiki NAME: what Wikipedia says about something
  node     node -e CODE: run JavaScript
  bc       echo "5*5/129" | bc -l: maths with decimals and %
Everything else is ordinary bash: cat, ls, grep, sed, awk, find, head, tail, wc, sort, jq, pipes, loops.
Files: /home (kept in this browser between chats), /tmp (this page only).
Not here: git, gh. For a web search use the web_search tool; for a page curl can't reach, the web_fetch tool.`,
  curl: `curl URL: fetch a web page and print it as readable text (not HTML). GET only.
  Many sites refuse requests from a browser page; use the web_fetch tool for those.
  curl https://example.com | grep -i -m5 word     find a line without reading the whole page`,
  wiki: `wiki NAME: the opening of the best-matching Wikipedia articles, with their links.   wiki "Emma Stone"`,
  node: `node -e "CODE" | node file.js | echo CODE | node: run JavaScript in a sandbox; prints console.log output
  and the value of the last expression. No network, no files.`,
  bc: `echo "EXPR" | bc -l   (or bc "EXPR"): maths with decimals; also 15% of 240, $1,200 * 3, sqrt(2).
  bash's own $((…)) is whole numbers only.`,
};

/** Tool definitions for the Messages API. Haiku takes the older server-tool versions. */
export function toolDefs(model: string) {
  const basic = model.includes("haiku");
  return [
    {
      name: "bash",
      description: BASH_DESCRIPTION,
      input_schema: {
        type: "object",
        properties: { command: { type: "string", description: 'The command, e.g. ls /home or grep -rn "todo" /home | head' } },
        required: ["command"],
      },
    },
    {
      name: "search_history",
      description: "Search all past chats with the user. Returns the best-matching passages with their dates.",
      input_schema: { type: "object", properties: { query: { type: "string", description: "What to look for" } }, required: ["query"] },
    },
    { type: basic ? "web_search_20250305" : "web_search_20260209", name: "web_search", max_uses: 5 },
    { type: basic ? "web_fetch_20250910" : "web_fetch_20260209", name: "web_fetch", max_uses: 5 },
  ];
}

export interface ToolContext {
  history: Session[];
  profile: Profile;
  /** Where /home is kept; localStorage in the browser, a Map in tests. */
  store?: Pick<Storage, "getItem" | "setItem">;
  fetch?: typeof fetch;
}

export interface ToolRun {
  /** What the model gets back. */
  output: string;
  isError: boolean;
  /** One line for the chat, like "$ ls /home". */
  label: string;
}

export async function runTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolRun> {
  if (name === "search_history") {
    const query = String(input.query ?? "");
    return { output: searchHistory(ctx.history, query, ctx.profile), isError: false, label: `searched past chats for “${query}”` };
  }
  if (name === "bash") return bash(String(input.command ?? "").trim(), ctx);
  return { output: `No tool named ${name}.`, isError: true, label: name };
}

// ── The shell ────────────────────────────────────────────────────────────

type JustBash = typeof import("just-bash/browser");
let lib: Promise<JustBash> | null = null;
let shellFs: InstanceType<JustBash["InMemoryFs"]> | null = null;

/** Forget the page's shell, so it reloads /home from the store (after Delete everything or an import). */
export function resetShell() {
  shellFs = null;
}

async function bash(command: string, ctx: ToolContext): Promise<ToolRun> {
  const label = `$ ${command.replace(/\s+/g, " ").slice(0, 80)}`;
  if (!command) return { output: "The command was empty. Put the whole shell line in command, e.g. ls /home or man.", isError: true, label };
  const L = await (lib ??= import("just-bash/browser"));
  const store = ctx.store ?? globalThis.localStorage;
  if (!shellFs) {
    const saved = JSON.parse(store?.getItem(FILES_KEY) ?? "{}") as Record<string, string>;
    shellFs = new L.InMemoryFs({ "/tmp/.keep": "", ...saved });
    await shellFs.mkdir("/home", { recursive: true });
  }
  const fs = shellFs;
  const shell = new L.Bash({ fs, cwd: "/home", env: { HOME: "/home" }, customCommands: commands(L.defineCommand, ctx), executionLimits: { maxExecutionTimeMs: 60_000 } } as never);
  let r: { stdout: string; stderr: string; exitCode: number };
  try {
    r = await shell.exec(command);
  } catch (e) {
    r = { stdout: "", stderr: String((e as Error)?.message ?? e), exitCode: 1 };
  }
  // Keep /home: every text file under it, as a path → content map.
  const files: Record<string, string> = {};
  for (const p of fs.getAllPaths()) {
    if (!p.startsWith("/home/")) continue;
    if ((await fs.stat(p)).isFile) files[p] = await fs.readFile(p);
  }
  store?.setItem(FILES_KEY, JSON.stringify(files));
  // The whole output, like Squiggle: keeping it short (head, grep, > /tmp/x) is the model's job.
  const parts = [r.stdout, r.stderr && `stderr:\n${r.stderr}`, r.exitCode ? `exit code ${r.exitCode}` : ""].filter(Boolean);
  return { output: parts.join("\n") || "(no output)", isError: false, label: r.exitCode ? `${label} (exit ${r.exitCode})` : label };
}

// ── Custom commands ──────────────────────────────────────────────────────

type Result = { stdout: string; stderr: string; exitCode: number };
type Ctx = { stdin?: string; cwd: string; fs: { readFile(p: string): Promise<string>; resolvePath(base: string, p: string): string } };

const say = (stdout: string): Result => ({ stdout: stdout.endsWith("\n") ? stdout : stdout + "\n", stderr: "", exitCode: 0 });
const fail = (stderr: string): Result => ({ stdout: "", stderr: stderr.endsWith("\n") ? stderr : stderr + "\n", exitCode: 1 });

/** The words of argv that aren't flags, and the value after any flag in `withValue`. */
export function flags(argv: string[], withValue: string[] = []) {
  const out: { _: string[]; [k: string]: string | boolean | string[] } = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const f = /^--?([\w-]+)$/.exec(argv[i]);
    if (f && withValue.includes(f[1]) && i + 1 < argv.length) out[f[1]] = argv[++i];
    else if (f) out[f[1]] = true;
    else out._.push(argv[i]);
  }
  return out;
}

function commands(defineCommand: JustBash["defineCommand"], ctx: ToolContext) {
  const doFetch = ctx.fetch ?? fetch;
  const cmd = (name: string, run: (argv: string[], c: Ctx) => Promise<Result>) =>
    defineCommand(name, async (argv: string[], c: unknown) => (argv.includes("--help") || argv.includes("-h") ? say(HELP[name].trim()) : run(argv, c as Ctx)));

  const curl = cmd("curl", async (argv) => {
    const f = flags(argv, ["o", "H", "X", "d", "A", "m"]);
    const raw = f._.find((a) => /^(https?:\/\/|[\w-]+\.[\w.-]+)/i.test(a));
    if (!raw) return fail("curl: give a URL");
    if (f.X || f.d) return fail("curl here only reads pages (GET)");
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let res: Response;
    try {
      res = await doFetch(url, { redirect: "follow" });
    } catch {
      return fail(`curl: ${new URL(url).host} doesn't allow requests from a browser page. Use the web_fetch tool for it.`);
    }
    const body = await res.text();
    if (res.status >= 400) return fail(`curl: ${url} returned HTTP ${res.status}`);
    const html = /html/i.test(res.headers.get("content-type") ?? "") || /^\s*<(!doctype|html)/i.test(body);
    return say(html ? pageText(body) : body);
  });

  const wiki = cmd("wiki", async (argv) => {
    const query = argv.join(" ").trim();
    if (!query) return fail("usage: wiki <name or question>");
    const p = new URLSearchParams({
      action: "query", format: "json", formatversion: "2", origin: "*", redirects: "1", generator: "search", gsrsearch: query,
      gsrlimit: "3", gsrnamespace: "0", prop: "extracts|info", inprop: "url", exintro: "1", explaintext: "1", exlimit: "3",
    });
    try {
      const data = await (await doFetch(`https://en.wikipedia.org/w/api.php?${p}`)).json();
      const pages = ((data?.query?.pages ?? []) as { title: string; extract?: string; fullurl: string; index: number }[]).sort((a, b) => a.index - b.index);
      if (!pages.length) return fail(`wiki: nothing on Wikipedia for “${query}”`);
      return say(pages.map((pg) => `${pg.title} (${pg.fullurl})\n${(pg.extract ?? "").trim()}`).join("\n\n"));
    } catch (e) {
      return fail(`wiki: ${(e as Error).message}`);
    }
  });

  const node = cmd("node", async (argv, c) => {
    const f = flags(argv, ["e", "eval", "p", "print"]);
    let code = (f.e || f.eval || (f.p || f.print ? `console.log(${f.p || f.print})` : "")) as string;
    if (!code && f._[0]) {
      try { code = await c.fs.readFile(c.fs.resolvePath(c.cwd, f._[0])); } catch { return fail(`node: cannot read ${f._[0]}`); }
    }
    if (!code && c.stdin) code = c.stdin;
    if (!code) return fail('usage: node -e "<code>" | node <file.js>');
    return runJs(code);
  });

  // bc: decimals and percentages (bash's own $((…)) is integers only: 5*5/129 → 0).
  const bc = cmd("bc", async (argv, c) => {
    const exprs = String(c.stdin || argv.filter((a) => !a.startsWith("-")).join(" ")).split(/[\n;]+/).map((s) => s.trim()).filter(Boolean);
    if (!exprs.length) return fail('usage: echo "2.5 * 4" | bc -l');
    const out: string[] = [];
    for (const e of exprs) {
      const r = calculate(e);
      if (r.error) return fail(`bc: ${r.error}`);
      out.push(String(r.result));
    }
    return say(out.join("\n"));
  });

  const man = defineCommand("man", async (argv: string[]) => {
    const page = argv.filter((a) => !a.startsWith("-"))[0];
    if (page && !HELP[page]) return { stdout: "", stderr: `No manual entry for ${page}. Ordinary commands: try ${page} --help. Custom ones: man (no argument).\n`, exitCode: 16 };
    return say(HELP[page ?? "all"].trim());
  });

  return [curl, wiki, node, bc, man];
}

/** A page's readable text: no scripts, styles or hidden parts. Browser only (DOMParser). */
function pageText(html: string): string {
  if (typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,noscript,svg,iframe,template,[hidden],[aria-hidden='true']").forEach((n) => n.remove());
  const title = doc.title.trim();
  const text = (doc.body?.innerText || doc.body?.textContent || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return title ? `${title}\n\n${text}` : text;
}

/** Runs JavaScript in a throwaway Worker with the network switched off, for 10 seconds at most. */
function runJs(code: string): Promise<Result> {
  if (typeof Worker === "undefined") return Promise.resolve(fail("node: no JavaScript sandbox here"));
  const src = `
    for (const k of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts"]) self[k] = () => { throw new Error(k + " is off here"); };
    const out = [];
    const show = (v) => typeof v === "string" ? v : (() => { try { return JSON.stringify(v); } catch { return String(v); } })();
    console.log = console.info = console.warn = console.error = (...a) => out.push(a.map(show).join(" "));
    self.onmessage = async (e) => {
      try {
        const value = await (0, eval)(e.data);
        postMessage({ out, value: value === undefined ? undefined : show(value) });
      } catch (err) { postMessage({ out, error: String(err && err.stack || err) }); }
    };`;
  const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  const worker = new Worker(url);
  return new Promise((done) => {
    const finish = (r: Result) => { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); done(r); };
    const timer = setTimeout(() => finish(fail("node: stopped after 10 seconds")), 10_000);
    worker.onmessage = (e: MessageEvent<{ out: string[]; value?: string; error?: string }>) => {
      const { out, value, error } = e.data;
      const stdout = [...out, ...(value !== undefined && !out.length ? [value] : [])].join("\n");
      finish(error ? { stdout: stdout ? stdout + "\n" : "", stderr: error + "\n", exitCode: 1 } : say(stdout));
    };
    worker.postMessage(code);
  });
}
