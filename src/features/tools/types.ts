import type { SessionLogger } from "../../core/logger";

export interface ToolContext {
  logger: SessionLogger;
  confirm: (message: string) => Promise<boolean>;
}

export interface Tool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<string>;
}
