import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  sqlQueryTool,
  pythonEvalTool,
  pdfToMdTool,
} from "../../src/features/tools/builtins/data";
import {
  makeWorkspace,
  approvingCtx,
  rejectingCtx,
  writeFixture,
  withSilencedStdout,
  commandExists,
} from "./_helpers";

let cleanup: () => void;

beforeEach(() => {
  ({ cleanup } = makeWorkspace());
});
afterEach(() => cleanup());

// ── sql_query (DuckDB) ─────────────────────────────────────────────────────
describe("sql_query", () => {
  it.skipIf(!commandExists("duckdb"))(
    "runs a SELECT against a CSV via read_csv_auto",
    async () => {
      writeFixture("data.csv", "id,name\n1,Alice\n2,Bob\n");
      const out = await withSilencedStdout(() =>
        sqlQueryTool.execute(
          { query: "SELECT count(*) AS n FROM read_csv_auto('data.csv');", format: "csv" },
          approvingCtx(),
        ),
      );
      expect(out).toMatch(/2/);
    },
  );

  it.skipIf(!commandExists("duckdb"))(
    "returns DuckDB error output on bad SQL",
    async () => {
      const out = await withSilencedStdout(() =>
        sqlQueryTool.execute(
          { query: "SELEC garbage;", format: "csv" },
          approvingCtx(),
        ),
      );
      expect(out).toMatch(/Exit|error|parser/i);
    },
  );

  it("blocks database paths outside workspace", async () => {
    const out = await sqlQueryTool.execute(
      { query: "SELECT 1;", database: "../../../etc/secrets.db" },
      approvingCtx(),
    );
    expect(out).toMatch(/outside workspace/);
  });
});

// ── python_eval ────────────────────────────────────────────────────────────
describe("python_eval", () => {
  it.skipIf(!commandExists("python3"))(
    "runs a one-liner and returns stdout",
    async () => {
      const out = await withSilencedStdout(() =>
        pythonEvalTool.execute({ code: "print(2 + 2)" }, approvingCtx()),
      );
      expect(out).toMatch(/^4\b/);
    },
  );

  it.skipIf(!commandExists("python3"))(
    "surfaces tracebacks on failure",
    async () => {
      const out = await withSilencedStdout(() =>
        pythonEvalTool.execute({ code: "raise ValueError('boom')" }, approvingCtx()),
      );
      expect(out).toMatch(/ValueError/);
      expect(out).toMatch(/boom/);
    },
  );

  it("respects user cancellation", async () => {
    const out = await pythonEvalTool.execute({ code: "print('x')" }, rejectingCtx());
    expect(out).toMatch(/cancelled/i);
  });

  it("blocks cwd outside the workspace", async () => {
    const out = await pythonEvalTool.execute(
      { code: "print(1)", cwd: "../../etc" },
      approvingCtx(),
    );
    expect(out).toMatch(/outside workspace/);
  });
});

// ── pdf_to_md ──────────────────────────────────────────────────────────────
describe("pdf_to_md", () => {
  it("refuses non-PDF extensions", async () => {
    writeFixture("foo.txt", "not a pdf");
    const out = await pdfToMdTool.execute({ path: "foo.txt" }, approvingCtx());
    expect(out).toMatch(/not a \.pdf/);
  });

  it("blocks paths outside the workspace", async () => {
    const out = await pdfToMdTool.execute({ path: "../../doc.pdf" }, approvingCtx());
    expect(out).toMatch(/outside workspace/);
  });
});
