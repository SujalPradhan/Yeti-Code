import chalk from "chalk";
import type { Interface as RlInterface } from "readline";
import type { UsageStats } from "../../domain/types";
import type { ConversationContext } from "../../domain/context";
import type { ModelConfig } from "../../infrastructure/llm/registry";

export const BANNER = `
${chalk.bold.cyan("╔══════════════════════════════════════╗")}
${chalk.bold.cyan("║")}  ${chalk.bold.white("🧊  YetiMind")}  ${chalk.dim("v0.3.0")}                ${chalk.bold.cyan("║")}
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

export function printToolCall(name: string, args: Record<string, unknown>, verbose: boolean): void {
  if (verbose) {
    const argsStr = JSON.stringify(args, null, 2);
    console.log(
      chalk.yellow(`\n  🔧 tool: ${chalk.bold(name)}(${argsStr})`),
    );
  } else {
    console.log(chalk.yellow(`\n  🔧 ${name}`));
  }
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
