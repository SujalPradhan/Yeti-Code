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
import { TeamOrchestrator } from "../../domain/team/orchestrator";
import { SkillRegistry } from "../../features/skills/registry";
import { ToolRegistry } from "../../features/tools/registry";
import { registerBuiltins } from "../../features/tools/builtins";
import { stateManager } from "../../core/state";
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

// ── Global state ────────────────────────────────────────────────────────────
// Prevents sending a new message while the agent is still processing.
let isProcessing = false;
// Team mode: when true, the Leader uses delegate_tasks to spawn sub-agents.
let teamModeActive = false;
let planExecuteMode = false;
let plannerModelId: string | undefined;
let executorModelId: string | undefined;
// Highest context-usage threshold (0-100) we've already warned about this session.
let lastContextWarnPct = 0;

function maybePrintContextHint(ctx: ConversationContext): void {
  const max = ctx.getMaxTokens();
  if (max <= 0) return;
  const pct = Math.floor((ctx.getTokenCount() / max) * 100);
  const thresholds = [70, 85, 95];
  for (const t of thresholds) {
    if (pct >= t && lastContextWarnPct < t) {
      lastContextWarnPct = t;
      const color = t >= 95 ? chalk.red : t >= 85 ? chalk.yellow : chalk.dim;
      console.log(color(`  ⚠ context ${pct}% full — /cost for details`));
      break;
    }
  }
}

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

  // ── Skills & Tools ────────────────────────────────────────────────────────
  const skillRegistry = new SkillRegistry();
  await skillRegistry.loadFromDirectory("~/.yeti-code/skills");
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

  // Thinking mode always starts OFF — opt in per-session with /think on.
  ollamaProvider.setThinking(false);
  stateManager.setThinkingMode(false);

  // ── Discover local Ollama models ─────────────────────────────────────────
  const ollamaSpinner = new Spinner("Discovering local Ollama models");
  ollamaSpinner.start();

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

  // Try to activate the configured model after all providers have been discovered.
  if (!modelRegistry.setActive(config.model)) {
    const allModels = modelRegistry.list().filter((m) => m.available);
    if (allModels.length === 0) {
      console.error(chalk.red(
        "\n  ❌  No models available. Set GEMINI_API_KEY in .env or start Ollama (`ollama serve`).\n",
      ));
      process.exit(1);
    }
    modelRegistry.setActive(allModels[0].id);
  }

  // ── Restore Advanced Modes ────────────────────────────────────────────────
  teamModeActive = stateManager.getTeamModeActive() ?? false;
  planExecuteMode = stateManager.getPlanExecuteMode() ?? false;
  plannerModelId = stateManager.getPlannerModelId();
  executorModelId = stateManager.getExecutorModelId();

  if (teamModeActive && planExecuteMode) {
    planExecuteMode = false;
    stateManager.setPlanExecuteMode(false);
  }

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
  console.log(chalk.dim("  Type /help to see commands.\n"));

  if (ollamaProvider.isThinking()) {
    console.log(chalk.cyan(`  💭 Thinking mode ON — Qwen 3 will stream its reasoning\n`));
  }

  if (teamModeActive) {
    console.log(chalk.cyan(`  🤝 Resuming in Team Mode (Leader: ${activeModel.id})\n`));
  } else if (planExecuteMode) {
    console.log(chalk.cyan(`  🧠 Resuming in Plan & Execute Mode (Planner: ${plannerModelId}, Executor: ${executorModelId})\n`));
  }

  // ── REPL ──────────────────────────────────────────────────────────────────
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.bold.green("you → "),
  });

  rl.setMaxListeners(20);
  rl.prompt();

  rl.on("line", async (line: string) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (input.toLowerCase() === "exit" || input.toLowerCase() === "quit" || input === "/exit" || input === "/quit") {
      console.log(chalk.dim("\n👋  Goodbye!\n"));
      process.exit(0);
    }

    // ── /help ────────────────────────────────────────────────────────────
    if (input === "/help" || input === "/?") {
      console.log(chalk.bold("\n  yeti-code commands\n"));
      const rows: Array<[string, string]> = [
        ["/help", "show this list"],
        ["/clear", "reset the conversation (keep active skill)"],
        ["/cost", "show token usage for the last turn + session estimate"],
        ["/model [list|pick|use <id>]", "show or switch the active model"],
        ["/skill [list|use <name>]", "show or switch the active skill"],
        ["/team [on|off|status]", "toggle multi-agent team mode (Qwen-only)"],
        ["/plan [<planner> <executor>|off|status]", "toggle Plan & Execute pipeline"],
        ["/think [on|off|status]", "toggle Qwen 3 thinking-mode stream"],
        ["/exit", "quit (also: exit, quit)"],
      ];
      for (const [cmd, desc] of rows) {
        console.log(`  ${chalk.cyan(cmd.padEnd(40))} ${chalk.dim(desc)}`);
      }
      console.log("");
      rl.prompt();
      return;
    }

    // ── /clear ───────────────────────────────────────────────────────────
    if (input === "/clear") {
      if (isProcessing) {
        console.log(chalk.yellow("\n  ⏳ Please wait for the current response to finish.\n"));
        rl.prompt();
        return;
      }
      ctx.clear();
      ctx.updateSystemMessage(skillRegistry.getActive().systemPrompt);
      lastContextWarnPct = 0;
      console.log(chalk.dim("\n  🧹 Conversation cleared.\n"));
      await logger.log("Conversation cleared");
      rl.prompt();
      return;
    }

    // ── /cost  (alias: /usage) ───────────────────────────────────────────
    if (input === "/cost" || input === "/usage") {
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
          stateManager.setLastModel(picked.id);
          console.log(chalk.green(`\n  ✅ Switched to: ${chalk.bold(picked.id)} ${chalk.dim(`[${picked.providerType}]`)}\n`));
          await logger.log(`Switched model: ${picked.id} (${picked.providerType})`);
        } else {
          console.log(chalk.dim("  Cancelled.\n"));
        }
      } else if (cmd === "use" && val) {
        if (modelRegistry.setActive(val)) {
          const newModel = modelRegistry.getActive();
          stateManager.setLastModel(newModel.id);
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

    // ── /team ────────────────────────────────────────────────────────────
    if (input.startsWith("/team")) {
      if (isProcessing) {
        console.log(chalk.yellow("\n  ⏳ Please wait for the current response to finish.\n"));
        rl.prompt();
        return;
      }

      const parts = input.split(/\s+/);
      const cmd = parts[1];
      const qwens = modelRegistry.listQwen();
      const bestQwen = modelRegistry.pickBestQwen();

      if (cmd === "on") {
        if (!bestQwen) {
          console.log(chalk.red("\n  ❌ Team mode requires at least one Qwen model from Ollama."));
          console.log(chalk.dim("     Pull one with: ") + chalk.cyan("ollama pull qwen3:4b") + chalk.dim("\n"));
        } else if (!bestQwen.supportsTools) {
          console.log(chalk.red(`\n  ❌ The best Qwen on this machine (${bestQwen.id}) does not support tool calling.`));
          console.log(chalk.dim("     Pull a tool-capable variant: ") + chalk.cyan("ollama pull qwen3:4b") + "\n");
        } else {
          // Force the leader to Qwen — team mode is Qwen-only by design.
          if (modelRegistry.getActiveId() !== bestQwen.id) {
            modelRegistry.setActive(bestQwen.id);
            stateManager.setLastModel(bestQwen.id);
            console.log(chalk.dim(`  Switched leader → ${chalk.white(bestQwen.id)}`));
          }
          teamModeActive = true;
          planExecuteMode = false; // mutually exclusive
          stateManager.setTeamModeActive(true);
          stateManager.setPlanExecuteMode(false);
          console.log(chalk.bold.cyan("\n  🤝 Team mode ON  ") + chalk.dim("(Qwen-only)"));
          console.log(chalk.dim(`  Leader: ${chalk.white(bestQwen.id)}`));
          console.log(chalk.dim("  Workers (Qwen pool):"));
          for (const m of qwens) {
            const tag = m.id === bestQwen.id ? chalk.green(" ← primary") : "";
            console.log(chalk.dim(`    • ${m.id} [${m.providerType}]${m.supportsTools ? "" : " · no tools"}${tag}`));
          }
          console.log(chalk.dim("\n  The leader will call 'delegate_tasks'; every worker is forced to Qwen.\n"));
          await logger.log(`Team mode activated (Qwen leader: ${bestQwen.id})`);
        }
      } else if (cmd === "off") {
        teamModeActive = false;
        stateManager.setTeamModeActive(false);
        console.log(chalk.dim("\n  Team mode OFF — back to single-agent.\n"));
        await logger.log("Team mode deactivated");
      } else if (cmd === "status" || !cmd) {
        console.log(chalk.bold(`\n  Team mode: ${teamModeActive ? chalk.green("ON") : chalk.dim("off")}  ${chalk.dim("(Qwen-only)")}`));
        console.log(chalk.dim(`  Active model: ${modelRegistry.getActiveId()}  (tool calling: ${modelRegistry.getActive().supportsTools ? "✓" : "✗"})`));
        console.log(chalk.bold("\n  Qwen pool:"));
        if (qwens.length === 0) {
          console.log(chalk.dim("    (none — pull one: ollama pull qwen3:4b)"));
        } else {
          for (const m of qwens) {
            const tag = bestQwen && m.id === bestQwen.id ? chalk.green(" ← primary") : "";
            console.log(`    ${chalk.cyan(m.id.padEnd(24))} [${m.providerType}]${m.supportsTools ? "" : chalk.dim(" · no tools")}${tag}`);
          }
        }
        console.log("");
      } else {
        console.log(chalk.dim("\n  Usage: /team on, /team off, /team status\n"));
      }
      rl.prompt();
      return;
    }

    // ── /plan  (alias: /plan-execute) ─────────────────────────────────────
    if (input.startsWith("/plan")) {
      if (isProcessing) {
        console.log(chalk.yellow("\n  ⏳ Please wait for the current response to finish.\n"));
        rl.prompt();
        return;
      }

      const parts = input.split(/\s+/);
      const cmd = parts[1];

      if (cmd === "off") {
        planExecuteMode = false;
        plannerModelId = undefined;
        executorModelId = undefined;
        stateManager.setPlanExecuteMode(false);
        console.log(chalk.dim("\n  Plan & Execute mode OFF — back to standard mode.\n"));
      } else if (cmd === "status" || (!parts[2] && parts[1] !== "on")) {
        console.log(chalk.bold(`\n  Plan & Execute mode: ${planExecuteMode ? chalk.green("ON") : chalk.dim("off")}`));
        if (planExecuteMode) {
          console.log(chalk.dim(`  Planner: ${plannerModelId}`));
          console.log(chalk.dim(`  Executor: ${executorModelId}`));
        }
        console.log("");
      } else {
        // Usage: /plan <planner> <executor>
        const pModel = parts[1];
        const eModel = parts[2];
        if (!pModel || !eModel) {
          console.log(chalk.dim("\n  Usage: /plan <planner_id> <executor_id> (e.g. /plan gemma3:4b qwen3:4b)\n  Or: /plan off\n"));
        } else {
          const p = modelRegistry.list().find(m => m.id === pModel);
          const e = modelRegistry.list().find(m => m.id === eModel);
          if (!p) {
            console.log(chalk.red(`\n  ❌ Planner model "${pModel}" not found.\n`));
          } else if (!e) {
            console.log(chalk.red(`\n  ❌ Executor model "${eModel}" not found.\n`));
          } else if (!e.supportsTools) {
            console.log(chalk.red(`\n  ❌ Executor model "${eModel}" does not support tools.\n`));
          } else {
            planExecuteMode = true;
            teamModeActive = false; // mutually exclusive
            plannerModelId = p.id;
            executorModelId = e.id;
            stateManager.setPlanExecuteMode(true, p.id, e.id);
            stateManager.setTeamModeActive(false);
            console.log(chalk.bold.cyan("\n  🧠 Plan & Execute mode ON"));
            console.log(chalk.dim(`  Planner:  ${chalk.white(p.id)}`));
            console.log(chalk.dim(`  Executor: ${chalk.white(e.id)}\n`));
          }
        }
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

    // ── /think ───────────────────────────────────────────────────────────
    if (input.startsWith("/think")) {
      if (isProcessing) {
        console.log(chalk.yellow("\n  ⏳ Please wait for the current response to finish.\n"));
        rl.prompt();
        return;
      }

      const parts = input.split(/\s+/);
      const cmd = parts[1];

      if (cmd === "on") {
        ollamaProvider.setThinking(true);
        stateManager.setThinkingMode(true);
        console.log(chalk.bold.cyan("\n  💭 Thinking mode ON"));
        console.log(chalk.dim("  Qwen 3 (and other thinking models) will stream their reasoning in dim text before the answer.\n"));
        await logger.log("Thinking mode activated");
      } else if (cmd === "off") {
        ollamaProvider.setThinking(false);
        stateManager.setThinkingMode(false);
        console.log(chalk.dim("\n  💭 Thinking mode OFF — answers stream immediately.\n"));
        await logger.log("Thinking mode deactivated");
      } else if (cmd === "status" || !cmd) {
        const on = ollamaProvider.isThinking();
        console.log(chalk.bold(`\n  Thinking mode: ${on ? chalk.green("ON") : chalk.dim("off")}`));
        console.log(chalk.dim("  Affects thinking-capable models (Qwen 3, DeepSeek-R1). Other models ignore it.\n"));
      } else {
        console.log(chalk.dim("\n  Usage: /think on, /think off, /think status\n"));
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
    let streamedTextPending = false;
    let restoreSystemInstruction: string | undefined;

    try {
      let currentModel = modelRegistry.getActive();
      let currentProvider = modelRegistry.getActiveProvider();
      let supportsTools = currentModel.supportsTools;

      if (planExecuteMode && plannerModelId && executorModelId) {
        // ── Plan & Execute Pipeline ─────────────────────────────────────────
        const pModel = modelRegistry.list().find(m => m.id === plannerModelId);
        const eModel = modelRegistry.list().find(m => m.id === executorModelId);
        
        if (!pModel || !eModel) throw new Error("Planner or Executor model missing.");
        
        const pProvider = modelRegistry.getProviderFor(pModel.providerType);
        if (!pProvider) throw new Error(`No provider for ${pModel.providerType}`);
        const eProvider = modelRegistry.getProviderFor(eModel.providerType);
        if (!eProvider) throw new Error(`No provider for ${eModel.providerType}`);

        console.log(chalk.dim(`\n  🧠 Planner (${pModel.id}) is creating an execution plan...\n`));

        // Create a temporary context for the Planner to include the specific system prompt
        const plannerCtx = new ConversationContext(config.maxContextTokens);
        plannerCtx.updateSystemMessage(
          "You are the Planner agent. Your job is to break down the user's request into a step-by-step execution plan. Do NOT execute any tools. Simply write out the logical steps needed to fulfill the request based on the tools available. Be clear and concise."
        );
        // Copy history
        for (const msg of ctx.getMessages()) {
          plannerCtx.addMessage(msg);
        }

        let planOutput = "";
        process.stdout.write(chalk.bold.magenta(`\nplanner (${pModel.id}) → `));

        await pProvider.streamChat({
          model: pModel.modelName,
          systemInstruction: plannerCtx.getSystemInstruction(),
          contents: plannerCtx.getMessages(),
          writeToken: (t) => {
            planOutput += t;
            process.stdout.write(chalk.magenta(t));
          }
        });
        
        console.log("\n");
        console.log(chalk.dim(`  ⚙️  Executor (${eModel.id}) is running the plan...\n`));

        const augmentedInput = `User Request:\n${input}\n\nExecution Plan:\n${planOutput}\n\nPlease execute the tools required to fulfill this plan and provide the final response.`;
        ctx.replaceLastMessage({ role: "user", parts: [{ text: augmentedInput }] });

        currentModel = eModel;
        currentProvider = eProvider;
        supportsTools = eModel.supportsTools;
      }

      // In team mode, augment the system prompt with the available model list
      // so the Leader can reason about which model to assign each task to.
      if (teamModeActive && supportsTools) {
        const modelList = modelRegistry.list()
          .map((m) => `- ${m.id} [${m.providerType}]${m.supportsTools ? "" : " (no tool calling)"}`)
          .join("\n");
        const teamInstruction = `\n\n---\nCRITICAL INSTRUCTION: You are operating in TEAM MODE as the Leader agent.\nYou MUST use the 'delegate_tasks' tool to break down the user's request into parallel tasks and assign them to sub-agents. DO NOT answer the prompt directly.\nAvailable models for sub-agents:\n${modelList}\nDelegate every distinct part of the request. Once they return, you will synthesise the final answer.`;
        restoreSystemInstruction = ctx.getSystemInstruction();
        ctx.updateSystemMessage(restoreSystemInstruction + teamInstruction);
        console.log(chalk.dim(`  🤝 Team mode — Leader: ${chalk.white(currentModel.id)}\n`));
      }

      const effectiveConfig = { ...config, model: currentModel.modelName };

      // Start spinner before the first LLM call
      spinner.start();

      let isFirstTurn = true;
      const speakerLabel = teamModeActive
        ? `leader (${currentModel.id})`
        : planExecuteMode
          ? `executor (${currentModel.id})`
          : `yeti (${currentModel.id})`;

      await agentLoop({
        config: effectiveConfig,
        ctx,
        toolRegistry,
        skillRegistry,
        rl,
        logger,
        provider: currentProvider,
        supportsTools,
        forcedToolNames: teamModeActive ? ["delegate_tasks"] : undefined,
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
              process.stdout.write(chalk.bold.magenta(`\n${speakerLabel} → `));
              isFirstTurn = false;
            }
            streamedTextPending = true;
            process.stdout.write(token);
          },
          onToolCall: (name, args) => {
            // Stop spinner before showing tool call
            spinner.stop();
            firstTokenReceived = true;
            if (streamedTextPending) {
              process.stdout.write("\n");
              streamedTextPending = false;
            }
            printToolCall(name, args, config.verbose);
          },
          onToolResult: (name, result) => {
            printToolResult(name, result, config.verbose);
            // After delegate_tasks, reset team system prompt augmentation
            if (name === "delegate_tasks" && teamModeActive) {
              ctx.updateSystemMessage(skillRegistry.getActive().systemPrompt);
            }
            // Restart spinner while waiting for next LLM turn
            firstTokenReceived = false;
            streamedTextPending = false;
            spinner.update(name === "delegate_tasks" ? "Synthesising results" : `Processing ${name} result`);
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
        // Inject teamOrchestrator so delegate_tasks tool can fire sub-agents
        toolContextExtras: teamModeActive
          ? { teamOrchestrator: new TeamOrchestrator(modelRegistry) }
          : undefined,
      });

      spinner.stop();

      // Terminate the streamed line so readline.prompt()'s cursor reset
      // doesn't overwrite the model's final response.
      if (streamedTextPending) {
        process.stdout.write("\n\n");
        streamedTextPending = false;
        if (config.verbose) {
          console.log(chalk.dim("─".repeat(40)));
        }
      }

      maybePrintContextHint(ctx);

      const messages = ctx.getMessages();
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === "model" && lastMsg.parts?.[0]?.text) {
        await logger.log(`Yeti: ${lastMsg.parts[0].text}`);
      }
    } catch (err: unknown) {
      spinner.stop();
      if (streamedTextPending) {
        process.stdout.write("\n");
        streamedTextPending = false;
      }
      const message = err instanceof Error ? err.message : String(err);
      console.log(chalk.red(`\n\n  ❌  Error: ${message}\n`));
      await logger.log(`Error: ${message}`);
    } finally {
      if (restoreSystemInstruction) {
        ctx.updateSystemMessage(restoreSystemInstruction);
      }
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
