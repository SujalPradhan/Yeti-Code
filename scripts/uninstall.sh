#!/usr/bin/env sh
# yeti-code uninstaller
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/SujalPradhan/Yeti-Code/main/scripts/uninstall.sh | sh
#
# Removes the launcher and source tree. By default, leaves your conversation
# logs and saved state in ~/.yeti-code/ alone (so you don't lose course traces
# by accident). Set YETI_PURGE=1 to wipe those too.

set -eu

INSTALL_ROOT="${YETI_INSTALL_ROOT:-$HOME/.local/share/yeti-code}"
BIN_DIR="${YETI_BIN_DIR:-$HOME/.local/bin}"
BIN_PATH="$BIN_DIR/yeti-code"
STATE_DIR="$HOME/.yeti-code"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET="$(printf '\033[0m')"; C_GREEN="$(printf '\033[32m')"; C_DIM="$(printf '\033[2m')"; C_YELLOW="$(printf '\033[33m')"
else
  C_RESET=""; C_GREEN=""; C_DIM=""; C_YELLOW=""
fi
ok()   { printf '%s  %s\n' "${C_GREEN}✓${C_RESET}" "$1"; }
skip() { printf '%s  %s\n' "${C_DIM}·${C_RESET}" "$1"; }
warn() { printf '%s  %s\n' "${C_YELLOW}!${C_RESET}" "$1"; }

if [ -f "$BIN_PATH" ] || [ -L "$BIN_PATH" ]; then
  rm -f "$BIN_PATH"
  ok "removed launcher $BIN_PATH"
else
  skip "no launcher at $BIN_PATH"
fi

if [ -d "$INSTALL_ROOT" ]; then
  rm -rf "$INSTALL_ROOT"
  ok "removed source tree $INSTALL_ROOT"
else
  skip "no source tree at $INSTALL_ROOT"
fi

if [ "${YETI_PURGE:-0}" = "1" ]; then
  if [ -d "$STATE_DIR" ]; then
    rm -rf "$STATE_DIR"
    ok "purged $STATE_DIR (state + logs + skills)"
  fi
else
  if [ -d "$STATE_DIR" ]; then
    warn "kept $STATE_DIR (state + logs + skills) — re-run with YETI_PURGE=1 to remove"
  fi
fi

printf '\nyeti-code uninstalled. Bye 👋\n'
