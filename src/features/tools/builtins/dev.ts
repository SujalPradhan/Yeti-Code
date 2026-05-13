import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import chalk from "chalk";
import type { Tool, ToolContext } from "../types";
import { resolveWorkspacePath } from "../pathSafety";

const DEFAULT_TIMEOUT_MS = 60_000;
const LONG_TIMEOUT_MS = 5 * 60_000;

interface SpawnOpts {
  cmd: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  label: string;
}

async function spawnCapture({ cmd, args, cwd, timeoutMs, label }: SpawnOpts): Promise<string> {
  return new Promise<string>((resolve) => {
    process.stdout.write(chalk.dim(`\n  ┌─ ${label} ──────────────────────────────\n`));
    const child = spawn(cmd, args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
      const s = d.toString();
      process.stdout.write(chalk.cyan(s));
      stdout += s;
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    const timer = setTimeout(() => {
      child.kill();
      process.stdout.write(chalk.dim("\n  └────────────────────────────────────────\n"));
      resolve(`Error: ${label} timed out after ${Math.round(timeoutMs / 1000)}s.\nstderr:\n${stderr}`);
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      process.stdout.write(chalk.dim("\n  └────────────────────────────────────────\n"));
      if (code !== 0) {
        resolve(`Exit ${code}.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
      } else {
        resolve(stdout || `(${label} succeeded with no output)`);
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      process.stdout.write(chalk.dim("\n  └────────────────────────────────────────\n"));
      resolve(`Error launching ${label}: ${err.message}`);
    });
  });
}

// ── npm ────────────────────────────────────────────────────────────────────
// Allowlist of subcommands. Anything else falls through with a hint.
const NPM_ALLOWED = new Set([
  "install", "i", "ci", "run", "test", "start",
  "ls", "list", "outdated", "audit", "view", "info", "version", "search", "exec",
]);
const NPM_DESTRUCTIVE = new Set(["install", "i", "ci", "exec"]);

export const npmTool: Tool = {
  name: "npm",
  description:
    "Run an npm subcommand. Allowed: install, ci, run <script>, test, start, ls, outdated, audit, view, info, version, search, exec. " +
    "Destructive ones (install, ci, exec) prompt for confirmation. 5-minute timeout.",
  schema: {
    type: "object",
    properties: {
      subcommand: { type: "string", description: "e.g. 'install', 'run', 'test', 'ls'." },
      args: {
        type: "array",
        items: { type: "string" },
        description: "Additional args, e.g. ['build'] for 'npm run build', or ['lodash'] for 'npm install lodash'.",
      },
      cwd: { type: "string", description: "Working directory. Defaults to workspace root." },
    },
    required: ["subcommand"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const sub = (args["subcommand"] as string)?.toLowerCase();
    const extra = Array.isArray(args["args"]) ? (args["args"] as unknown[]).map(String) : [];
    const cwdArg = (args["cwd"] as string) ?? ".";
    if (!sub) return 'Error: "subcommand" required.';
    if (!NPM_ALLOWED.has(sub)) {
      return `Error: npm subcommand "${sub}" is not on the allowlist. Allowed: ${[...NPM_ALLOWED].join(", ")}.`;
    }
    const safeCwd = resolveWorkspacePath(cwdArg);
    if (!safeCwd.ok) return `Error: ${safeCwd.error}`;

    if (NPM_DESTRUCTIVE.has(sub)) {
      const ok = await ctx.confirm(`Run: npm ${sub} ${extra.join(" ")} (in ${cwdArg})?`);
      if (!ok) return "Action cancelled by user.";
    }

    await ctx.logger.log(`npm ${sub} ${extra.join(" ")} (cwd=${safeCwd.path})`);
    return spawnCapture({
      cmd: "npm",
      args: [sub, ...extra],
      cwd: safeCwd.path,
      timeoutMs: LONG_TIMEOUT_MS,
      label: `npm ${sub}`,
    });
  },
};

// ── git (read-only) ────────────────────────────────────────────────────────
const GIT_READONLY = new Set([
  "status", "log", "diff", "show", "blame", "branch", "remote",
  "ls-files", "rev-parse", "describe", "config", "tag", "stash",
]);

export const gitTool: Tool = {
  name: "git",
  description:
    "Run a read-only git command. Allowed: status, log, diff, show, blame, branch, remote, ls-files, rev-parse, describe, config, tag, stash. " +
    "Use shell for write operations (commit, push, etc.) so the user can review them explicitly.",
  schema: {
    type: "object",
    properties: {
      subcommand: { type: "string", description: "e.g. 'status', 'log', 'diff'." },
      args: {
        type: "array",
        items: { type: "string" },
        description: "Additional args, e.g. ['--oneline', '-n', '10'] for 'git log --oneline -n 10'.",
      },
      cwd: { type: "string", description: "Working directory. Defaults to workspace root." },
    },
    required: ["subcommand"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const sub = (args["subcommand"] as string)?.toLowerCase();
    const extra = Array.isArray(args["args"]) ? (args["args"] as unknown[]).map(String) : [];
    const cwdArg = (args["cwd"] as string) ?? ".";
    if (!sub) return 'Error: "subcommand" required.';
    if (!GIT_READONLY.has(sub)) {
      return `Error: git "${sub}" is not on the read-only allowlist. Use the shell tool (with user confirmation) for write operations.`;
    }
    const safeCwd = resolveWorkspacePath(cwdArg);
    if (!safeCwd.ok) return `Error: ${safeCwd.error}`;

    await ctx.logger.log(`git ${sub} ${extra.join(" ")}`);
    return spawnCapture({
      cmd: "git",
      args: [sub, ...extra],
      cwd: safeCwd.path,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      label: `git ${sub}`,
    });
  },
};

// ── find_files (glob) ──────────────────────────────────────────────────────
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".turbo", ".cache"]);

function globToRegex(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { re += ".*"; i++; }
      else re += "[^/]*";
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

export const findFilesTool: Tool = {
  name: "find_files",
  description:
    "Find files matching a glob pattern. Patterns support *, **, ?. Skips node_modules, .git, dist, build, .next.",
  schema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob to match against the relative path, e.g. '**/*.ts', 'src/**/*.test.ts'." },
      dir: { type: "string", description: "Directory to start in. Default '.'." },
      max_results: { type: "number", description: "Cap (default 200)." },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const pattern = args["pattern"] as string;
    const dir = (args["dir"] as string) ?? ".";
    const cap = typeof args["max_results"] === "number" ? (args["max_results"] as number) : 200;
    if (!pattern) return 'Error: "pattern" required.';
    const safe = resolveWorkspacePath(dir);
    if (!safe.ok) return `Error: ${safe.error}`;
    const re = globToRegex(pattern);

    const results: string[] = [];
    const walk = async (d: string): Promise<void> => {
      if (results.length >= cap) return;
      const entries = await fs.readdir(d, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        if (results.length >= cap) return;
        const full = path.join(d, e.name);
        const rel = path.relative(safe.root, full);
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
          await walk(full);
        } else if (e.isFile()) {
          if (re.test(rel) || re.test(e.name)) results.push(rel);
        }
      }
    };
    await walk(safe.path);

    if (results.length === 0) return `No files match "${pattern}" in ${dir}.`;
    const truncated = results.length >= cap ? `\n\n… (capped at ${cap})` : "";
    return results.join("\n") + truncated;
  },
};

// ── run_script ─────────────────────────────────────────────────────────────
// Auto-detect interpreter from extension. Useful for executing helper scripts
// without the model needing to remember shebang/interpreter syntax.
const INTERPRETERS: Record<string, { cmd: string; args: string[] }> = {
  ".sh": { cmd: "bash", args: [] },
  ".bash": { cmd: "bash", args: [] },
  ".zsh": { cmd: "zsh", args: [] },
  ".js": { cmd: "node", args: [] },
  ".mjs": { cmd: "node", args: [] },
  ".cjs": { cmd: "node", args: [] },
  ".ts": { cmd: "npx", args: ["ts-node"] },
  ".py": { cmd: "python3", args: [] },
  ".rb": { cmd: "ruby", args: [] },
};

export const runScriptTool: Tool = {
  name: "run_script",
  description:
    "Execute a script file from the workspace, auto-selecting the interpreter by extension " +
    "(.sh→bash, .js/.mjs→node, .ts→ts-node, .py→python3, .rb→ruby). Prompts for confirmation. 1-minute timeout.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the script file." },
      args: { type: "array", items: { type: "string" }, description: "Arguments to pass to the script." },
      cwd: { type: "string", description: "Working directory. Defaults to workspace root." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const scriptPath = args["path"] as string;
    const scriptArgs = Array.isArray(args["args"]) ? (args["args"] as unknown[]).map(String) : [];
    const cwdArg = (args["cwd"] as string) ?? ".";
    if (!scriptPath) return 'Error: "path" required.';
    const safe = resolveWorkspacePath(scriptPath);
    if (!safe.ok) return `Error: ${safe.error}`;
    const safeCwd = resolveWorkspacePath(cwdArg);
    if (!safeCwd.ok) return `Error: ${safeCwd.error}`;

    const ext = path.extname(safe.path).toLowerCase();
    const interp = INTERPRETERS[ext];
    if (!interp) {
      return `Error: no interpreter mapped for "${ext}". Use the shell tool for this file type.`;
    }

    const ok = await ctx.confirm(`Run ${interp.cmd} ${[...interp.args, scriptPath, ...scriptArgs].join(" ")}?`);
    if (!ok) return "Action cancelled by user.";

    await ctx.logger.log(`run_script: ${interp.cmd} ${scriptPath} ${scriptArgs.join(" ")}`);
    return spawnCapture({
      cmd: interp.cmd,
      args: [...interp.args, safe.path, ...scriptArgs],
      cwd: safeCwd.path,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      label: `${interp.cmd} ${path.basename(scriptPath)}`,
    });
  },
};
