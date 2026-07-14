#!/usr/bin/env bash
# install.sh — wire this checkout into a Claude Code config dir (~/.claude).
#
# Non-destructive by design:
#   • ENGINE (bin/ commands/ craft/ memory/ templates/ scripts/ docs/ + the root
#     convention docs) — per-FILE symlinks into the target, so `git pull` in this
#     checkout updates the live install, and your own files in those dirs are
#     never hidden. An existing regular file in the way is BACKED UP first, then
#     replaced; an existing symlink is repointed.
#   • KB + CONFIG (pipeline/** , CLAUDE.md, settings.json) — copy-if-absent ONLY.
#     These are YOUR state (seeded from the shipped templates); the installer
#     never overwrites them. When one already exists you get a pointer to the
#     shipped example to merge by hand.
#
# Usage:  ./install.sh [--copy] [--dry-run]
#   --copy     copy engine files instead of symlinking (for a throwaway checkout)
#   --dry-run  print every action without touching anything
#
# Target dir: $CLAUDE_CONFIG_DIR if set, else ~/.claude.
# Exit: 0 = installed, 1 = error.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$TARGET/v-coding-setup-backup-$STAMP"

mode="link"
dry=0
for arg in "$@"; do
  case "$arg" in
    --copy) mode="copy" ;;
    --dry-run) dry=1 ;;
    *) echo "install.sh: unknown flag $arg (use --copy / --dry-run)"; exit 1 ;;
  esac
done

say() { printf '%s\n' "$*"; }
act() {  # act <desc> <cmd...> — honor --dry-run
  local desc="$1"; shift
  if [ "$dry" -eq 1 ]; then say "DRY: $desc"; else "$@"; say "     $desc"; fi
}

backup_path() {  # <abs path under $TARGET> — move it into the backup tree
  local p="$1" rel="${1#"$TARGET"/}"
  act "backup  $rel -> ${BACKUP##*/}/$rel" mkdir -p "$BACKUP/$(dirname "$rel")"
  act "        (moved)" mv "$p" "$BACKUP/$rel"
}

install_engine_file() {  # <rel path> — symlink|copy $SRC/<rel> to $TARGET/<rel>
  local rel="$1" src="$SRC/$1" dst="$TARGET/$1"
  [ -e "$src" ] || { say "install.sh: missing source $rel"; exit 1; }
  act "mkdir   $(dirname "$rel")/" mkdir -p "$(dirname "$dst")"
  if [ -L "$dst" ]; then
    :  # existing symlink — repoint below
  elif [ -e "$dst" ]; then
    if cmp -s "$src" "$dst"; then
      :  # identical regular file — safe to replace without backup
    else
      backup_path "$dst"
    fi
  fi
  if [ "$mode" = "link" ]; then
    act "link    $rel" ln -sfn "$src" "$dst"
  else
    act "copy    $rel" cp -f "$src" "$dst"
  fi
}

copy_if_absent() {  # <src rel> <dst rel> — never overwrite
  local src="$SRC/$1" dst="$TARGET/$2"
  if [ -e "$dst" ] || [ -L "$dst" ]; then
    say "keep    $2 (exists — merge by hand from $1 if you want the shipped version)"
  else
    act "mkdir   $(dirname "$2")/" mkdir -p "$(dirname "$dst")"
    act "seed    $2 (from $1)" cp "$src" "$dst"
  fi
}

say "v-coding-setup installer"
say "  source: $SRC"
say "  target: $TARGET   (mode: $mode$([ "$dry" -eq 1 ] && echo ', DRY RUN'))"
say ""

[ -d "$TARGET" ] || act "mkdir   target" mkdir -p "$TARGET"

# --- 1. Engine: per-file symlinks/copies -------------------------------------
ENGINE_DIRS="bin commands craft memory templates scripts docs"
for d in $ENGINE_DIRS; do
  ( cd "$SRC" && find "$d" -type f ! -name '.DS_Store' ) | while IFS= read -r rel; do
    install_engine_file "$rel"
  done
done

ROOT_DOCS="workflow-conventions.md workflow-chains.md commands-reference.md usage-stats.md screenshot-recipe.md"
for f in $ROOT_DOCS; do
  install_engine_file "$f"
done

# --- 2. KB: seed from templates, never overwrite ------------------------------
( cd "$SRC" && find pipeline -type f ! -name '.DS_Store' ) | while IFS= read -r rel; do
  copy_if_absent "$rel" "$rel"
done

# --- 3. Config: seed from examples, never overwrite ---------------------------
copy_if_absent "CLAUDE.example.md" "CLAUDE.md"
copy_if_absent "settings.example.json" "settings.json"

say ""
say "Installed. Manual steps that remain (each optional until you need it):"
say ""
say "  1. PATH for the bare-verb helpers (pr-health, sb-new, conflict-scan, …) — add to ~/.zprofile:"
say '       case ":$PATH:" in *":$HOME/.claude/bin:"*) ;; *) export PATH="$HOME/.claude/bin:$PATH" ;; esac'
say "     (zprofile, not zshrc — Claude Code's shell is login, non-interactive. New sessions only.)"
say ""
say "  2. Linear MCP — hosted (OAuth):  claude mcp add --transport http linear https://mcp.linear.app/mcp"
say "     or self-hosted token-frugal wrapper: github.com/wiklob/linear-mcp-lean, then"
say "     export LINEAR_MCP_WRAPPER_URL=<your endpoint> and manage routing via bin/linear-wrapper-toggle.mjs."
say ""
say "  3. Secrets — put tokens (MCP_BEARER_TOKEN, …) in $TARGET/.envrc and 'direnv allow' it."
say "     The guards + settings deny-rules assume this pattern; never commit or display it."
say ""
say "  4. Scheduled rituals (macOS launchd, all optional) — install per job:"
say "       bash $TARGET/bin/install-harvest-launchd.sh          # daily pipeline-bug harvest"
say "       bash $TARGET/bin/install-feedback-harvest-launchd.sh # daily feedback harvest"
say "       bash $TARGET/bin/install-schedule-brief-launchd.sh   # morning brief"
say "       bash $TARGET/bin/install-daily-plan-launchd.sh       # morning /daily-plan"
say "       bash $TARGET/bin/install-git-hygiene-launchd.sh      # daily repo hygiene sweep"
say "       bash $TARGET/bin/install-docs-refresh-launchd.sh     # daily /docs-refresh"
say "       bash $TARGET/bin/install-daily-summary-launchd.sh    # evening /daily-summary"
say "       bash $TARGET/bin/install-periodic-review-launchd.sh  # weekly /periodic-review"
say ""
say "  5. Per-repo ticket flow — in each repo you work on, run /ticket-flow-init (or copy"
say "     .claude/ticket-flow.example.json to <repo>/.claude/ticket-flow.json and fill it in)."
say ""
say "  6. Seed the KB — edit $TARGET/pipeline/objectives.md (+ principles.md), then /refresh-landscape."
say ""
say "  7. Multi-model (optional) — npm install -g @wiklob/claude-model-router && model-router install-launchd,"
say "     then point sessions at it in settings.json:  \"env\": { \"ANTHROPIC_BASE_URL\": \"http://localhost:8399\" }"
say "     Model per conversation: 'claude --model <id>' or '/model <id>'. See docs/multi-model-support.md."
if [ "$dry" -eq 1 ]; then
  say ""
  say "(dry run — nothing was changed)"
fi
