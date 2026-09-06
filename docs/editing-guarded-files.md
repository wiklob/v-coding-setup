# Editing guarded files — a safe procedure

> Status: Procedure doc · 2026-07-16

Some tickets must change the very files the permission floor protects — the ask/deny
floor itself (e.g. **V-395**, ask-gating `supabase db reset`) or a guard hook's
classification logic (e.g. **V-385**, stop mis-gating a read-only `curl -G` GET). This is
how to do that safely, and why the obvious attempt fails.

## Why it feels impossible

Protection runs in two **name-based, content-blind** layers, enforced in this order:

1. **`permissions.deny` globs** in `settings.json` — `Read(**/*secret*)`,
   `Read(**/*credentials*)`, `Read(.env*)`, `Edit(**/.envrc)`, … A denied `Read` also
   blocks `Edit` (Edit requires a prior Read).
2. **The PreToolUse guard hook** (`bin/guard-sensitive-access.py`) — catches the vectors
   prefix rules structurally can't (interpreter exfil, copy-then-read, redirect writes,
   env dumps, prod-mutating commands buried mid-chain).

Both match on **path/name substrings**, not on whether a file actually holds a secret.
That is correct for real `.env`/`*.pem`/`*credentials*` files. It also means a *source
file whose name merely contains a protected token* gets locked out as a false positive —
the guard hook's own source used to be named `guard-secret-access.py`, so
`Read(**/*secret*)` made the one file you'd edit to change secret-handling un-editable.
(Renamed to `guard-sensitive-access.py` — `sensitive` is not a protected token — so the
collision is gone. Keep it that way: never name a **source** file `*secret*` /
`*credentials*`.)

This is the same failure philosophy as **V-385**: the guard matching a *surface pattern*
that isn't actually a secret operation (inert command text there; a filename here).

## Two problem classes — tell them apart first

- **By-design protection — do NOT bypass.** Real secret data (`.env`, `.envrc`, `*.pem`,
  `*.key`, `*credentials*`), the live `~/.claude/settings.json` (edits escalate/prompt on
  purpose), and anything under the protected `.claude` path. If a ticket seems to need
  one of these edited directly, that's a signal to route *around* it (below), or — for
  real secrets — to hand the action to the human. The floor is not the obstacle; it's the
  spec.
- **False-positive lockout — fixable.** A pipeline **source** file caught only because its
  name matches a protected token. The durable fix is to rename it out of collision; until
  then, use the git hatch.

### Which `settings.json` actually gates (V-667)

The guard's settings gate is scoped to the **installed** file — the one the harness loads,
sitting directly inside a `.claude/` directory (`~/.claude/settings.json`,
`<repo>/.claude/settings{,.local}.json`). Editing that still prompts, on purpose.

A `settings.json` at the **root of a ticket worktree** is *not* that file. This repo *is*
the `.claude` dir, so every checkout carries `settings.json` at its root; that copy is a PR
artifact — it changes nothing until the branch merges, and `/land-ticket` reviews it on the
way (`bin/sensitive-diff-scan` rates any `settings*.json` permission-surface edit **HIGH**).
Gating it bought no security and froze background sessions on a prompt nobody was there to
answer: V-667 measured ~25h of dead time across three V-652 stages, all on that one path.

So: gate the installed path, never "any file named `settings.json`". `is_installed_settings()`
in `bin/guard-sensitive-access.py` is the single decision point — it resolves a relative path
against the hook event's `cwd`, and **fails safe** (gates) when there is no `cwd` to resolve
against. Do not re-widen it.

## The procedure (three rules)

1. **Edit the repo source, never the live install.** The guards are versioned here
   (`settings.example.json` for the floor, `bin/*` for the hooks). `~/.claude/*` are
   `install.sh` copies. Editing source cannot destabilize the running session — the live
   floor changes only when the user re-installs. Always work at the source layer.

2. **Verify empirically — artifact presence is not proof.** After any guard change, run
   the guard's own suite and the decision-matrix test, and confirm the invariant still
   holds *by probe*:
   ```
   bash bin/guard-sensitive-access.test.sh      # 122 vectors: secrets still blocked
   python3 bin/guard-access.test.py             # decision-matrix
   bash bin/probe-claude-gate.sh                # live gate probe
   ```
   A guard that "looks right" but opened a hole is the failure that matters.

3. **For a name-collision source file, use the git hatch.** The deny/guard layers match
   the literal tool call, and `git` object reads are not path-denied:
   - **Read:** `git show HEAD:bin/<file>` — works even when the Read tool is denied.
   - **Rename:** `git mv old new` — preserves history; the hook does not block it.
   - **Write, if the name can't change:** stage the edit as a patch and `git apply
     <patch>` — the target path lives *inside the diff*, never on the Bash command line,
     so the name matcher never sees it.
   Never point Read/Edit/Write, or a `cat`/`cp`/redirect, at a genuinely secret path —
   the hatch is for false-positive **source**, not for real secrets.

## How a floor change reaches the live install

`install.sh` **force-copies** the engine (`bin/`, `commands/`, …) but seeds
`settings.json` **copy-if-absent** — it never clobbers a user's live config. So on an
*existing* install, a `settings.example.json` floor change (a new ask/deny rule, a renamed
hook path) does **not** auto-apply: the user must fold the delta into their live
`~/.claude/settings.json` themselves — a settings edit, which escalates by design. State
this in the PR so the change actually takes effect. (This applies to every floor ticket,
V-395 included, not just renames.)
