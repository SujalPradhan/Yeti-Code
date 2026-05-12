import type { Content, Part, FunctionCall } from "@google/genai";

export type { Content, Part, FunctionCall };

export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface StreamResult extends UsageStats {
  text: string;
  functionCalls: FunctionCall[];
}
