# 🧊 yeti-code

A streaming, multi-agent terminal AI agent for the [IITM **Tools in Data Science** course](https://tds.s-anand.net). Runs **gemma4:e4b** locally (default) via Ollama, with 30 built-in tools tuned for the course's modules.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/SujalPradhan/Yeti-Code/main/scripts/install.sh | sh
```

Re-run the same command to upgrade. Requires `git`, `node ≥ 20`, `npm`.

Uninstall:

```bash
curl -fsSL https://raw.githubusercontent.com/SujalPradhan/Yeti-Code/main/scripts/uninstall.sh | sh
```

## Pick a model

**Local (default).** Install [Ollama](https://ollama.com/), pull the default:

```bash
brew install ollama
OLLAMA_NUM_PARALLEL=4 ollama serve &     # 4 concurrent inferences for /team mode
ollama pull gemma4:e4b
```

The `OLLAMA_NUM_PARALLEL=4` is what makes `/team` mode actually parallel — Ollama defaults to 1 (serial), and yeti-code prints a warning + speedup metric after each delegate so you can tell.

**Cloud.** Set `GEMINI_API_KEY` in your shell — `/model use gemini-2.5-flash` once inside.

## Run

```bash
yeti-code
```

You're in a streaming REPL. Type `/help` to see every command.

## Features

- **gemma4:e4b by default** — Google's tool-capable 8B model (4.5B effective, 128K context). Verified end-to-end with our tool parser.
- **30 built-in tools** — file system, grep/sed/diff, npm/git/run_script/shell, fetch_url/extract_html (CSS selector engine), http_request, json_query, csv_info, encode/decode (base64/hex/url/rot13), sql_query (DuckDB), python_eval, pdf_to_md.
- **Multi-agent team mode** — `/team on` promotes the best worker (gemma4 → qwen3 → mistral → llama3) to leader and forces every sub-agent to the same model. Live per-worker token counters.
- **Plan & Execute** — `/plan <planner> <executor>` runs a two-model pipeline: a planner drafts an imperative tool plan, the executor follows it. The plan never pollutes conversation history.
- **Thinking-mode toggle** — `/think on` streams Qwen 3's reasoning in dim; `/think off` (default) suppresses it via Ollama's `think:false` plus a streaming `<think>` stripper.
- **Workspace-sandboxed** — every file tool refuses paths outside `cwd`; destructive ops gate on `(y/N)`; `npm`/`git` use safe-subcommand allowlists.
- **Session logging** — every prompt, tool call, and mode switch lands in `~/.yeti-code/logs/session_*.log` so instructors can see what students did.
- **Skills** — system prompt + tool allowlist + optional model override per persona. Drop JSON into `~/.yeti-code/skills/`.

## In-session commands

```
/help                            list commands
/clear                           reset conversation, keep skill
/cost                            token usage for last turn + session
/model [list|pick|use <id>]      switch model
/skill [list|use <name>]         switch skill
/team [on|off|status]            toggle multi-agent mode
/plan [<p> <e>|off|status]       toggle Plan & Execute
/think [on|off|status]           toggle reasoning stream
/exit                            quit
```

## CLI flags

```
yeti-code [options]

  -m, --model <id>       LLM model to use            (default: gemma4:e4b)
  -s, --skill <name>     activate a skill at startup
  -v, --verbose          dump message array each turn
  --max-tokens <n>       context-window cap          (default: 1,000,000)
  --max-turns <n>        max tool-call turns         (default: 10)
  --ollama-url <url>     Ollama URL                  (default: http://localhost:11434)
```

## Tests

```bash
npm test                       # vitest — 155 black-box tests, ~1.2s
ITER=200 npm run benchmark     # micro-benchmarks for all read-only tools
```

## Architecture

See [`architecture.md`](./architecture.md) for the full picture. One-liner: a generic `agentLoop` in `domain/` drives any `LLMProvider` (Ollama or Gemini) through a stream-of-tokens-and-tool-calls protocol. Every tool conforms to one `Tool` interface, registered into a `ToolRegistry`. Path safety, command allowlists, and confirm-gates are single chokepoints.

```
src/
├── core/            CLI config · persisted state · session logger
├── domain/          agentLoop · ConversationContext · team orchestrator
├── features/        tools (30 builtins) · skills
├── infrastructure/  LLM providers (Ollama, Gemini) · ModelRegistry · ThinkStripper
└── presentation/    REPL · slash commands · spinner · formatters
```

## License

ISC
