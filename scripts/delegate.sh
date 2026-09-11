#!/usr/bin/env bash
# delegate.sh — hand bulk work to an external agent CLI so it bills THAT CLI's
# quota, not the Claude session's.
#
# Why this exists: Claude Code's built-in subagents (the Agent/Task tool) only
# run Anthropic models — the `model` field takes sonnet | opus | haiku | fable |
# a Claude model ID | inherit, and `inherit` is the default. "Give it to a
# subagent" therefore spends the SAME quota as the main thread, usually more,
# because each subagent re-reads files in its own context and writes a report
# back into yours. Routing work to Grok/Cursor/Codex requires leaving the
# process — which is what this script does.
#
# Contract with the caller: the full answer goes to a FILE; only a short tail
# comes back on stdout. The orchestrator's context stays small by construction.
#
# Usage:
#   scripts/delegate.sh "audit every services/*.html for a missing canonical tag"
#   scripts/delegate.sh -f prompts/audit.md --tail 60
#   scripts/delegate.sh --write "fix the canonical tags you found"   # allows edits
#   scripts/delegate.sh --list                                       # show engines
#
# Env:
#   DELEGATE_ENGINES  engine preference order (default: "grok cursor-agent codex gemini")
#   DELEGATE_MODEL    model passed to the engine when it supports --model
#   DELEGATE_GROK_ARGS / DELEGATE_CURSOR_ARGS   extra verbatim args
#   DELEGATE_OUT_DIR  output directory (default: .delegate)
set -uo pipefail

ENGINES="${DELEGATE_ENGINES:-grok cursor-agent codex gemini}"
OUT_DIR="${DELEGATE_OUT_DIR:-.delegate}"
TAIL=40
WRITE=0
PROMPT=""

die() { printf 'delegate: %s\n' "$1" >&2; exit "${2:-1}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    -f|--file)   [ -f "${2:-}" ] || die "no such prompt file: ${2:-}"; PROMPT="$(cat "$2")"; shift 2 ;;
    --tail)      TAIL="${2:-40}"; shift 2 ;;
    --write)     WRITE=1; shift ;;
    --engine)    ENGINES="${2:-}"; shift 2 ;;
    --list)      for e in $ENGINES; do
                   printf '%-14s %s\n' "$e" "$(command -v "$e" 2>/dev/null || echo 'not installed')"
                 done; exit 0 ;;
    -h|--help)   sed -n '2,28p' "$0"; exit 0 ;;
    *)           PROMPT="${PROMPT:+$PROMPT }$1"; shift ;;
  esac
done

[ -n "$PROMPT" ] || die "no prompt given (pass text, or -f <file>)" 2

ENGINE=""
for e in $ENGINES; do command -v "$e" >/dev/null 2>&1 && { ENGINE="$e"; break; }; done

if [ -z "$ENGINE" ]; then
  cat >&2 <<MSG
delegate: no external agent CLI found on PATH.
  Looked for: $ENGINES

Without one, bulk work has nowhere to go but the Claude session's own quota —
which is the failure this script exists to prevent. Install at least one and
make sure its API key is in the environment, then re-run:

  grok         xAI Grok Build CLI   (XAI_API_KEY)
  cursor-agent Cursor CLI           (cursor-agent login)
  codex        OpenAI Codex CLI     (OPENAI_API_KEY)

In a Claude Code web/cloud session, install it from the environment's setup
script so every session has it — the container is rebuilt each time.
MSG
  exit 3
fi

mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$OUT_DIR/$STAMP-$ENGINE.md"

# Engines differ in flag spelling between versions; probe --help and degrade
# gracefully rather than failing on an unknown flag.
supports() { "$ENGINE" --help 2>/dev/null | grep -q -- "$1"; }

set -- 
case "$ENGINE" in
  grok)
    set -- -p "$PROMPT"
    supports '--output-format' && set -- "$@" --output-format text
    supports '--no-auto-update' && set -- "$@" --no-auto-update
    [ "$WRITE" = 1 ] && supports '--always-approve' && set -- "$@" --always-approve
    [ -n "${DELEGATE_MODEL:-}" ] && supports '--model' && set -- "$@" --model "$DELEGATE_MODEL"
    # shellcheck disable=SC2086
    [ -n "${DELEGATE_GROK_ARGS:-}" ] && set -- "$@" $DELEGATE_GROK_ARGS
    ;;
  cursor-agent)
    set -- -p "$PROMPT" --output-format text
    [ -n "${DELEGATE_MODEL:-}" ] && set -- "$@" --model "$DELEGATE_MODEL"
    # shellcheck disable=SC2086
    [ -n "${DELEGATE_CURSOR_ARGS:-}" ] && set -- "$@" $DELEGATE_CURSOR_ARGS
    ;;
  codex)  set -- exec "$PROMPT" ;;
  gemini) set -- -p "$PROMPT" ;;
esac

printf '### delegate run\nengine: %s\nstarted: %s\nwrite-mode: %s\n\n---\n\n' \
  "$ENGINE" "$STAMP" "$WRITE" > "$OUT"

"$ENGINE" "$@" >> "$OUT" 2>&1
RC=$?

LINES="$(wc -l < "$OUT")"
cat <<SUMMARY
engine : $ENGINE
exit   : $RC
output : $OUT ($LINES lines)

--- last $TAIL lines ---
SUMMARY
tail -n "$TAIL" "$OUT"

[ "$RC" -ne 0 ] && printf '\ndelegate: %s exited %s — read %s for the full log.\n' "$ENGINE" "$RC" "$OUT" >&2
exit "$RC"
