import type { Content, StreamResult } from "../../domain/types";

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface StreamChatOptions {
  model: string;
  systemInstruction: string;
  contents: Content[];
  tools?: FunctionDeclaration[];
  writeToken: (token: string) => void;
}

export interface LLMProvider {
  streamChat(opts: StreamChatOptions): Promise<StreamResult>;
}
