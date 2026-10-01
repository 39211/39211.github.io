#!/usr/bin/env bash
# verify-site.sh — deterministic checks for this static site. Zero LLM tokens.
#
# Verification is a decision problem with a right answer, so it belongs in code,
# not in a model's context window. Every check here is something an LLM would
# otherwise "verify" by reading megabytes of JSON and HTML — at roughly 350K
# tokens for social-posts.json alone. Run this first; hand the model only the
# failures.
#
# Usage: scripts/verify-site.sh [--quiet] [check ...]
#   scripts/verify-site.sh                 run every check
#   scripts/verify-site.sh json sitemap    run only the named checks
#   scripts/verify-site.sh --list          show check names
# Exit: 0 all passed, 1 one or more failed.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

QUIET=0; SELECTED=""
while [ $# -gt 0 ]; do
  case "$1" in
    --quiet) QUIET=1; shift ;;
    --list)  echo "json sitemap required links conflicts feeds"; exit 0 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) SELECTED="${SELECTED:+$SELECTED }$1"; shift ;;
  esac
done

PASS=0; FAIL=0
declare -a FAILURES=()

wanted() { [ -z "$SELECTED" ] && return 0; case " $SELECTED " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
ok()   { PASS=$((PASS+1)); [ "$QUIET" = 1 ] || printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); FAILURES+=("$1${2:+ — $2}"); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; [ -n "${2:-}" ] && printf '        %s\n' "$2"; }
head_() { [ "$QUIET" = 1 ] || printf '\n\033[1m%s\033[0m\n' "$1"; }

# ── json: every tracked .json parses ─────────────────────────────────────────
if wanted json; then
  head_ "JSON parses"
  bad_files=""
  while IFS= read -r f; do
    jq empty "$f" 2>/dev/null || bad_files="${bad_files}${bad_files:+, }$f"
  done < <(git ls-files '*.json')
  n=$(git ls-files '*.json' | wc -l)
  [ -z "$bad_files" ] && ok "$n JSON files parse" || bad "malformed JSON" "$bad_files"
fi

# ── sitemap: XML well-formed, and every <loc> on our own host ────────────────
if wanted sitemap; then
  head_ "Sitemaps"
  host="$(tr -d '[:space:]' < CNAME 2>/dev/null)"
  for x in sitemap.xml ai-sitemap.xml; do
    [ -f "$x" ] || { bad "$x missing"; continue; }
    if xmllint --noout "$x" 2>/dev/null; then
      n=$(grep -c '<loc>' "$x" 2>/dev/null) || n=0
      if [ -n "$host" ]; then
        off=$(grep -o '<loc>[^<]*</loc>' "$x" 2>/dev/null | grep -cv "$host" || true)
        [ "${off:-0}" -eq 0 ] && ok "$x well-formed, $n <loc>, all on $host" \
                              || bad "$x has $off <loc> off-host" "expected host: $host"
      else
        ok "$x well-formed, $n <loc>"
      fi
    else
      bad "$x is not well-formed XML"
    fi
  done
  if [ -f rss.xml ]; then
    if xmllint --noout rss.xml 2>/dev/null; then
      n=$(grep -c '<item>' rss.xml 2>/dev/null) || n=0
      [ "$n" -gt 0 ] && ok "rss.xml well-formed, $n <item>" || bad "rss.xml has no <item> entries"
    else
      bad "rss.xml is not well-formed XML"
    fi
  else
    bad "rss.xml missing"
  fi
fi

# ── required: files GitHub Pages and the AI-discovery setup depend on ────────
if wanted required; then
  head_ "Required files"
  # .nojekyll is a marker: GitHub Pages only checks that it exists, so an
  # empty file is correct. Everything else must have content.
  for f in .nojekyll; do
    [ -e "$f" ] && ok "$f (marker present)" || bad "$f missing"
  done
  for f in CNAME index.html robots.txt llms.txt sitemap.xml \
           .well-known/ai.json business-profile.json; do
    [ -s "$f" ] && ok "$f" || bad "$f missing or empty"
  done
  if [ -f robots.txt ]; then
    grep -qi '^sitemap:' robots.txt && ok "robots.txt declares a Sitemap" \
                                    || bad "robots.txt has no Sitemap: line"
  fi
fi

# ── links: internal hrefs in top-level HTML resolve on disk ──────────────────
if wanted links; then
  head_ "Internal links"
  for page in index.html 404.html docs/index.html posts/index.html knowledge/index.html; do
    [ -f "$page" ] || continue
    missing=0; sample=""
    while IFS= read -r href; do
      case "$href" in ''|'#'*|http*|mailto:*|tel:*|data:*|'//'*) continue ;; esac
      target="${href%%#*}"; target="${target%%\?*}"
      case "$target" in /*) target=".${target}" ;; *) target="$(dirname "$page")/$target" ;; esac
      [ -e "$target" ] || [ -e "${target%/}/index.html" ] || {
        missing=$((missing+1)); [ -z "$sample" ] && sample="$href"; }
    done < <(grep -o 'href="[^"]*"' "$page" 2>/dev/null | sed 's/href="//;s/"$//' | sort -u)
    [ "$missing" -eq 0 ] && ok "$page: all internal links resolve" \
                         || bad "$page: $missing broken internal link(s)" "first: $sample"
  done
fi

# ── conflicts: no unresolved merge markers anywhere ──────────────────────────
if wanted conflicts; then
  head_ "Merge markers"
  hits="$(git ls-files -z | xargs -0 grep -l -E '^(<<<<<<< |>>>>>>> )' 2>/dev/null | head -5)"
  [ -z "$hits" ] && ok "no conflict markers in tracked files" \
                 || bad "conflict markers present" "$(echo "$hits" | tr '\n' ' ')"
fi

# ── feeds: JSON feeds carry entries and agree with each other ────────────────
if wanted feeds; then
  head_ "Feeds"
  for f in feed.json answers.json services.json knowledge-graph.json social-posts.json; do
    [ -f "$f" ] || { bad "$f missing"; continue; }
    n="$(jq '[.. | arrays] | map(length) | max // 0' "$f" 2>/dev/null)"
    [ "${n:-0}" -gt 0 ] && ok "$f: largest array has $n entries" \
                        || bad "$f: contains no populated array"
  done
fi

printf '\n\033[1m%d passed, %d failed\033[0m\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '\nFailures to hand to an agent (and nothing else):\n'
  for f in "${FAILURES[@]}"; do printf '  • %s\n' "$f"; done
  exit 1
fi
exit 0
