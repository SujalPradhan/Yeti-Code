import dotenv from "dotenv";
import { Command } from "commander";
import { stateManager } from "./state";

dotenv.config();

export interface AppConfig {
  apiKey: string;
  model: string;
  maxContextTokens: number;
  maxTurns: number;
  skill?: string;
  verbose: boolean;
  ollamaUrl: string;
}

/**
 * Parse CLI flags and merge with .env defaults.
 * CLI flags take precedence over .env values.
 */
export function loadConfig(argv: string[] = process.argv): AppConfig {
  const program = new Command();

  program
    .name("yeti-code")
    .description("Yeti Code — a streaming terminal AI agent")
    .version("0.1.0")
    .option("-m, --model <model>", "LLM model to use")
    .option("-v, --verbose", "print full message array before each API call")
    .option(
      "--max-tokens <number>",
      "hard limit for context window (in tokens)",
    )
    .option(
      "--max-turns <number>",
      "max tool-call turns per user message (default: 10)",
    )
    .option("-s, --skill <name>", "activate a specific skill at startup")
    .option("--ollama-url <url>", "Ollama server URL")
    .parse(argv);

  const opts = program.opts<{
    model?: string;
    verbose?: boolean;
    maxTokens?: string;
    maxTurns?: string;
    skill?: string;
    ollamaUrl?: string;
  }>();

  const apiKey = process.env["GEMINI_API_KEY"] ?? process.env["OPENAI_API_KEY"] ?? "";
  const model = opts.model ?? stateManager.getLastModel() ?? process.env["MODEL"] ?? "gemma4:e4b";
  // Default to 1M tokens — local models bear no per-token cost, and we'd
  // rather let the model truncate at its own context limit than have
  // yeti-code's trimmer silently drop history before the model even sees it.
  const maxContextTokens = opts.maxTokens
    ? parseInt(opts.maxTokens, 10)
    : parseInt(process.env["MAX_CONTEXT_TOKENS"] ?? "1000000", 10);
  const maxTurns = opts.maxTurns
    ? parseInt(opts.maxTurns, 10)
    : 10;
  const skill = opts.skill;
  const verbose = opts.verbose ?? false;
  const ollamaUrl = opts.ollamaUrl ?? process.env["OLLAMA_URL"] ?? "http://localhost:11434";

  // API key is no longer required — Ollama models don't need one.
  // We'll validate at provider level instead.

  return { apiKey, model, maxContextTokens, maxTurns, skill, verbose, ollamaUrl };
}
