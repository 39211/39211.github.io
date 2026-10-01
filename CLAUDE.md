# Working rules for this repository

A mirrored static site: ~1,100 tracked files, **~17.9 MB of tracked text
(≈5.1M tokens)**. Several single files exceed a third of a 1M context window.
Treat context as the scarce resource — the rules below exist because ignoring
them once cost a full weekly model allowance.

See `docs/token-budget-playbook.md` for the reasoning and measurements, and
`docs/HANDOVER-token-investigation.md` for the open investigation into which
session drained the allowance (that one needs the local machine's transcripts).

To audit where tokens actually went in any session:
`scripts/audit-token-usage.sh --all`

## Check before you spend

`scripts/verify-site.sh` answers every routine question about site state —
JSON validity, sitemap well-formedness, required files, internal links, merge
markers, feed contents — in about **2 seconds for 0 tokens**.

```bash
scripts/verify-site.sh            # everything
scripts/verify-site.sh --quiet    # failures only
```

Run it first. Act on the failure list it prints. Do not read the repository to
answer a question this script already answers.

## Never read a large file whole

A `PreToolUse` hook denies whole-file reads over 64 KB and unlimited `cat` of
the same. **It is inert until installed** — Claude cannot write its own
settings file, so activate it once:

```bash
cp docs/claude-settings.example.json .claude/settings.json
```

Then open `/hooks` once (or restart the session) so the config is picked up. Work with the file instead of ingesting it:

```bash
jq 'keys' social-posts.json            # survey structure
jq '.posts | length' social-posts.json # count
rg -n 'canonical' index.html | head -30
sed -n '200,260p' index.html
```

`Read` with `offset`/`limit` is always allowed. To override once:
`CONTEXT_GUARD_MAX_BYTES=<bytes>`.

## Bulk work goes to an external CLI

**Claude Code subagents only run Claude models.** A subagent's `model` accepts
`sonnet` / `opus` / `haiku` / `fable` / a Claude model ID / `inherit`, and
defaults to the main conversation's model. Spawning subagents spends the same
quota as working directly, typically more — each re-reads files in a fresh
context and reports back into this one.

To actually move load off this subscription, leave the process:

```bash
scripts/delegate.sh --list                                   # engines available
scripts/delegate.sh "audit every services/*.html for canonical tags"
scripts/delegate.sh -f prompts/task.md --tail 60
scripts/delegate.sh --write "apply the fixes"                # allows edits
```

Full output lands in `.delegate/`; only a tail returns. If it exits **3**, no
engine is installed — say so and stop. Do not quietly do the work in-session.

## When a Claude subagent is genuinely right

Only for work needing Claude-quality judgement. Always pass an explicit cheap
model; `.claude/settings.json` sets `CLAUDE_CODE_SUBAGENT_MODEL=haiku` as the
default, and an agent definition or per-invocation `model` overrides it.
Instruct every subagent to return a summary and write detail to a file.

## Deployment

`main` auto-deploys to GitHub Pages via `.github/workflows/pages.yml`, which
uploads the repository root as-is. `.nojekyll` is a marker file and is
correctly zero bytes — do not "fix" it. `CNAME` pins the custom domain.
