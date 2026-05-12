/**
 * provider.ts — LLM client using the native Google Gemini SDK.
 *
 * Uses @google/genai for streaming chat completions with tool support.
 */

import { GoogleGenAI, Type } from "@google/genai";
import type { FunctionCall } from "@google/genai";
import type { LLMProvider, StreamChatOptions } from "./types";
import type { StreamResult } from "../../domain/types";

export { Type };

export class GeminiProvider implements LLMProvider {
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async streamChat(opts: StreamChatOptions): Promise<StreamResult> {
    const { model, systemInstruction, contents, tools, writeToken } = opts;

    // Build config
  const config: Record<string, unknown> = {
    systemInstruction,
  };

  if (tools && tools.length > 0) {
    config["tools"] = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ];
  }

  // Stream the response
  const responseStream = await this.ai.models.generateContentStream({
    model,
    contents,
    config,
  });

  let fullText = "";
  const allFunctionCalls: FunctionCall[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;

  for await (const chunk of responseStream) {
    // Extract text
    const text = chunk.text;
    if (text) {
      fullText += text;
      writeToken(text);
    }

    // Extract function calls
    const fcs = chunk.functionCalls;
    if (fcs && fcs.length > 0) {
      allFunctionCalls.push(...fcs);
    }

    // Extract usage metadata (usually in the final chunk)
    if (chunk.usageMetadata) {
      promptTokens = chunk.usageMetadata.promptTokenCount ?? 0;
      completionTokens = chunk.usageMetadata.candidatesTokenCount ?? 0;
      totalTokens = chunk.usageMetadata.totalTokenCount ?? 0;
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
}
