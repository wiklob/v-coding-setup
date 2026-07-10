#!/usr/bin/env python3
"""PreToolUse authoring guard — reject a hand-authored / round-number / non-monotonic
migration filename in supabase/migrations/, routing authoring through `sb-new` (V-330).

Why this exists (V-330): the V-31 collision-free minting (`bin/sb-new`) is opt-in — nothing
forces a migration to be created through it. Parallel `edit`-style worktrees hand-authored
round-number `…000000` filenames, so two branches produced the SAME YYYYMMDDHHMMSS prefix
(the PK in schema_migrations); git merged both files cleanly, every PR showed MERGEABLE, and
the collision only detonated at `db push` / `db reset`. This hook makes the prevention half
enforceable at AUTHORING time — the earliest, cheapest moment to catch it — and, because it
lives in the global ~/.claude/settings.json, it fires in client repos too (item 5 reach).

It is the authoring-time complement to migration-collision-check (land + CI) and sb-push's
push-time guard: three guards, one 14-digit-prefix notion (${base:0:14}), agreeing.

What it denies — NEW-FILE CREATION ONLY (the load-bearing distinction, V-330 thesis-check):
  A Write/Edit whose target is a supabase/migrations/*.sql path that does NOT yet exist, when
  its 14-digit prefix is EITHER
    • round-number …000000 (HHMMSS == 000000 — the hand-authored signature), OR
    • not strictly greater than every OTHER migration already on disk (the monotonicity
      `sb-new` guarantees) — computed over the OTHERS, excluding the target.
  The deny points the author at `sb-new`, which mints a collision-free monotonic prefix.

What it NEVER denies (why the new-vs-existing split is essential):
  An Edit/Write to an ALREADY-EXISTING migration file. `sb-new` writes only a STUB (via Bash
  `cat >`), then the author EDITS that file to add DDL — and the just-minted stub IS the local
  max, so a naive `prefix <= max` would deny the second half of the very flow this hook
  promotes. So an edit of an existing migration is ALWAYS allowed; the `<= max` rule is a
  CREATION guard, not an edit guard. (The empty-dir FIRST migration has no "others" → the
  non-monotonic branch is a no-op there; only the round-number branch can fire.)

Safety: FAILS OPEN. Any parse/logic error, or a non-14-digit / unparseable prefix, → exit 0
(allow, no output). A convenience guard must never brick a legitimate Write/Edit; the land
(migration-collision-check) and CI checks are the diff-driven backstop for anything it lets by.
"""
import sys, os, re, json

_MIG_RE = re.compile(r"(?:^|/)supabase/migrations/[^/]+\.sql$")
_PREFIX14_RE = re.compile(r"^([0-9]{14})")


def allow_noop():
    sys.exit(0)


def deny(reason):
    sys.stdout.write(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}) + "\n")
    sys.exit(0)


def prefix14(basename):
    m = _PREFIX14_RE.match(basename)
    return m.group(1) if m else None


def other_prefixes(migdir, target_basename):
    """Max-of-others: the 14-digit prefixes of every OTHER .sql in migdir (excluding the
    target). Missing dir / no siblings → empty (the empty-dir-first-migration case)."""
    out = []
    try:
        entries = os.listdir(migdir)
    except OSError:
        return out
    for name in entries:
        if name == target_basename or not name.endswith(".sql"):
            continue
        p = prefix14(name)
        if p:
            out.append(p)
    return out


def run():
    raw = sys.stdin.read()
    event = json.loads(raw) if raw.strip() else {}
    if event.get("tool_name", "") not in ("Write", "Edit", "MultiEdit"):
        allow_noop()
    ti = event.get("tool_input", {}) or {}
    path = ti.get("file_path") or ti.get("path") or ""
    if not isinstance(path, str) or not _MIG_RE.search(path):
        allow_noop()                       # not a migration file → not our business

    # NEW-VS-EXISTING: the guard fires only on creation of a not-yet-on-disk file.
    # An edit of an existing migration (incl. the sb-new stub's DDL edit) is always allowed.
    if os.path.lexists(path):
        allow_noop()

    basename = os.path.basename(path)
    p = prefix14(basename)
    if p is None:
        allow_noop()                       # no 14-digit prefix → can't judge; fail open

    # (a) round-number …000000 — the hand-authored signature (HHMMSS == 000000).
    if p.endswith("000000"):
        deny(
            "Hand-authored round-number migration prefix " + p + " in " + basename + ". "
            "Round-number …000000 timestamps collide across parallel worktrees (V-330). "
            "Create migrations with `sb-new <name>` — it mints a collision-free monotonic "
            "timestamp (V-330 migration-collision guard)."
        )

    # (b) non-monotonic — not strictly greater than every OTHER existing migration.
    others = other_prefixes(os.path.dirname(path), basename)
    if others:
        mx = max(others)
        if p <= mx:                        # zero-padded 14-digit strings compare correctly
            deny(
                "Non-monotonic migration prefix " + p + " in " + basename + " — it is not "
                "greater than the latest existing migration (" + mx + "), so it would sort "
                "at/before it and can collide. Create migrations with `sb-new <name>`, which "
                "mints max(now, latest+1s) (V-330 migration-collision guard)."
            )
    allow_noop()


try:
    run()
except SystemExit:
    raise                                  # allow_noop()/deny() must propagate
except Exception:
    sys.exit(0)                            # FAIL OPEN — never brick a legitimate Write/Edit
