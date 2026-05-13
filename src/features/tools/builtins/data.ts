/**
 * data.ts — Tools for the course's data-analysis modules.
 *
 * sql_query   — run SQL against a CSV/Parquet/SQLite file via the DuckDB CLI.
 * python_eval — evaluate a short Python expression / script with python3.
 * pdf_to_md   — convert a PDF to markdown via pdftotext (poppler).
 *
 * Each shells out to a locally-installed CLI. If the CLI is missing, we
 * return a clear "install X" hint instead of a cryptic spawn error.
 */

import { spawn } from "child_process";
import * as path from "path";
import chalk from "chalk";
import type { Tool, ToolContext } from "../types";
import { resolveWorkspacePath } from "../pathSafety";

const TIMEOUT_MS = 60_000;

interface SpawnResult { stdout: string; stderr: string; code: number | null; timedOut: boolean; }

function runQuiet(cmd: string, args: string[], opts: { cwd?: string; input?: string; timeoutMs?: number; stream?: boolean; label?: string } = {}): Promise<SpawnResult> {
  return new Promise((resolve) => {
    if (opts.stream && opts.label) {
      process.stdout.write(chalk.dim(`\n  ┌─ ${opts.label} ──────────────────────────────\n`));
    }
    const child = spawn(cmd, args, { cwd: opts.cwd ?? process.cwd(), shell: false });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      if (opts.stream) process.stdout.write(chalk.cyan(s));
    });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs ?? TIMEOUT_MS);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (opts.stream && opts.label) {
        process.stdout.write(chalk.dim("\n  └────────────────────────────────────────\n"));
      }
      resolve({ stdout, stderr, code, timedOut });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      if (opts.stream && opts.label) {
        process.stdout.write(chalk.dim("\n  └────────────────────────────────────────\n"));
      }
      resolve({ stdout, stderr: stderr + err.message, code: null, timedOut });
    });

    if (opts.input !== undefined) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
  });
}

function missingCliHint(cmd: string, installHint: string): string {
  return `Error: "${cmd}" is not on PATH. Install it: ${installHint}`;
}

// ── sql_query (DuckDB) ─────────────────────────────────────────────────────
export const sqlQueryTool: Tool = {
  name: "sql_query",
  description:
    "Run a SQL query through DuckDB. DuckDB can query CSV/Parquet files directly with read_csv_auto('path') / " +
    "read_parquet('path'), and open SQLite databases. Requires the `duckdb` CLI on PATH (install: `brew install duckdb` " +
    "or download from duckdb.org). 60s timeout.",
  schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "SQL query. Example: SELECT * FROM read_csv_auto('data.csv') LIMIT 5;" },
      database: { type: "string", description: "Optional path to a .duckdb / .sqlite file to attach as the working database." },
      format: { type: "string", description: "Output format: box (default), csv, json, markdown." },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const query = args["query"] as string;
    const dbArg = args["database"] as string | undefined;
    const format = (args["format"] as string) ?? "box";
    if (!query) return 'Error: "query" required.';

    let dbPath: string | null = null;
    if (dbArg) {
      const safe = resolveWorkspacePath(dbArg);
      if (!safe.ok) return `Error: ${safe.error}`;
      dbPath = safe.path;
    }

    const argv: string[] = [];
    if (dbPath) argv.push(dbPath);
    argv.push("-cmd", `.mode ${format}`);
    argv.push("-c", query);

    await ctx.logger.log(`sql_query (${dbPath ?? ":memory:"}): ${query.slice(0, 200)}`);

    const r = await runQuiet("duckdb", argv, {
      cwd: process.cwd(),
      stream: true,
      label: "duckdb",
    });
    if (r.code === null && r.stderr.match(/ENOENT|not found/i)) {
      return missingCliHint("duckdb", "brew install duckdb (macOS) · or https://duckdb.org/docs/installation");
    }
    if (r.timedOut) return `Error: query timed out after ${TIMEOUT_MS / 1000}s.\nstderr:\n${r.stderr}`;
    if (r.code !== 0) return `Exit ${r.code}.\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
    return r.stdout || "(no rows)";
  },
};

// ── python_eval ────────────────────────────────────────────────────────────
export const pythonEvalTool: Tool = {
  name: "python_eval",
  description:
    "Run a short Python snippet with python3 and return stdout. The snippet may import stdlib freely; for third-party " +
    "packages they must be installed in the active environment. Snippets that need to print results should call print(). " +
    "60s timeout.",
  schema: {
    type: "object",
    properties: {
      code: { type: "string", description: "Python source code." },
      cwd: { type: "string", description: "Working directory for the script. Defaults to workspace root." },
    },
    required: ["code"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const code = args["code"] as string;
    const cwdArg = (args["cwd"] as string) ?? ".";
    if (!code) return 'Error: "code" required.';
    const safeCwd = resolveWorkspacePath(cwdArg);
    if (!safeCwd.ok) return `Error: ${safeCwd.error}`;

    const ok = await ctx.confirm(`Run Python: ${code.slice(0, 80)}${code.length > 80 ? "…" : ""}?`);
    if (!ok) return "Action cancelled by user.";

    await ctx.logger.log(`python_eval: ${code.slice(0, 200)}`);
    const r = await runQuiet("python3", ["-c", code], {
      cwd: safeCwd.path,
      stream: true,
      label: "python3",
    });
    if (r.code === null && r.stderr.match(/ENOENT|not found/i)) {
      return missingCliHint("python3", "Install Python 3 from python.org or `brew install python@3.12`.");
    }
    if (r.timedOut) return `Error: snippet timed out after ${TIMEOUT_MS / 1000}s.\nstderr:\n${r.stderr}`;
    if (r.code !== 0) {
      return `Exit ${r.code}.\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
    }
    return r.stdout || "(no output)";
  },
};

// ── pdf_to_md ──────────────────────────────────────────────────────────────
export const pdfToMdTool: Tool = {
  name: "pdf_to_md",
  description:
    "Convert a PDF to plain text / pseudo-markdown via the `pdftotext` CLI (Poppler). Useful for the course's " +
    "'Convert PDFs to Markdown' module. Install: `brew install poppler` on macOS.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the PDF file." },
      layout: { type: "boolean", description: "Preserve layout (default true)." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const p = args["path"] as string;
    const layout = args["layout"] === undefined ? true : Boolean(args["layout"]);
    if (!p) return 'Error: "path" required.';
    const safe = resolveWorkspacePath(p);
    if (!safe.ok) return `Error: ${safe.error}`;
    if (path.extname(safe.path).toLowerCase() !== ".pdf") {
      return `Error: not a .pdf file: ${p}`;
    }

    await ctx.logger.log(`pdf_to_md: ${p}`);
    const argv = ["-q"];
    if (layout) argv.push("-layout");
    argv.push(safe.path, "-"); // write to stdout
    const r = await runQuiet("pdftotext", argv, { cwd: process.cwd() });
    if (r.code === null && r.stderr.match(/ENOENT|not found/i)) {
      return missingCliHint("pdftotext", "brew install poppler (macOS) · apt install poppler-utils (Linux)");
    }
    if (r.code !== 0) return `pdftotext exit ${r.code}.\nstderr:\n${r.stderr}`;
    return r.stdout;
  },
};
