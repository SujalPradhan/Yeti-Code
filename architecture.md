# yeti-code — Architecture

> **What it is.** A streaming, multi-agent, terminal-based AI assistant built for the IITM "Tools in Data Science" course. ~4.7K lines of TypeScript across 4 layers (core → domain → features → infrastructure → presentation), one REPL, two LLM providers (Ollama + Gemini), 30 built-in tools, and 153 black-box tests.

## Table of contents

1. [Bird's-eye view](#birds-eye-view)
2. [Layer-by-layer walkthrough](#layer-by-layer-walkthrough)
3. [The agent loop](#the-agent-loop)
4. [Tool system](#tool-system)
5. [Multi-agent team mode](#multi-agent-team-mode)
6. [Streaming pipeline](#streaming-pipeline)
7. [State, config, and persistence](#state-config-and-persistence)
8. [Skills](#skills)
9. [CLI surface](#cli-surface)
10. [Testing & benchmarks](#testing--benchmarks)
11. [Repository map](#repository-map)

---

## Bird's-eye view

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          PRESENTATION (CLI)                             │
│   src/presentation/cli/                                                 │
│   index.ts (REPL) · formatters.ts (tool/model rendering) · spinner.ts   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              DOMAIN                                     │
│   src/domain/                                                           │
│   ┌─────────────┐  ┌────────────────┐  ┌──────────────────────────┐    │
│   │ agentLoop   │──│ Conversation   │  │  Team                    │    │
│   │ (one fn)    │  │ Context        │  │  ─ Orchestrator          │    │
│   └─────────────┘  │ (history+sys)  │  │  ─ subAgent.runSubAgent  │    │
│                    └────────────────┘  │  ─ types (AgentTask…)    │    │
│                                        └──────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                │                                       │
                ▼                                       ▼
┌──────────────────────────────────┐  ┌────────────────────────────────────┐
│           FEATURES               │  │           INFRASTRUCTURE           │
│   src/features/                  │  │   src/infrastructure/llm/          │
│  ┌─────────────────────────────┐ │  │  ┌──────────────────────────────┐  │
│  │ tools/                      │ │  │  │  LLMProvider (interface)     │  │
│  │  ─ registry  (dispatch)     │ │  │  │  ├─ OllamaProvider           │  │
│  │  ─ pathSafety (sandbox)     │ │  │  │  │   · ThinkStripper         │  │
│  │  ─ builtins/ (10 files,     │ │  │  │  │   · Qwen3 /no_think       │  │
│  │      30 tools)              │ │  │  │  └─ GeminiProvider           │  │
│  │  ─ types  (Tool interface)  │ │  │  │  ModelRegistry               │  │
│  └─────────────────────────────┘ │  │  │   (id → ModelConfig)         │  │
│  ┌─────────────────────────────┐ │  │  └──────────────────────────────┘  │
│  │ skills/                     │ │  └────────────────────────────────────┘
│  │  ─ registry (system prompt  │ │
│  │      + tool allowlist)      │ │
│  │  ─ types                    │ │
│  └─────────────────────────────┘ │
└──────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              CORE                                       │
│   src/core/   config.ts (CLI + env)  state.ts (persisted)  logger.ts    │
└─────────────────────────────────────────────────────────────────────────┘
```

**Dependency rule (top → bottom only).** Presentation depends on Domain; Domain depends on Features and Infrastructure interfaces; Features and Infrastructure depend on Core types. No circular imports.

**Key idea.** One narrow seam between everything: the **`LLMProvider`** interface (`streamChat(opts) → StreamResult`) and the **`Tool`** interface (`execute(args, ctx) → string`). Every provider and every tool slot into those, and the agent loop is generic over both.

---

## Layer-by-layer walkthrough

### `core/` — config, state, logger (no business logic)

| File | Role |
|---|---|
| `config.ts` | `loadConfig(argv)` — parses CLI flags via `commander`, merges `.env`, returns `AppConfig`. Resolves model from `--model` → `stateManager.getLastModel()` → `$MODEL` → `qwen3:4b`. |
| `state.ts` | `StateManager` — single-file JSON at `~/.yeti-code/state.json`. Holds `lastModel`, `teamModeActive`, `planExecuteMode`, `planner/executorModelId`, `thinkingMode`. Restore-on-startup logic lives in the CLI, not here. |
| `logger.ts` | `SessionLogger` — append-only timestamped log at `~/.yeti-code/logs/session_<ts>.log`. Every tool call, mode switch, and user prompt is logged. **This is the "learning trace" pipe** for the course. |

### `domain/` — the agent loop and conversation model

| File | Role |
|---|---|
| `agent.ts` | `agentLoop(AgentContext)` — the heart of the system. ~130 lines, no IO of its own. |
| `context.ts` | `ConversationContext` — message array + system instruction + token-window trimming + last-usage cache. Token estimate uses the "4 chars ≈ 1 token" heuristic. |
| `types.ts` | Re-exports `Content`, `Part`, `FunctionCall` from `@google/genai` (so the whole codebase speaks one message shape), plus `StreamResult` and `UsageStats`. |
| `team/orchestrator.ts` | `TeamOrchestrator` — fans tasks out via `Promise.allSettled`, formats results for the leader's synthesis turn. Picks the best Qwen via `ModelRegistry.pickBestQwen()`. |
| `team/subAgent.ts` | `runSubAgent(task, provider)` — stateless sub-agent: one prompt in, one text result out, no tool calling, no history. |
| `team/types.ts` | `AgentTask`, `AgentTaskResult`, `TeamPlan`. |

### `features/` — tools and skills (the "what the agent can actually do")

| File | Role |
|---|---|
| `tools/types.ts` | `Tool` interface: `{ name, description, schema, execute(args, ctx) }`. `ToolContext` carries the logger, `confirm()` callback, and optional `teamOrchestrator`. |
| `tools/registry.ts` | `ToolRegistry` — `register`, `dispatch`, and `toFunctionDeclarations()` (recursive type-uppercaser for the Gemini JSON schema dialect). |
| `tools/pathSafety.ts` | `resolveWorkspacePath(input, root)` — single chokepoint that resolves a user-provided path against `process.cwd()` and refuses anything that escapes it. **Every file-touching tool calls this.** |
| `tools/builtins/` | 10 files, 30 tools — see the [Tool system](#tool-system) section. |

| File | Role |
|---|---|
| `skills/types.ts` | `Skill` = `{ name, description, systemPrompt, tools?, model? }`. |
| `skills/registry.ts` | `SkillRegistry` — loads JSON skills from `~/.yeti-code/skills/` and `./skills/builtins/` at startup, plus a hard-coded `default` skill. Switching skills swaps the system prompt and (optionally) restricts the tool set. |

### `infrastructure/llm/` — provider adapters

| File | Role |
|---|---|
| `types.ts` | `LLMProvider`, `StreamChatOptions`, `FunctionDeclaration`. The smallest possible provider contract. |
| `registry.ts` | `ModelRegistry` — id → `ModelConfig`. `setActive`, `listQwen`, `pickBestQwen` (tool-capable + largest `:Nb`). |
| `gemini.ts` | `GeminiProvider` — wraps `@google/genai` SDK; streams via `generateContentStream`. |
| `ollama.ts` | `OllamaProvider` — talks to Ollama's OpenAI-compatible `/v1/chat/completions`. Owns the `ThinkStripper` (state machine that filters `<think>…</think>` in `"strip"` or `"show"` mode across chunk boundaries) and the Qwen 3 thinking toggle (`setThinking`). |

### `presentation/cli/` — the only entry point users see

| File | Role |
|---|---|
| `index.ts` | `main()` — wires everything together: registries, providers, REPL, all slash commands, mode banners, restore-from-state, streaming bug fix (post-turn newlines), context-usage hints. |
| `formatters.ts` | `printToolCall`, `printToolResult`, `printModelList`, `interactiveModelPicker`, `printUsage`, plus per-tool argument summaries for the non-verbose tool-call header. |
| `spinner.ts` | Standalone `Spinner` class — start/stop/update, uses `\r\x1b[2K` to clear in place. |

---

## The agent loop

```
                  ┌──────────────────────────────┐
   user line ─►   │   REPL turn (cli/index.ts)   │
                  │   - addMessage(user)         │
                  │   - spinner.start()          │
                  │   - call agentLoop(...)      │
                  └──────────────┬───────────────┘
                                 │
                                 ▼
                ┌───────────────────────────────────┐
                │   agentLoop  (domain/agent.ts)    │
                │   while (turns < maxTurns)        │
                │   ┌────────────────────────────┐  │
                │   │ provider.streamChat({...}) │──┼──► writeToken → onToken
                │   └────────────────────────────┘  │      (REPL prints + tracks)
                │                                   │
                │   if (no functionCalls)           │
                │     addMessage(model:text) ─► RETURN
                │                                   │
                │   else for each functionCall:     │
                │     onToolCall(name, args)        │
                │     toolRegistry.dispatch(...)    │──► ToolContext{logger,confirm,...}
                │     onToolResult(name, result)    │
                │     append functionResponse part  │
                │                                   │
                │   addMessage(user:responses)      │
                │   turns++                         │
                └───────────────────────────────────┘
```

**Two cases per LLM call:**
1. Plain text → loop exits, message stored, control returns to REPL.
2. Function calls → each tool is dispatched, results are wrapped in `functionResponse` parts, fed back, loop continues.

**Why it's tiny (131 lines).** The loop owns no IO. Streaming is the provider's job (via the `writeToken` callback). Confirmations are the CLI's job (via `onAskConfirm`). Spinners and prints are the CLI's job (via the `callbacks` object). The loop only knows about messages and tool dispatch.

**Skill filtering.** Before the first turn, the loop filters `toolRegistry.toFunctionDeclarations()` down to the active skill's `tools` allowlist (unless the tool is in `forcedToolNames`, e.g. `delegate_tasks` in team mode). The skill can also override the model.

---

## Tool system

Tools are the agent's hands. Every tool conforms to:

```ts
interface Tool {
  name: string;                            // unique, kebab_case
  description: string;                     // shown to the LLM
  schema: Record<string, unknown>;         // JSON schema for arguments
  execute(args, ctx: ToolContext): Promise<string>;
}
```

The registry collects them, exposes `toFunctionDeclarations()` for the LLM, and `dispatch(name, args, ctx)` for the loop. **30 built-ins, organized by topic:**

| File | Tools | Notes |
|---|---|---|
| `builtins/fs.ts` | `read_file`, `write_file`, `edit_file`, `delete_file`, `list_dir`, `create_dir`, `move_file`, `search_files` | All workspace-sandboxed via `resolveWorkspacePath`. Destructive ones gated by `ctx.confirm`. |
| `builtins/text.ts` | `grep`, `sed`, `head_file`, `tail_file`, `count_lines`, `diff_files` | Pure JS implementations. `grep` supports globs + case toggle. `sed` has `dry_run`. |
| `builtins/dev.ts` | `find_files`, `run_script`, `npm`, `git` | `npm`/`git` use **allowlists** of safe subcommands. `run_script` auto-picks an interpreter by extension (`.sh→bash`, `.ts→ts-node`, `.py→python3`, …). |
| `builtins/shell.ts` | `shell` | Live-streamed stdout, 30s timeout. Always prompts for confirmation. |
| `builtins/web.ts` | `fetch_url`, `extract_html` | `extract_html` is a tiny in-house CSS-selector engine (tag/.class/#id/[attr]/desc/child) — no jsdom/cheerio dep. |
| `builtins/course.ts` | `http_request`, `json_query`, `csv_info`, `encode`, `decode` | The course-aligned set: REST, JSONPath-ish, CSV profiling, base64/hex/url/rot13. |
| `builtins/data.ts` | `sql_query`, `python_eval`, `pdf_to_md` | Shell out to DuckDB / `python3` / `pdftotext`. Return a clear install hint if the CLI is missing. |
| `builtins/delegateTasks.ts` | `delegate_tasks` | Team mode's leader-facing tool — see [Multi-agent team mode](#multi-agent-team-mode). |

**Safety model.**
- Path-touching tools → `resolveWorkspacePath` refuses `..` / absolute outside `cwd`.
- Process-spawning tools → `spawn(..., { shell: false })` with an explicit argv (no shell injection).
- `npm`/`git` → static allowlists; everything else gets rejected with a hint to use `shell`.
- Destructive ops (`write_file`, `sed`, `npm install`, `run_script`, `python_eval`, non-GET `http_request`) → `await ctx.confirm(...)`.

---

## Multi-agent team mode

Team mode turns one agent into a small org chart:

```
                  ┌──────────────────────────────────────────────┐
   user prompt ─► │   LEADER (Qwen, tool-capable)                │
                  │   ─ runs full agentLoop                      │
                  │   ─ calls `delegate_tasks` with N AgentTasks │
                  └────────────────────┬─────────────────────────┘
                                       │
                                       ▼
                  ┌─────────────────────────────────────────────┐
                  │   delegate_tasks tool (builtin)             │
                  │   ─ parse + validate tasks                  │
                  │   ─ FORCE every task.modelId → Qwen         │
                  │   ─ orchestrator.runParallel(tasks)         │
                  └────────────────────┬────────────────────────┘
                                       │
                ┌──────────────────────┼──────────────────────┐
                ▼                      ▼                      ▼
       ┌────────────────┐    ┌────────────────┐    ┌────────────────┐
       │ Sub-agent t1   │    │ Sub-agent t2   │    │ Sub-agent tN   │
       │ runSubAgent(): │    │ runSubAgent(): │    │ runSubAgent(): │
       │ Qwen, no tools │    │ Qwen, no tools │    │ Qwen, no tools │
       └────────┬───────┘    └────────┬───────┘    └────────┬───────┘
                └────────────────────┬┴─────────────────────┘
                                     ▼
                       ┌────────────────────────────────────┐
                       │  formatResultsForLeader(plan, res) │
                       │  → bundled markdown returned to    │
                       │    delegate_tasks as its result    │
                       └────────────────┬───────────────────┘
                                        ▼
                          Leader's next agentLoop turn
                          (synthesises the final answer)
```

**Design decisions:**
- **Qwen-only.** `pickBestQwen()` enforces it; `/team on` refuses without a Qwen. Same instruction-tuned family → predictable behavior, no "which model speaks JSON" guessing.
- **Sub-agents are stateless.** No tools, no history. They're cheap, parallelizable text workers. If a sub-agent needs files, the leader does the IO and passes content in the prompt.
- **Leader picks intent, system picks model.** The LLM only chooses *what* to delegate. `delegate_tasks` overrides `task.modelId` to the orchestrator's Qwen — the LLM can't accidentally route to a chat-only model.
- **Live worker visibility.** `delegate_tasks` redraws an in-place per-task status block with token counters (`⏳ t1 [qwen3:4b] · 47 tokens…`) as workers stream — throttled to 80ms to avoid flicker.

---

## Streaming pipeline

```
Provider chunk → ThinkStripper (Ollama only) → onToken callback → REPL stdout
                                                      │
                                                      └── tracks streamedTextPending
                                                              │
                              after agentLoop returns: write "\n\n" if pending
                              (the bug fix — readline's prompt() resets the cursor)
```

**`ThinkStripper` (in `infrastructure/llm/ollama.ts`).** Streaming-safe state machine with two modes:
- **`"strip"`** (default): drops everything between `<think>` and `</think>`. Holds back up to 7 chars across chunk boundaries so a tag split across two chunks is still caught.
- **`"show"`** (when `/think on`): emits `\x1b[2m💭 ` on `<think>`, streams the body verbatim, emits `\x1b[22m\n─── answer ───\n` on `</think>`. `flush()` emits dim-off if the stream dies mid-thought so the next prompt isn't dimmed.

**Why it's separate from the agent loop.** The loop never sees raw `<think>` text. By the time tokens reach `writeToken`, they're already filtered. Conversation context stores only the visible answer — no token-budget pollution from reasoning.

---

## State, config, and persistence

| Concern | Where | Why |
|---|---|---|
| CLI flags / env | `core/config.ts` (one-shot) | Pure function. No side effects. |
| Session-level state (last model, modes) | `core/state.ts` → `~/.yeti-code/state.json` | Persists across launches. |
| Conversation history | `domain/context.ts` (in-memory) | Trimmed to fit `maxContextTokens`. Cleared by `/clear`. |
| Append-only audit log | `core/logger.ts` → `~/.yeti-code/logs/session_*.log` | The trace pipe — every tool call, mode switch, error. |
| User-defined skills | JSON in `~/.yeti-code/skills/` | Loaded once at startup. |
| Active skill | `features/skills/registry.ts` (in-memory) | Not persisted (resets to `default` each session). |

**Side-effect map.** Outside of file IO inside tools, the only writers to disk are: `SessionLogger`, `StateManager`, and `SkillRegistry.loadFromDirectory` (which `mkdir`s `~/.yeti-code/skills/` to ensure it exists).

---

## Skills

A skill is a name + system prompt + optional tool allowlist + optional model override:

```ts
interface Skill {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: string[];   // allowlist; if absent, all tools are available
  model?: string;     // override the active model for this skill
}
```

The default skill is hard-coded in `SkillRegistry`. Additional skills live as JSON files under `~/.yeti-code/skills/` or `./skills/builtins/` and are loaded once at startup.

**Why a tool allowlist?** A `researcher` skill that only has `search_files` cannot accidentally `rm -rf`. Skills compose with the safety model rather than replacing it.

---

## CLI surface

Claude-Code-style slash commands. **All commands** (see `index.ts`):

```
/help                              show all commands
/clear                             reset conversation, keep skill
/cost          (alias /usage)      token usage for last turn + session
/model [list|pick|use <id>]        switch model
/skill [list|use <name>]           switch skill
/team [on|off|status]              toggle Qwen-only team mode
/plan [<p> <e>|off|status]         toggle Plan & Execute pipeline
/think [on|off|status]             toggle Qwen 3 thinking-mode stream
/exit          (alias exit, quit)  quit
```

**REPL contract.**
- One request at a time (`isProcessing` flag rejects new input while a turn is running).
- Slash commands are dispatched *before* the request lock — `/clear`, `/help` etc. always work.
- Streaming output is followed by `\n\n` before `rl.prompt()` to avoid readline overwriting the last line (a real bug surfaced in early testing).
- Context-usage hints fire at 70/85/95% thresholds (each once per session).

---

## Testing & benchmarks

`tests/blackbox/` — 153 passing tests across 9 files, ~1.1s total:

| File | Tests | Scope |
|---|---|---|
| `text.test.ts` | 17 | grep / sed / head / tail / count_lines / diff_files |
| `dev.test.ts` | 16 | find_files / npm / git / run_script (with real `npm`/`git` when on PATH) |
| `web.test.ts` | 19 | fetch_url (mocked) + extract_html selector engine |
| `course.test.ts` | 21 | http_request, json_query, csv_info, encode/decode |
| `data.test.ts` | 9 (+2 skipped) | sql_query, python_eval, pdf_to_md (conditional on CLIs) |
| `team.test.ts` | 14 | ModelRegistry Qwen helpers, TeamOrchestrator, delegate_tasks override behavior |
| `safety.test.ts` | 36 | path-traversal blocks across every file-touching tool; npm/git allowlists |
| `formatters.test.ts` | 12 | per-tool argument summary rendering |
| `thinkStripper.test.ts` | 11 | streaming filter — chunk boundaries, show/strip modes, false positives |

**Conventions:**
- Each test creates a fresh temp dir (`mkdtempSync`), `chdir`s in, runs, `chdir`s out, `rm -rf`s. Configured `singleFork: true` in `vitest.config.ts` so `chdir` calls don't race.
- ANSI codes are stripped before assertions on rendered output.
- Tests requiring external CLIs (`npm`, `git`, `python3`, `bash`, `duckdb`, `pdftotext`) check `commandExists()` and `skipIf` rather than failing.
- LLM providers are mocked via a `CannedOllamaProvider` (team tests) or by replacing `global.fetch` (web tests).

**`tests/benchmark.ts`** — runs all read-only tools 50× over a 50-file × 200-line fixture and reports mean/p50/p95/ops-per-sec. Run with `npm run benchmark`. Headline numbers on M4:

| Tool | mean (ms) | ops/sec |
|---|---|---|
| `grep` recursive | 3.0 | 329 |
| `find_files **/*.ts` | 0.25 | 3,966 |
| `json_query` (1K items) | 0.24 | 4,219 |
| `csv_info` (1K rows × 4 cols) | 0.56 | 1,788 |
| `extract_html` (200 rows) | 0.14 | 7,226 |
| `ThinkStripper.strip` 1-char chunks | 0.11 | 9,516 |

---

## Repository map

```
Yeti-Code/
├── architecture.md                   # this file
├── README.md
├── package.json                      # vitest, ts-node, chalk, commander, dotenv, @google/genai
├── tsconfig.json                     # strict, ES2022, commonjs, src/ → dist/
├── vitest.config.ts                  # singleFork pool, 30s timeout
│
├── src/
│   ├── core/
│   │   ├── config.ts                 # CLI + env → AppConfig
│   │   ├── state.ts                  # ~/.yeti-code/state.json
│   │   └── logger.ts                 # ~/.yeti-code/logs/session_*.log
│   │
│   ├── domain/
│   │   ├── agent.ts                  # agentLoop — the heart (131 lines)
│   │   ├── context.ts                # ConversationContext
│   │   ├── types.ts                  # Content/Part/FunctionCall re-exports
│   │   └── team/
│   │       ├── orchestrator.ts       # parallel fan-out
│   │       ├── subAgent.ts           # stateless worker
│   │       └── types.ts              # AgentTask, AgentTaskResult, TeamPlan
│   │
│   ├── features/
│   │   ├── skills/
│   │   │   ├── registry.ts           # loads ~/.yeti-code/skills/*.json
│   │   │   └── types.ts
│   │   └── tools/
│   │       ├── registry.ts           # register / dispatch / toFunctionDeclarations
│   │       ├── pathSafety.ts         # the workspace sandbox
│   │       ├── types.ts              # Tool, ToolContext
│   │       └── builtins/
│   │           ├── index.ts          # registerBuiltins() — wires all 30 tools
│   │           ├── fs.ts             # read/write/edit/delete/list/mkdir/move/search
│   │           ├── text.ts           # grep/sed/head/tail/count/diff
│   │           ├── dev.ts            # find/npm/git/run_script
│   │           ├── shell.ts          # shell (streamed stdout, confirm-gated)
│   │           ├── web.ts            # fetch_url, extract_html (in-house CSS engine)
│   │           ├── course.ts         # http_request, json_query, csv_info, encode, decode
│   │           ├── data.ts           # sql_query, python_eval, pdf_to_md
│   │           └── delegateTasks.ts  # leader's team-mode entrypoint
│   │
│   ├── infrastructure/
│   │   └── llm/
│   │       ├── types.ts              # LLMProvider, StreamChatOptions, FunctionDeclaration
│   │       ├── registry.ts           # ModelRegistry + Qwen helpers
│   │       ├── gemini.ts             # GeminiProvider
│   │       └── ollama.ts             # OllamaProvider + ThinkStripper
│   │
│   └── presentation/
│       └── cli/
│           ├── index.ts              # main() — REPL, slash commands, modes
│           ├── formatters.ts         # tool/model/usage rendering
│           └── spinner.ts            # \r-based terminal spinner
│
└── tests/
    ├── benchmark.ts                  # micro-benchmarks
    └── blackbox/
        ├── _helpers.ts               # makeWorkspace, fakeLogger, approvingCtx, …
        ├── text.test.ts
        ├── dev.test.ts
        ├── web.test.ts
        ├── course.test.ts
        ├── data.test.ts
        ├── team.test.ts
        ├── safety.test.ts
        ├── formatters.test.ts
        └── thinkStripper.test.ts
```

---

## One-paragraph summary

yeti-code is a layered TypeScript CLI: a small generic `agentLoop` in `domain/` drives any `LLMProvider` (`Ollama` or `Gemini`) through a stream-of-tokens-and-tool-calls protocol. Tools live behind a uniform `Tool` interface registered into a `ToolRegistry`, with a single `pathSafety` chokepoint sandboxing the workspace, allowlists guarding subprocess tools, and a `ctx.confirm` gate on every destructive op. A `ThinkStripper` on the Ollama path filters Qwen 3's `<think>` blocks across chunk boundaries. Team mode promotes one Qwen to "leader," forces every sub-agent to the same Qwen via `delegate_tasks`, fans out tasks in parallel, and renders a live per-worker status block. Skills layer a system prompt + tool allowlist + optional model override on top. Session state lives in `~/.yeti-code/`. 153 black-box tests + benchmarks keep the whole thing honest.
