/**
 * src/domain/team/orchestrator.ts
 *
 * TeamOrchestrator — coordinates the Leader → Sub-Agents → Synthesis flow.
 *
 * Flow:
 *   1. runParallel()  — fires all AgentTasks concurrently, collects results
 *   2. formatResultsForLeader() — packs results into a prompt for the Leader
 *
 * The actual Leader LLM call (planning + synthesis) happens in the existing
 * agentLoop via the `delegate_tasks` built-in tool — this class just handles
 * the parallel dispatch and result formatting.
 */

import type { ModelRegistry } from "../../infrastructure/llm/registry";
import type { AgentTask, AgentTaskResult, TeamPlan } from "./types";
import { runSubAgent } from "./subAgent";

export interface ParallelRunCallbacks {
  onTaskStart?: (task: AgentTask) => void;
  onTaskToken?: (taskId: string, token: string) => void;
  onTaskComplete?: (result: AgentTaskResult) => void;
}

export class TeamOrchestrator {
  constructor(private readonly modelRegistry: ModelRegistry) {}

  /**
   * Resolve the correct LLMProvider for a modelId.
   * Falls back to the active provider if the modelId is unrecognised.
   */
  private resolveProvider(modelId: string) {
    const model = this.modelRegistry.list().find((m) => m.id === modelId);
    if (!model) {
      return {
        provider: this.modelRegistry.getActiveProvider(),
        modelName: modelId,
      };
    }
    const provider = this.modelRegistry.getProviderFor(model.providerType);
    if (!provider) {
      throw new Error(`No provider registered for type "${model.providerType}"`);
    }
    return { provider, modelName: model.modelName };
  }

  /**
   * Run all tasks in parallel.
   * Uses Promise.allSettled so one failing sub-agent doesn't kill the others.
   */
  async runParallel(
    tasks: AgentTask[],
    callbacks: ParallelRunCallbacks = {},
  ): Promise<AgentTaskResult[]> {
    const promises = tasks.map(async (task) => {
      callbacks.onTaskStart?.(task);

      const { provider, modelName } = this.resolveProvider(task.modelId);

      // Override the modelId in the task with the resolved modelName
      const resolvedTask: AgentTask = { ...task, modelId: modelName };

      return runSubAgent({
        task: resolvedTask,
        provider,
        onToken: callbacks.onTaskToken,
      });
    });

    const settled = await Promise.allSettled(promises);

    return settled.map((s, i) => {
      if (s.status === "fulfilled") {
        callbacks.onTaskComplete?.(s.value);
        return s.value;
      }
      // Rejected (should not happen — runSubAgent catches internally)
      const err = s.reason instanceof Error ? s.reason.message : String(s.reason);
      const failedResult: AgentTaskResult = {
        taskId: tasks[i].id,
        modelId: tasks[i].modelId,
        result: "",
        durationMs: 0,
        error: err,
      };
      callbacks.onTaskComplete?.(failedResult);
      return failedResult;
    });
  }

  /**
   * Pack all sub-agent results into a single string the Leader uses for synthesis.
   */
  formatResultsForLeader(plan: TeamPlan, results: AgentTaskResult[]): string {
    const lines: string[] = [
      "All sub-agents have completed their tasks. Here are the results:\n",
    ];

    for (const task of plan.tasks) {
      const result = results.find((r) => r.taskId === task.id);
      lines.push(`## Task: ${task.description}`);
      lines.push(`Model: ${task.modelId}  |  Duration: ${result ? result.durationMs : "?"}ms`);
      if (result?.error) {
        lines.push(`❌ Error: ${result.error}`);
      } else {
        lines.push(result?.result ?? "(no result)");
      }
      lines.push("");
    }

    lines.push("---");
    lines.push(
      "Using the above results, synthesise a clear, complete, and well-structured final answer for the user.",
    );

    return lines.join("\n");
  }
}
