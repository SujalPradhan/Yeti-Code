import { describe, it, expect, vi } from "vitest";
import { printToolCall } from "../../src/presentation/cli/formatters";

// chalk colours come out as ANSI escapes. We strip them for assertions.
const stripAnsi = (s: string): string => s.replace(/\[[0-9;]*m/g, "");

function captureConsole(fn: () => void): string {
  const lines: string[] = [];
  const orig = console.log;
  console.log = vi.fn((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  try {
    fn();
  } finally {
    console.log = orig;
  }
  return stripAnsi(lines.join("\n"));
}

describe("printToolCall (non-verbose)", () => {
  it("renders read_file with the path", () => {
    const out = captureConsole(() => printToolCall("read_file", { path: "src/foo.ts" }, false));
    expect(out).toMatch(/read_file/);
    expect(out).toMatch(/src\/foo\.ts/);
  });

  it("renders shell with the command in quotes", () => {
    const out = captureConsole(() => printToolCall("shell", { command: "npm test" }, false));
    expect(out).toMatch(/"npm test"/);
  });

  it("renders grep with pattern and path", () => {
    const out = captureConsole(() =>
      printToolCall("grep", { pattern: "useState", path: "src", glob: "*.tsx" }, false),
    );
    expect(out).toMatch(/grep/);
    expect(out).toMatch(/useState/);
    expect(out).toMatch(/src/);
    expect(out).toMatch(/\*\.tsx/);
  });

  it("renders sed with dry-run marker", () => {
    const out = captureConsole(() =>
      printToolCall("sed", { path: "a.txt", pattern: "foo", replacement: "bar", dry_run: true }, false),
    );
    expect(out).toMatch(/sed/);
    expect(out).toMatch(/a\.txt/);
    expect(out).toMatch(/\[dry\]/);
  });

  it("renders npm with subcommand and args", () => {
    const out = captureConsole(() =>
      printToolCall("npm", { subcommand: "install", args: ["lodash"] }, false),
    );
    expect(out).toMatch(/npm/);
    expect(out).toMatch(/install lodash/);
  });

  it("renders git with subcommand and args", () => {
    const out = captureConsole(() =>
      printToolCall("git", { subcommand: "log", args: ["--oneline", "-n", "5"] }, false),
    );
    expect(out).toMatch(/log --oneline -n 5/);
  });

  it("renders find_files with pattern and dir", () => {
    const out = captureConsole(() =>
      printToolCall("find_files", { pattern: "**/*.ts", dir: "src" }, false),
    );
    expect(out).toMatch(/\*\*\/\*\.ts/);
    expect(out).toMatch(/src/);
  });

  it("renders fetch_url with the URL truncated", () => {
    const url = "https://example.com/" + "x".repeat(200);
    const out = captureConsole(() => printToolCall("fetch_url", { url }, false));
    expect(out).toMatch(/fetch_url/);
    expect(out).toMatch(/example\.com/);
    expect(out).toMatch(/…$/m);
  });

  it("renders delegate_tasks with task count and model list", () => {
    const out = captureConsole(() =>
      printToolCall(
        "delegate_tasks",
        {
          reasoning: "split work",
          tasks: [
            { id: "t1", description: "d", prompt: "p", modelId: "qwen3:4b" },
            { id: "t2", description: "d", prompt: "p", modelId: "gemma3:4b" },
            { id: "t3", description: "d", prompt: "p", modelId: "qwen3:4b" },
          ],
        },
        false,
      ),
    );
    expect(out).toMatch(/3 tasks/);
    expect(out).toMatch(/qwen3:4b/);
    expect(out).toMatch(/gemma3:4b/);
  });

  it("renders diff_files with both paths", () => {
    const out = captureConsole(() =>
      printToolCall("diff_files", { a: "old.ts", b: "new.ts" }, false),
    );
    expect(out).toMatch(/old\.ts.*new\.ts/);
  });

  it("falls back gracefully for unknown tools", () => {
    const out = captureConsole(() =>
      printToolCall("brand_new_tool", { somearg: "value" }, false),
    );
    expect(out).toMatch(/brand_new_tool/);
  });
});

describe("printToolCall (verbose)", () => {
  it("dumps full JSON args", () => {
    const out = captureConsole(() =>
      printToolCall("read_file", { path: "a.ts", encoding: "utf-8" }, true),
    );
    expect(out).toMatch(/"path": "a\.ts"/);
    expect(out).toMatch(/"encoding": "utf-8"/);
  });
});
