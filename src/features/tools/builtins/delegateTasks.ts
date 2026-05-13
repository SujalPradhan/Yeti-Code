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
        type: "array",
        description:
          "Task objects to run in parallel. Each task must have id, description, prompt, and modelId.",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            description: { type: "string" },
            prompt: { type: "string" },
            modelId: { type: "string" },
          },
          required: ["id", "description", "prompt", "modelId"],
          additionalProperties: false,
        },
      },
    },
    required: ["reasoning", "tasks"],
    additionalProperties: false,
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const orchestrator = context.teamOrchestrator;

    if (!orchestrator) {
      return "Error: delegate_tasks requires team mode to be active. Use /team on to enable it.";
    }

    const reasoning = (args["reasoning"] as string) ?? "";
    const tasksValue = args["tasks"];
    
    let rawTasks: AgentTask[] = [];
    if (typeof tasksValue === "string") {
      try {
        rawTasks = JSON.parse(tasksValue);
      } catch (err) {
        return `Error: Failed to parse tasks JSON array. ${err}`;
      }
    } else if (Array.isArray(tasksValue)) {
      rawTasks = tasksValue as AgentTask[];
    } else {
      return "Error: tasks must be an array of task objects.";
    }

    if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
      return "Error: tasks must be a non-empty JSON array.";
    }

    for (const task of rawTasks) {
      if (
        typeof task.id !== "string" ||
        typeof task.description !== "string" ||
        typeof task.prompt !== "string" ||
        typeof task.modelId !== "string"
      ) {
        return "Error: each task must include string id, description, prompt, and modelId fields.";
      }
    }

    // Team mode is Qwen-only: override whatever the leader chose with the
    // best available Qwen. Keeps every worker on the same instruction-tuned
    // family for predictable tool-calling behavior, and lets the model
    // delegate without having to know exact local-model ids.
    let workerModelId: string;
    try {
      workerModelId = orchestrator.pickWorkerModelId();
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
    rawTasks = rawTasks.map((t) => ({ ...t, modelId: workerModelId }));

    const plan: TeamPlan = { reasoning, tasks: rawTasks };

    // Log the plan
    await context.logger.log(`[Team Plan] Reasoning: ${reasoning}`);
    await context.logger.log(`[Team Plan] Tasks: ${JSON.stringify(rawTasks, null, 2)}`);

    console.log(chalk.bold.cyan("\n  ╔═ Team Plan ════════════════════════════════╗"));
    console.log(chalk.dim(`  ║  ${reasoning.slice(0, 70)}${reasoning.length > 70 ? "…" : ""}`));
    console.log(chalk.bold.cyan("  ╚════════════════════════════════════════════╝\n"));

    // ── Live status block ──────────────────────────────────────────────────
    // Pre-print one line per task; redraw the whole block in place as tokens
    // stream in. This lets students watch each sub-agent work in real time.
    type Status = "pending" | "running" | "done" | "failed";
    interface TaskState {
      status: Status;
      tokens: number;
      modelId: string;
      description: string;
      durationMs?: number;
      error?: string;
    }
    const taskState = new Map<string, TaskState>();
    for (const t of rawTasks) {
      taskState.set(t.id, {
        status: "pending",
        tokens: 0,
        modelId: t.modelId,
        description: t.description,
      });
    }
    const taskOrder = rawTasks.map((t) => t.id);

    const renderLine = (id: string): string => {
      const s = taskState.get(id)!;
      const idLabel = chalk.bold(id.padEnd(12));
      const modelLabel = chalk.yellow(`[${s.modelId}]`);
      const desc = chalk.dim(s.description.length > 32 ? s.description.slice(0, 31) + "…" : s.description);
      if (s.status === "pending") {
        return `  ${chalk.dim("•")} ${idLabel} ${modelLabel} ${desc}`;
      }
      if (s.status === "running") {
        return `  ${chalk.cyan("⏳")} ${idLabel} ${modelLabel} ${desc} ${chalk.dim(`· ${s.tokens} tokens…`)}`;
      }
      if (s.status === "done") {
        return `  ${chalk.green("✓")} ${idLabel} ${modelLabel} ${desc} ${chalk.dim(`· ${s.tokens} tokens · ${s.durationMs}ms`)}`;
      }
      return `  ${chalk.red("✗")} ${idLabel} ${modelLabel} ${desc} ${chalk.red(`· ${s.error ?? "failed"}`)}`;
    };

    // Initial render
    for (const id of taskOrder) {
      console.log(renderLine(id));
    }

    let lastRender = Date.now();
    const rerender = (force = false): void => {
      const now = Date.now();
      if (!force && now - lastRender < 80) return;
      lastRender = now;
      // Move cursor up N lines to the top of the block.
      process.stdout.write(`\x1b[${taskOrder.length}A`);
      for (const id of taskOrder) {
        process.stdout.write(`\r\x1b[2K${renderLine(id)}\n`);
      }
    };

    // Run all sub-agents in parallel
    const results = await orchestrator.runParallel(rawTasks, {
      onTaskStart: (task) => {
        const s = taskState.get(task.id);
        if (s) s.status = "running";
        rerender(true);
      },
      onTaskToken: (taskId, _token) => {
        const s = taskState.get(taskId);
        if (s) s.tokens++;
        rerender();
      },
      onTaskComplete: (result) => {
        const s = taskState.get(result.taskId);
        if (s) {
          s.status = result.error ? "failed" : "done";
          s.durationMs = result.durationMs;
          s.error = result.error;
        }
        rerender(true);
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
