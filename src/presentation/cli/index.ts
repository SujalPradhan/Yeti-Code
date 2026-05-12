#!/usr/bin/env node

import * as readline from "readline";
import chalk from "chalk";
import { loadConfig } from "../../core/config";
import { SessionLogger } from "../../core/logger";
import { ConversationContext } from "../../domain/context";
import { agentLoop } from "../../domain/agent";
import { GeminiProvider } from "../../infrastructure/llm/gemini";
import { SkillRegistry } from "../../features/skills/registry";
import { ToolRegistry } from "../../features/tools/registry";
import { registerBuiltins } from "../../features/tools/builtins";
import { BANNER, printUsage, printToolCall, printToolResult } from "./formatters";
import type { Content } from "../../domain/types";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new SessionLogger();
  await logger.init();

  const provider = new GeminiProvider(config.apiKey);

  const skillRegistry = new SkillRegistry();
  await skillRegistry.loadFromDirectory("~/.yetimind/skills");
  await skillRegistry.loadFromDirectory("./skills/builtins");

  if (config.skill) {
    if (skillRegistry.setActive(config.skill)) {
      await logger.log(`Activated skill via CLI: ${config.skill}`);
    } else {
      console.log(
        chalk.yellow(`\n  ⚠️  Skill "${config.skill}" not found. Using default.\n`),
      );
    }
  }

  const toolRegistry = new ToolRegistry();
  registerBuiltins(toolRegistry);

  const ctx = new ConversationContext(config.maxContextTokens);
  ctx.updateSystemMessage(skillRegistry.getActive().systemPrompt);

  console.log(BANNER);
  console.log(
    chalk.dim(`  Model: ${chalk.white(config.model)}  ·  `) +
      chalk.dim(`Max tokens: ${chalk.white(String(config.maxContextTokens))}`) +
      chalk.dim(`  ·  Skill: ${chalk.cyan(skillRegistry.getActive().name)}`) +
      (config.verbose ? chalk.yellow("  ·  verbose mode") : ""),
  );
  console.log(chalk.dim(`  Provider: ${chalk.white("Google Gemini (native SDK)")}`));
  console.log(chalk.dim(`  Log: ${logger.getLogPath()}`));
  console.log(
    chalk.dim(
      '  Type your message and press Enter. "/skill" for skills, "/usage" for tokens, "exit" to quit.\n',
    ),
  );

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.bold.green("you → "),
  });

  rl.prompt();

  rl.on("line", async (line: string) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (input.toLowerCase() === "exit" || input.toLowerCase() === "quit") {
      console.log(chalk.dim("\n👋  Goodbye!\n"));
      process.exit(0);
    }

    if (input === "/usage") {
      const usage = ctx.getLastUsage();
      printUsage(usage, ctx);
      rl.prompt();
      return;
    }

    if (input.startsWith("/skill")) {
      const parts = input.split(" ");
      const cmd = parts[1];
      const val = parts[2];

      if (cmd === "list") {
        console.log(chalk.bold("\n  Available Skills:"));
        skillRegistry.list().forEach((s) => {
          const isActive = s.name === skillRegistry.getActive().name;
          console.log(
            `  ${isActive ? chalk.green("→") : " "} ${chalk.cyan(s.name.padEnd(12))} ${chalk.dim(s.description)}`,
          );
        });
        console.log("");
      } else if (cmd === "use" && val) {
        if (skillRegistry.setActive(val)) {
          const newSkill = skillRegistry.getActive();
          ctx.updateSystemMessage(newSkill.systemPrompt);
          console.log(
            chalk.green(`\n  ✅ Activated skill: ${chalk.bold(newSkill.name)}\n`),
          );
          await logger.log(`Switched to skill: ${newSkill.name}`);
        } else {
          console.log(chalk.red(`\n  ❌ Skill "${val}" not found.\n`));
        }
      } else {
        console.log(chalk.dim("\n  Usage: /skill list, /skill use <name>\n"));
      }
      rl.prompt();
      return;
    }

    const userMsg: Content = {
      role: "user",
      parts: [{ text: input }],
    };
    ctx.addMessage(userMsg);
    await logger.log(`User: ${input}`);

    try {
      let isFirstTurn = true;
      await agentLoop({
        config,
        ctx,
        toolRegistry,
        skillRegistry,
        rl,
        logger,
        provider,
        callbacks: {
          onTurnStart: () => {
            if (config.verbose) {
              console.log(chalk.dim("\n┌─ messages ─────────────────────────────"));
              console.log(chalk.dim(JSON.stringify(ctx.getMessages(), null, 2)));
              console.log(chalk.dim("└────────────────────────────────────────\n"));
            }
            if (isFirstTurn) {
              process.stdout.write(chalk.bold.magenta("\nyeti → "));
              isFirstTurn = false;
            } else {
              process.stdout.write(chalk.bold.magenta("\nyeti → "));
            }
          },
          onToken: (token) => process.stdout.write(token),
          onToolCall: (name, args) => printToolCall(name, args, config.verbose),
          onToolResult: (name, result) => printToolResult(name, result, config.verbose),
          onMaxTurns: (max) => {
            console.log(chalk.red(`\n\n  ⚠️  Reached max tool turns (${max}). Stopping.\n`));
          },
          onAskConfirm: (msg) => {
            return new Promise<boolean>((resolve) => {
              rl.question(chalk.magenta(`\n  ❓ ${msg} (y/n): `), (answer) => {
                resolve(answer.trim().toLowerCase() === "y");
              });
            });
          },
        },
      });

      const messages = ctx.getMessages();
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === "model" && lastMsg.parts?.[0]?.text) {
        await logger.log(`Yeti: ${lastMsg.parts[0].text}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(chalk.red(`\n\n  ❌  Error: ${message}\n`));
      await logger.log(`Error: ${message}`);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log(chalk.dim("\n👋  Goodbye!\n"));
    process.exit(0);
  });
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
