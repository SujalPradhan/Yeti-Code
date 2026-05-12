import dotenv from "dotenv";
import { Command } from "commander";

dotenv.config();

export interface AppConfig {
  apiKey: string;
  model: string;
  maxContextTokens: number;
  maxTurns: number;
  skill?: string;
  verbose: boolean;
}

/**
 * Parse CLI flags and merge with .env defaults.
 * CLI flags take precedence over .env values.
 */
export function loadConfig(argv: string[] = process.argv): AppConfig {
  const program = new Command();

  program
    .name("yetimind")
    .description("YetiMind — a streaming terminal AI assistant")
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
    .parse(argv);

  const opts = program.opts<{
    model?: string;
    verbose?: boolean;
    maxTokens?: string;
    maxTurns?: string;
    skill?: string;
  }>();

  const apiKey = process.env["GEMINI_API_KEY"] ?? process.env["OPENAI_API_KEY"] ?? "";
  const model = opts.model ?? process.env["MODEL"] ?? "gemini-2.0-flash";
  const maxContextTokens = opts.maxTokens
    ? parseInt(opts.maxTokens, 10)
    : parseInt(process.env["MAX_CONTEXT_TOKENS"] ?? "8000", 10);
  const maxTurns = opts.maxTurns
    ? parseInt(opts.maxTurns, 10)
    : 10;
  const skill = opts.skill;
  const verbose = opts.verbose ?? false;

  if (!apiKey) {
    console.error(
      "❌  GEMINI_API_KEY is not set. Add it to .env or export it.",
    );
    process.exit(1);
  }

  return { apiKey, model, maxContextTokens, maxTurns, skill, verbose };
}
