import type { SessionLogger } from "../../core/logger";
import type { TeamOrchestrator } from "../../domain/team/orchestrator";

export interface ToolContext {
  logger: SessionLogger;
  confirm: (message: string) => Promise<boolean>;
  /** Only present when team mode is active (/team on) */
  teamOrchestrator?: TeamOrchestrator;
}

export interface Tool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<string>;
}
