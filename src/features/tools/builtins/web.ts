import * as fs from "fs/promises";
import type { Tool, ToolContext } from "../types";
import { resolveWorkspacePath } from "../pathSafety";

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

// ── extract_html ───────────────────────────────────────────────────────────
// Tiny CSS-selector engine. Supports: tag, .class, #id, [attr], [attr=val],
// descendant (space), child (>). Enough for the course's scraping module
// without pulling cheerio/jsdom into the bundle.
interface HtmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
  text: string;
  parent?: HtmlNode;
}

function parseHtml(html: string): HtmlNode {
  const root: HtmlNode = { tag: "#root", attrs: {}, children: [], text: "" };
  const stack: HtmlNode[] = [root];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>/g;
  const voidEls = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const text = html.slice(lastIdx, m.index);
    if (text.trim()) {
      stack[stack.length - 1].text += text;
    }
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    const attrsRaw = m[3];
    const selfClose = m[4] === "/" || voidEls.has(tag);

    if (closing) {
      // Pop until we find this tag
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
    } else {
      // Skip script/style content
      if (tag === "script" || tag === "style") {
        const close = html.indexOf(`</${tag}`, tagRe.lastIndex);
        if (close === -1) break;
        tagRe.lastIndex = close;
        lastIdx = tagRe.lastIndex;
        continue;
      }
      const attrs: Record<string, string> = {};
      const attrRe = /([a-zA-Z_:][a-zA-Z0-9._:-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let am: RegExpExecArray | null;
      while ((am = attrRe.exec(attrsRaw)) !== null) {
        attrs[am[1].toLowerCase()] = am[3] ?? am[4] ?? am[5] ?? "";
      }
      const node: HtmlNode = { tag, attrs, children: [], text: "", parent: stack[stack.length - 1] };
      stack[stack.length - 1].children.push(node);
      if (!selfClose) stack.push(node);
    }
    lastIdx = tagRe.lastIndex;
  }
  return root;
}

interface Simple {
  tag?: string;
  id?: string;
  classes: string[];
  attrs: Array<{ name: string; value?: string }>;
}
type Combinator = " " | ">";

function parseSelector(sel: string): Array<{ comb: Combinator; simple: Simple }> {
  // Split into compound parts; track combinators between.
  const parts: Array<{ comb: Combinator; simple: Simple }> = [];
  const tokens = sel.trim().split(/\s+/);
  let prevComb: Combinator = " ";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === ">") { prevComb = ">"; continue; }
    parts.push({ comb: i === 0 ? " " : prevComb, simple: parseSimple(t) });
    prevComb = " ";
  }
  return parts;
}

function parseSimple(s: string): Simple {
  const out: Simple = { classes: [], attrs: [] };
  // Pull off [..] groups
  s = s.replace(/\[([^\]]+)\]/g, (_, inner: string) => {
    const eq = inner.indexOf("=");
    if (eq === -1) {
      out.attrs.push({ name: inner.trim().toLowerCase() });
    } else {
      const name = inner.slice(0, eq).trim().toLowerCase();
      const val = inner.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
      out.attrs.push({ name, value: val });
    }
    return "";
  });
  // Now classes and ids
  const classRe = /\.([a-zA-Z_][\w-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = classRe.exec(s)) !== null) out.classes.push(m[1]);
  s = s.replace(classRe, "");
  const idM = s.match(/#([a-zA-Z_][\w-]*)/);
  if (idM) {
    out.id = idM[1];
    s = s.replace(idM[0], "");
  }
  if (s && s !== "*") out.tag = s.toLowerCase();
  return out;
}

function matchesSimple(node: HtmlNode, s: Simple): boolean {
  if (s.tag && node.tag !== s.tag) return false;
  if (s.id && node.attrs["id"] !== s.id) return false;
  if (s.classes.length > 0) {
    const cls = (node.attrs["class"] ?? "").split(/\s+/);
    for (const c of s.classes) if (!cls.includes(c)) return false;
  }
  for (const a of s.attrs) {
    if (!(a.name in node.attrs)) return false;
    if (a.value !== undefined && node.attrs[a.name] !== a.value) return false;
  }
  return true;
}

function nodeText(node: HtmlNode): string {
  let t = node.text;
  for (const c of node.children) t += " " + nodeText(c);
  return t.replace(/\s+/g, " ").trim();
}

function nodeHtml(node: HtmlNode): string {
  const attrs = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${v.replace(/"/g, "&quot;")}"`).join("");
  if (node.children.length === 0 && !node.text) return `<${node.tag}${attrs}/>`;
  let inner = node.text;
  for (const c of node.children) inner += nodeHtml(c);
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
}

function querySelectorAll(root: HtmlNode, selector: string): HtmlNode[] {
  const parts = parseSelector(selector);
  if (parts.length === 0) return [];

  let candidates: HtmlNode[] = [];
  const collectAll = (n: HtmlNode): void => {
    for (const c of n.children) { candidates.push(c); collectAll(c); }
  };
  collectAll(root);
  // Start by matching the LAST simple selector across all descendants,
  // then walk left validating combinators against ancestors.
  const last = parts[parts.length - 1];
  let matches = candidates.filter((n) => matchesSimple(n, last.simple));

  for (let i = parts.length - 2; i >= 0; i--) {
    const { simple } = parts[i];
    const combNext = parts[i + 1].comb;
    matches = matches.filter((n) => {
      if (combNext === ">") {
        const p = n.parent;
        return !!p && matchesSimple(p, simple);
      }
      // descendant
      let p = n.parent;
      while (p) {
        if (matchesSimple(p, simple)) return true;
        p = p.parent;
      }
      return false;
    });
  }
  return matches;
}

export const extractHtmlTool: Tool = {
  name: "extract_html",
  description:
    "Extract elements from an HTML file or string with a CSS selector. Supports tag, .class, #id, [attr], [attr=val], " +
    "descendant (' '), and child ('>') combinators. Returns either the text content or the outer HTML of each match.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to an HTML file in the workspace." },
      html: { type: "string", description: "Inline HTML string (use this instead of path)." },
      selector: { type: "string", description: "CSS selector. Examples: 'a[href]', '.product h2', 'table > tr'." },
      mode: { type: "string", description: "'text' (default) or 'html' for outer HTML of each match." },
      max_results: { type: "number", description: "Cap on results (default 100)." },
    },
    required: ["selector"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = args["path"] as string | undefined;
    const inline = args["html"] as string | undefined;
    const selector = args["selector"] as string;
    const mode = ((args["mode"] as string) ?? "text") === "html" ? "html" : "text";
    const cap = typeof args["max_results"] === "number" ? (args["max_results"] as number) : 100;
    if (!selector) return 'Error: "selector" required.';
    if (!filePath && !inline) return 'Error: provide either "path" or "html".';

    let raw: string;
    if (filePath) {
      const safe = resolveWorkspacePath(filePath);
      if (!safe.ok) return `Error: ${safe.error}`;
      try {
        raw = await fs.readFile(safe.path, "utf-8");
      } catch (e) {
        return `Error reading "${filePath}": ${(e as Error).message}`;
      }
    } else {
      raw = inline as string;
    }

    const root = parseHtml(raw);
    const matches = querySelectorAll(root, selector).slice(0, cap);
    if (matches.length === 0) return `No matches for "${selector}".`;
    return matches.map((n) => (mode === "html" ? nodeHtml(n) : nodeText(n))).join("\n");
  },
};

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
        headers: { "User-Agent": "yeti-code/0.1 (+education; tds.s-anand.net)" },
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
