/**
 * tests/benchmark.ts — micro-benchmarks for built-in tools.
 *
 * Each scenario builds a temp workspace of the right shape, runs the tool
 * many times, reports p50/p95/mean. Read-only tools dominate the list since
 * those are the ones the model will call most. No LLM is involved.
 *
 * Run with:  npx ts-node tests/benchmark.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { performance } from "perf_hooks";

import {
  grepTool,
  headFileTool,
  tailFileTool,
  countLinesTool,
  diffFilesTool,
} from "../src/features/tools/builtins/text";
import { findFilesTool } from "../src/features/tools/builtins/dev";
import { readFileTool, searchFilesTool } from "../src/features/tools/builtins/fs";
import {
  jsonQueryTool,
  csvInfoTool,
  encodeTool,
  decodeTool,
} from "../src/features/tools/builtins/course";
import { extractHtmlTool } from "../src/features/tools/builtins/web";
import { ThinkStripper } from "../src/infrastructure/llm/ollama";
import type { ToolContext } from "../src/features/tools/types";
import type { SessionLogger } from "../src/core/logger";

const ITERATIONS = Number(process.env["ITER"] ?? 50);
const WARMUP = 5;

const fakeCtx: ToolContext = {
  logger: { async log() {}, getLogPath: () => "/dev/null", init: async () => {} } as unknown as SessionLogger,
  confirm: async () => true,
};

interface Result {
  name: string;
  iterations: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  opsPerSec: number;
  notes?: string;
}

async function bench(name: string, fn: () => Promise<unknown>, notes?: string): Promise<Result> {
  for (let i = 0; i < WARMUP; i++) await fn();
  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((s, x) => s + x, 0) / samples.length;
  const p50 = samples[Math.floor(samples.length * 0.5)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  return {
    name,
    iterations: ITERATIONS,
    meanMs: mean,
    p50Ms: p50,
    p95Ms: p95,
    opsPerSec: 1000 / mean,
    notes,
  };
}

function buildRepoFixture(root: string, fileCount: number, linesPerFile: number): void {
  for (let f = 0; f < fileCount; f++) {
    const dir = path.join(root, "src", `pkg${Math.floor(f / 10)}`);
    fs.mkdirSync(dir, { recursive: true });
    const lines: string[] = [];
    for (let l = 0; l < linesPerFile; l++) {
      const filler = `line ${l} of ${f} ${"x".repeat(Math.max(0, (l * 7) % 40))}`;
      lines.push(l === Math.floor(linesPerFile / 2) ? `${filler} needle` : filler);
    }
    fs.writeFileSync(path.join(dir, `file_${f}.ts`), lines.join("\n"));
  }
  // Add some noise that the tools should skip.
  fs.mkdirSync(path.join(root, "node_modules", "junk"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", "junk", "z.js"), "needle ".repeat(200));
}

function printResults(results: Result[]): void {
  const header = ["tool", "iter", "mean (ms)", "p50 (ms)", "p95 (ms)", "ops/sec", "notes"];
  const rows = results.map((r) => [
    r.name,
    String(r.iterations),
    r.meanMs.toFixed(3),
    r.p50Ms.toFixed(3),
    r.p95Ms.toFixed(3),
    r.opsPerSec.toFixed(1),
    r.notes ?? "",
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmtRow = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log("\n" + fmtRow(header));
  console.log(widths.map((w) => "─".repeat(w)).join("  "));
  for (const r of rows) console.log(fmtRow(r));
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yeti-bench-"));
  const prevCwd = process.cwd();
  process.chdir(root);

  console.log(`# yeti-code tool benchmarks`);
  console.log(`# fixture: ${root}`);
  console.log(`# iterations per scenario: ${ITERATIONS} (warmup: ${WARMUP})`);
  console.log(`# node ${process.version}, ${os.platform()} ${os.arch()}, ${os.cpus()[0]?.model ?? "?"}\n`);

  const FILE_COUNT = 50;
  const LINES = 200;
  buildRepoFixture(root, FILE_COUNT, LINES);
  console.log(`fixture built: ${FILE_COUNT} files × ${LINES} lines (~${FILE_COUNT * LINES} lines total)\n`);

  const results: Result[] = [];

  results.push(
    await bench(
      "grep (recursive, common pattern)",
      async () => {
        await grepTool.execute({ pattern: "needle", path: "." }, fakeCtx);
      },
      `${FILE_COUNT} files`,
    ),
  );

  results.push(
    await bench(
      "grep (anchored, rare regex)",
      async () => {
        await grepTool.execute({ pattern: "^line 100 of 0\\b", path: "." }, fakeCtx);
      },
      "regex w/ anchor",
    ),
  );

  results.push(
    await bench(
      "search_files (legacy, recursive)",
      async () => {
        await searchFilesTool.execute({ dir: ".", pattern: "needle" }, fakeCtx);
      },
      "compare vs grep",
    ),
  );

  results.push(
    await bench(
      "find_files (**/*.ts)",
      async () => {
        await findFilesTool.execute({ pattern: "**/*.ts" }, fakeCtx);
      },
    ),
  );

  results.push(
    await bench(
      "read_file (medium file)",
      async () => {
        await readFileTool.execute({ path: "src/pkg0/file_0.ts" }, fakeCtx);
      },
      `${LINES} lines`,
    ),
  );

  results.push(
    await bench(
      "head_file (20 lines)",
      async () => {
        await headFileTool.execute({ path: "src/pkg0/file_0.ts", lines: 20 }, fakeCtx);
      },
    ),
  );

  results.push(
    await bench(
      "tail_file (20 lines)",
      async () => {
        await tailFileTool.execute({ path: "src/pkg0/file_0.ts", lines: 20 }, fakeCtx);
      },
    ),
  );

  results.push(
    await bench(
      "count_lines",
      async () => {
        await countLinesTool.execute({ path: "src/pkg0/file_0.ts" }, fakeCtx);
      },
    ),
  );

  results.push(
    await bench(
      "diff_files (small)",
      async () => {
        await diffFilesTool.execute(
          { a: "src/pkg0/file_0.ts", b: "src/pkg0/file_1.ts" },
          fakeCtx,
        );
      },
    ),
  );

  // ── Course tools ──────────────────────────────────────────────────────────
  const sampleJson = JSON.stringify({
    users: Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      name: `user_${i}`,
      tags: ["a", "b", i % 2 === 0 ? "even" : "odd"],
    })),
  });
  fs.writeFileSync(path.join(root, "data.json"), sampleJson);
  results.push(
    await bench("json_query (1000-item array)", async () => {
      await jsonQueryTool.execute(
        { path: "data.json", query: ".users[500].name" },
        fakeCtx,
      );
    }),
  );

  // CSV: 1000 rows
  const csvLines = ["id,name,score,joined"];
  for (let i = 0; i < 1000; i++) {
    csvLines.push(`${i},user${i},${(i * 0.7).toFixed(2)},2024-${(i % 12) + 1}-15`);
  }
  fs.writeFileSync(path.join(root, "big.csv"), csvLines.join("\n"));
  results.push(
    await bench("csv_info (1000 rows × 4 cols)", async () => {
      await csvInfoTool.execute({ path: "big.csv" }, fakeCtx);
    }),
  );

  // Encoding round-trip
  const encPayload = "x".repeat(2000);
  results.push(
    await bench("encode base64 (2KB)", async () => {
      await encodeTool.execute({ text: encPayload, codec: "base64" }, fakeCtx);
    }),
  );
  const b64 = Buffer.from(encPayload).toString("base64");
  results.push(
    await bench("decode base64 (2KB)", async () => {
      await decodeTool.execute({ text: b64, codec: "base64" }, fakeCtx);
    }),
  );

  // HTML extraction
  const htmlBlock =
    "<html><body>" +
    Array.from({ length: 200 }, (_, i) => `<div class="row"><a href="/x/${i}">link ${i}</a></div>`).join("") +
    "</body></html>";
  results.push(
    await bench("extract_html ('a[href]' across 200 rows)", async () => {
      await extractHtmlTool.execute({ html: htmlBlock, selector: "a[href]" }, fakeCtx);
    }),
  );

  // ── ThinkStripper micro-bench (pure CPU) ──────────────────────────────────
  const thinkPayload = "preface " + "<think>" + "a".repeat(5000) + "</think>" + " answer ".repeat(50);
  results.push(
    await bench(
      "ThinkStripper.strip (5KB block)",
      async () => {
        const s = new ThinkStripper("strip");
        s.feed(thinkPayload);
        s.flush();
      },
    ),
  );
  results.push(
    await bench(
      "ThinkStripper.strip (1-char chunks)",
      async () => {
        const s = new ThinkStripper("strip");
        for (const c of thinkPayload) s.feed(c);
        s.flush();
      },
      "worst case streaming",
    ),
  );
  results.push(
    await bench(
      "ThinkStripper.show (5KB block)",
      async () => {
        const s = new ThinkStripper("show");
        s.feed(thinkPayload);
        s.flush();
      },
    ),
  );

  printResults(results);

  // ── Headline summary ──────────────────────────────────────────────────────
  const grepR = results.find((r) => r.name.startsWith("grep (recursive"));
  const sfR = results.find((r) => r.name.startsWith("search_files"));
  if (grepR && sfR) {
    const ratio = sfR.meanMs / grepR.meanMs;
    console.log(
      `\nNew grep vs legacy search_files: ${ratio.toFixed(2)}× ` +
        (ratio > 1 ? `faster (mean ${grepR.meanMs.toFixed(2)}ms vs ${sfR.meanMs.toFixed(2)}ms)` : `slower`),
    );
  }

  process.chdir(prevCwd);
  fs.rmSync(root, { recursive: true, force: true });
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
