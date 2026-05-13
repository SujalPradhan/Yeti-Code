import type { Tool, ToolContext } from "../types";

const MAX_BYTES = 200_000;
const TIMEOUT_MS = 15_000;

function stripHtml(html: string): string {
  // Quick-and-dirty: strip script/style blocks, then tags, then collapse ws.
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const fetchUrlTool: Tool = {
  name: "fetch_url",
  description:
    "HTTP GET a URL and return its body. For HTML pages, returns text-extracted content. " +
    "Useful for looking up documentation or fetching JSON APIs. Caps body at 200KB.",
  schema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Full URL including http(s)://." },
      as_text: {
        type: "boolean",
        description: "If true (default), strip HTML to readable text. Set false for raw HTML/JSON.",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const url = args["url"] as string;
    const asText = args["as_text"] === undefined ? true : Boolean(args["as_text"]);
    if (!url) return 'Error: "url" required.';
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return `Error: invalid URL "${url}".`;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return `Error: only http(s) URLs are allowed (got ${parsed.protocol}).`;
    }

    await ctx.logger.log(`fetch_url: ${url}`);

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": "YetiMind/0.1 (+education)" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const ctype = res.headers.get("content-type") ?? "";
      const buf = await res.arrayBuffer();
      let body = new TextDecoder().decode(buf.slice(0, MAX_BYTES));
      const truncatedNote = buf.byteLength > MAX_BYTES ? `\n\n… (truncated at ${MAX_BYTES} bytes of ${buf.byteLength})` : "";

      if (asText && ctype.includes("html")) {
        body = stripHtml(body);
      }
      const header = `HTTP ${res.status} · ${ctype} · ${buf.byteLength} bytes`;
      return `${header}\n\n${body}${truncatedNote}`;
    } catch (e) {
      return `Error fetching ${url}: ${(e as Error).message}`;
    }
  },
};
