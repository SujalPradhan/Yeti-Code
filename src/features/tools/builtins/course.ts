/**
 * course.ts — Tools aligned with the IITM "Tools in Data Science" course.
 *
 * These cover skills the course teaches as first-class topics (REST APIs,
 * JSON parsing, CSV profiling, base64 / encoding) so the model has structured
 * alternatives to shelling out for each one.
 */

import * as fs from "fs/promises";
import type { Tool, ToolContext } from "../types";
import { resolveWorkspacePath } from "../pathSafety";

const HTTP_TIMEOUT_MS = 15_000;
const HTTP_MAX_BYTES = 500_000;

// ── http_request ───────────────────────────────────────────────────────────
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const httpRequestTool: Tool = {
  name: "http_request",
  description:
    "Send an HTTP request and return status, headers, and body. Supports GET/HEAD/OPTIONS without confirmation; " +
    "POST/PUT/PATCH/DELETE prompt for confirmation. Caps body at 500KB.",
  schema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Full URL including http(s)://." },
      method: { type: "string", description: "HTTP method (default GET)." },
      headers: {
        type: "object",
        description: "Header name → value map.",
        additionalProperties: { type: "string" },
      },
      body: { type: "string", description: "Request body (raw string; set Content-Type header explicitly)." },
      json: { type: "object", description: "Shortcut: a JSON object to send as the body with content-type application/json.", additionalProperties: true },
    },
    required: ["url"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const url = args["url"] as string;
    const method = ((args["method"] as string) ?? "GET").toUpperCase();
    const headers = (args["headers"] as Record<string, string>) ?? {};
    let body = (args["body"] as string) ?? undefined;
    const jsonBody = args["json"];

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

    if (jsonBody !== undefined) {
      body = JSON.stringify(jsonBody);
      if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
        headers["Content-Type"] = "application/json";
      }
    }

    if (!SAFE_METHODS.has(method)) {
      const ok = await ctx.confirm(`Send ${method} ${url}?`);
      if (!ok) return "Action cancelled by user.";
    }

    await ctx.logger.log(`http_request ${method} ${url}`);

    try {
      const res = await fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      const buf = await res.arrayBuffer();
      const text = new TextDecoder().decode(buf.slice(0, HTTP_MAX_BYTES));
      const truncated = buf.byteLength > HTTP_MAX_BYTES
        ? `\n\n… (truncated at ${HTTP_MAX_BYTES} bytes of ${buf.byteLength})`
        : "";

      const hdrLines: string[] = [];
      res.headers.forEach((v, k) => hdrLines.push(`  ${k}: ${v}`));

      return [
        `HTTP ${res.status} ${res.statusText}`,
        hdrLines.join("\n"),
        "",
        text + truncated,
      ].join("\n");
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  },
};

// ── json_query ─────────────────────────────────────────────────────────────
// Lightweight JSONPath-ish evaluator: dot/bracket access, wildcards, slices.
// Supports:  .a.b.c   .arr[0]   .arr[*].name   .arr[1:4]   .   (whole doc)
function evalJsonPath(doc: unknown, path: string): unknown {
  if (!path || path === "." || path === "$") return doc;
  // Tokenize
  const tokens: string[] = [];
  let buf = "";
  let i = 0;
  while (i < path.length) {
    const c = path[i];
    if (c === ".") {
      if (buf) { tokens.push(buf); buf = ""; }
      i++;
    } else if (c === "[") {
      if (buf) { tokens.push(buf); buf = ""; }
      const end = path.indexOf("]", i);
      if (end === -1) throw new Error(`Unclosed [ in path at ${i}`);
      tokens.push(`[${path.slice(i + 1, end)}]`);
      i = end + 1;
    } else if (c === "$") {
      i++;
    } else {
      buf += c;
      i++;
    }
  }
  if (buf) tokens.push(buf);

  let current: unknown = doc;
  for (const tok of tokens) {
    if (current === null || current === undefined) return undefined;
    if (tok.startsWith("[") && tok.endsWith("]")) {
      const inner = tok.slice(1, -1);
      if (inner === "*") {
        if (!Array.isArray(current)) return undefined;
        return current.map((v) => v); // identity, caller can continue but we collapse here
      }
      if (inner.includes(":")) {
        if (!Array.isArray(current)) return undefined;
        const [a, b] = inner.split(":").map((s) => (s === "" ? undefined : parseInt(s, 10)));
        current = current.slice(a, b);
        continue;
      }
      const n = parseInt(inner, 10);
      if (Number.isNaN(n)) {
        // String key in bracket form: ["key"]
        const key = inner.replace(/^['"]|['"]$/g, "");
        current = (current as Record<string, unknown>)[key];
      } else {
        if (!Array.isArray(current)) return undefined;
        current = current[n < 0 ? current.length + n : n];
      }
    } else {
      current = (current as Record<string, unknown>)[tok];
    }
  }
  return current;
}

export const jsonQueryTool: Tool = {
  name: "json_query",
  description:
    "Query a JSON file or inline JSON with a dotted path. Examples: '.users[0].name', '.items[*]', '.data[0:5]'. " +
    "Use '.' or '$' to return the whole document.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to a JSON file in the workspace." },
      json: { type: "string", description: "Inline JSON string (use this instead of path)." },
      query: { type: "string", description: "Dotted/bracket path, e.g. '.users[0].name'." },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = args["path"] as string | undefined;
    const inline = args["json"] as string | undefined;
    const query = args["query"] as string;
    if (!query) return 'Error: "query" required.';
    if (!filePath && !inline) return 'Error: provide either "path" or "json".';

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

    let doc: unknown;
    try {
      doc = JSON.parse(raw);
    } catch (e) {
      return `Error: invalid JSON: ${(e as Error).message}`;
    }

    try {
      const result = evalJsonPath(doc, query);
      return JSON.stringify(result, null, 2);
    } catch (e) {
      return `Error evaluating path: ${(e as Error).message}`;
    }
  },
};

// ── csv_info ───────────────────────────────────────────────────────────────
// Lightweight CSV profiler — no pandas dep needed. RFC-4180-ish: handles
// quoted fields and embedded commas/newlines for the common case.
function parseCsvRow(line: string, sep: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { buf += '"'; i++; }
      else if (c === '"') inQ = false;
      else buf += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === sep) { out.push(buf); buf = ""; }
      else buf += c;
    }
  }
  out.push(buf);
  return out;
}

function inferType(v: string): "int" | "float" | "bool" | "date" | "string" | "null" {
  if (v === "" || v.toLowerCase() === "null" || v.toLowerCase() === "nan") return "null";
  if (/^-?\d+$/.test(v)) return "int";
  if (/^-?\d+\.\d+(e-?\d+)?$/i.test(v)) return "float";
  if (/^(true|false)$/i.test(v)) return "bool";
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return "date";
  return "string";
}

export const csvInfoTool: Tool = {
  name: "csv_info",
  description:
    "Profile a CSV: row count, column names, inferred dtypes, null counts, sample of first rows. " +
    "Far cheaper than read_file for big CSVs.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the CSV file." },
      separator: { type: "string", description: "Delimiter (default ',')." },
      sample_rows: { type: "number", description: "How many sample rows to include (default 5)." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const p = args["path"] as string;
    const sep = (args["separator"] as string) ?? ",";
    const sampleRows = typeof args["sample_rows"] === "number" ? (args["sample_rows"] as number) : 5;
    if (!p) return 'Error: "path" required.';
    const safe = resolveWorkspacePath(p);
    if (!safe.ok) return `Error: ${safe.error}`;

    let raw: string;
    try {
      raw = await fs.readFile(safe.path, "utf-8");
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
    const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length === 0) return "Empty file.";

    const header = parseCsvRow(lines[0], sep);
    const rows = lines.slice(1).map((l) => parseCsvRow(l, sep));

    const typeCounts: Record<string, Record<string, number>> = {};
    const nulls: Record<string, number> = {};
    for (const col of header) {
      typeCounts[col] = {};
      nulls[col] = 0;
    }
    for (const row of rows) {
      for (let i = 0; i < header.length; i++) {
        const col = header[i];
        const v = (row[i] ?? "").trim();
        const t = inferType(v);
        if (t === "null") nulls[col]++;
        else typeCounts[col][t] = (typeCounts[col][t] ?? 0) + 1;
      }
    }

    const out: string[] = [];
    out.push(`${p}: ${rows.length} rows × ${header.length} cols`);
    out.push("");
    out.push("Columns (name · dominant dtype · nulls):");
    for (const col of header) {
      const dist = typeCounts[col];
      const sorted = Object.entries(dist).sort((a, b) => b[1] - a[1]);
      const top = sorted[0]?.[0] ?? "null";
      out.push(`  · ${col.padEnd(24)} ${top.padEnd(8)} nulls=${nulls[col]}`);
    }
    out.push("");
    out.push(`First ${Math.min(sampleRows, rows.length)} rows:`);
    out.push(`  ${header.join(" | ")}`);
    for (let i = 0; i < Math.min(sampleRows, rows.length); i++) {
      out.push(`  ${rows[i].join(" | ")}`);
    }
    return out.join("\n");
  },
};

// ── encode / decode ────────────────────────────────────────────────────────
// Base64, hex, URL, ROT13. Course teaches base64-encoding as its own topic,
// and picoCTF (Project 2A) leans on these constantly.
type Codec = "base64" | "hex" | "url" | "rot13";

function rot13(s: string): string {
  return s.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function encodeText(s: string, codec: Codec): string {
  switch (codec) {
    case "base64": return Buffer.from(s, "utf-8").toString("base64");
    case "hex": return Buffer.from(s, "utf-8").toString("hex");
    case "url": return encodeURIComponent(s);
    case "rot13": return rot13(s);
  }
}

function decodeText(s: string, codec: Codec): string {
  switch (codec) {
    case "base64": return Buffer.from(s, "base64").toString("utf-8");
    case "hex": return Buffer.from(s, "hex").toString("utf-8");
    case "url": return decodeURIComponent(s);
    case "rot13": return rot13(s);
  }
}

function isCodec(v: unknown): v is Codec {
  return v === "base64" || v === "hex" || v === "url" || v === "rot13";
}

export const encodeTool: Tool = {
  name: "encode",
  description: "Encode text. Codecs: base64, hex, url, rot13.",
  schema: {
    type: "object",
    properties: {
      text: { type: "string", description: "Text to encode." },
      codec: { type: "string", description: "One of: base64, hex, url, rot13." },
    },
    required: ["text", "codec"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const text = args["text"] as string;
    const codec = args["codec"];
    if (typeof text !== "string") return 'Error: "text" required.';
    if (!isCodec(codec)) return 'Error: codec must be one of base64, hex, url, rot13.';
    try {
      return encodeText(text, codec);
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  },
};

export const decodeTool: Tool = {
  name: "decode",
  description: "Decode text. Codecs: base64, hex, url, rot13.",
  schema: {
    type: "object",
    properties: {
      text: { type: "string", description: "Text to decode." },
      codec: { type: "string", description: "One of: base64, hex, url, rot13." },
    },
    required: ["text", "codec"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const text = args["text"] as string;
    const codec = args["codec"];
    if (typeof text !== "string") return 'Error: "text" required.';
    if (!isCodec(codec)) return 'Error: codec must be one of base64, hex, url, rot13.';
    try {
      return decodeText(text, codec);
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  },
};
