import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolContext } from "../types";
import { resolveWorkspacePath } from "../pathSafety";

const MAX_GREP_RESULTS = 300;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".turbo", ".cache"]);

function globToRegex(glob: string): RegExp {
  // Minimal glob → regex: supports *, **, ?, character classes.
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^$()|{}\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

export const grepTool: Tool = {
  name: "grep",
  description:
    "Search for a regex pattern inside file(s). Like grep -rn. Returns matches as 'path:line: content'. " +
    "Use this for targeted code search instead of shelling out.",
  schema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regex pattern to search for." },
      path: { type: "string", description: "File or directory to search. Defaults to '.'" },
      glob: { type: "string", description: "Optional filename glob filter, e.g. '*.ts' or '**/*.tsx'." },
      ignore_case: { type: "boolean", description: "Case-insensitive match." },
      max_results: { type: "number", description: `Cap on matches returned (default ${MAX_GREP_RESULTS}).` },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const pattern = args["pattern"] as string;
    const target = (args["path"] as string) ?? ".";
    const glob = args["glob"] as string | undefined;
    const ignoreCase = Boolean(args["ignore_case"]);
    const cap = typeof args["max_results"] === "number" ? (args["max_results"] as number) : MAX_GREP_RESULTS;

    if (!pattern) return 'Error: "pattern" parameter is required.';
    const safe = resolveWorkspacePath(target);
    if (!safe.ok) return `Error: ${safe.error}`;

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, ignoreCase ? "i" : "");
    } catch (e) {
      return `Error: invalid regex: ${(e as Error).message}`;
    }
    const globRe = glob ? globToRegex(glob) : null;

    const results: string[] = [];

    const scanFile = async (filePath: string): Promise<void> => {
      try {
        const rel = path.relative(safe.root, filePath);
        if (globRe && !globRe.test(path.basename(filePath)) && !globRe.test(rel)) return;
        const content = await fs.readFile(filePath, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            results.push(`${rel}:${i + 1}: ${lines[i].slice(0, 240)}`);
            if (results.length >= cap) return;
          }
        }
      } catch { /* binary or unreadable — skip */ }
    };

    const walk = async (dir: string): Promise<void> => {
      if (results.length >= cap) return;
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (results.length >= cap) return;
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
          await walk(path.join(dir, entry.name));
        } else if (entry.isFile()) {
          await scanFile(path.join(dir, entry.name));
        }
      }
    };

    const stat = await fs.stat(safe.path).catch(() => null);
    if (!stat) return `Error: path not found: ${target}`;
    if (stat.isFile()) {
      await scanFile(safe.path);
    } else {
      await walk(safe.path);
    }

    if (results.length === 0) return "No matches found.";
    const truncated = results.length >= cap ? `\n\n… (capped at ${cap} matches)` : "";
    return results.join("\n") + truncated;
  },
};

export const sedTool: Tool = {
  name: "sed",
  description:
    "Regex find-and-replace across a file. Like sed -i. Supports flags (g=global, i=case-insensitive, m=multiline). " +
    "Use dry_run=true to preview the diff without writing. For exact-string single-shot edits, prefer edit_file.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File to edit." },
      pattern: { type: "string", description: "Regex pattern to match." },
      replacement: { type: "string", description: "Replacement string. Supports $1, $2 backrefs." },
      flags: { type: "string", description: "Regex flags: any combination of g, i, m. Default: g." },
      dry_run: { type: "boolean", description: "If true, return the would-be diff and do not write." },
    },
    required: ["path", "pattern", "replacement"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const p = args["path"] as string;
    const pattern = args["pattern"] as string;
    const replacement = args["replacement"] as string;
    const flagsArg = (args["flags"] as string) ?? "g";
    const dryRun = Boolean(args["dry_run"]);

    if (!p || typeof pattern !== "string" || typeof replacement !== "string") {
      return 'Error: "path", "pattern", and "replacement" are required.';
    }
    const safe = resolveWorkspacePath(p);
    if (!safe.ok) return `Error: ${safe.error}`;

    const cleanFlags = flagsArg.replace(/[^gim]/g, "") || "g";
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, cleanFlags);
    } catch (e) {
      return `Error: invalid regex: ${(e as Error).message}`;
    }

    let original: string;
    try {
      original = await fs.readFile(safe.path, "utf-8");
    } catch (e) {
      return `Error reading "${p}": ${(e as Error).message}`;
    }

    const updated = original.replace(regex, replacement);
    if (updated === original) {
      return `No matches for /${pattern}/${cleanFlags} in ${p} — file unchanged.`;
    }

    // Count replacements
    const matches = original.match(new RegExp(pattern, cleanFlags.includes("g") ? cleanFlags : cleanFlags + "g"));
    const count = matches ? matches.length : 1;

    if (dryRun) {
      const before = original.split("\n").length;
      const after = updated.split("\n").length;
      return `[dry_run] ${count} replacement(s) in ${p}. Lines: ${before} → ${after}. Not written.`;
    }

    const ok = await ctx.confirm(`Apply ${count} replacement(s) to ${p}?`);
    if (!ok) return "Action cancelled by user.";

    await fs.writeFile(safe.path, updated, "utf-8");
    await ctx.logger.log(`sed: ${count} replacement(s) in ${p}`);
    return `Applied ${count} replacement(s) to "${p}".`;
  },
};

async function readLines(filePath: string): Promise<string[] | string> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content.split("\n");
  } catch (e) {
    return `Error: ${(e as Error).message}`;
  }
}

export const headFileTool: Tool = {
  name: "head_file",
  description: "Read the first N lines of a file (default 20). Cheap way to peek at large files without flooding context.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File to read." },
      lines: { type: "number", description: "Number of lines (default 20)." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const p = args["path"] as string;
    const n = typeof args["lines"] === "number" ? Math.max(1, args["lines"] as number) : 20;
    if (!p) return 'Error: "path" required.';
    const safe = resolveWorkspacePath(p);
    if (!safe.ok) return `Error: ${safe.error}`;
    const lines = await readLines(safe.path);
    if (typeof lines === "string") return lines;
    return lines.slice(0, n).join("\n") + (lines.length > n ? `\n\n… (${lines.length - n} more lines)` : "");
  },
};

export const tailFileTool: Tool = {
  name: "tail_file",
  description: "Read the last N lines of a file (default 20). Useful for logs.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File to read." },
      lines: { type: "number", description: "Number of lines (default 20)." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const p = args["path"] as string;
    const n = typeof args["lines"] === "number" ? Math.max(1, args["lines"] as number) : 20;
    if (!p) return 'Error: "path" required.';
    const safe = resolveWorkspacePath(p);
    if (!safe.ok) return `Error: ${safe.error}`;
    const lines = await readLines(safe.path);
    if (typeof lines === "string") return lines;
    const start = Math.max(0, lines.length - n);
    return (start > 0 ? `… (${start} earlier lines)\n\n` : "") + lines.slice(start).join("\n");
  },
};

export const countLinesTool: Tool = {
  name: "count_lines",
  description: "Count lines, words, and characters in a file. Like wc.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File to inspect." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const p = args["path"] as string;
    if (!p) return 'Error: "path" required.';
    const safe = resolveWorkspacePath(p);
    if (!safe.ok) return `Error: ${safe.error}`;
    try {
      const content = await fs.readFile(safe.path, "utf-8");
      const lines = content.split("\n").length;
      const words = content.split(/\s+/).filter(Boolean).length;
      const chars = content.length;
      const bytes = Buffer.byteLength(content, "utf-8");
      return `${p}: ${lines} lines · ${words} words · ${chars} chars · ${bytes} bytes`;
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  },
};

export const diffFilesTool: Tool = {
  name: "diff_files",
  description: "Show a unified line-diff between two files. Read-only.",
  schema: {
    type: "object",
    properties: {
      a: { type: "string", description: "First file." },
      b: { type: "string", description: "Second file." },
      context: { type: "number", description: "Context lines around each hunk (default 3)." },
    },
    required: ["a", "b"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const aPath = args["a"] as string;
    const bPath = args["b"] as string;
    const ctxLines = typeof args["context"] === "number" ? (args["context"] as number) : 3;
    if (!aPath || !bPath) return 'Error: "a" and "b" required.';
    const sa = resolveWorkspacePath(aPath);
    if (!sa.ok) return `Error: ${sa.error}`;
    const sb = resolveWorkspacePath(bPath);
    if (!sb.ok) return `Error: ${sb.error}`;

    const a = await readLines(sa.path);
    const b = await readLines(sb.path);
    if (typeof a === "string") return a;
    if (typeof b === "string") return b;

    // Naive line-diff: emit `- a-only`, `+ b-only`, `  =` for common runs.
    // Good enough for short files; for long ones the model can use shell.
    const out: string[] = [`--- ${aPath}`, `+++ ${bPath}`];
    const max = Math.max(a.length, b.length);
    let same = 0;
    let hasDiff = false;
    for (let i = 0; i < max; i++) {
      if (a[i] === b[i]) {
        same++;
        if (same <= ctxLines) out.push(`  ${a[i] ?? ""}`);
      } else {
        same = 0;
        hasDiff = true;
        if (a[i] !== undefined) out.push(`- ${a[i]}`);
        if (b[i] !== undefined) out.push(`+ ${b[i]}`);
      }
    }
    if (!hasDiff) return "Files are identical.";
    return out.join("\n");
  },
};
