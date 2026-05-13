/**
 * ollama.ts — LLM provider for local Ollama models.
 *
 * Connects to a locally running Ollama instance via its OpenAI-compatible
 * REST API. Supports streaming and tool calling (Ollama ≥ 0.4.6).
 */

import type { LLMProvider, StreamChatOptions } from "./types";
import type { StreamResult, FunctionCall } from "../../domain/types";

const DEFAULT_OLLAMA_URL = "http://localhost:11434";

export class OllamaProvider implements LLMProvider {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl ?? DEFAULT_OLLAMA_URL).replace(/\/$/, "");
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
    const allFunctionCalls: FunctionCall[] = [];
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
            fullText += delta.content;
            writeToken(delta.content);
          }

          // Handle tool calls
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.function?.name) {
                allFunctionCalls.push({
                  name: tc.function.name,
                  args: tc.function.arguments
                    ? JSON.parse(tc.function.arguments)
                    : {},
                });
              }
            }
          }

          // Usage (usually in the final chunk)
          if (chunk?.usage) {
            promptTokens = chunk.usage.prompt_tokens ?? 0;
            completionTokens = chunk.usage.completion_tokens ?? 0;
            totalTokens = chunk.usage.total_tokens ?? 0;
          }
        } catch {
          // Skip malformed chunks
        }
      }
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
          return {
            id: `call_${i}`,
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
        for (const p of functionResponseParts) {
          const fr = p["functionResponse"] as Record<string, unknown>;
          const resp = fr["response"] as Record<string, unknown>;
          messages.push({
            role: "tool",
            tool_call_id: `call_0`,
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
