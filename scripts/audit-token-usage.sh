#!/usr/bin/env bash
# audit-token-usage.sh — forensic token accounting for Claude Code sessions.
#
# Reads the local transcripts under ~/.claude/projects and reports where the
# tokens actually went. Aggregates only: it prints counts, models, file paths
# and truncated commands — never message content.
#
# The number that usually explains a drained allowance is cache_read: the
# conversation so far, re-sent on every API call. It grows with the context,
# so one large file read early makes every later turn more expensive. 80 turns
# at a 400K context is ~32M cache-read tokens for one task.
#
# Usage:
#   scripts/audit-token-usage.sh                 list sessions, newest first
#   scripts/audit-token-usage.sh --all           summarise every session
#   scripts/audit-token-usage.sh <file.jsonl>    full report for one session
#   scripts/audit-token-usage.sh --since 2026-09-09
set -uo pipefail

ROOT="${CLAUDE_PROJECTS_DIR:-$HOME/.claude/projects}"
SINCE=""; MODE="list"; TARGET=""

while [ $# -gt 0 ]; do
  case "$1" in
    --all)   MODE="all"; shift ;;
    --since) SINCE="${2:-}"; shift 2 ;;
    --root)  ROOT="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *)       MODE="one"; TARGET="$1"; shift ;;
  esac
done

command -v jq >/dev/null 2>&1 || { echo "audit: jq is required" >&2; exit 1; }
[ -d "$ROOT" ] || { echo "audit: no transcript directory at $ROOT" >&2
                    echo "       pass --root <dir> or set CLAUDE_PROJECTS_DIR" >&2; exit 1; }

b()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
num() { printf "%'d" "$1" 2>/dev/null || printf '%s' "$1"; }

# ── totals for one transcript ────────────────────────────────────────────────
totals() {
  jq -s '[.[]|select(.type=="assistant" and .message.usage)]|map(.message.usage)
    |{calls:length,
      input:(map(.input_tokens//0)|add//0),
      output:(map(.output_tokens//0)|add//0),
      cache_write:(map(.cache_creation_input_tokens//0)|add//0),
      cache_read:(map(.cache_read_input_tokens//0)|add//0)}' "$1"
}

summarise_one() {
  local f="$1"
  local t; t="$(totals "$f")"
  local calls cr cw out peak
  calls=$(jq -r '.calls' <<<"$t"); cr=$(jq -r '.cache_read' <<<"$t")
  cw=$(jq -r '.cache_write' <<<"$t"); out=$(jq -r '.output' <<<"$t")
  peak=$(jq -sr '[.[]|select(.type=="assistant")|.message.usage.cache_read_input_tokens//0]|max//0' "$f")
  printf '%-38s %6s calls  out %9s  cache_w %10s  cache_r %12s  peak_ctx %9s\n' \
    "$(basename "$f" .jsonl | cut -c1-36)" "$calls" "$(num "$out")" "$(num "$cw")" "$(num "$cr")" "$(num "$peak")"
}

# ── list mode ────────────────────────────────────────────────────────────────
if [ "$MODE" != "one" ]; then
  mapfile -t FILES < <(find "$ROOT" -name '*.jsonl' -type f -printf '%T@ %p\n' 2>/dev/null \
                       | sort -rn | cut -d' ' -f2-)
  [ "${#FILES[@]}" -gt 0 ] || { echo "audit: no .jsonl transcripts under $ROOT" >&2; exit 1; }
  b "Sessions under $ROOT (newest first)"
  for f in "${FILES[@]}"; do
    d="$(date -r "$f" '+%Y-%m-%d %H:%M' 2>/dev/null)"
    [ -n "$SINCE" ] && [ "${d%% *}" \< "$SINCE" ] && continue
    printf '\n  %s  %s\n  project: %s\n  ' "$d" "$f" "$(basename "$(dirname "$f")")"
    [ "$MODE" = "all" ] && summarise_one "$f" || printf '\n'
  done
  printf '\nDrill into one:  %s <path-to.jsonl>\n' "$0"
  exit 0
fi

F="$TARGET"
[ -f "$F" ] || { echo "audit: no such transcript: $F" >&2; exit 1; }

b "Session"
printf '  file    : %s\n  project : %s\n  entries : %s\n' \
  "$F" "$(basename "$(dirname "$F")")" "$(wc -l < "$F")"
jq -sr '[.[]|select(.timestamp)]|"  started : \(.[0].timestamp)\n  ended   : \(.[-1].timestamp)"' "$F" 2>/dev/null

b "Token totals"
totals "$F" | jq -r '"  API calls   : \(.calls)
  input       : \(.input)
  output      : \(.output)
  cache write : \(.cache_write)
  cache read  : \(.cache_read)   <- the transcript, re-sent every call"'
totals "$F" | jq -r 'if .calls>0 then "  avg context re-sent per call: \((.cache_read/.calls)|floor)" else empty end'

b "By model  (proves which model actually did the work)"
jq -sr '[.[]|select(.type=="assistant" and .message.model)]|group_by(.message.model)
  |map({m:.[0].message.model,t:length,o:(map(.message.usage.output_tokens//0)|add//0),
        c:(map(.message.usage.cache_read_input_tokens//0)|add//0)})
  |.[]|"  \(.m)\n      turns \(.t)   output \(.o)   cache_read \(.c)"' "$F"

b "Main thread vs subagent sidechains"
jq -sr '[.[]|select(.type=="assistant")]|group_by(.isSidechain//false)
  |map({s:(.[0].isSidechain//false),t:length,o:(map(.message.usage.output_tokens//0)|add//0),
        c:(map(.message.usage.cache_read_input_tokens//0)|add//0)})
  |.[]|"  \(if .s then "subagent " else "main     " end) turns \(.t)   output \(.o)   cache_read \(.c)"' "$F"

b "Subagent spawns  (model=INHERIT means it ran on the MAIN model)"
spawns=$(jq -r 'select(.type=="assistant")|.message.content[]?
  |select(.type=="tool_use" and (.name=="Task" or .name=="Agent"))
  |"  \(.name)  subagent_type=\(.input.subagent_type//"?")  model=\(.input.model//"INHERIT")"' "$F" 2>/dev/null | sort | uniq -c)
[ -n "$spawns" ] && echo "$spawns" || echo "  none — no subagents were spawned in this session"

b "Context growth  (cache_read per call, in order)"
jq -sr '[.[]|select(.type=="assistant" and .message.usage)|.message.usage.cache_read_input_tokens//0]
  |. as $v|($v|max) as $m
  |to_entries|map(select(.key % ((($v|length)/25|ceil)|if .<1 then 1 else . end) == 0))
  |.[]|"  call \(.key|tostring|(" "*(4-length))+.)  \(.value|tostring|(" "*(10-length))+.)  \("#"*(((.value*40)/(if $m>0 then $m else 1 end))|floor))"' "$F" 2>/dev/null

b "Compactions  (each one re-summarises and re-sends everything)"
n=$(jq -r 'select(.type=="summary" or .isCompactSummary==true or .subtype=="compact_boundary")|.type' "$F" 2>/dev/null | wc -l)
echo "  $n compaction event(s)"

b "Heaviest transcript entries  (what filled the window)"
jq -r '[(tostring|length),(.type//"?"),
        ([..|objects|.file_path?]|map(select(type=="string"))|first//""),
        ([..|objects|.command?]|map(select(type=="string"))|first//""|.[0:50])]|@tsv' "$F" 2>/dev/null \
  | sort -rn | head -15 \
  | awk -F'\t' '{printf "  %9d  %-11s %s%s\n", $1, $2, $3, ($4==""?"":"$ "$4)}'

b "Tool call counts"
jq -r 'select(.type=="assistant")|.message.content[]?|select(.type=="tool_use")|.name' "$F" 2>/dev/null \
  | sort | uniq -c | sort -rn | head -15 | awk '{printf "  %4d  %s\n", $1, $2}'

printf '\n'
