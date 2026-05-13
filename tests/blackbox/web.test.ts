import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchUrlTool } from "../../src/features/tools/builtins/web";
import { approvingCtx } from "./_helpers";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFetch(body: string, opts: { status?: number; contentType?: string } = {}): void {
  global.fetch = vi.fn(async () => {
    const buf = new TextEncoder().encode(body).buffer;
    return {
      status: opts.status ?? 200,
      headers: new Headers({ "content-type": opts.contentType ?? "text/plain" }),
      arrayBuffer: async () => buf,
    } as unknown as Response;
  }) as typeof fetch;
}

describe("fetch_url", () => {
  it("returns body for a plain text response", async () => {
    mockFetch("hello world", { contentType: "text/plain" });
    const out = await fetchUrlTool.execute({ url: "https://example.com/x" }, approvingCtx());
    expect(out).toMatch(/HTTP 200/);
    expect(out).toMatch(/text\/plain/);
    expect(out).toMatch(/hello world/);
  });

  it("strips HTML to text by default", async () => {
    mockFetch(
      "<html><head><style>body{}</style></head><body><h1>Title</h1><p>Para</p><script>alert(1)</script></body></html>",
      { contentType: "text/html" },
    );
    const out = await fetchUrlTool.execute({ url: "https://example.com/" }, approvingCtx());
    expect(out).toMatch(/Title/);
    expect(out).toMatch(/Para/);
    expect(out).not.toMatch(/<h1>/);
    expect(out).not.toMatch(/alert\(1\)/);
  });

  it("returns raw HTML when as_text=false", async () => {
    mockFetch("<h1>x</h1>", { contentType: "text/html" });
    const out = await fetchUrlTool.execute(
      { url: "https://example.com/", as_text: false },
      approvingCtx(),
    );
    expect(out).toMatch(/<h1>x<\/h1>/);
  });

  it("rejects non-http(s) URLs", async () => {
    const out = await fetchUrlTool.execute({ url: "file:///etc/passwd" }, approvingCtx());
    expect(out).toMatch(/only http\(s\)/);
  });

  it("rejects malformed URLs", async () => {
    const out = await fetchUrlTool.execute({ url: "not-a-url" }, approvingCtx());
    expect(out).toMatch(/invalid URL/);
  });

  it("decodes common HTML entities", async () => {
    mockFetch("<p>a &amp; b &lt;c&gt;</p>", { contentType: "text/html" });
    const out = await fetchUrlTool.execute({ url: "https://example.com/" }, approvingCtx());
    expect(out).toMatch(/a & b <c>/);
  });

  it("truncates oversized bodies", async () => {
    const huge = "x".repeat(300_000);
    mockFetch(huge, { contentType: "text/plain" });
    const out = await fetchUrlTool.execute({ url: "https://example.com/" }, approvingCtx());
    expect(out).toMatch(/truncated at 200000 bytes/);
  });

  it("surfaces network errors gracefully", async () => {
    global.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const out = await fetchUrlTool.execute({ url: "https://example.com/" }, approvingCtx());
    expect(out).toMatch(/Error fetching/);
    expect(out).toMatch(/network down/);
  });
});
