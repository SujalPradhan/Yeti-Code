/**
 * src/domain/team/types.ts
 *
 * Shared data shapes for the Leader ↔ Sub-Agent team system.
 */

/** A single task delegated by the Leader to a sub-agent. */
export interface AgentTask {
  /** Unique ID for this task within the plan (e.g. "task-1") */
  id: string;
  /** Human-readable description shown in the terminal UI */
  description: string;
  /** Full, self-contained prompt sent to the sub-agent */
  prompt: string;
  /** Model registry ID to use for this task (e.g. "gemma3:4b", "qwen3:4b") */
  modelId: string;
}

/** The result returned by a single sub-agent after completing its task. */
export interface AgentTaskResult {
  taskId: string;
  modelId: string;
  /** The sub-agent's text response */
  result: string;
  /** Wall-clock time taken in milliseconds */
  durationMs: number;
  /** Set if the sub-agent call threw an error */
  error?: string;
}

/**
 * The structured plan produced by the Leader when it calls `delegate_tasks`.
 * Logged to disk so instructors can inspect how the Leader reasoned.
 */
export interface TeamPlan {
  /** Leader's explanation of why it decomposed the task this way */
  reasoning: string;
  tasks: AgentTask[];
}
