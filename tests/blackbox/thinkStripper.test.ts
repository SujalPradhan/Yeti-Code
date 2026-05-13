import { describe, it, expect } from "vitest";
import { ThinkStripper } from "../../src/infrastructure/llm/ollama";

// ANSI codes the stripper uses in "show" mode.
const DIM_ON = "\x1b[2m";
const DIM_OFF = "\x1b[22m";

function feedAll(s: ThinkStripper, chunks: string[]): string {
  let out = "";
  for (const c of chunks) out += s.feed(c);
  out += s.flush();
  return out;
}

describe("ThinkStripper — strip mode", () => {
  it("removes a single <think>…</think> block delivered in one chunk", () => {
    const s = new ThinkStripper("strip");
    expect(feedAll(s, ["before<think>hidden thoughts</think>after"])).toBe("beforeafter");
  });

  it("removes a block split across many tiny chunks", () => {
    const s = new ThinkStripper("strip");
    const stream = "Hi <think>secret reasoning here</think>there.";
    const chunks = stream.split("");
    expect(feedAll(s, chunks)).toBe("Hi there.");
  });

  it("handles open tag straddling a chunk boundary", () => {
    const s = new ThinkStripper("strip");
    expect(feedAll(s, ["hello <thi", "nk>hidden</think>world"])).toBe("hello world");
  });

  it("handles close tag straddling a chunk boundary", () => {
    const s = new ThinkStripper("strip");
    expect(feedAll(s, ["a<think>hidden</thi", "nk>b"])).toBe("ab");
  });

  it("passes through text with no thinking blocks unchanged", () => {
    const s = new ThinkStripper("strip");
    expect(feedAll(s, ["plain ", "old ", "text"])).toBe("plain old text");
  });

  it("handles back-to-back blocks", () => {
    const s = new ThinkStripper("strip");
    expect(feedAll(s, ["a<think>x</think>b<think>y</think>c"])).toBe("abc");
  });

  it("drops unclosed thinking when stream ends mid-block", () => {
    const s = new ThinkStripper("strip");
    expect(feedAll(s, ["a<think>partial"])).toBe("a");
  });

  it("does not eat angle brackets that look like, but aren't, the tag", () => {
    const s = new ThinkStripper("strip");
    expect(feedAll(s, ["a<thing>b</thing>c"])).toBe("a<thing>b</thing>c");
  });
});

describe("ThinkStripper — show mode", () => {
  it("wraps the thinking content in ANSI dim with markers", () => {
    const s = new ThinkStripper("show");
    const out = feedAll(s, ["a<think>reason</think>b"]);
    expect(out).toContain(DIM_ON);
    expect(out).toContain("💭");
    expect(out).toContain("reason");
    expect(out).toContain(DIM_OFF);
    expect(out).toContain("answer");
    expect(out.startsWith("a")).toBe(true);
    expect(out.endsWith("b")).toBe(true);
  });

  it("streams thinking content incrementally without holding everything until close", () => {
    const s = new ThinkStripper("show");
    // Feed the opening + a chunk of thinking — we should see most of the
    // thinking content emitted now, not buffered.
    const first = s.feed("a<think>reasoning_content_here_long_enough_to_emit");
    expect(first).toContain("💭");
    // Most of the long token should be visible already; the tail (up to 7
    // chars for "</think>" prefix detection) may be held back.
    expect(first).toMatch(/reasoning_content_here/);
  });

  it("emits dim-off on flush when the stream dies mid-thinking", () => {
    const s = new ThinkStripper("show");
    const out = feedAll(s, ["a<think>oops"]);
    expect(out).toContain(DIM_OFF);
  });
});
