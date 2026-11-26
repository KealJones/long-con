// Working set plus a depth-2 tree (P20). The files the chat's recent turns named, pasted or edited, resolved
// against the caller's workspace file list, and the folders around them: each one's own folder, its parent, and
// the parent's other subfolders. Only paths that exist in the workspace are ever listed, so a file the chat
// talked about that isn't there gets nothing rather than a made-up line.

import { estimateTokens } from "./text.ts";

export interface WorkingSet {
  /** Workspace paths the turns name, newest first. A folder ends in "/". */
  items: string[];
  /** The section as the model reads it; "" when nothing resolved or nothing fit. */
  text: string;
  tokens: number;
}

/** Most names on one folder's line; the rest go in a "+N more" count. Working-set names always stay. */
const MAX_ENTRIES = 16;
/** Most working-set items the tree is built around. */
const MAX_ITEMS = 8;

export const WORKING_SET = "Files named in this chat (marked *) and the folders around them, from the workspace file list:";

/**
 * Builds the section from `texts` (newest first: the message, then the recent turns) and the workspace's file
 * paths, relative to its root. The whole section, its title line included, stays within `maxTokens`.
 */
export function workingSet(texts: string[], workspace: string[], maxTokens: number): WorkingSet {
  const ws = indexWorkspace(workspace);
  const items: string[] = [];
  for (const text of texts) {
    // shortcut: a scan of every file per path-like token; index basenames if workspaces grow past a few thousand files.
    for (const token of text.split(/[^\w./@+~-]+/)) {
      const hit = resolvePath(token, ws);
      if (hit && !items.includes(hit)) items.push(hit);
    }
  }
  const lines = renderTree(items.slice(0, MAX_ITEMS), ws, maxTokens - estimateTokens(`${WORKING_SET}\n`));
  if (!lines.length) return { items, text: "", tokens: 0 };
  const text = [WORKING_SET, ...lines].join("\n");
  return { items, text, tokens: estimateTokens(text) };
}

interface Workspace {
  files: Set<string>;
  /** Folder path ("" is the root) to its files' and subfolders' names. */
  dirs: Map<string, { files: string[]; dirs: string[] }>;
}

function indexWorkspace(paths: string[]): Workspace {
  const files = new Set(paths.map((p) => p.replace(/^\.\//, "")).filter(Boolean));
  const dirs = new Map<string, { files: string[]; dirs: string[] }>();
  const dir = (d: string) => dirs.get(d) ?? dirs.set(d, { files: [], dirs: [] }).get(d)!;
  for (const path of files) {
    const parts = path.split("/");
    dir(parts.slice(0, -1).join("/")).files.push(parts.at(-1)!);
    for (let i = 1; i < parts.length; i++) {
      const parent = dir(parts.slice(0, i - 1).join("/"));
      if (!parent.dirs.includes(parts[i - 1]!)) parent.dirs.push(parts[i - 1]!);
    }
  }
  for (const d of dirs.values()) d.files.sort(), d.dirs.sort();
  return { files, dirs };
}

/**
 * One token of chat text to a workspace path, or nothing. Exact paths, a/ and b/ diff prefixes, ./ and absolute
 * paths ending in a workspace path all resolve; a partial path or bare file name resolves only when exactly one
 * workspace file ends with it, so "index.ts" or "package.json" in a repo with several gets nothing, root one
 * included. A folder needs a slash in it and must match exactly.
 */
function resolvePath(raw: string, ws: Workspace): string | undefined {
  const rooted = /^(?:\.\/|[ab]\/)/.test(raw);
  const token = raw.replace(/\.+$/, "").replace(/^(?:\.\/|[ab]\/)/, "");
  if (token.length < 3 || !/[./]/.test(token)) return;
  const folder = token.replace(/\/+$/, "");
  if ((folder.includes("/") || token.endsWith("/")) && folder && ws.dirs.has(folder)) return `${folder}/`;
  if (!/\.[A-Za-z0-9]+$/.test(token)) return;
  const ends = [...ws.files].filter((p) => p.endsWith(`/${token}`));
  if (ws.files.has(token) && (rooted || token.includes("/") || !ends.length)) return token;
  if (ws.files.has(token)) return;
  if (ends.length === 1) return ends[0];
  if (ends.length > 1) return;
  // An absolute or prefixed path: the longest workspace path it ends with, if that path has a folder in it.
  const under = [...ws.files].filter((p) => p.includes("/") && token.endsWith(`/${p}`)).sort((a, b) => b.length - a.length);
  return under[0];
}

/**
 * Folder lines, sorted by path: each item's folder first, then its parent, then the parent's other subfolders,
 * added in that order while they fit. A line that doesn't fit is skipped, never cut mid-name.
 */
function renderTree(items: string[], ws: Workspace, maxTokens: number): string[] {
  const marked = new Set(items);
  const wanted: string[] = [];
  const want = (d: string | undefined) => d !== undefined && ws.dirs.has(d) && !wanted.includes(d) && wanted.push(d);
  for (const item of items) want(folderOf(item));
  for (const item of items) {
    const parent = parentOf(folderOf(item));
    want(parent);
    if (parent !== undefined) for (const sub of ws.dirs.get(parent)?.dirs ?? []) want(join(parent, sub));
  }
  const lines = new Map<string, string>();
  let used = 0;
  for (const d of wanted) {
    const line = folderLine(d, ws, marked);
    const cost = estimateTokens(`${line}\n`);
    if (used + cost > maxTokens) continue;
    used += cost;
    lines.set(d, line);
  }
  // Only lines holding a working-set item, or near one that does, make a section; a lone parent line says little.
  if (![...lines.keys()].some((d) => items.some((i) => folderOf(i) === d))) return [];
  return [...lines.keys()].sort().map((d) => lines.get(d)!);
}

function folderLine(d: string, ws: Workspace, marked: Set<string>): string {
  const { files, dirs } = ws.dirs.get(d)!;
  const names = [...dirs.map((n) => `${n}/`), ...files].map((n) => ({ n, star: marked.has(join(d, n)) }));
  const kept = [...names.filter((x) => x.star), ...names.filter((x) => !x.star)].slice(0, Math.max(MAX_ENTRIES, names.filter((x) => x.star).length));
  const shown = names.filter((x) => kept.includes(x)).map((x) => `${x.star ? "*" : ""}${x.n}`);
  const more = names.length - shown.length;
  return `${d || "."}/: ${shown.join(" ")}${more ? ` +${more} more` : ""}`;
}

/** The folder an item sits in; a folder item is its own. */
const folderOf = (item: string) => (item.endsWith("/") ? item.slice(0, -1) : item.includes("/") ? item.slice(0, item.lastIndexOf("/")) : "");
const parentOf = (d: string) => (d === "" ? undefined : d.includes("/") ? d.slice(0, d.lastIndexOf("/")) : "");
const join = (d: string, n: string) => (d ? `${d}/${n}` : n);
