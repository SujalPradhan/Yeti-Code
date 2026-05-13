import chalk from "chalk";
import type { Interface as RlInterface } from "readline";
import type { UsageStats } from "../../domain/types";
import type { ConversationContext } from "../../domain/context";
import type { ModelConfig } from "../../infrastructure/llm/registry";

export const BANNER = `
${chalk.bold.cyan("╔══════════════════════════════════════╗")}
${chalk.bold.cyan("║")}  ${chalk.bold.white("🧊  YetiMind")}  ${chalk.dim("v0.1.0")}                ${chalk.bold.cyan("║")}
${chalk.bold.cyan("║")}  ${chalk.dim("Streaming terminal AI assistant")}     ${chalk.bold.cyan("║")}
${chalk.bold.cyan("╚══════════════════════════════════════╝")}
`;

export function printUsage(stats: UsageStats | null, ctx: ConversationContext): void {
  console.log("\n");
  console.log(chalk.dim("  ┌─ usage ──────────────────────────────"));

  if (stats && stats.totalTokens > 0) {
    console.log(
      chalk.dim(
        `  │ prompt: ${chalk.white(String(stats.promptTokens))}` +
          `  completion: ${chalk.white(String(stats.completionTokens))}` +
          `  total: ${chalk.white(String(stats.totalTokens))}`,
      ),
    );
  } else {
    console.log(
      chalk.dim(
        `  │ (no usage data — estimated context: ~${chalk.white(String(ctx.getTokenCount()))} tokens)`,
      ),
    );
  }

  console.log(
    chalk.dim(
      `  │ context: ${chalk.white(String(ctx.getMessageCount()))} messages, ~${chalk.white(String(ctx.getTokenCount()))} est. tokens`,
    ),
  );
  console.log(chalk.dim("  └────────────────────────────────────────\n"));
}

function summarizeToolArgs(name: string, args: Record<string, unknown>): string {
  const truncate = (s: string, n = 60): string =>
    s.length > n ? s.slice(0, n - 1) + "…" : s;

  switch (name) {
    case "read_file":
    case "write_file":
    case "edit_file":
    case "delete_file":
    case "list_dir":
    case "create_dir":
    case "head_file":
    case "tail_file":
    case "count_lines": {
      const path = args["path"] ?? args["file_path"] ?? args["filename"];
      return typeof path === "string" ? truncate(path) : "";
    }
    case "move_file": {
      const src = args["src"];
      const dest = args["dest"];
      if (typeof src === "string" && typeof dest === "string") {
        return `${truncate(src, 28)} → ${truncate(dest, 28)}`;
      }
      return "";
    }
    case "grep":
    case "search_files": {
      const pattern = args["pattern"];
      const where = args["path"] ?? args["dir"] ?? ".";
      const glob = args["glob"];
      const parts: string[] = [];
      if (typeof pattern === "string") parts.push(`/${truncate(pattern, 32)}/`);
      if (typeof where === "string") parts.push(`in ${truncate(where, 24)}`);
      if (typeof glob === "string") parts.push(`(${glob})`);
      return parts.join(" ");
    }
    case "sed": {
      const path = args["path"];
      const pattern = args["pattern"];
      const dry = args["dry_run"] ? " [dry]" : "";
      if (typeof path === "string" && typeof pattern === "string") {
        return `${truncate(path, 28)} s/${truncate(pattern, 24)}/…${dry}`;
      }
      return typeof path === "string" ? truncate(path) : "";
    }
    case "diff_files": {
      const a = args["a"];
      const b = args["b"];
      if (typeof a === "string" && typeof b === "string") {
        return `${truncate(a, 24)} ↔ ${truncate(b, 24)}`;
      }
      return "";
    }
    case "find_files": {
      const pattern = args["pattern"];
      const dir = args["dir"] ?? ".";
      if (typeof pattern === "string" && typeof dir === "string") {
        return `${pattern} in ${truncate(dir, 24)}`;
      }
      return typeof pattern === "string" ? pattern : "";
    }
    case "npm": {
      const sub = args["subcommand"];
      const extra = Array.isArray(args["args"]) ? (args["args"] as unknown[]).map(String).join(" ") : "";
      return typeof sub === "string" ? truncate(`${sub} ${extra}`.trim()) : "";
    }
    case "git": {
      const sub = args["subcommand"];
      const extra = Array.isArray(args["args"]) ? (args["args"] as unknown[]).map(String).join(" ") : "";
      return typeof sub === "string" ? truncate(`${sub} ${extra}`.trim()) : "";
    }
    case "run_script": {
      const path = args["path"];
      const extra = Array.isArray(args["args"]) ? (args["args"] as unknown[]).map(String).join(" ") : "";
      return typeof path === "string" ? truncate(`${path} ${extra}`.trim()) : "";
    }
    case "fetch_url": {
      const url = args["url"];
      return typeof url === "string" ? truncate(url, 80) : "";
    }
    case "shell":
    case "run_shell":
    case "bash": {
      const cmd = args["command"] ?? args["cmd"] ?? args["script"];
      return typeof cmd === "string" ? `"${truncate(cmd)}"` : "";
    }
    case "delegate_tasks": {
      const tasks = args["tasks"];
      const parsed = typeof tasks === "string"
        ? (() => { try { return JSON.parse(tasks); } catch { return null; } })()
        : tasks;
      if (Array.isArray(parsed) && parsed.length > 0) {
        const models = parsed
          .map((t) => (t && typeof t === "object" ? (t as Record<string, unknown>)["modelId"] : undefined))
          .filter((m): m is string => typeof m === "string");
        const unique = Array.from(new Set(models));
        return `${parsed.length} task${parsed.length === 1 ? "" : "s"} → [${unique.join(", ")}]`;
      }
      return "";
    }
    default: {
      // Fall back to the first short string-valued arg, if any.
      for (const [, v] of Object.entries(args)) {
        if (typeof v === "string" && v.length > 0 && v.length < 120) {
          return truncate(v);
        }
      }
      return "";
    }
  }
}

export function printToolCall(name: string, args: Record<string, unknown>, verbose: boolean): void {
  if (verbose) {
    const argsStr = JSON.stringify(args, null, 2);
    console.log(
      chalk.yellow(`\n  🔧 tool: ${chalk.bold(name)}(${argsStr})`),
    );
    return;
  }
  const summary = summarizeToolArgs(name, args);
  const head = chalk.yellow(`\n  🔧 ${chalk.bold(name.padEnd(16))}`);
  console.log(summary ? `${head} ${chalk.dim(summary)}` : head);
}

export function printToolResult(name: string, result: string, verbose: boolean): void {
  if (verbose) {
    const truncated = result.length > 500 ? result.slice(0, 500) + "…" : result;
    console.log(chalk.dim(`  📎 result [${name}]: ${truncated}`));
  }
}

export function printModelList(models: ModelConfig[], activeId: string): void {
  console.log(chalk.bold("\n  Available Models:"));
  for (const m of models) {
    const isActive = m.id === activeId;
    const status = m.available
      ? chalk.green("●")
      : chalk.red("○");
    const provider = chalk.dim(`[${m.providerType}]`);
    const toolBadge = m.supportsTools ? "" : chalk.dim(" · no tools");
    console.log(
      `  ${isActive ? chalk.green("→") : " "} ${status} ${chalk.cyan(m.id.padEnd(24))} ${provider}${toolBadge} ${chalk.dim(m.label)}`,
    );
  }
  console.log("");
}

/**
 * Numbered model picker — uses rl.question() so it never conflicts with
 * readline's own stdin management (no raw mode, no app shutdown).
 *
 * Prints a numbered list, asks the user to type a number, and returns the
 * selected ModelConfig. Returns undefined if the user cancels (empty input
 * or a non-numeric answer).
 */
export async function interactiveModelPicker(
  models: ModelConfig[],
  activeId: string,
  rl: RlInterface,
): Promise<ModelConfig | undefined> {
  if (models.length === 0) return undefined;

  // Print numbered list
  console.log(chalk.bold("\n  Select a model:"));
  console.log(chalk.dim("  (type a number and press Enter, or leave blank to cancel)\n"));

  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    const isCurrent = m.id === activeId;
    const num = chalk.dim(`  ${String(i + 1).padStart(2)}.`);
    const id = isCurrent
      ? chalk.bold.cyan(m.id.padEnd(28))
      : chalk.cyan(m.id.padEnd(28));
    const provider = chalk.dim(`[${m.providerType}]`);
    const toolBadge = m.supportsTools ? "" : chalk.dim(" · no tools");
    const currentTag = isCurrent ? chalk.dim(" ← current") : "";
    console.log(`${num} ${id} ${provider}${toolBadge}${currentTag}`);
  }

  console.log("");

  return new Promise((resolve) => {
    rl.question(chalk.green("  Choice: "), (answer) => {
      const trimmed = answer.trim();
      if (!trimmed) {
        resolve(undefined);
        return;
      }
      const idx = parseInt(trimmed, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= models.length) {
        console.log(chalk.red(`  ❌ Invalid choice "${trimmed}"\n`));
        resolve(undefined);
        return;
      }
      resolve(models[idx]);
    });
  });
}
