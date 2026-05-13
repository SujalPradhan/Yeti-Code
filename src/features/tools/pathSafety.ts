import * as path from "path";

export type SafePathResult =
  | { ok: true; path: string; root: string }
  | { ok: false; error: string; root: string };

export function resolveWorkspacePath(inputPath: string, root = process.cwd()): SafePathResult {
  const workspaceRoot = path.resolve(root);
  const resolvedPath = path.resolve(workspaceRoot, inputPath);
  const relativePath = path.relative(workspaceRoot, resolvedPath);

  const isInsideWorkspace =
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));

  if (!isInsideWorkspace) {
    return {
      ok: false,
      error: `Access denied. Path resolves outside workspace: ${inputPath}`,
      root: workspaceRoot,
    };
  }

  return { ok: true, path: resolvedPath, root: workspaceRoot };
}
