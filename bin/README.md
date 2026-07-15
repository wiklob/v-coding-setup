# ~/.claude/bin — global skill helpers

Deterministic helpers that slash-command skills (`~/.claude/commands/*.md`) call instead of composing mega-pipelines in Bash. The point: each helper is **one** allowlisted Bash invocation. Skills get prompt-free execution; the user gets transparent, reviewable scripts.

## When to add a helper here

Add a helper when a skill needs to do work that's:

- **Stateful** — a polling loop with sleep, a multi-step deterministic procedure.
- **Pipeline-heavy** — `jq | sed | find | head` style; the matcher refuses pipelines as a single allow.
- **Reused across sessions** — same logic every time, no per-invocation reasoning.

**Don't** add a helper for one-off logic, judgment calls, or anything that benefits from Claude reading and adapting. Use the skill itself for that.

## File-naming convention

Descriptive verb-noun. Prefix with the owning skill only when the bare name is generic enough to collide with a future helper.

Current files:

- `wait-for-check.mjs` — /land-ticket §6.7 (CI poll). Name is specific; no prefix.
- `usage-stats.mjs` — /land-ticket §8.5 (session token dump). Name is specific; no prefix.
- `transcript-resolver.mjs` — ticket → all sessions, secret-redacted reader (V-26). The shared discovery+read primitive for post-session review (V-5) and §8.5 stats (V-1/V-20/V-21). Name is specific; no prefix. See "transcript-resolver contract" below.
- `session-review.mjs` — the V-5 post-session review ENGINE. Streams a resolved transcript once and emits a two-lens report: Lens A (repetitive-call mining → Script/Allow/Deny-or-Ask buckets, feeds V-4/V-23) and Lens B (correctness-flag *candidates* — failed-then-claimed, error-swallow, doc-asserts-state; never verdicts, per the V-25 "don't over-automate" caveat). Reuses `discoverPrimary` (usage-stats.mjs) for resolution and `redact` (transcript-resolver.mjs) for safety — every emitted byte is redacted, tool-result bodies never printed. The *written* SOP is `pipeline/review-standard.md` (V-25). Auto-allowlisted by `Bash(node ~/.claude/bin/*.mjs)`.
- `ensure-envrc.sh` — shared (SessionStart hook + /next-ticket). No prefix because no owner.
- `dev-server-port.sh` — `/land-ticket` §4.9 worktree-aware port selection + listener-cwd verification; prevents a visual-verification handoff from silently serving another worktree.
- `bootstrap-worktree-perms.sh` — SessionStart hook (pre-existing).
- `sb-mgmt` — Supabase Management API verb (bare verb; writes ask-gated). See "Bare-verb helpers" below.
- `pr-health` — PR status rollup (bare verb; pure read). Wired into /land-ticket §2 + /bulk-fix.
- `sb-push` — migration preview / gated apply (bare verb; `--apply` ask-gated). Wired into /land-ticket §4/§6.
- `sb-new` — mint a collision-free, monotonic migration filename (bare verb; authoring only — no prod mutation, no network). Prevention complement to `sb-push`'s push-time guard. See V-31.
- `conflict-scan` — merge-conflict-marker scan (bare verb; pure read).
- `pr-close-guard` — rejects closing magic-words (`Closes/Fixes/Resolves <ID>`) in a PR body (bare verb; pure read). Wired into /land-ticket §0 + §1. See V-14.
- `log-pipeline-error.mjs` — `PostToolUseFailure` + `PermissionDenied` hook (and manual backstop) that appends genuine tool errors to `pipeline/audit/errors.jsonl` (V-55). Reuses `redact` (transcript-resolver.mjs) so the log can't become a secret sink. Auto-allowlisted by the blanket `Bash(node ~/.claude/bin/*.mjs)`. See "Hooks" below + `pipeline/audit/README.md`.
- `log-gate-audit.mjs` — sanctioned append path for `/go`'s cross-run gate-audit friction map `pipeline/audit/gate-audit.md` (V-75). Flag-driven (`--ticket/--outcome/--pd/--intervened/--forced/--gate…`); stamps the block, `mkdirSync`s the dir inline (no `mkdir` prompt), appends to the **canonical** checkout (path resolved relative to `bin/`, so it writes the source-of-truth ledger even when `/go`'s §6 flush runs post-teardown in the shared checkout). Replaces the old heredoc `cat >>` append (convention-7 violation). Auto-allowlisted by the blanket `Bash(node ~/.claude/bin/*.mjs)`. See `commands/go.md` §4.

If a second skill needed its own CI-wait with different semantics, rename to `land-wait-for-check.mjs` + `<other>-wait-for-check.mjs`. Rule of thumb: don't prefix prophylactically.

`.mjs` for Node (uses standard lib only — no npm deps), `.sh` for shell, **no extension for bare-verb helpers** (`sb-mgmt`, `pr-health`, `sb-push`, `sb-new`, `conflict-scan`, `pr-close-guard` — see below). Pick by what fits the task.

## Allowlist patterns

The two patterns in `~/.claude/settings.json` that cover the `*.mjs` / `*.sh` helpers here:

```json
"Bash(node ~/.claude/bin/*.mjs)",
"Bash(bash ~/.claude/bin/*.sh)"
```

Any `*.mjs`/`*.sh` helper following the naming convention is automatically allowlisted — no settings.json edit needed. **The bare-verb helpers are the exception** (next section): they are deliberately *not* covered by these blanket patterns, so that per-verb allow/ask rules can gate them precisely.

## Bare-verb helpers (the V-23 carve-out for V-4)

`sb-mgmt`, `pr-health`, `sb-push`, `sb-new`, `conflict-scan`, `pr-close-guard` are invoked as **bare verbs** (`sb-mgmt GET config/auth`), not `bash ~/.claude/bin/sb-mgmt.sh …`. Two requirements follow:

1. **`~/.claude/bin` must be on `PATH`** — `export PATH="$HOME/.claude/bin:$PATH"` in **`~/.zprofile`**, *not* `~/.zshrc`. The Claude Code Bash tool runs a **login, non-interactive** zsh, which sources `~/.zprofile` but **not** `~/.zshrc` (the latter is interactive-only) — so a `~/.zshrc` export never reaches pipeline Bash calls and the bare verb stays unresolved (exit-127). Guard it so re-sourcing won't bloat PATH: `case ":$PATH:" in *":$HOME/.claude/bin:"*) ;; *) export PATH="$HOME/.claude/bin:$PATH" ;; esac`. Add it to `~/.zshrc` too if you want it in interactive terminals. The harness snapshots env at session start, so a fresh edit only takes effect in a new session (verify in-place with `zsh -lc 'source ~/.zprofile; which pr-close-guard'`). Without it the bare verb doesn't resolve and the rules below don't match — the scripts still run via full path, just un-gated. (V-115)
2. **Per-verb rules in `settings.json`** (human-applied per V-4 — the blanket `bash ~/.claude/bin/*.sh` pattern can't distinguish a read GET from a prod-mutating PATCH):

```json
// allow
"Bash(sb-mgmt GET:*)", "Bash(pr-health:*)", "Bash(sb-push --dry-run:*)", "Bash(sb-new:*)",
"Bash(conflict-scan:*)", "Bash(pr-close-guard:*)", "Bash(jq:*)",
"Bash(node ~/.claude/bin/wait-for-check.mjs:*)", "Bash(node ~/.claude/bin/usage-stats.mjs:*)"
// ask
"Bash(sb-mgmt PATCH:*)", "Bash(sb-mgmt POST:*)", "Bash(sb-mgmt PUT:*)", "Bash(sb-push --apply:*)"
```

Why bare verbs at all, now that `settings.json` carries a broad `Bash(*)` allow? Because the value is the **ask** side: a bare verb is the only clean target for `ask Bash(sb-mgmt PATCH:*)` / `ask Bash(sb-push --apply:*)`. Wrapping `supabase db push` inside `sb-push` would otherwise *bypass* the existing `ask Bash(supabase db push*)` gate — the `--dry-run`/`--apply` split + the `--apply` ask rule restore it.

## transcript-resolver contract (V-26)

The stable interface that V-1/V-20/V-21 (§8.5 stats) and V-5/V-25 (review SOP) consume. Two verbs, both auto-allowlisted by the blanket `Bash(node ~/.claude/bin/*.mjs)` pattern — no per-verb rule needed. The point (V-4 angle): raw `grep`/`python3` over `~/.claude/projects/*.jsonl` is secret-laden and stays denied; this verb redacts every emitted byte, so it is the *sanctioned* read path.

```
node ~/.claude/bin/transcript-resolver.mjs resolve <TICKET> [--json] [--limit N]
node ~/.claude/bin/transcript-resolver.mjs read <TICKET|sessionId|path> [--session id] [--grep p] [--excerpt[=N]] [--json]
```

- **`resolve`** — scans **every** `~/.claude/projects/*` dir, ranks sessions by **mention count** (content-match wins; recency is a tiebreaker only, so the >5-min staleness trap never gates correctness). Emits metadata only (session id, project dir, count, timestamps, redacted first-user snippet) — never a transcript body. `--json` for machine consumption; `--limit` to cap rows.
- **`read`** — locates the target (a ticket → its top-ranked session unless `--session`/path pins one). **Zero-context by default**: prints only a structured summary (message/tool-call counts, time span). Opt-in body access is **best-effort redacted** (env-var names kept, values masked — the same secret classes the deny-list knows): `--grep <pat>` prints matching message lines, `--excerpt[=N]` prints the first N (default 40) message-text lines. Tool-result bodies are never emitted (that's where leaked secrets live), keeping the read safe-by-construction. Redaction masks structured assignments (`KEY=val`, JSON pairs), bearer tokens, prefix-tagged tokens (`sbp_`/`sk-`/`ghp_`/`xox*`/`AKIA`/JWT), and opaque runs ≥32 chars; a short, unstructured, prefix-less secret embedded in prose can still slip through — treat the output as low-risk, not certified secret-free.

Exit codes: `0` success · `1` no sessions found / unreadable / fs error · `3` bad args. Tested by `transcript-resolver.test.mjs` (redaction classes + whole-token matching).

## Hooks

Helpers can also serve as SessionStart hooks (event-triggered, not skill-triggered). Currently:

- `bootstrap-worktree-perms.sh` — writes per-worktree edit-scope `settings.local.json`.
- `ensure-envrc.sh` — symlinks `.envrc` from main worktree if missing.

Both wired in `~/.claude/settings.json` under `hooks.SessionStart`.

- `log-pipeline-error.mjs` — wired under `hooks.PostToolUseFailure` + `hooks.PermissionDenied` (NOT `PostToolUse`, which fires only on success). Passive logger: reads the hook payload on stdin, applies a noise filter, appends genuine errors to `pipeline/audit/errors.jsonl`, always exits 0. Also runs in manual mode (`--command/--error/--tool` flags) as the behavioral backstop for semantic errors no hook can observe. See `pipeline/audit/README.md`.

## Distinction from other layers

| Layer | Lives in | Triggered by | Reasoning per call? |
|---|---|---|---|
| Slash-command skill | `~/.claude/commands/*.md` | User types `/foo` | Yes — Claude reads the .md, adapts. |
| SessionStart hook | `~/.claude/bin/*.sh` | Session starts | No — deterministic shell. |
| Skill helper | `~/.claude/bin/*.{mjs,sh}` | Skill calls it via Bash | No — deterministic. |
| In-repo build script | `<repo>/scripts/*.{mjs,sh,js}` | Skill or user (`Bash(node scripts/*)`) | No — deterministic, repo-scoped. |

This dir is for the **global** deterministic layer. Per-repo deterministic logic goes in the repo's `scripts/` dir, not here.

## Exit codes

Every Node helper exits with explicit, documented codes (in the header comment). Skills branch on the exit code — never grep the script's stdout.

Convention:
- `0` — success
- `1` — domain failure (caller's input was right; the world said no)
- `2` — soft failure (timeout, retry-worthy)
- `3` — bad args / unrecoverable internal error
