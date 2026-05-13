import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { ToolContext } from "../../src/features/tools/types";
import type { SessionLogger } from "../../src/core/logger";

/**
 * Create a fresh temp workspace and chdir into it. Returns a cleanup fn.
 * Tools that use `resolveWorkspacePath` will scope all access to this dir.
 */
export function makeWorkspace(): { root: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yeti-test-"));
  const prev = process.cwd();
  process.chdir(root);
  return {
    root,
    cleanup: () => {
      process.chdir(prev);
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * Fake logger — counts calls but otherwise no-op. Matches the SessionLogger
 * surface that the tools touch (only `.log()` is used inside execute()).
 */
export function fakeLogger(): SessionLogger {
  const calls: string[] = [];
  return {
    async log(msg: string): Promise<void> {
      calls.push(msg);
    },
    getLogPath: () => "/dev/null",
    init: async () => {},
    // Cast so the test compiles even if SessionLogger grows new methods.
  } as unknown as SessionLogger;
}

/** ToolContext that auto-approves confirmations. */
export function approvingCtx(): ToolContext {
  return {
    logger: fakeLogger(),
    confirm: async () => true,
  };
}

/** ToolContext that rejects every confirmation. */
export function rejectingCtx(): ToolContext {
  return {
    logger: fakeLogger(),
    confirm: async () => false,
  };
}

/** Write a file relative to cwd; creates parent dirs as needed. */
export function writeFixture(relPath: string, content: string): void {
  const abs = path.resolve(process.cwd(), relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
}

export function readFixture(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), "utf-8");
}

/** Silence stdout while a function runs — tools spawn child processes whose
 *  output we don't want polluting test reports. */
export async function withSilencedStdout<T>(fn: () => Promise<T>): Promise<T> {
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((..._args: unknown[]) => true) as typeof process.stdout.write;
  try {
    return await fn();
  } finally {
    process.stdout.write = orig;
  }
}

/** Check whether a CLI tool is available on PATH (for conditional skipping). */
export function commandExists(cmd: string): boolean {
  try {
    const { execSync } = require("child_process") as typeof import("child_process");
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
