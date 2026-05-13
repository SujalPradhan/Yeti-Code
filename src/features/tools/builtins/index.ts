import type { Tool } from "../types";
import {
  readFileTool,
  writeFileTool,
  editFileTool,
  deleteFileTool,
  listDirTool,
  createDirTool,
  moveFileTool,
  searchFilesTool,
} from "./fs";
import { shellTool } from "./shell";
import { delegateTasksTool } from "./delegateTasks";
import {
  grepTool,
  sedTool,
  headFileTool,
  tailFileTool,
  countLinesTool,
  diffFilesTool,
} from "./text";
import {
  npmTool,
  gitTool,
  findFilesTool,
  runScriptTool,
} from "./dev";
import { fetchUrlTool } from "./web";

/** Register all built-in tools into a registry. */
export function registerBuiltins(
  registry: { register: (tool: Tool) => void },
): void {
  // File system
  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(editFileTool);
  registry.register(deleteFileTool);
  registry.register(listDirTool);
  registry.register(createDirTool);
  registry.register(moveFileTool);
  registry.register(searchFilesTool);

  // Text / search
  registry.register(grepTool);
  registry.register(sedTool);
  registry.register(headFileTool);
  registry.register(tailFileTool);
  registry.register(countLinesTool);
  registry.register(diffFilesTool);
  registry.register(findFilesTool);

  // Dev workflow
  registry.register(shellTool);
  registry.register(runScriptTool);
  registry.register(npmTool);
  registry.register(gitTool);

  // Web
  registry.register(fetchUrlTool);

  // Team
  registry.register(delegateTasksTool);
}
