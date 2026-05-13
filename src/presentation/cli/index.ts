#!/usr/bin/env node

import * as readline from "readline";
import chalk from "chalk";
import { loadConfig } from "../../core/config";
import { SessionLogger } from "../../core/logger";
import { ConversationContext } from "../../domain/context";
import { agentLoop } from "../../domain/agent";
import { GeminiProvider } from "../../infrastructure/llm/gemini";
import { OllamaProvider } from "../../infrastructure/llm/ollama";
import { ModelRegistry } from "../../infrastructure/llm/registry";
import { SkillRegistry } from "../../features/skills/registry";
import { ToolRegistry } from "../../features/tools/registry";
import { registerBuiltins } from "../../features/tools/builtins";
import {
  BANNER,
  printUsage,
  printToolCall,
  printToolResult,
  printModelList,
  interactiveModelPicker,
} from "./formatters";
import { Spinner } from "./spinner";
import type { Content } from "../../domain/types";

// ── Global request lock ─────────────────────────────────────────────────────
// Prevents sending a new message while the agent is still processing.
let isProcessing = false;

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new SessionLogger();
  await logger.init();

  // ── Model Registry Setup ──────────────────────────────────────────────────
  const modelRegistry = new ModelRegistry();

  // Register Gemini provider (if API key is available)
  if (config.apiKey) {
    const geminiProvider = new GeminiProvider(config.apiKey);
    modelRegistry.registerProvider("gemini", geminiProvider);

    modelRegistry.addModel({
      id: "gemini-2.5-flash",
      label: "Google Gemini 2.5 Flash",
      providerType: "gemini",
      modelName: "gemini-2.5-flash",
      available: true,
      supportsTools: true,
    });
    modelRegistry.addModel({
      id: "gemini-2.0-flash",
      label: "Google Gemini 2.0 Flash",
      providerType: "gemini",
      modelName: "gemini-2.0-flash",
      available: true,
      supportsTools: true,
    });
  }

  // Register Ollama provider eagerly (no await — lazy background discovery)
  const ollamaProvider = new OllamaProvider(config.ollamaUrl);
  modelRegistry.registerProvider("ollama", ollamaProvider);

  // Set active model from config immediately using what's registered so far
  if (!modelRegistry.setActive(config.model)) {
    const allModels = modelRegistry.list();
    if (allModels.length === 0) {
      console.error(chalk.red(
        "\n  ❌  No models available. Set GEMINI_API_KEY in .env or start Ollama (`ollama serve`).\n",
      ));
      process.exit(1);
    }
    modelRegistry.setActive(allModels[0].id);
  }

  // ── Skills & Tools ────────────────────────────────────────────────────────
  const skillRegistry = new SkillRegistry();
  await skillRegistry.loadFromDirectory("~/.yetimind/skills");
  await skillRegistry.loadFromDirectory("./skills/builtins");

  if (config.skill) {
    if (skillRegistry.setActive(config.skill)) {
      await logger.log(`Activated skill via CLI: ${config.skill}`);
    } else {
      console.log(chalk.yellow(`\n  ⚠️  Skill "${config.skill}" not found. Using default.\n`));
    }
  }

  const toolRegistry = new ToolRegistry();
  registerBuiltins(toolRegistry);

  const ctx = new ConversationContext(config.maxContextTokens);
  ctx.updateSystemMessage(skillRegistry.getActive().systemPrompt);

  // ── Banner ────────────────────────────────────────────────────────────────
  const activeModel = modelRegistry.getActive();
  console.log(BANNER);
  console.log(
    chalk.dim(`  Model: ${chalk.white(activeModel.id)}  ·  `) +
      chalk.dim(`Provider: ${chalk.white(activeModel.providerType)}  ·  `) +
      chalk.dim(`Skill: ${chalk.cyan(skillRegistry.getActive().name)}`) +
      (config.verbose ? chalk.yellow("  ·  verbose") : ""),
  );
  console.log(chalk.dim(`  Log: ${logger.getLogPath()}`));
  console.log(chalk.dim("  Commands: /model, /skill, /usage, exit\n"));

  // ── Lazy Ollama discovery in background ───────────────────────────────────
  // Does NOT block startup. Adds local models as they become available.
  const ollamaSpinner = new Spinner("Discovering local Ollama models");
  ollamaSpinner.start();

  (async () => {
    try {
      const ollamaAvailable = await ollamaProvider.isAvailable();
      if (ollamaAvailable) {
        const localModels = await ollamaProvider.listModels();
        const toolSupportedModels = ["mistral", "llama3", "llama3.1", "qwen2.5", "qwen3", "command-r"];
        for (const modelName of localModels) {
          const supportsTools = toolSupportedModels.some((m) => modelName.toLowerCase().startsWith(m));
          modelRegistry.addModel({
            id: modelName,
            label: `Local (Ollama)${supportsTools ? "" : " · no tools"}`,
            providerType: "ollama",
            modelName,
            available: true,
            supportsTools,
          });
        }
        if (localModels.length > 0) {
          ollamaSpinner.stop(chalk.dim(`  ✓ Ollama: ${chalk.green(String(localModels.length))} local model(s) added — use /model to switch`));
          await logger.log(`Ollama detected: ${localModels.length} local model(s) available`);
        } else {
          ollamaSpinner.stop(chalk.dim("  ✓ Ollama running but no models installed (run: ollama pull qwen3:4b)"));
        }
      } else {
        ollamaSpinner.stop(); // Silently clear — Ollama not running is normal
      }
    } catch {
      ollamaSpinner.stop();
    }

    // If default model from config was an Ollama model, try to activate it now
    if (!modelRegistry.getActive() || modelRegistry.getActive().id !== config.model) {
      modelRegistry.setActive(config.model);
    }
  })();

  // ── REPL ──────────────────────────────────────────────────────────────────
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

    // ── /usage ───────────────────────────────────────────────────────────
    if (input === "/usage") {
      const usage = ctx.getLastUsage();
      printUsage(usage, ctx);
      rl.prompt();
      return;
    }

    // ── /model ───────────────────────────────────────────────────────────
    if (input.startsWith("/model")) {
      // Block model switching during active requests
      if (isProcessing) {
        console.log(chalk.yellow("\n  ⏳ Please wait for the current response to finish.\n"));
        rl.prompt();
        return;
      }

      const parts = input.split(/\s+/);
      const cmd = parts[1];
      const val = parts.slice(2).join(" ");

      if (!cmd || cmd === "list") {
        printModelList(modelRegistry.list(), modelRegistry.getActiveId());
      } else if (cmd === "pick") {
        const picked = await interactiveModelPicker(modelRegistry.list(), modelRegistry.getActiveId(), rl);
        if (picked) {
          modelRegistry.setActive(picked.id);
          console.log(chalk.green(`\n  ✅ Switched to: ${chalk.bold(picked.id)} ${chalk.dim(`[${picked.providerType}]`)}\n`));
          await logger.log(`Switched model: ${picked.id} (${picked.providerType})`);
        } else {
          console.log(chalk.dim("  Cancelled.\n"));
        }
      } else if (cmd === "use" && val) {
        if (modelRegistry.setActive(val)) {
          const newModel = modelRegistry.getActive();
          console.log(chalk.green(`\n  ✅ Switched to: ${chalk.bold(newModel.id)} ${chalk.dim(`[${newModel.providerType}]`)}\n`));
          await logger.log(`Switched model: ${newModel.id} (${newModel.providerType})`);
        } else {
          console.log(chalk.red(`\n  ❌ Model "${val}" not found. Use /model list or /model pick.\n`));
        }
      } else {
        console.log(chalk.dim("\n  Usage: /model list, /model pick, /model use <id>\n"));
      }
      rl.prompt();
      return;
    }

    // ── /skill ───────────────────────────────────────────────────────────
    if (input.startsWith("/skill")) {
      if (isProcessing) {
        console.log(chalk.yellow("\n  ⏳ Please wait for the current response to finish.\n"));
        rl.prompt();
        return;
      }

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
          console.log(chalk.green(`\n  ✅ Activated skill: ${chalk.bold(newSkill.name)}\n`));
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

    // ── Request lock: reject if already processing ───────────────────────
    if (isProcessing) {
      console.log(chalk.yellow("\n  ⏳ Still thinking... please wait for the current response.\n"));
      rl.prompt();
      return;
    }

    // ── Send message to agent ─────────────────────────────────────────────
    isProcessing = true;

    const userMsg: Content = {
      role: "user",
      parts: [{ text: input }],
    };
    ctx.addMessage(userMsg);
    await logger.log(`User: ${input}`);

    const spinner = new Spinner("Thinking");
    let firstTokenReceived = false;

    try {
      const currentModel = modelRegistry.getActive();
      const currentProvider = modelRegistry.getActiveProvider();
      const supportsTools = currentModel.supportsTools;

      if (!supportsTools) {
        console.log(chalk.dim(`\n  ℹ️  ${currentModel.id} runs in chat-only mode (no tool calling).`));
      }

      const effectiveConfig = { ...config, model: currentModel.modelName };

      // Start spinner before the first LLM call
      spinner.start();

      let isFirstTurn = true;

      await agentLoop({
        config: effectiveConfig,
        ctx,
        toolRegistry,
        skillRegistry,
        rl,
        logger,
        provider: currentProvider,
        supportsTools,
        callbacks: {
          onTurnStart: () => {
            if (config.verbose) {
              spinner.stop();
              console.log(chalk.dim("\n┌─ messages ─────────────────────────────"));
              console.log(chalk.dim(JSON.stringify(ctx.getMessages(), null, 2)));
              console.log(chalk.dim("└────────────────────────────────────────\n"));
              spinner.start();
            }
          },
          onToken: (token) => {
            // Stop spinner and print prefix on the very first token
            if (!firstTokenReceived) {
              firstTokenReceived = true;
              spinner.stop();
              if (isFirstTurn) {
                process.stdout.write(chalk.bold.magenta("\nyeti → "));
                isFirstTurn = false;
              } else {
                process.stdout.write(chalk.bold.magenta("\nyeti → "));
              }
            }
            process.stdout.write(token);
          },
          onToolCall: (name, args) => {
            // Stop spinner before showing tool call
            spinner.stop();
            firstTokenReceived = true; // treat as "output started"
            printToolCall(name, args, config.verbose);
          },
          onToolResult: (name, result) => {
            printToolResult(name, result, config.verbose);
            // Restart spinner while waiting for next LLM turn
            firstTokenReceived = false;
            spinner.update(`Processing ${name} result`);
            spinner.start();
          },
          onMaxTurns: (max) => {
            spinner.stop();
            console.log(chalk.red(`\n\n  ⚠️  Reached max tool turns (${max}). Stopping.\n`));
          },
          onAskConfirm: (msg) => {
            spinner.stop();
            return new Promise<boolean>((resolve) => {
              rl.question(chalk.magenta(`\n  ❓ ${msg} (y/n): `), (answer) => {
                resolve(answer.trim().toLowerCase() === "y");
              });
            });
          },
        },
      });

      spinner.stop();

      const messages = ctx.getMessages();
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === "model" && lastMsg.parts?.[0]?.text) {
        await logger.log(`Yeti: ${lastMsg.parts[0].text}`);
      }
    } catch (err: unknown) {
      spinner.stop();
      const message = err instanceof Error ? err.message : String(err);
      console.log(chalk.red(`\n\n  ❌  Error: ${message}\n`));
      await logger.log(`Error: ${message}`);
    } finally {
      isProcessing = false;
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
