/**
 * context.ts — Manages conversation history with a hard token-window limit.
 *
 * Uses the native Gemini SDK types (Content, Part) for message representation.
 * Token estimation uses the "4 chars ≈ 1 token" heuristic.
 */

import type { Content, UsageStats } from "./types";

/** Estimate token count for a single Content message. */
export function estimateTokens(message: Content): number {
  let chars = 0;
  if (message.parts) {
    for (const part of message.parts) {
      if (part.text) {
        chars += part.text.length;
      }
      if (part.functionCall) {
        chars += JSON.stringify(part.functionCall).length;
      }
      if (part.functionResponse) {
        chars += JSON.stringify(part.functionResponse).length;
      }
    }
  }
  // ~4 chars per token + 4-token overhead per message
  return Math.ceil(chars / 4) + 4;
}

/** Estimate total tokens across an array of messages. */
export function estimateTotalTokens(messages: Content[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m), 0);
}

export class ConversationContext {
  private messages: Content[] = [];
  private readonly maxTokens: number;
  private systemInstruction: string;
  private lastUsage: UsageStats | null = null;

  constructor(maxTokens: number) {
    this.maxTokens = maxTokens;
    this.systemInstruction =
      "You are YetiMind, a helpful and concise terminal AI assistant. " +
      "Answer clearly and directly. Use markdown formatting when helpful. " +
      "You have access to tools for reading files, writing files, and running shell commands. " +
      "Use them when the user's request requires interacting with the filesystem or running commands.";
  }

  /** Add a message and trim oldest messages if over the limit. */
  addMessage(message: Content): void {
    this.messages.push(message);
    this.trim();
  }

  /** Get the current message array (immutable copy). */
  getMessages(): Content[] {
    return [...this.messages];
  }

  replaceLastMessage(message: Content): void {
    if (this.messages.length === 0) {
      this.addMessage(message);
      return;
    }

    this.messages[this.messages.length - 1] = message;
    this.trim();
  }

  /** Get the system instruction string (used in config, not as a Content message). */
  getSystemInstruction(): string {
    return this.systemInstruction;
  }

  /** Update the system instruction (for skill switching). */
  updateSystemMessage(content: string): void {
    this.systemInstruction = content;
  }

  setLastUsage(usage: UsageStats): void {
    this.lastUsage = usage;
  }

  getLastUsage(): UsageStats | null {
    return this.lastUsage;
  }

  /** Current estimated token count. */
  getTokenCount(): number {
    return estimateTotalTokens(this.messages);
  }

  /** Number of messages. */
  getMessageCount(): number {
    return this.messages.length;
  }

  /** Configured maximum token budget for the context window. */
  getMaxTokens(): number {
    return this.maxTokens;
  }

  /**
   * Drop the oldest messages until we're under the token limit.
   */
  private trim(): void {
    while (
      this.messages.length > 1 &&
      estimateTotalTokens(this.messages) > this.maxTokens
    ) {
      this.messages.splice(0, 1);

      while (
        this.messages.length > 0 &&
        (this.hasFunctionCall(this.messages[0]) ||
          this.hasFunctionResponse(this.messages[0]))
      ) {
        this.messages.splice(0, 1);
      }
    }
  }

  private hasFunctionCall(message: Content): boolean {
    return message.parts?.some((part) => Boolean(part.functionCall)) ?? false;
  }

  private hasFunctionResponse(message: Content): boolean {
    return message.parts?.some((part) => Boolean(part.functionResponse)) ?? false;
  }
}
