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
import { fetchUrlTool, extractHtmlTool } from "./web";
import {
  httpRequestTool,
  jsonQueryTool,
  csvInfoTool,
  encodeTool,
  decodeTool,
} from "./course";
import { sqlQueryTool, pythonEvalTool, pdfToMdTool } from "./data";

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
  registry.register(extractHtmlTool);

  // Course-aligned: APIs, JSON, CSV, encodings
  registry.register(httpRequestTool);
  registry.register(jsonQueryTool);
  registry.register(csvInfoTool);
  registry.register(encodeTool);
  registry.register(decodeTool);

  // Data analysis
  registry.register(sqlQueryTool);
  registry.register(pythonEvalTool);
  registry.register(pdfToMdTool);

  // Team
  registry.register(delegateTasksTool);
}
