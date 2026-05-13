import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchUrlTool, extractHtmlTool } from "../../src/features/tools/builtins/web";
import { approvingCtx, makeWorkspace, writeFixture } from "./_helpers";

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

describe("extract_html", () => {
  let cleanup: () => void;

  beforeEach(() => {
    ({ cleanup } = makeWorkspace());
  });
  afterEach(() => cleanup());

  const SAMPLE = `
    <html>
      <body>
        <h1 id="title">Hello</h1>
        <div class="card featured">
          <h2>Card A</h2>
          <a href="/a">Link A</a>
        </div>
        <div class="card">
          <h2>Card B</h2>
          <a href="/b" data-test="yes">Link B</a>
        </div>
        <ul>
          <li>one</li>
          <li>two</li>
          <li>three</li>
        </ul>
        <script>var x = 1;</script>
      </body>
    </html>
  `;

  it("selects by tag and returns text by default", async () => {
    const out = await extractHtmlTool.execute(
      { html: SAMPLE, selector: "li" },
      approvingCtx(),
    );
    expect(out.split("\n")).toEqual(["one", "two", "three"]);
  });

  it("selects by id", async () => {
    const out = await extractHtmlTool.execute(
      { html: SAMPLE, selector: "#title" },
      approvingCtx(),
    );
    expect(out).toBe("Hello");
  });

  it("selects by class", async () => {
    const out = await extractHtmlTool.execute(
      { html: SAMPLE, selector: ".card h2" },
      approvingCtx(),
    );
    expect(out.split("\n")).toEqual(["Card A", "Card B"]);
  });

  it("supports compound class selector", async () => {
    const out = await extractHtmlTool.execute(
      { html: SAMPLE, selector: ".card.featured h2" },
      approvingCtx(),
    );
    expect(out).toBe("Card A");
  });

  it("supports attribute selectors", async () => {
    const out = await extractHtmlTool.execute(
      { html: SAMPLE, selector: "a[data-test=yes]" },
      approvingCtx(),
    );
    expect(out).toBe("Link B");
  });

  it("supports child combinator", async () => {
    const out = await extractHtmlTool.execute(
      { html: SAMPLE, selector: "ul > li" },
      approvingCtx(),
    );
    expect(out.split("\n").length).toBe(3);
  });

  it("returns outer HTML when mode=html", async () => {
    const out = await extractHtmlTool.execute(
      { html: SAMPLE, selector: "#title", mode: "html" },
      approvingCtx(),
    );
    expect(out).toMatch(/^<h1[^>]*id="title"[^>]*>Hello<\/h1>$/);
  });

  it("ignores script/style contents", async () => {
    const out = await extractHtmlTool.execute(
      { html: SAMPLE, selector: "body" },
      approvingCtx(),
    );
    expect(out).not.toMatch(/var x = 1/);
  });

  it("reports no matches clearly", async () => {
    const out = await extractHtmlTool.execute(
      { html: SAMPLE, selector: ".does-not-exist" },
      approvingCtx(),
    );
    expect(out).toMatch(/No matches/);
  });

  it("reads from a file in the workspace", async () => {
    writeFixture("page.html", SAMPLE);
    const out = await extractHtmlTool.execute(
      { path: "page.html", selector: "h1" },
      approvingCtx(),
    );
    expect(out).toBe("Hello");
  });

  it("blocks paths outside the workspace", async () => {
    const out = await extractHtmlTool.execute(
      { path: "../../etc/passwd", selector: "a" },
      approvingCtx(),
    );
    expect(out).toMatch(/outside workspace/);
  });
});
