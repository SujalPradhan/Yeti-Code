# 🧊 yeti-code

A streaming, multi-agent terminal AI agent built for the [IITM **Tools in Data Science** course](https://tds.s-anand.net). Runs local models via Ollama (recommended for students — free, private, no API key) or Google Gemini. Ships with 30 built-in tools tuned for the course's modules (REST, SQL/DuckDB, scraping, CSV/JSON, base64/CTF, Python eval, …) and a multi-agent **team mode** where one Qwen leader delegates parallel work to Qwen workers.

## 🚀 Install (one command)

```bash
curl -fsSL https://raw.githubusercontent.com/SujalPradhan/Yeti-Code/main/scripts/install.sh | sh
```

This installs into `~/.local/share/yeti-code/` (the source tree) and drops a launcher at `~/.local/bin/yeti-code`. Re-run the same command to upgrade. Requires **git**, **Node.js ≥ 20**, and **npm**.

If `~/.local/bin` isn't on your PATH, the installer tells you exactly which one line to add to your `~/.zshrc` / `~/.bashrc`.

**To uninstall:**

```bash
curl -fsSL https://raw.githubusercontent.com/SujalPradhan/Yeti-Code/main/scripts/uninstall.sh | sh
# Add YETI_PURGE=1 to also remove ~/.yeti-code (state, logs, custom skills).
```

## 🤖 Pick a model

**Option A — local (recommended for the course):** install [Ollama](https://ollama.com/), pull a Qwen model, you're done.

```bash
brew install ollama          # macOS — or follow ollama.com for Linux/Windows
ollama serve &               # background daemon
ollama pull qwen3:4b         # ~2.4 GB, runs on a laptop
```

**Option B — cloud Gemini:** put your key in `~/.yeti-code/.env` (created on first run) or your shell:

```bash
export GEMINI_API_KEY=your_key_here
```

## 💬 First session

```bash
yeti-code
```

You'll see:

```
╔══════════════════════════════════════╗
║  🧊  yeti-code  v0.1.0               ║
║  AI agent                            ║
╚══════════════════════════════════════╝
  Model: qwen3:4b  ·  Provider: ollama  ·  Skill: default
  Log: /Users/you/.yeti-code/logs/session_1747xxxxxx.log
  Type /help to see commands.

you →
```

Type `/help` any time to see the full command list.

## ✨ Highlights

- **30 built-in tools** across file system, text/search, dev workflow, web/HTTP, course-specific (HTTP, JSON, CSV, encoding), data analysis (DuckDB SQL, Python eval, PDF→md), and team delegation.
- **Multi-agent team mode** — one Qwen "leader" decomposes a request and delegates parallel sub-tasks to Qwen workers. Live token counters per worker. Enable with `/team on`.
- **Streaming everywhere** — tokens print as the model produces them; sub-agent token counts update in place.
- **Qwen-3 thinking-mode toggle** — `/think on` to stream the model's reasoning in dim, `/think off` (default) to suppress it via Ollama's `think:false` and a stream-side `<think>` stripper.
- **Workspace-sandboxed** — every file tool refuses paths outside `cwd`; destructive ops gate on a `(y/N)` confirmation; `npm`/`git` use safe-subcommand allowlists.
- **Skills** — swap the system prompt + tool allowlist per use case (`/skill use coder`). Drop your own JSON skills into `~/.yeti-code/skills/`.
- **Session logging** — every prompt, tool call, and mode switch lands in `~/.yeti-code/logs/session_*.log` for instructors / TAs to inspect.

## 🛠️ CLI flags

```
Usage: yeti-code [options]

  -V, --version          show version
  -m, --model <id>       LLM model to use            (default: qwen3:4b)
  -v, --verbose          dump full message array before each LLM call
  --max-tokens <n>       context-window cap          (default: 8000)
  --max-turns <n>        max tool-call turns per user message (default: 10)
  -s, --skill <name>     activate a skill at startup
  --ollama-url <url>     Ollama server URL           (default: http://localhost:11434)
  -h, --help             show this help
```

## 🧭 In-session commands

```
/help                              show all commands
/clear                             reset conversation, keep active skill
/cost          (alias /usage)      token usage for last turn + session
/model [list|pick|use <id>]        switch model
/skill [list|use <name>]           switch skill
/team [on|off|status]              toggle Qwen-only multi-agent mode
/plan [<p> <e>|off|status]         toggle Plan & Execute pipeline
/think [on|off|status]             toggle Qwen 3 thinking-mode stream
/exit          (alias exit, quit)  quit
```

## 🔧 Built-in tools

**File system** — `read_file`, `write_file`, `edit_file`, `delete_file`, `list_dir`, `create_dir`, `move_file`, `search_files`

**Text & search** — `grep`, `sed` (with `dry_run`), `head_file`, `tail_file`, `count_lines`, `diff_files`, `find_files` (globs)

**Dev workflow** — `shell` (streamed stdout), `run_script` (auto-interpreter by extension), `npm` (allowlisted subcommands), `git` (read-only subcommands)

**Web** — `fetch_url` (HTML→text by default), `extract_html` (in-house CSS-selector engine: tag, `.class`, `#id`, `[attr]`, descendant, `>` child)

**Course-aligned** — `http_request` (full REST), `json_query` (JSONPath-ish), `csv_info` (rows × cols × dtypes × nulls), `encode` / `decode` (base64, hex, url, rot13)

**Data analysis** — `sql_query` (DuckDB CLI; read CSV/Parquet/SQLite directly), `python_eval` (`python3 -c "..."`), `pdf_to_md` (pdftotext)

**Team** — `delegate_tasks` (leader-only; auto-overrides every `task.modelId` to the best available Qwen)

Every destructive tool prompts for confirmation. Every path-touching tool refuses to escape the workspace. Every CLI-spawning tool falls back to a clear *"install X"* hint if the binary isn't on PATH.

## 🎭 Built-in skills

| Skill | Description | Tool allowlist |
|---|---|---|
| `default` | General assistant | `read_file`, `write_file`, `shell` |
| `coder` | Expert software engineer | full fs + search + shell |
| `researcher` | Analysis & synthesis | `search_files` only |
| `explainer` | Step-by-step teacher | none — pure text |

Custom skills go in `~/.yeti-code/skills/<name>.json`:

```json
{
  "name": "ga5-analyst",
  "description": "Module 5 (Analyze) — DuckDB + pandas focus",
  "systemPrompt": "You help the student profile data and answer GA5 questions...",
  "tools": ["csv_info", "sql_query", "python_eval", "head_file", "read_file"]
}
```

## 🏗️ Architecture

See [`architecture.md`](./architecture.md) for the full picture. Quick orientation:

```
src/
├── core/            CLI config · persisted state · session logger
├── domain/          agentLoop · ConversationContext · team orchestrator
├── features/        tools (registry + 10 builtin files) · skills
├── infrastructure/  LLM providers (Ollama, Gemini) · ModelRegistry · ThinkStripper
└── presentation/    CLI entry · slash commands · spinner · formatters
```

## 🧪 Tests & benchmarks

```bash
npm test                    # vitest — 153 black-box tests, ~1s
npm run test:watch          # watch mode
ITER=200 npm run benchmark  # cranked iterations
```

153 tests cover every tool (file system, text, dev, web, course, data), the team-mode Qwen-lock logic, path-traversal safety, the `<think>` streaming filter, and tool-call formatting. Run with `npm test`. CLIs that aren't installed (duckdb, python3, npm, git, bash) are gracefully skipped.

## 🧑‍🏫 For the course

yeti-code is designed so the instructor team can see what students did, not just what they submitted. Every prompt, tool call, mode switch, and error lands in `~/.yeti-code/logs/session_*.log` — a complete learning trace per session.

Recommended starting flow for students:

```bash
# 1. install
curl -fsSL https://raw.githubusercontent.com/SujalPradhan/Yeti-Code/main/scripts/install.sh | sh

# 2. install ollama + pull qwen
brew install ollama && ollama serve & && ollama pull qwen3:4b

# 3. start a session per assignment, in that assignment's working directory
cd ~/tds/ga1 && yeti-code
```

## ⚖️ License

ISC
