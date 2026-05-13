import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolContext } from "../types";
import { resolveWorkspacePath } from "../pathSafety";

export const readFileTool: Tool = {
  name: "read_file",
  description: "Read the contents of a file at the given path. Returns the file contents as a UTF-8 string.",
  schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative path to the file to read.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const p = args["path"] as string;
    if (!p) return 'Error: "path" parameter is required.';
    const safePath = resolveWorkspacePath(p);
    if (!safePath.ok) return `Error: ${safePath.error}`;
    try {
      const content = await fs.readFile(safePath.path, "utf-8");
      return content;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error reading file "${p}": ${msg}`;
    }
  },
};

export const writeFileTool: Tool = {
  name: "write_file",
  description: "Write content to a file at the given path. Creates the file if it doesn't exist, overwrites if it does.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to write." },
      content: { type: "string", description: "The content to write to the file." },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const p = args["path"] as string;
    const content = args["content"] as string;
    if (!p || typeof content !== "string") return 'Error: "path" and "content" are required.';
    const safePath = resolveWorkspacePath(p);
    if (!safePath.ok) return `Error: ${safePath.error}`;

    const confirm = await ctx.confirm(`Write ${content.length} bytes to ${p}?`);
    if (!confirm) {
      await ctx.logger.log(`write_file cancelled by user: ${p}`);
      return "Action cancelled by user.";
    }

    try {
      await fs.writeFile(safePath.path, content, "utf-8");
      await ctx.logger.log(`write_file: Wrote to ${p}`);
      return `Successfully wrote to "${p}".`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error writing file "${p}": ${msg}`;
    }
  },
};

export const editFileTool: Tool = {
  name: "edit_file",
  description: "Find and replace a specific string in a file.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to edit." },
      old_str: { type: "string", description: "Exact string to find." },
      content: { type: "string", description: "Content to replace it with." },
    },
    required: ["path", "old_str", "content"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const p = args["path"] as string;
    const oldStr = args["old_str"] as string;
    const content = args["content"] as string;
    if (!p || !oldStr || typeof content !== "string") return "Error: Missing parameters.";
    const safePath = resolveWorkspacePath(p);
    if (!safePath.ok) return `Error: ${safePath.error}`;

    const confirm = await ctx.confirm(`Replace string in ${p}?`);
    if (!confirm) {
      await ctx.logger.log(`edit_file cancelled by user: ${p}`);
      return "Action cancelled by user.";
    }

    try {
      const fileContent = await fs.readFile(safePath.path, "utf-8");
      if (!fileContent.includes(oldStr)) {
        return `Error: The string "${oldStr}" was not found in the file.`;
      }
      const newContent = fileContent.replace(oldStr, content);
      await fs.writeFile(safePath.path, newContent, "utf-8");
      await ctx.logger.log(`edit_file: Edited ${p}`);
      return `Successfully edited "${p}".`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error editing file "${p}": ${msg}`;
    }
  },
};

export const deleteFileTool: Tool = {
  name: "delete_file",
  description: "Delete a file.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to delete." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const p = args["path"] as string;
    if (!p) return 'Error: "path" parameter is required.';
    const safePath = resolveWorkspacePath(p);
    if (!safePath.ok) return `Error: ${safePath.error}`;

    const confirm = await ctx.confirm(`Delete file ${p}?`);
    if (!confirm) {
      await ctx.logger.log(`delete_file cancelled by user: ${p}`);
      return "Action cancelled by user.";
    }

    try {
      await fs.unlink(safePath.path);
      await ctx.logger.log(`delete_file: Deleted ${p}`);
      return `Successfully deleted "${p}".`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error deleting file "${p}": ${msg}`;
    }
  },
};

export const listDirTool: Tool = {
  name: "list_dir",
  description: "List files and folders in a directory.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const p = args["path"] as string;
    if (!p) return 'Error: "path" parameter is required.';
    const safePath = resolveWorkspacePath(p);
    if (!safePath.ok) return `Error: ${safePath.error}`;
    try {
      const files = await fs.readdir(safePath.path);
      return files.join("\n");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error listing directory "${p}": ${msg}`;
    }
  },
};

export const createDirTool: Tool = {
  name: "create_dir",
  description: "Create a directory recursively.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path to create." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const p = args["path"] as string;
    if (!p) return 'Error: "path" parameter is required.';
    const safePath = resolveWorkspacePath(p);
    if (!safePath.ok) return `Error: ${safePath.error}`;

    try {
      await fs.mkdir(safePath.path, { recursive: true });
      await ctx.logger.log(`create_dir: Created ${p}`);
      return `Successfully created directory "${p}".`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error creating directory "${p}": ${msg}`;
    }
  },
};

export const moveFileTool: Tool = {
  name: "move_file",
  description: "Move or rename a file or directory.",
  schema: {
    type: "object",
    properties: {
      src: { type: "string", description: "Source path." },
      dest: { type: "string", description: "Destination path." },
    },
    required: ["src", "dest"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const src = args["src"] as string;
    const dest = args["dest"] as string;
    if (!src || !dest) return "Error: Missing parameters.";
    const safeSrc = resolveWorkspacePath(src);
    if (!safeSrc.ok) return `Error: ${safeSrc.error}`;
    const safeDest = resolveWorkspacePath(dest);
    if (!safeDest.ok) return `Error: ${safeDest.error}`;

    const confirm = await ctx.confirm(`Move/Rename ${src} to ${dest}?`);
    if (!confirm) {
      await ctx.logger.log(`move_file cancelled by user: ${src} -> ${dest}`);
      return "Action cancelled by user.";
    }

    try {
      await fs.rename(safeSrc.path, safeDest.path);
      await ctx.logger.log(`move_file: Moved ${src} to ${dest}`);
      return `Successfully moved "${src}" to "${dest}".`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error moving file: ${msg}`;
    }
  },
};

export const searchFilesTool: Tool = {
  name: "search_files",
  description: "Grep-style search. Recursively search for a regex pattern in a directory.",
  schema: {
    type: "object",
    properties: {
      dir: { type: "string", description: "Directory to search in." },
      pattern: { type: "string", description: "Regex pattern to search for." },
    },
    required: ["dir", "pattern"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const dir = args["dir"] as string;
    const pattern = args["pattern"] as string;
    if (!dir || !pattern) return "Error: Missing parameters.";
    const safeDir = resolveWorkspacePath(dir);
    if (!safeDir.ok) return `Error: ${safeDir.error}`;

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, "g");
    } catch (e) {
      return `Error: Invalid regex pattern: ${pattern}`;
    }

    let results: string[] = [];

    async function walk(currentDir: string) {
      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === "node_modules" || entry.name === ".git") continue;
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile()) {
            try {
              const content = await fs.readFile(fullPath, "utf-8");
              const lines = content.split("\n");
              lines.forEach((line, index) => {
                regex.lastIndex = 0;
                if (regex.test(line)) {
                  results.push(`${fullPath}:${index + 1}: ${line}`);
                }
              });
            } catch (e) { /* ignore */ }
          }
        }
      } catch (e) { /* ignore */ }
    }

    await walk(safeDir.path);
    if (results.length === 0) return "No matches found.";
    if (results.length > 200) {
      return results.slice(0, 200).join("\n") + "\n\n... (truncated, too many matches)";
    }
    return results.join("\n");
  },
};
