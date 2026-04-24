#!/usr/bin/env bash
# Abacus preflight — verifies every binary Abacus needs is available and at a
# workable version. Run this before `pnpm install` on a fresh checkout.
# Exit code 0 = ready; non-zero = one or more required tools missing.

set -u

GREEN=$'\033[0;32m'; RED=$'\033[0;31m'; YELLOW=$'\033[0;33m'; RESET=$'\033[0m'

missing=0
ok()    { printf '  %sOK%s   %-8s %s\n'   "$GREEN"  "$RESET" "$1" "$2"; }
warn()  { printf '  %sWARN%s %-8s %s\n'   "$YELLOW" "$RESET" "$1" "$2"; }
fail()  { printf '  %sFAIL%s %-8s %s\n'   "$RED"    "$RESET" "$1" "$2"; missing=$((missing+1)); }

check_required() {
  local name="$1" cmd="$2" version_cmd="$3"
  if command -v "$cmd" >/dev/null 2>&1; then
    ok "$name" "$(eval "$version_cmd" 2>&1 | head -1)"
  else
    fail "$name" "not found on PATH"
  fi
}

check_optional() {
  local name="$1" cmd="$2" version_cmd="$3" note="$4"
  if command -v "$cmd" >/dev/null 2>&1; then
    ok "$name" "$(eval "$version_cmd" 2>&1 | head -1)"
  else
    warn "$name" "not found — $note"
  fi
}

echo "Abacus preflight"
echo "================"

check_required "node"   "node"   "node --version"
check_required "pnpm"   "pnpm"   "pnpm --version"
check_required "bd"     "bd"     "bd --version"
check_required "dolt"   "dolt"   "dolt version | head -1"
check_required "tmux"   "tmux"   "tmux -V"
check_required "claude" "claude" "claude --version"
check_optional "jq"     "jq"     "jq --version" "nice-to-have for debugging JSON agent logs"

echo

if [ "$missing" -eq 0 ]; then
  printf '%sAll required tools present.%s\n' "$GREEN" "$RESET"
  exit 0
else
  printf '%s%d required tool(s) missing.%s See https://github.com/... for install notes.\n' "$RED" "$missing" "$RESET"
  exit 1
fi
