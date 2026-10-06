#!/usr/bin/env bash
# context-guard.sh — PreToolUse guard that stops a single tool call from
# swallowing the whole context window (and with it, a week of Opus/Fable quota).
#
# This repo is a mirrored static site: 1,100+ tracked files and ~18 MB of JSON,
# HTML and TXT. Reading social-posts.json (1.2 MB) or index.html (374 KB) whole
# costs ~350K and ~100K tokens respectively. A handful of those calls fills a
# 1M context, forces repeated compaction, and re-bills the entire transcript
# every turn. The guard denies the read and names a cheap alternative instead.
#
# stdin : PreToolUse hook JSON
# stdout: PreToolUse hook JSON (permissionDecision allow/deny)
set -uo pipefail

MAX_BYTES="${CONTEXT_GUARD_MAX_BYTES:-65536}"   # 64 KB ≈ 18K tokens

allow() { printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}\n'; exit 0; }
deny()  {
  jq -cn --arg r "$1" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

command -v jq >/dev/null 2>&1 || allow
payload="$(cat)" || allow
tool="$(jq -r '.tool_name // empty' <<<"$payload" 2>/dev/null)" || allow

human() { awk -v b="$1" 'BEGIN{printf "%.0f KB (~%.0fK tokens)", b/1024, b/3500}'; }

case "$tool" in
  Read)
    f="$(jq -r '.tool_input.file_path // empty' <<<"$payload")"
    [ -n "$f" ] && [ -f "$f" ] || allow
    # An explicit offset/limit means a windowed read — that is exactly what we want.
    windowed="$(jq -r 'if (.tool_input.limit // .tool_input.offset) then "yes" else "no" end' <<<"$payload")"
    [ "$windowed" = "yes" ] && allow
    size="$(stat -c%s "$f" 2>/dev/null || echo 0)"
    [ "$size" -le "$MAX_BYTES" ] && allow
    deny "$(basename "$f") is $(human "$size") — a whole-file Read would consume a large slice of the context window and bill it again on every later turn.
Use a targeted command instead, then read only what you need:
  • JSON  : jq '<path>' \"$f\" | head -50      (jq 'keys', 'length', '.[0]' to survey first)
  • HTML  : rg -n '<pattern>' \"$f\" | head -50
  • Slice : Read with offset/limit, or sed -n '100,160p' \"$f\"
  • Bulk  : scripts/delegate.sh -f <prompt-file>   (runs on an external CLI's quota)
Override for this one call: CONTEXT_GUARD_MAX_BYTES=$((size + 1))"
    ;;
  Bash)
    cmd="$(jq -r '.tool_input.command // empty' <<<"$payload")"
    [ -n "$cmd" ] || allow
    # Only catch whole-file dumps: cat/less/more/json_pp with no size limiter downstream.
    grep -Eq '(^|[;&|]\s*)(cat|less|more|json_pp)\s' <<<"$cmd" || allow
    grep -Eq '\|\s*(head|tail|sed|awk|grep|rg|jq|wc|cut|sort|uniq)\b' <<<"$cmd" && allow
    for w in $cmd; do
      case "$w" in -*|*'*'*) continue ;; esac
      [ -f "$w" ] || continue
      size="$(stat -c%s "$w" 2>/dev/null || echo 0)"
      [ "$size" -gt "$MAX_BYTES" ] && deny "This command dumps $(basename "$w") ($(human "$size")) into the transcript whole.
Pipe it through a limiter — head/tail/sed/grep/rg/jq/wc — or use scripts/delegate.sh for bulk analysis."
    done
    allow
    ;;
esac
allow
