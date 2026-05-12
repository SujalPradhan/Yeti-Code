import chalk from "chalk";
import type { UsageStats } from "../../domain/types";
import type { ConversationContext } from "../../domain/context";
import type { FunctionCall } from "../../domain/types";

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
