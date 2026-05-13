/**
 * src/domain/team/subAgent.ts
 *
 * Lightweight sub-agent runner.
 *
 * A sub-agent is a stateless worker: it receives a single task prompt, calls
 * an LLMProvider with NO tool calling, streams tokens, and returns the result.
 *
 * Because sub-agents don't use tools, even chat-only models (e.g. Gemma) work
 * perfectly here.
 */

import type { LLMProvider } from "../../infrastructure/llm/types";
import type { AgentTask, AgentTaskResult } from "./types";

export interface SubAgentRunOptions {
  task: AgentTask;
  provider: LLMProvider;
  /** Fired on each streamed token — used to show live progress in the terminal */
  onToken?: (taskId: string, token: string) => void;
}

/**
 * Run a single sub-agent task.
 *
 * Starts a fresh, ephemeral conversation with only the task prompt.
 * Returns the full text result and timing information.
 */
export async function runSubAgent(opts: SubAgentRunOptions): Promise<AgentTaskResult> {
  const { task, provider, onToken } = opts;
  const start = Date.now();

  try {
    const result = await provider.streamChat({
      model: task.modelId,
      systemInstruction:
        "You are a focused sub-agent. Complete the assigned task thoroughly and return only the result. Do not add preamble or meta-commentary.",
      contents: [
        {
          role: "user",
          parts: [{ text: task.prompt }],
        },
      ],
      // No tools — sub-agents are pure text workers
      tools: undefined,
      writeToken: (token) => onToken?.(task.id, token),
    });

    return {
      taskId: task.id,
      modelId: task.modelId,
      result: result.text,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      taskId: task.id,
      modelId: task.modelId,
      result: "",
      durationMs: Date.now() - start,
      error: message,
    };
  }
}
