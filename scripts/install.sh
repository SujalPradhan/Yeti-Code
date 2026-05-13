#!/usr/bin/env sh
# yeti-code installer
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/SujalPradhan/Yeti-Code/main/scripts/install.sh | sh
#
# Installs from source (clone + build) into:
#   ~/.local/share/yeti-code     — the project tree
#   ~/.local/bin/yeti-code       — the launcher (symlink-style wrapper)
#
# Re-running this script upgrades to the latest main branch.

set -eu

# ── config ────────────────────────────────────────────────────────────────
REPO_URL="${YETI_REPO_URL:-https://github.com/SujalPradhan/Yeti-Code.git}"
BRANCH="${YETI_BRANCH:-main}"
INSTALL_ROOT="${YETI_INSTALL_ROOT:-$HOME/.local/share/yeti-code}"
BIN_DIR="${YETI_BIN_DIR:-$HOME/.local/bin}"
BIN_PATH="$BIN_DIR/yeti-code"
MIN_NODE_MAJOR=20

# ── pretty printing ───────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET="$(printf '\033[0m')"
  C_BOLD="$(printf '\033[1m')"
  C_DIM="$(printf '\033[2m')"
  C_CYAN="$(printf '\033[36m')"
  C_GREEN="$(printf '\033[32m')"
  C_RED="$(printf '\033[31m')"
  C_YELLOW="$(printf '\033[33m')"
else
  C_RESET=""; C_BOLD=""; C_DIM=""; C_CYAN=""; C_GREEN=""; C_RED=""; C_YELLOW=""
fi

info()    { printf '%s  %s%s\n' "${C_CYAN}→${C_RESET}" "$1" ""; }
ok()      { printf '%s  %s%s\n' "${C_GREEN}✓${C_RESET}" "$1" ""; }
warn()    { printf '%s  %s%s\n' "${C_YELLOW}!${C_RESET}" "$1" ""; }
fatal()   { printf '%s  %s%s\n' "${C_RED}✗${C_RESET}" "$1" "" >&2; exit 1; }
section() { printf '\n%s%s%s\n' "${C_BOLD}" "$1" "${C_RESET}"; }

# ── banner ────────────────────────────────────────────────────────────────
cat <<BANNER
${C_CYAN}╔══════════════════════════════════════╗${C_RESET}
${C_CYAN}║${C_RESET}  ${C_BOLD}🧊  yeti-code${C_RESET}  ${C_DIM}installer${C_RESET}              ${C_CYAN}║${C_RESET}
${C_CYAN}║${C_RESET}  ${C_DIM}AI agent for tds.s-anand.net${C_RESET}        ${C_CYAN}║${C_RESET}
${C_CYAN}╚══════════════════════════════════════╝${C_RESET}

BANNER

# ── preflight ─────────────────────────────────────────────────────────────
section "1. Checking prerequisites"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fatal "Missing required command: $1. $2"
  fi
}

need_cmd git "Install git first: https://git-scm.com/downloads"
need_cmd node "Install Node.js ${MIN_NODE_MAJOR}+ from https://nodejs.org/  (or via nvm / brew install node)"
need_cmd npm  "npm ships with Node.js — reinstall Node from nodejs.org"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  fatal "Node.js >= ${MIN_NODE_MAJOR} required (you have $(node -v)). Upgrade and re-run."
fi
ok "node $(node -v) · npm $(npm -v) · git installed"

# ── fetch ─────────────────────────────────────────────────────────────────
section "2. Fetching source (${REPO_URL} @ ${BRANCH})"

mkdir -p "$INSTALL_ROOT"
if [ -d "$INSTALL_ROOT/.git" ]; then
  info "Updating existing checkout at $INSTALL_ROOT"
  git -C "$INSTALL_ROOT" fetch --quiet origin "$BRANCH"
  git -C "$INSTALL_ROOT" reset --hard --quiet "origin/${BRANCH}"
else
  if [ -n "$(ls -A "$INSTALL_ROOT" 2>/dev/null || true)" ]; then
    fatal "$INSTALL_ROOT exists and is not a git checkout. Move it aside or set \$YETI_INSTALL_ROOT."
  fi
  info "Cloning into $INSTALL_ROOT"
  git clone --quiet --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_ROOT"
fi
ok "source ready"

# ── build ─────────────────────────────────────────────────────────────────
section "3. Installing dependencies and building"

cd "$INSTALL_ROOT"

# Use ci when lockfile exists (deterministic, faster); else fall back to install.
if [ -f package-lock.json ]; then
  info "npm ci  (this can take a minute)"
  npm ci --no-audit --no-fund --loglevel=error
else
  info "npm install"
  npm install --no-audit --no-fund --loglevel=error
fi

info "npm run build"
npm run build --silent
ok "built · dist/presentation/cli/index.js"

# ── launcher ──────────────────────────────────────────────────────────────
section "4. Installing launcher"

mkdir -p "$BIN_DIR"
ENTRY="$INSTALL_ROOT/dist/presentation/cli/index.js"
[ -f "$ENTRY" ] || fatal "Build did not produce $ENTRY"
chmod +x "$ENTRY" 2>/dev/null || true

# Wrapper script — survives across git pulls and is easy to inspect.
cat > "$BIN_PATH" <<EOF
#!/usr/bin/env sh
# yeti-code launcher (managed by scripts/install.sh — do not edit by hand)
exec node "$ENTRY" "\$@"
EOF
chmod +x "$BIN_PATH"
ok "launcher → $BIN_PATH"

# ── PATH guidance ─────────────────────────────────────────────────────────
section "5. PATH check"

case ":$PATH:" in
  *":$BIN_DIR:"*)
    ok "$BIN_DIR is on your PATH"
    ;;
  *)
    warn "$BIN_DIR is NOT on your PATH yet."
    case "${SHELL:-/bin/sh}" in
      *zsh)   RC="$HOME/.zshrc" ;;
      *bash)  RC="$HOME/.bashrc" ;;
      *fish)  RC="$HOME/.config/fish/config.fish" ;;
      *)      RC="$HOME/.profile" ;;
    esac
    printf "    Add this line to %s and reload your shell:\n\n" "$RC"
    printf "      ${C_CYAN}export PATH=\"\$HOME/.local/bin:\$PATH\"${C_RESET}\n\n"
    printf "    Or run yeti-code directly: %s\n" "$BIN_PATH"
    ;;
esac

# ── done ──────────────────────────────────────────────────────────────────
section "Done."

cat <<NEXT

Next:
  ${C_CYAN}yeti-code${C_RESET}                   # start an interactive session
  ${C_CYAN}yeti-code --skill coder${C_RESET}     # start with a specific skill
  ${C_CYAN}yeti-code --help${C_RESET}            # show all flags

To upgrade later:
  ${C_DIM}curl -fsSL https://raw.githubusercontent.com/SujalPradhan/Yeti-Code/${BRANCH}/scripts/install.sh | sh${C_RESET}

To uninstall:
  ${C_DIM}curl -fsSL https://raw.githubusercontent.com/SujalPradhan/Yeti-Code/${BRANCH}/scripts/uninstall.sh | sh${C_RESET}

For Ollama (recommended local model):
  ${C_DIM}brew install ollama && ollama serve & && ollama pull qwen3:4b${C_RESET}

For Gemini (cloud):
  ${C_DIM}Set GEMINI_API_KEY in your shell environment.${C_RESET}

NEXT
