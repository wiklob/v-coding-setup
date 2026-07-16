#!/usr/bin/env python3
"""PreToolUse authoring guard — surface a loud warning (ask) when a GitHub Actions
workflow file is authored/edited with a DESTRUCTIVE `supabase db` step, BEFORE the
push that would run it silently in CI (V-395).

Why this exists (V-395, originating incident CB-379): the interactive permission floor
already ask-gates `supabase db push` / `supabase db reset` — but that gate is a Claude
PreToolUse hook, so it fires only for commands a Claude session runs. A command written
INTO a CI workflow file runs later inside GitHub Actions, where no PreToolUse hook or
settings ask-rule can ever apply. CB-379: a newly-authored `validate` workflow ran
`supabase db reset` on a branch push and alarmed the user — it fired silently in CI
because authoring it triggered no prompt. This hook closes that gap at the earliest,
cheapest moment: it fires at AUTHORING time (the Write/Edit that adds the step), so the
human sees it BEFORE the git push that would land it in CI.

What it asks on — a Write/Edit/MultiEdit whose target is a GitHub Actions workflow file
(`.github/workflows/*.yml` / `*.yaml`, non-nested — GitHub ignores workflows in
subdirectories) whose incoming CONTENT contains a destructive `supabase db` verb
(`reset` or `push`) or `sb-push --apply`. These are the drops/recreates that mutate a
database; `db dump`/`diff`/`pull` are non-destructive and are NOT flagged.

Why ASK, not DENY: authoring a workflow that resets an EPHEMERAL CI Postgres is a
legitimate pattern (the CB-379 command itself only hit a throwaway CI DB). The failure
was that it happened SILENTLY, not that it happened. So the guard surfaces it loudly and
lets the human confirm — visibility, not prohibition.

Scope boundary (honest, V-395 thesis-check): this catches an inline `run:` step in the
workflow YAML — the CB-379 vector — not a workflow that shells out to a `bin/*` script
that itself contains the command (scanning every authored file for the string would
false-positive on docs, tests, and the guards themselves). The inline step is the primary
vector; the boundary is documented, not hidden.

Content-blind twin: the runtime `guard-sensitive-access.py` gates the same commands when a
Claude session RUNS them; this hook gates them when a session AUTHORS them into CI. Two
guards, one destructive-`supabase db` notion, agreeing.

Safety: FAILS OPEN. Any parse/logic error → exit 0 (allow, no output). A convenience guard
must never brick a legitimate Write/Edit.
"""
import sys, os, re, json

# A workflow file GitHub Actions actually runs: directly under .github/workflows/, .yml/.yaml.
# Nested paths are intentionally excluded — GitHub ignores workflows in subdirectories, so
# covering them would be dead code.
_WORKFLOW_RE = re.compile(r"(?:^|/)\.github/workflows/[^/]+\.ya?ml$", re.IGNORECASE)

# Destructive `supabase db` verbs (drops/recreates), plus the sb-push --apply wrapper.
_DESTRUCTIVE_DB_RE = re.compile(r"\bsupabase\s+db\s+(reset|push)\b", re.IGNORECASE)
_SB_PUSH_APPLY_RE = re.compile(r"\bsb-push\b[^\n]*--apply\b", re.IGNORECASE)


def allow_noop():
    sys.exit(0)


def ask(reason):
    sys.stdout.write(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "ask",
        "permissionDecisionReason": reason,
    }}) + "\n")
    sys.exit(0)


def incoming_content(tool_name, ti):
    """The text about to be written to the file, per tool. Write→content;
    Edit→new_string; MultiEdit→every edit's new_string joined."""
    if tool_name == "Write":
        return ti.get("content") or ""
    if tool_name == "Edit":
        return ti.get("new_string") or ""
    if tool_name == "MultiEdit":
        edits = ti.get("edits") or []
        return "\n".join(
            (e.get("new_string") or "") for e in edits if isinstance(e, dict))
    return ""


def destructive_hit(content):
    m = _DESTRUCTIVE_DB_RE.search(content)
    if m:
        return "supabase db " + m.group(1).lower()
    if _SB_PUSH_APPLY_RE.search(content):
        return "sb-push --apply"
    return None


def run():
    raw = sys.stdin.read()
    event = json.loads(raw) if raw.strip() else {}
    tool_name = event.get("tool_name", "")
    if tool_name not in ("Write", "Edit", "MultiEdit"):
        allow_noop()
    ti = event.get("tool_input", {}) or {}
    path = ti.get("file_path") or ti.get("path") or ""
    if not isinstance(path, str) or not _WORKFLOW_RE.search(path):
        allow_noop()                       # not a workflow file → not our business

    content = incoming_content(tool_name, ti)
    if not isinstance(content, str) or not content:
        allow_noop()

    verb = destructive_hit(content)
    if verb is None:
        allow_noop()                       # no destructive supabase db step → allow

    ask(
        "This workflow file (" + os.path.basename(path) + ") adds a destructive `" + verb
        + "` step. It will run inside GitHub Actions on push — where no interactive gate "
        "can prompt — so it would fire SILENTLY in CI (V-395 / CB-379). Confirm you intend "
        "to author this. Destructive `supabase db` (reset/push) drops or mutates a database; "
        "if it targets an ephemeral CI Postgres that is fine, but it must not be a surprise. "
        "This gate fires at authoring time, before the push that would trigger it."
    )


try:
    run()
except SystemExit:
    raise                                  # allow_noop()/ask() must propagate
except Exception:
    sys.exit(0)                            # FAIL OPEN — never brick a legitimate Write/Edit
