// Working set plus a depth-2 tree (P20). The files the chat's recent turns named, pasted or edited, resolved
// against the caller's active workspace, and the folders around them: each one's own folder, its parent, and the
// parent's other subfolders. Only paths that exist in the workspace are ever listed, so a file the chat talked about
// that isn't there gets nothing rather than a made-up line.
//
// Long Con is one chat across projects, so a path counts only once the window ties it to the active workspace: a
// turn names the workspace or writes a path under its root. A path into another checkout, or a relative path whose
// top folder this workspace doesn't have, unties it until the next tie. A bare file name is never a tie.

import { estimateTokens } from "./text.ts";

/** The project the caller is working in: where it lives, what it's called, and its file paths relative to `root`. */
export interface ActiveWorkspace {
  root: string;
  name: string;
  files: string[];
}

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
 * Builds the section from `texts` (newest first: the message, then the recent turns) and the active workspace.
 * The whole section, its title line included, stays within `maxTokens`.
 */
export function workingSet(texts: string[], workspace: ActiveWorkspace, maxTokens: number): WorkingSet {
  const ws = indexWorkspace(workspace);
  const named = nameMatcher(workspace);
  let tied = false;
  let items: string[] = [];
  // Oldest first, so a later turn can leave the workspace or come back to it. Within one turn a tie wins.
  for (const text of [...texts].reverse()) {
    const tokens = text.split(/[^\w./@+~-]+/);
    if (tokens.some((t) => leaves(t, ws))) tied = false;
    if (named.test(text) || tokens.some((t) => ABSOLUTE.test(t) && underRoot(t, ws) !== undefined)) tied = true;
    if (!tied) continue;
    // shortcut: a scan of every file per path-like token; index basenames if workspaces grow past a few thousand files.
    items = [...tokens.map((t) => resolvePath(t, ws)).filter((p): p is string => !!p), ...items];
  }
  items = [...new Set(items)];
  const lines = renderTree(items.slice(0, MAX_ITEMS), ws, maxTokens - estimateTokens(`${WORKING_SET}\n`));
  if (!lines.length) return { items, text: "", tokens: 0 };
  const text = [WORKING_SET, ...lines].join("\n");
  return { items, text, tokens: estimateTokens(text) };
}

/** The workspace's name or its root folder's name as words: "long-con" also matches "Long Con" and "longcon". */
function nameMatcher({ root, name }: ActiveWorkspace): RegExp {
  const words = (n: string) =>
    n
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .join("[-_ ]?");
  const names = [...new Set([name, root.split("/").filter(Boolean).at(-1) ?? ""].map(words).filter(Boolean))];
  return new RegExp(`(?<![\\w-])(?:${names.join("|")})(?![\\w-])`, "i");
}

interface Workspace {
  /** The root with no trailing slash, and the same with the home folder written as "~". */
  roots: string[];
  files: Set<string>;
  /** Folder path ("" is the root) to its files' and subfolders' names. */
  dirs: Map<string, { files: string[]; dirs: string[] }>;
}

function indexWorkspace({ root, files: paths }: ActiveWorkspace): Workspace {
  const base = root.replace(/\/+$/, "");
  const roots = [...new Set([base, base.replace(/^\/(?:home|Users)\/[^/]+/, "~")])];
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
  return { roots, files, dirs };
}

/** An absolute path: "/x" or "~/x", not a "//host" left from a URL. */
const ABSOLUTE = /^(?:\/(?!\/)|~\/)/;

/** The rest of an absolute path under the workspace root ("" for the root itself), or undefined. */
function underRoot(token: string, ws: Workspace): string | undefined {
  const path = token.replace(/\.+$/, "").replace(/\/+$/, "");
  for (const root of ws.roots) if (path === root || path.startsWith(`${root}/`)) return path.slice(root.length + 1);
  return undefined;
}

/**
 * Whether a token points into another project: an absolute path of two or more parts outside the root, a path
 * climbing out with ../, or a relative file path whose top folder this workspace doesn't have and that is no tail of
 * a workspace file ("lib/bm25.ts" in a repo with no lib/; "core/src/text.ts" stays).
 */
function leaves(raw: string, ws: Workspace): boolean {
  if (ABSOLUTE.test(raw)) return /^~?\/[^/]+\/[\w.@-]/.test(raw) && underRoot(raw, ws) === undefined;
  if (raw.startsWith("../")) return true;
  const token = raw.replace(/\.+$/, "").replace(/^(?:\.\/|[ab]\/)/, "");
  if (!/^[\w.@-]+\/[\w./@-]*\.[A-Za-z0-9]+$/.test(token)) return false;
  return !ws.dirs.has(token.slice(0, token.indexOf("/"))) && ![...ws.files].some((p) => p.endsWith(`/${token}`));
}

/**
 * One token of chat text to a workspace path, or nothing. Exact paths, a/ and b/ diff prefixes, ./ paths and
 * absolute paths under the root resolve as written; an absolute path anywhere else never does. A partial path or
 * bare file name resolves only when exactly one workspace file ends with it, so "index.ts" or "package.json" in a
 * repo with several gets nothing, root one included. A folder needs a slash and must match exactly.
 */
function resolvePath(raw: string, ws: Workspace): string | undefined {
  if (ABSOLUTE.test(raw)) {
    const rest = underRoot(raw, ws);
    if (!rest) return undefined;
    if (ws.files.has(rest)) return rest;
    return ws.dirs.has(rest) ? `${rest}/` : undefined;
  }
  const rooted = /^(?:\.\/|[ab]\/)/.test(raw);
  const token = raw.replace(/\.+$/, "").replace(/^(?:\.\/|[ab]\/)/, "");
  if (token.length < 3 || !/[./]/.test(token)) return undefined;
  const folder = token.replace(/\/+$/, "");
  if ((folder.includes("/") || token.endsWith("/")) && folder && ws.dirs.has(folder)) return `${folder}/`;
  if (!/\.[A-Za-z0-9]+$/.test(token)) return undefined;
  const ends = [...ws.files].filter((p) => p.endsWith(`/${token}`));
  if (ws.files.has(token)) return rooted || token.includes("/") || !ends.length ? token : undefined;
  return ends.length === 1 ? ends[0] : undefined;
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
