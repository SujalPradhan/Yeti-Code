/**
 * src/features/tools/builtins/delegateTasks.ts
 *
 * The `delegate_tasks` built-in tool.
 *
 * When the Leader calls this tool it provides:
 *   - reasoning: why it decomposed the request this way
 *   - tasks:     array of AgentTask objects
 *
 * The tool handler:
 *   1. Fires all sub-agents in parallel via TeamOrchestrator
 *   2. Returns a formatted string of all results back to the Leader
 *   3. The Leader then performs the final synthesis turn
 *
 * This tool is only registered when team mode is active (the CLI injects
 * `teamOrchestrator` into the ToolContext before starting the agent loop).
 */

import chalk from "chalk";
import type { Tool, ToolContext } from "../types";
import type { TeamPlan, AgentTask } from "../../../domain/team/types";

export const delegateTasksTool: Tool = {
  name: "delegate_tasks",
  description:
    "Decompose the user's request into parallel sub-tasks and assign each to a specific model. " +
    "Use this when the request has multiple independent parts that different models can handle simultaneously. " +
    "Each task must have a complete, self-contained prompt — sub-agents have no conversation history.",
  schema: {
    type: "object",
    properties: {
      reasoning: {
        type: "string",
        description:
          "Explain why you chose this decomposition and which model handles which part.",
      },
      tasks: {
        type: "string",
        description:
          "A JSON array of task objects to run in parallel. Each object must have: { 'id': string, 'description': string, 'prompt': string, 'modelId': string }. Example: [{\"id\": \"t1\", \"description\": \"...\", \"prompt\": \"...\", \"modelId\": \"qwen3:4b\"}]",
      },
    },
    required: ["reasoning", "tasks"],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const orchestrator = context.teamOrchestrator;

    if (!orchestrator) {
      return "Error: delegate_tasks requires team mode to be active. Use /team on to enable it.";
    }

    const reasoning = (args["reasoning"] as string) ?? "";
    const tasksRaw = args["tasks"] as string;
    
    let rawTasks: AgentTask[] = [];
    try {
      rawTasks = JSON.parse(tasksRaw);
    } catch (err) {
      return `Error: Failed to parse tasks JSON array. ${err}`;
    }

    if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
      return "Error: tasks must be a non-empty JSON array.";
    }

    const plan: TeamPlan = { reasoning, tasks: rawTasks };

    // Log the plan
    await context.logger.log(`[Team Plan] Reasoning: ${reasoning}`);
    await context.logger.log(`[Team Plan] Tasks: ${JSON.stringify(rawTasks, null, 2)}`);

    console.log(chalk.bold.cyan("\n  ╔═ Team Plan ════════════════════════════════╗"));
    console.log(chalk.dim(`  ║  ${reasoning.slice(0, 70)}${reasoning.length > 70 ? "…" : ""}`));
    console.log(chalk.bold.cyan("  ╚════════════════════════════════════════════╝\n"));

    for (const task of rawTasks) {
      console.log(
        `  ${chalk.cyan("◆")} ${chalk.bold(task.id)} → ${chalk.dim(task.description)} ${chalk.yellow(`[${task.modelId}]`)}`,
      );
    }
    console.log("");

    // Run all sub-agents in parallel
    const results = await orchestrator.runParallel(rawTasks, {
      onTaskStart: (task) => {
        process.stdout.write(
          chalk.dim(`  ⏳ ${task.id} (${task.modelId}) starting...\n`),
        );
      },
      onTaskToken: (_taskId, _token) => {
        // Silent streaming for sub-agents — we show results when done
      },
      onTaskComplete: (result) => {
        if (result.error) {
          console.log(
            chalk.red(`  ✗ ${result.taskId} failed: ${result.error}`),
          );
        } else {
          console.log(
            chalk.green(`  ✓ ${result.taskId} done`) +
              chalk.dim(` (${result.durationMs}ms)`),
          );
        }
      },
    });

    // Log results
    for (const r of results) {
      await context.logger.log(
        `[Sub-Agent ${r.taskId}] model=${r.modelId} duration=${r.durationMs}ms ` +
          (r.error ? `error=${r.error}` : `result_len=${r.result.length}`),
      );
    }

    console.log("");

    return orchestrator.formatResultsForLeader(plan, results);
  },
};
