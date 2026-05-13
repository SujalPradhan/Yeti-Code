/**
 * ollama.ts — LLM provider for local Ollama models.
 *
 * Connects to a locally running Ollama instance via its OpenAI-compatible
 * REST API. Supports streaming and tool calling (Ollama ≥ 0.4.6).
 */

import type { LLMProvider, StreamChatOptions } from "./types";
import type { StreamResult, FunctionCall } from "../../domain/types";

const DEFAULT_OLLAMA_URL = "http://localhost:11434";

interface PendingToolCall {
  id?: string;
  name?: string;
  arguments: string;
}

/**
 * Streaming filter that handles <think>…</think> blocks. Qwen 3 emits a
 * lengthy chain-of-thought there before its visible answer.
 *
 * Modes:
 *   - "strip": thinking is dropped entirely (kept out of UI AND context).
 *   - "show":  thinking is wrapped in ANSI dim + a 💭 marker so the user
 *              sees it streaming distinctly, then a divider before the
 *              answer. Visible output includes the thinking — caller can
 *              choose whether to also store it in context.
 *
 * Both modes return only "visible" text (no raw tags) and are streaming-
 * safe across chunk boundaries.
 */
type ThinkMode = "strip" | "show";

class ThinkStripper {
  private state: "out" | "in" = "out";
  private buf = "";
  private static readonly OPEN = "<think>";
  private static readonly CLOSE = "</think>";
  // ANSI: 2 = dim on, 22 = dim off.
  private static readonly DIM_ON = "\x1b[2m";
  private static readonly DIM_OFF = "\x1b[22m";

  constructor(private readonly mode: ThinkMode = "strip") {}

  feed(chunk: string): string {
    this.buf += chunk;
    let out = "";
    while (this.buf.length > 0) {
      if (this.state === "out") {
        const idx = this.buf.indexOf(ThinkStripper.OPEN);
        if (idx >= 0) {
          out += this.buf.slice(0, idx);
          this.buf = this.buf.slice(idx + ThinkStripper.OPEN.length);
          this.state = "in";
          if (this.mode === "show") {
            out += `\n${ThinkStripper.DIM_ON}💭 `;
          }
          continue;
        }
        // Hold back any tail that could be the start of "<think>".
        let holdFrom = this.buf.length;
        const scanFrom = Math.max(0, this.buf.length - (ThinkStripper.OPEN.length - 1));
        for (let i = scanFrom; i < this.buf.length; i++) {
          if (ThinkStripper.OPEN.startsWith(this.buf.slice(i))) {
            holdFrom = i;
            break;
          }
        }
        out += this.buf.slice(0, holdFrom);
        this.buf = this.buf.slice(holdFrom);
        break;
      } else {
        const idx = this.buf.indexOf(ThinkStripper.CLOSE);
        if (idx >= 0) {
          if (this.mode === "show") {
            out += this.buf.slice(0, idx);
            out += `${ThinkStripper.DIM_OFF}\n─── answer ───\n`;
          }
          this.buf = this.buf.slice(idx + ThinkStripper.CLOSE.length);
          this.state = "out";
          continue;
        }
        if (this.mode === "show") {
          // Stream the thinking text, but hold the tail in case "</think>"
          // straddles a chunk boundary.
          const holdLen = Math.min(this.buf.length, ThinkStripper.CLOSE.length - 1);
          const emitTo = this.buf.length - holdLen;
          out += this.buf.slice(0, emitTo);
          this.buf = this.buf.slice(emitTo);
        } else {
          // Drop everything except the tail that could begin "</think>".
          const holdLen = Math.min(this.buf.length, ThinkStripper.CLOSE.length - 1);
          this.buf = this.buf.slice(this.buf.length - holdLen);
        }
        break;
      }
    }
    return out;
  }

  flush(): string {
    if (this.state === "out") {
      const out = this.buf;
      this.buf = "";
      return out;
    }
    // Stream ended mid-thinking — close the styling so the prompt is readable.
    this.buf = "";
    return this.mode === "show" ? ThinkStripper.DIM_OFF : "";
  }
}

/** Qwen 3 supports a "/no_think" directive that disables its thinking mode. */
function isQwen3(model: string): boolean {
  return model.toLowerCase().startsWith("qwen3");
}

export class OllamaProvider implements LLMProvider {
  private baseUrl: string;
  private thinking = false;

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl ?? DEFAULT_OLLAMA_URL).replace(/\/$/, "");
  }

  /** Toggle whether thinking-mode models (Qwen 3 etc.) reason out loud. */
  setThinking(enabled: boolean): void {
    this.thinking = enabled;
  }

  isThinking(): boolean {
    return this.thinking;
  }

  async streamChat(opts: StreamChatOptions): Promise<StreamResult> {
    const { model, systemInstruction, contents, tools, writeToken } = opts;

    // Convert Gemini-style contents to OpenAI-style messages
    const messages = this.convertToMessages(systemInstruction, contents as Array<{ role?: string; parts?: Array<Record<string, unknown>> }>);

    // Build request body
    const body: Record<string, unknown> = {
      model,
      messages,
      stream: true,
    };

    // Ollama-specific knob (≥ 0.7) — explicitly enable or disable thinking
    // on supported models (Qwen 3, DeepSeek-R1, etc.). Harmless if ignored.
    if (isQwen3(model)) {
      body["think"] = this.thinking;
    }

    if (tools && tools.length > 0) {
      body["tools"] = tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ollama error (${response.status}): ${errText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response stream from Ollama");

    const decoder = new TextDecoder();
    let fullText = "";
    const stripper = new ThinkStripper(this.thinking ? "show" : "strip");
    const pendingToolCalls = new Map<number, PendingToolCall>();
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;

        try {
          const chunk = JSON.parse(data);
          const delta = chunk?.choices?.[0]?.delta;

          if (delta?.content) {
            const visible = stripper.feed(delta.content);
            if (visible) {
              fullText += visible;
              writeToken(visible);
            }
          }

          // Handle streamed tool call deltas.
          if (Array.isArray(delta?.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const index = typeof tc.index === "number" ? tc.index : 0;
              const pending = pendingToolCalls.get(index) ?? { arguments: "" };

              if (typeof tc.id === "string") {
                pending.id = tc.id;
              }
              if (typeof tc.function?.name === "string") {
                if (!pending.name) {
                  pending.name = tc.function.name;
                } else if (!pending.name.endsWith(tc.function.name)) {
                  pending.name += tc.function.name;
                }
              }
              if (typeof tc.function?.arguments === "string") {
                pending.arguments += tc.function.arguments;
              }

              pendingToolCalls.set(index, pending);
            }
          }

          // Usage (usually in the final chunk)
          if (chunk?.usage) {
            promptTokens = chunk.usage.prompt_tokens ?? 0;
            completionTokens = chunk.usage.completion_tokens ?? 0;
            totalTokens = chunk.usage.total_tokens ?? 0;
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`Failed to parse Ollama stream chunk: ${message}`);
        }
      }
    }

    // Drain any held-back text (e.g. the stream ended mid-tag-guess).
    const tail = stripper.flush();
    if (tail) {
      fullText += tail;
      writeToken(tail);
    }

    const allFunctionCalls: FunctionCall[] = [];
    for (const [index, call] of Array.from(pendingToolCalls.entries()).sort(([a], [b]) => a - b)) {
      if (!call.name) continue;

      let parsedArgs: Record<string, unknown> = {};
      if (call.arguments.trim()) {
        try {
          parsedArgs = JSON.parse(call.arguments) as Record<string, unknown>;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`Failed to parse tool call arguments for ${call.name}: ${message}`);
        }
      }

      allFunctionCalls.push({
        id: call.id ?? `call_${index}`,
        name: call.name,
        args: parsedArgs,
      });
    }

    return {
      text: fullText,
      functionCalls: allFunctionCalls,
      promptTokens,
      completionTokens,
      totalTokens,
    };
  }

  private convertToMessages(
    systemInstruction: string,
    contents: Array<{ role?: string; parts?: Array<Record<string, unknown>> }>,
  ): Array<Record<string, unknown>> {
    const messages: Array<Record<string, unknown>> = [];

    if (systemInstruction) {
      messages.push({ role: "system", content: systemInstruction });
    }

    for (const msg of contents) {
      const role = msg.role === "model" ? "assistant" : "user";
      const parts = msg.parts ?? [];

      // Handle function calls from the model
      const functionCallParts = parts.filter((p) => p["functionCall"]);
      if (functionCallParts.length > 0) {
        const toolCalls = functionCallParts.map((p, i) => {
          const fc = p["functionCall"] as Record<string, unknown>;
          const id = typeof fc["id"] === "string" ? fc["id"] : `call_${i}`;
          return {
            id,
            type: "function",
            function: {
              name: fc["name"],
              arguments: JSON.stringify(fc["args"] ?? {}),
            },
          };
        });
        messages.push({ role: "assistant", tool_calls: toolCalls });
        continue;
      }

      // Handle function responses
      const functionResponseParts = parts.filter((p) => p["functionResponse"]);
      if (functionResponseParts.length > 0) {
        for (let i = 0; i < functionResponseParts.length; i++) {
          const p = functionResponseParts[i];
          const fr = p["functionResponse"] as Record<string, unknown>;
          const resp = fr["response"] as Record<string, unknown>;
          const id = typeof fr["id"] === "string" ? fr["id"] : `call_${i}`;
          messages.push({
            role: "tool",
            tool_call_id: id,
            content: typeof resp?.["result"] === "string"
              ? resp["result"]
              : JSON.stringify(resp ?? {}),
          });
        }
        continue;
      }

      // Handle plain text
      const textParts = parts.filter((p) => p["text"]);
      if (textParts.length > 0) {
        const text = textParts.map((p) => p["text"]).join("");
        messages.push({ role, content: text });
      }
    }

    return messages;
  }

  /** Check if Ollama is reachable. */
  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** List models available in the local Ollama instance. */
  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) return [];
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      return (data.models ?? []).map((m) => m.name);
    } catch {
      return [];
    }
  }
}
