import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  grepTool,
  sedTool,
  headFileTool,
  tailFileTool,
  countLinesTool,
  diffFilesTool,
} from "../../src/features/tools/builtins/text";
import {
  makeWorkspace,
  approvingCtx,
  rejectingCtx,
  writeFixture,
  readFixture,
} from "./_helpers";

let cleanup: () => void;

beforeEach(() => {
  ({ cleanup } = makeWorkspace());
});
afterEach(() => cleanup());

describe("grep", () => {
  it("finds matches across nested files and reports path:line", async () => {
    writeFixture("src/a.ts", "import { useState } from 'react';\nconst x = 1;");
    writeFixture("src/nested/b.ts", "useState();\nfoo();");
    writeFixture("README.md", "Just docs, no match.");

    const out = await grepTool.execute({ pattern: "useState", path: "src" }, approvingCtx());
    const lines = out.split("\n").sort();
    expect(lines).toEqual([
      "src/a.ts:1: import { useState } from 'react';",
      "src/nested/b.ts:1: useState();",
    ]);
  });

  it("honors the glob filter", async () => {
    writeFixture("src/a.ts", "needle");
    writeFixture("src/a.js", "needle");
    const out = await grepTool.execute(
      { pattern: "needle", path: "src", glob: "*.ts" },
      approvingCtx(),
    );
    expect(out).toContain("a.ts");
    expect(out).not.toContain("a.js");
  });

  it("is case-sensitive by default and respects ignore_case", async () => {
    writeFixture("x.txt", "Hello\nhello\nHELLO");
    const sensitive = await grepTool.execute({ pattern: "hello", path: "x.txt" }, approvingCtx());
    expect(sensitive.split("\n")).toHaveLength(1);
    const insensitive = await grepTool.execute(
      { pattern: "hello", path: "x.txt", ignore_case: true },
      approvingCtx(),
    );
    expect(insensitive.split("\n")).toHaveLength(3);
  });

  it("returns 'No matches found.' when nothing matches", async () => {
    writeFixture("a.txt", "alpha");
    const out = await grepTool.execute({ pattern: "zzz", path: "a.txt" }, approvingCtx());
    expect(out).toBe("No matches found.");
  });

  it("rejects regex syntax errors with a useful message", async () => {
    writeFixture("a.txt", "anything");
    const out = await grepTool.execute({ pattern: "(unclosed", path: "a.txt" }, approvingCtx());
    expect(out).toMatch(/invalid regex/i);
  });

  it("skips node_modules and .git", async () => {
    writeFixture("node_modules/foo/index.js", "needle");
    writeFixture(".git/config", "needle");
    writeFixture("src/x.ts", "needle");
    const out = await grepTool.execute({ pattern: "needle" }, approvingCtx());
    expect(out).toContain("src/x.ts");
    expect(out).not.toContain("node_modules");
    expect(out).not.toContain(".git");
  });

  it("blocks paths outside the workspace", async () => {
    const out = await grepTool.execute({ pattern: "x", path: "../../../etc" }, approvingCtx());
    expect(out).toMatch(/outside workspace/);
  });
});

describe("sed", () => {
  it("performs regex replacement and writes the file", async () => {
    writeFixture("a.txt", "foo bar foo");
    const out = await sedTool.execute(
      { path: "a.txt", pattern: "foo", replacement: "baz" },
      approvingCtx(),
    );
    expect(out).toMatch(/Applied 2 replacement/);
    expect(readFixture("a.txt")).toBe("baz bar baz");
  });

  it("supports backreferences", async () => {
    writeFixture("a.txt", "hello world");
    await sedTool.execute(
      { path: "a.txt", pattern: "(hello) (world)", replacement: "$2 $1" },
      approvingCtx(),
    );
    expect(readFixture("a.txt")).toBe("world hello");
  });

  it("dry_run reports counts without writing", async () => {
    writeFixture("a.txt", "x x x");
    const out = await sedTool.execute(
      { path: "a.txt", pattern: "x", replacement: "y", dry_run: true },
      approvingCtx(),
    );
    expect(out).toMatch(/\[dry_run\] 3 replacement/);
    expect(readFixture("a.txt")).toBe("x x x");
  });

  it("returns 'No matches' when the pattern is absent", async () => {
    writeFixture("a.txt", "abc");
    const out = await sedTool.execute(
      { path: "a.txt", pattern: "zzz", replacement: "y" },
      approvingCtx(),
    );
    expect(out).toMatch(/No matches/);
  });

  it("respects user cancellation on confirmation", async () => {
    writeFixture("a.txt", "alpha");
    const out = await sedTool.execute(
      { path: "a.txt", pattern: "alpha", replacement: "beta" },
      rejectingCtx(),
    );
    expect(out).toMatch(/cancelled/i);
    expect(readFixture("a.txt")).toBe("alpha");
  });
});

describe("head_file / tail_file", () => {
  it("returns first/last N lines and notes the rest", async () => {
    const content = Array.from({ length: 50 }, (_, i) => `line${i + 1}`).join("\n");
    writeFixture("big.txt", content);

    const head = await headFileTool.execute({ path: "big.txt", lines: 3 }, approvingCtx());
    expect(head.startsWith("line1\nline2\nline3")).toBe(true);
    expect(head).toMatch(/47 more lines/);

    const tail = await tailFileTool.execute({ path: "big.txt", lines: 3 }, approvingCtx());
    expect(tail).toMatch(/47 earlier lines/);
    expect(tail.endsWith("line48\nline49\nline50")).toBe(true);
  });

  it("defaults to 20 lines", async () => {
    writeFixture("f.txt", Array.from({ length: 25 }, (_, i) => `${i}`).join("\n"));
    const out = await headFileTool.execute({ path: "f.txt" }, approvingCtx());
    const lines = out.split("\n").filter((l) => /^\d+$/.test(l));
    expect(lines).toHaveLength(20);
  });
});

describe("count_lines", () => {
  it("counts lines, words, chars, bytes", async () => {
    writeFixture("a.txt", "one two\nthree four five");
    const out = await countLinesTool.execute({ path: "a.txt" }, approvingCtx());
    expect(out).toMatch(/2 lines/);
    expect(out).toMatch(/5 words/);
  });
});

describe("diff_files", () => {
  it("reports identical files", async () => {
    writeFixture("a.txt", "x\ny\n");
    writeFixture("b.txt", "x\ny\n");
    const out = await diffFilesTool.execute({ a: "a.txt", b: "b.txt" }, approvingCtx());
    expect(out).toBe("Files are identical.");
  });

  it("shows added and removed lines", async () => {
    writeFixture("a.txt", "alpha\nbeta\ngamma");
    writeFixture("b.txt", "alpha\nBETA\ngamma");
    const out = await diffFilesTool.execute({ a: "a.txt", b: "b.txt" }, approvingCtx());
    expect(out).toMatch(/^--- a\.txt/m);
    expect(out).toMatch(/^\+\+\+ b\.txt/m);
    expect(out).toMatch(/- beta/);
    expect(out).toMatch(/\+ BETA/);
  });
});
