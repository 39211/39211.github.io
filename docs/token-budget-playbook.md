# Token Budget Playbook

Why a one-task session drained a weekly Opus/Fable allowance, and the machinery
in this repo that stops it happening again.

---

## 1. The finding that explains everything

**Claude Code subagents cannot run Grok.** The `model` field of a subagent
accepts exactly four kinds of value: an alias (`sonnet`, `opus`, `haiku`,
`fable`), a full Claude model ID (`claude-opus-5`), the literal `inherit`, or
nothing at all. There is no value that means "xAI" or "Cursor". When the field
is omitted, resolution falls through to:

1. the `model` parameter on that specific invocation
2. the subagent definition's `model` frontmatter (`inherit` = the main model)
3. the `CLAUDE_CODE_SUBAGENT_MODEL` environment variable
4. **the main conversation's model**

With nothing configured, step 4 wins. So "delegate the bulk work to subagents"
spent the main model's quota — every time, by design, silently.

It is also the *expensive* way to spend it. A subagent gets a fresh context, so
it re-reads whatever it needs from scratch, and its report is written back into
the parent's context. Independent measurements put Claude Code fan-outs at up
to **5.9× the tokens** of doing the same work single-threaded. Delegation
without a model change is not a saving; it is a multiplier.

## 2. Why this repository is unusually dangerous

| File | Size | Cost if read whole |
|---|---:|---:|
| `social-posts.json` | 1.19 MB | ~350K tokens |
| `ai-discovery.json` | 759 KB | ~215K tokens |
| `knowledge-graph.json` | 580 KB | ~165K tokens |
| `llms.jsonl` | 507 KB | ~145K tokens |
| `index.html` | 374 KB | ~105K tokens |
| `llms-full.txt` | 364 KB | ~105K tokens |

Tracked text across the repo totals **~17.9 MB ≈ 5.1M tokens** — five full
1M-token context windows. Three of the files above, read whole, fill the window
on their own. Once the window is full, auto-compaction runs, and every
subsequent turn re-bills a growing transcript. That is how a single
verification task consumes a weekly allowance: not one expensive call, but the
same megabytes re-billed turn after turn.

## 3. What the state of the art actually does

Five techniques, roughly in order of leverage:

**Tier the models, do not just split the work.** Route search, scanning and
summarising to a small fast model; reserve the frontier model for decisions and
code that ships. Haiku is roughly 15× cheaper per token than Opus, and on work
that needs no deep reasoning the quality gap is negligible. In Claude Code this
is `CLAUDE_CODE_SUBAGENT_MODEL`, or a `model:` line in each agent definition.

**Route at the API layer.** Tools like claude-code-router sit between the CLI
and the model and dispatch by task type — `default` / `background` / `think` /
`longContext` / `webSearch`. Sending the `background` route (file scanning,
indexing, context gathering) to a cheap or local model is the single change
that most reduces spend; `longContext` automatically diverts anything over a
threshold (default 60K tokens) to a large-window model.

**Delegate out of the process entirely.** Every serious coding CLI now has a
headless mode — `grok -p "…"`, `cursor-agent -p "…" --output-format text`,
`codex exec "…"`. Called from Bash, the work bills *that* CLI's quota and only
the summary returns. This is the only mechanism that genuinely moves load off
the Claude subscription, and it is what `scripts/delegate.sh` wraps.

**Do not use a model where code will do.** Checking that 176 JSON files parse,
that sitemaps are well-formed, and that internal links resolve is a decision
problem with a right answer. `scripts/verify-site.sh` answers it in **2
seconds for 0 tokens**. An LLM answering the same question reads megabytes.

**Keep artefacts on disk, not in context.** Sub-processes write full output to
files; the orchestrator reads a tail. Context is the budget — spend it on
decisions, not on transport.

## 4. The machinery in this repo

### `scripts/verify-site.sh` — check first, spend later
```bash
scripts/verify-site.sh              # all checks, ~2s, 0 tokens
scripts/verify-site.sh json links   # named checks only
scripts/verify-site.sh --quiet      # failures only — ideal for CI
```
Exits non-zero on failure and prints a "failures to hand to an agent" list.
Hand an agent that list. Never the repo.

### `scripts/delegate.sh` — bulk work leaves the process
```bash
scripts/delegate.sh --list                              # which engines are installed
scripts/delegate.sh "audit services/*.html for canonical tags"
scripts/delegate.sh -f prompts/audit.md --tail 60
scripts/delegate.sh --write "apply the fixes you proposed"
```
Picks the first available engine from `grok cursor-agent codex gemini`, probes
`--help` so flag differences between versions degrade gracefully, writes the
full transcript to `.delegate/`, and returns only a tail. Exits **3** with
install instructions when no engine is present — a loud failure, because the
silent fallback is exactly the bug this file is about.

### `.claude/hooks/context-guard.sh` — the hard stop
A `PreToolUse` hook that denies any whole-file `Read` over 64 KB, and any
`cat`/`less`/`more` of such a file that is not piped through a limiter. The
denial names the cheap alternative (`jq`, `rg`, an offset/limit read,
`delegate.sh`). Windowed reads always pass. Override a single call with
`CONTEXT_GUARD_MAX_BYTES`.

Verified against this repo: denies `index.html` and `social-posts.json`, allows
`robots.txt`, a windowed `index.html` read, and `cat social-posts.json | head`.

**Activation is a deliberate, one-time step.** Claude Code's auto mode refuses
to let the agent write its own `.claude/settings.json`, so the configuration
ships as a template you install yourself:

```bash
cp docs/claude-settings.example.json .claude/settings.json
```

Open `/hooks` once afterwards (or start a new session) so the settings watcher
picks it up. The template also sets `CLAUDE_CODE_SUBAGENT_MODEL=haiku`, making
Haiku the default for every subagent that does not name its own model, and caps
inline Bash output at 12,000 characters.

## 5. Operating rules

1. Run `verify-site.sh` before asking a model anything about site state.
2. Bulk scanning, auditing and rewriting go through `delegate.sh`.
3. Never read a >64 KB file whole. Survey with `jq 'keys'`, `jq 'length'`, `rg -n`.
4. Reach for the Agent tool only when the work needs Claude-quality judgement —
   and give it an explicit cheap `model`. It is not a route to another vendor.
5. If `delegate.sh` exits 3, stop and install an engine. Do not silently fall
   back to doing the work in-session; that is the original failure.

## Sources

- [Create custom subagents — Claude Code Docs](https://code.claude.com/docs/en/sub-agents)
- [The Subagent Tax: Claude Code Fan-Outs Cost Up to 5.9x the Tokens](https://systima.ai/blog/subagent-tax)
- [Why Claude Code Subagents Burn So Many Tokens](https://youcanbuildthings.com/articles/claude-code-subagents-token-usage/)
- [Claude Code Subagents: A 2026 Practical Guide — Tembo](https://www.tembo.io/blog/claude-code-subagents)
- [Claude Code Router: Multi-Model Routing for Efficient Coding — DataCamp](https://www.datacamp.com/tutorial/claude-code-router)
- [Claude Code Router 2026: Config, Models, Cost Control](https://tokenmix.ai/blog/claude-code-router-guide-2026)
- [Headless & Scripting — xAI Grok Build CLI](https://docs.x.ai/build/cli/headless-scripting)
- [Using Headless CLI — Cursor Docs](https://cursor.com/docs/cli/headless)
