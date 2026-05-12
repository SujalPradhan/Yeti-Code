/**
 * tools.ts — Tool interface, types, and registry.
 *
 * Defines the contract every tool must implement and a registry
 * that formats tools for the Gemini API and dispatches calls.
 */

import type { FunctionDeclaration } from "../../infrastructure/llm/types";
import type { Tool, ToolContext } from "./types";

/**
 * ToolRegistry — registers tools, formats them for the API, dispatches calls.
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  /** Register a tool. Throws if a tool with the same name already exists. */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);
  }

  /** Get all registered tools. */
  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /** Get a tool by name, or undefined. */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** Whether any tools are registered. */
  hasTools(): boolean {
    return this.tools.size > 0;
  }

  /** Format tools for the Gemini API `functionDeclarations` parameter. */
  toFunctionDeclarations(): FunctionDeclaration[] {
    return this.getAll().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.schema as Record<string, unknown>,
    }));
  }

  /**
   * Look up a tool by name and execute it with the given args.
   * Returns the string result. If the tool is not found, returns an error string.
   */
  async dispatch(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      return `Error: unknown tool "${name}". Available tools: ${Array.from(this.tools.keys()).join(", ")}`;
    }
    try {
      return await tool.execute(args, context);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error executing tool "${name}": ${msg}`;
    }
  }
}
