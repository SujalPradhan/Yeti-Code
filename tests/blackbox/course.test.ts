import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  httpRequestTool,
  jsonQueryTool,
  csvInfoTool,
  encodeTool,
  decodeTool,
} from "../../src/features/tools/builtins/course";
import {
  makeWorkspace,
  approvingCtx,
  rejectingCtx,
  writeFixture,
} from "./_helpers";

const originalFetch = global.fetch;

let cleanup: () => void;

beforeEach(() => {
  ({ cleanup } = makeWorkspace());
});
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFetch(body: string, opts: { status?: number; statusText?: string; contentType?: string; headers?: Record<string, string> } = {}): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => {
    const buf = new TextEncoder().encode(body).buffer;
    const headers = new Headers({ "content-type": opts.contentType ?? "text/plain", ...(opts.headers ?? {}) });
    return {
      status: opts.status ?? 200,
      statusText: opts.statusText ?? "OK",
      headers,
      arrayBuffer: async () => buf,
    } as unknown as Response;
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

// ── http_request ───────────────────────────────────────────────────────────
describe("http_request", () => {
  it("GET returns status + headers + body without confirmation", async () => {
    mockFetch('{"ok":true}', { status: 200, contentType: "application/json" });
    const out = await httpRequestTool.execute(
      { url: "https://api.example.com/x" },
      rejectingCtx(), // proves GET does not call confirm
    );
    expect(out).toMatch(/HTTP 200/);
    expect(out).toMatch(/content-type: application\/json/);
    expect(out).toMatch(/"ok":true/);
  });

  it("POST prompts for confirmation and respects rejection", async () => {
    mockFetch("posted", { status: 201 });
    const out = await httpRequestTool.execute(
      { url: "https://api.example.com/x", method: "POST", body: "{}" },
      rejectingCtx(),
    );
    expect(out).toMatch(/cancelled/i);
  });

  it("json shortcut sets the body and content-type", async () => {
    const fetchSpy = mockFetch("ok", { status: 200 });
    await httpRequestTool.execute(
      { url: "https://api.example.com/x", method: "POST", json: { a: 1 } },
      approvingCtx(),
    );
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("rejects non-http(s) URLs", async () => {
    const out = await httpRequestTool.execute({ url: "file:///etc/passwd" }, approvingCtx());
    expect(out).toMatch(/only http\(s\)/);
  });

  it("rejects malformed URLs", async () => {
    const out = await httpRequestTool.execute({ url: "not a url" }, approvingCtx());
    expect(out).toMatch(/invalid URL/);
  });
});

// ── json_query ─────────────────────────────────────────────────────────────
describe("json_query", () => {
  it("returns a nested property", async () => {
    writeFixture("data.json", JSON.stringify({ user: { name: "Sujal", age: 21 } }));
    const out = await jsonQueryTool.execute(
      { path: "data.json", query: ".user.name" },
      approvingCtx(),
    );
    expect(out).toBe('"Sujal"');
  });

  it("indexes into arrays", async () => {
    writeFixture("d.json", JSON.stringify({ items: ["a", "b", "c"] }));
    const out = await jsonQueryTool.execute({ path: "d.json", query: ".items[1]" }, approvingCtx());
    expect(out).toBe('"b"');
  });

  it("supports negative indices", async () => {
    writeFixture("d.json", JSON.stringify({ items: ["a", "b", "c"] }));
    const out = await jsonQueryTool.execute({ path: "d.json", query: ".items[-1]" }, approvingCtx());
    expect(out).toBe('"c"');
  });

  it("supports slices", async () => {
    writeFixture("d.json", JSON.stringify({ items: [1, 2, 3, 4, 5] }));
    const out = await jsonQueryTool.execute({ path: "d.json", query: ".items[1:4]" }, approvingCtx());
    expect(JSON.parse(out)).toEqual([2, 3, 4]);
  });

  it("returns the whole doc for '.'", async () => {
    writeFixture("d.json", JSON.stringify({ x: 1 }));
    const out = await jsonQueryTool.execute({ path: "d.json", query: "." }, approvingCtx());
    expect(JSON.parse(out)).toEqual({ x: 1 });
  });

  it("works with inline JSON", async () => {
    const out = await jsonQueryTool.execute(
      { json: '{"a": 42}', query: ".a" },
      approvingCtx(),
    );
    expect(out).toBe("42");
  });

  it("surfaces invalid JSON", async () => {
    writeFixture("bad.json", "not json");
    const out = await jsonQueryTool.execute({ path: "bad.json", query: "." }, approvingCtx());
    expect(out).toMatch(/invalid JSON/);
  });

  it("blocks paths outside the workspace", async () => {
    const out = await jsonQueryTool.execute({ path: "../../etc/x.json", query: "." }, approvingCtx());
    expect(out).toMatch(/outside workspace/);
  });
});

// ── csv_info ───────────────────────────────────────────────────────────────
describe("csv_info", () => {
  it("reports row/col counts and inferred dtypes", async () => {
    writeFixture(
      "data.csv",
      [
        "id,name,score,joined",
        "1,Alice,99.5,2024-01-01",
        "2,Bob,87.2,2024-02-15",
        '3,"Last, First",,2024-03-10',
        "4,Dee,72.1,2024-04-01",
      ].join("\n"),
    );
    const out = await csvInfoTool.execute({ path: "data.csv" }, approvingCtx());
    expect(out).toMatch(/4 rows × 4 cols/);
    expect(out).toMatch(/id\s+int/);
    expect(out).toMatch(/name\s+string/);
    expect(out).toMatch(/score\s+float/);
    expect(out).toMatch(/joined\s+date/);
    expect(out).toMatch(/score.*nulls=1/);
  });

  it("handles quoted fields with embedded commas", async () => {
    writeFixture("q.csv", 'a,b\n"hello, world","x"\n"y","z"');
    const out = await csvInfoTool.execute({ path: "q.csv" }, approvingCtx());
    expect(out).toMatch(/2 rows/);
    expect(out).toMatch(/hello, world/);
  });

  it("respects a custom separator", async () => {
    writeFixture("t.tsv", "a\tb\n1\t2\n3\t4");
    const out = await csvInfoTool.execute({ path: "t.tsv", separator: "\t" }, approvingCtx());
    expect(out).toMatch(/2 rows × 2 cols/);
  });
});

// ── encode / decode ────────────────────────────────────────────────────────
describe("encode / decode", () => {
  const cases: Array<{ codec: string; plain: string; encoded: string }> = [
    { codec: "base64", plain: "hello", encoded: "aGVsbG8=" },
    { codec: "hex", plain: "hi", encoded: "6869" },
    { codec: "url", plain: "a b&c=1", encoded: "a%20b%26c%3D1" },
    { codec: "rot13", plain: "Hello, World!", encoded: "Uryyb, Jbeyq!" },
  ];
  for (const c of cases) {
    it(`${c.codec}: encode then decode round-trips`, async () => {
      const enc = await encodeTool.execute({ text: c.plain, codec: c.codec }, approvingCtx());
      expect(enc).toBe(c.encoded);
      const dec = await decodeTool.execute({ text: c.encoded, codec: c.codec }, approvingCtx());
      expect(dec).toBe(c.plain);
    });
  }

  it("rejects unknown codec", async () => {
    const out = await encodeTool.execute({ text: "x", codec: "rot42" }, approvingCtx());
    expect(out).toMatch(/codec must be one of/);
  });
});
