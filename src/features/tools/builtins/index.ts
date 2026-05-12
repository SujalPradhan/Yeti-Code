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

/** Register all built-in tools into a registry. */
export function registerBuiltins(
  registry: { register: (tool: Tool) => void },
): void {
  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(editFileTool);
  registry.register(deleteFileTool);
  registry.register(listDirTool);
  registry.register(createDirTool);
  registry.register(moveFileTool);
  registry.register(searchFilesTool);
  registry.register(shellTool);
}
