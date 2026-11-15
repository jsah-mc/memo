import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ignore from "ignore";

export type SlashCommand = {
  name: string;
  args?: string;
  description: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/help", description: "list commands" },
  { name: "/clear", description: "clear conversation" },
  { name: "/retry", description: "resend last message" },
  { name: "/status", description: "show gateway and bot status" },
  { name: "/model", args: "[name]", description: "pick or set model" },
  { name: "/bot", args: "[name]", description: "switch bots" },
  { name: "/bot create", args: "", description: "set up a new bot" },
  { name: "/bot set", args: "<bot>", description: "activate a bot" },
  { name: "/bots", description: "list bots" },
  { name: "/apps", description: "list connected apps" },
  { name: "/apps connect", args: "<app>", description: "log in to an app" },
  { name: "/apps find", args: "<query>", description: "search app catalog" },
  { name: "/setup", description: "create a bot" },
  { name: "/settings", description: "open settings" },
  { name: "/voice", description: "toggle Gemini Live voice mode" },
  { name: "/quit", description: "exit" },
];

export type CompletionItem = {
  label: string;
  hint?: string;
  value: string;
};

/**
 * Fzy-style fuzzy match: every query char must appear in order. Scores
 * reward consecutive runs, word/separator boundaries, camelCase humps,
 * and early matches; gaps and leading offsets cost score.
 */
export function fuzzyScore(query: string, candidate: string): number {
  const q = query.toLocaleLowerCase();
  const c = candidate.toLocaleLowerCase();
  if (!q) return 0;
  if (q.length > c.length) return -1;

  const isBoundary = (index: number) => {
    if (index === 0) return true;
    const prev = c[index - 1];
    const curr = c[index];
    return (
      /[^a-z0-9]/.test(prev) ||
      (prev >= "a" && prev <= "z" && curr >= "A" && curr <= "Z")
    );
  };

  // Greedy leftmost match with lookahead: prefer a boundary position
  // when the same char appears later.
  const positions: number[] = [];
  let ci = 0;
  for (let qi = 0; qi < q.length; qi += 1) {
    const ch = q[qi];
    let found = -1;
    let fallback = -1;
    for (; ci < c.length; ci += 1) {
      if (c[ci] !== ch) continue;
      if (fallback === -1) fallback = ci;
      if (isBoundary(ci)) {
        found = ci;
        break;
      }
      // Keep scanning a few chars for a boundary match.
      if (ci - fallback > 8) break;
    }
    const pick = found !== -1 ? found : fallback;
    if (pick === -1) return -1;
    positions.push(pick);
    ci = pick + 1;
  }

  let score = 0;
  let streak = 0;
  for (let i = 0; i < positions.length; i += 1) {
    const pos = positions[i];
    score += 1;
    if (i > 0 && pos === positions[i - 1] + 1) {
      streak += 1;
      score += 4 + streak * 2;
    } else {
      streak = 0;
      if (isBoundary(pos)) score += 7;
      else if (pos === 0) score += 8;
    }
    if (i === 0) score -= pos * 0.2;
  }
  score -= c.length * 0.01;
  return score;
}

/** Query text when the input is a lone "/partial" token. */
export function slashQuery(input: string): string | null {
  if (!input.startsWith("/")) return null;
  if (/\s/.test(input)) return null;
  return input.slice(1);
}

/** Location of a trailing "@partial" file token, if any. */
export function fileQuery(
  input: string,
): { start: number; query: string } | null {
  const match = /(^|\s)@([^\s@]*)$/.exec(input);
  if (!match) return null;
  return { start: match.index + match[1].length, query: match[2] };
}

export function commandCompletions(query: string, limit = 100): CompletionItem[] {
  return SLASH_COMMANDS.map((command) => {
    const name = command.args ? `${command.name} ${command.args}` : command.name;
    return {
      label: name,
      hint: command.description,
      value: command.args ? `${command.name} ` : command.name,
      score: fuzzyScore(query, command.name),
    };
  })
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ label, hint, value }) => ({ label, hint, value }));
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  ".venv",
  "__pycache__",
  ".next",
  "coverage",
]);
const MAX_FILES = 4000;
const MAX_DEPTH = 6;

type FileEntry = { path: string; isDir: boolean };

const fileCache = new Map<string, FileEntry[]>();

type IgnoreRule = { base: string; matcher: ReturnType<typeof ignore> };

function loadIgnoreRules(dir: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  try {
    const content = readFileSync(join(dir, ".gitignore"), "utf8");
    if (content.trim()) {
      rules.push({ base: dir, matcher: ignore().add(content) });
    }
  } catch {
    // No .gitignore in this directory.
  }
  return rules;
}

function isIgnored(path: string, isDir: boolean, rules: IgnoreRule[]): boolean {
  for (const rule of rules) {
    const rel = relative(rule.base, path).split(sep).join("/");
    if (!rel) continue;
    if (rule.matcher.ignores(rel) || (isDir && rule.matcher.ignores(`${rel}/`))) {
      return true;
    }
  }
  return false;
}

export function listFiles(cwd: string): FileEntry[] {
  const cached = fileCache.get(cwd);
  if (cached) return cached;
  const files: FileEntry[] = [];
  const walk = (dir: string, depth: number, rules: IgnoreRule[]) => {
    if (files.length >= MAX_FILES || depth > MAX_DEPTH) return;
    const localRules = [...rules, ...loadIgnoreRules(dir)];
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      const isDir = entry.isDirectory();
      if (isIgnored(full, isDir, localRules)) continue;
      if (isDir) {
        files.push({ path: full, isDir: true });
        walk(full, depth + 1, localRules);
      } else if (entry.isFile()) {
        files.push({ path: full, isDir: false });
      }
    }
  };
  walk(cwd, 0, []);
  fileCache.set(cwd, files);
  return files;
}

export function fileCompletions(
  cwd: string,
  query: string,
  limit = 100,
): CompletionItem[] {
  const scored = listFiles(cwd)
    .map((entry) => {
      const rel = entry.path
        .slice(cwd.length)
        .replace(/\\/g, "/")
        .replace(/^\//, "");
      const base = rel.split("/").pop() ?? rel;
      const score = Math.max(fuzzyScore(query, rel), fuzzyScore(query, base));
      return { rel, score, isDir: entry.isDir };
    })
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.rel.length - b.rel.length);

  return scored.slice(0, limit).map(({ rel, isDir }) => ({
    label: isDir ? `${rel}/` : rel,
    value: isDir ? `@${rel}/` : `@${rel} `,
  }));
}

/** Invalidate the file cache (e.g. after files change). */
export function clearFileCache(): void {
  fileCache.clear();
}
