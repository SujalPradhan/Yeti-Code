# 🧊 YetiMind

YetiMind is a streaming terminal AI assistant powered by the **Google Gemini SDK**. It features an agentic tool-calling loop, a skills system for specialized personas, and real-time streaming output.

## ✨ Features

- **Native Gemini SDK**: Uses `@google/genai` for streaming and tool calling — no OpenAI shim.
- **Real-time Streaming**: Response tokens are printed character-by-character as they arrive.
- **Tool System**: Comprehensive suite of built-in file system tools with confirmation prompts.
- **Agent Loop**: Automatically handles multiple tool-call turns (up to a configurable limit).
- **Skills System**: Switch between specialized personas (`coder`, `researcher`, `explainer`) with custom prompts and tool sets.
- **Context Management**: Maintains conversation history with a sliding window (default 8000 tokens).
- **Session Logging**: All sessions and file operations are logged to `~/.yetimind/logs/`.

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- A [Google Gemini API Key](https://aistudio.google.com/apikey)

### Installation

```bash
npm install
```

### Configuration

Create a `.env` file in the root directory:

```env
GEMINI_API_KEY=your_gemini_api_key_here
MODEL=gemini-2.0-flash
MAX_CONTEXT_TOKENS=8000
```

### Usage

**Build the project:**
```bash
npm run build
```

**Run YetiMind:**
```bash
npm start
```

**Development mode (build and run):**
```bash
npm run dev
```

## 🛠️ CLI Options

```
Usage: yetimind [options]

Options:
  -V, --version          output the version number
  -m, --model <model>    LLM model to use (default: gemini-2.0-flash)
  -v, --verbose          print full message array and tool details
  --max-tokens <number>  hard limit for context window (in tokens)
  --max-turns <number>   max tool-call turns per session (default: 10)
  -s, --skill <name>     activate a skill at startup
  -h, --help             display help for command
```

## 🔧 Built-in Tools

| Tool | Description |
|------|-------------|
| `read_file(path)` | Reads a file and returns its content. |
| `write_file(path, content)` | Writes content to a file (creates or overwrites). Asks confirmation. |
| `edit_file(path, old_str, content)` | Replaces a specific string in a file. Asks confirmation. |
| `delete_file(path)` | Deletes a file. Asks confirmation. |
| `list_dir(path)` | Lists all files and folders in a directory. |
| `create_dir(path)` | Creates a directory recursively. |
| `move_file(src, dest)` | Moves or renames a file. Asks confirmation. |
| `search_files(dir, pattern)` | Recursively searches for a regex pattern within files in a directory. |
| `shell(command, cwd?)` | Runs a shell command. Live streams stdout, captures stderr, 30s timeout. |

## 🎭 Skills System

Switch between specialized personas using CLI flags or in-session commands:

```bash
# Start with a specific skill
node dist/cli.js --skill coder

# In-session commands
/skill list              # List available skills
/skill use researcher    # Switch to researcher mode
/usage                   # Display current context and token usage stats
```

### Built-in Skills

| Skill | Description | Tools |
|-------|-------------|-------|
| `default` | General-purpose assistant | All tools |
| `coder` | Expert software engineer | read_file, write_file, edit_file, delete_file, list_dir, create_dir, move_file, search_files, shell |
| `researcher` | Analysis and synthesis specialist | search_files |
| `explainer` | Step-by-step concept teacher | None |

Custom skills can be added as JSON files to `~/.yetimind/skills/`.

## 📁 Project Structure

```text
src/
├── core/               # App configuration and session logging
├── domain/             # LLM Agent loop, token context, shared types
├── features/           # Modular skills and tool registries (fs, shell)
├── infrastructure/     # LLM Provider interfaces (Google Gemini SDK)
└── presentation/       # CLI entry point, REPL loop, terminal UI formatting
```

## ⚖️ License

ISC