#!/usr/bin/env node
// ~/.claude/bin/check-skill-staleness.mjs
// Detect STALE skill execution — warn the model when its injected slash-command
// text predates the on-disk command files. (V-99)
//
// WHY THIS EXISTS:
//   Custom slash-command / skill bodies are injected into the conversation ONCE,
//   at invocation time, and are NEVER re-read from disk during the session. So a
//   long-running / resumed / parallel `/go` run keeps executing the frozen text it
//   was launched with — even after a sibling run lands a PR that fixes the very
//   command file it's mid-executing. That session re-introduces already-banned
//   patterns (the pre-V-75 audit-flush heredoc; the V-74 hardcoded `cd`).
//
//   A prose fix to a command file (V-75's heredoc removal) CANNOT reach an
//   in-flight session — it only changes what FUTURE invocations inject. The only
//   repo mechanism that bites a session already carrying stale text is a HOOK:
//   it runs from settings.json on disk every session-start / prompt, regardless of
//   what prose the session is carrying. That is exactly why V-74's hook-level guard
//   DID catch its stale `cd` while V-75's prose-only fix kept recurring. This helper
//   generalizes the V-74 property from "one banned pattern" to "any drift": it
//   DETECTS staleness and tells the model, in model-visible additionalContext, to
//   re-read the on-disk command before continuing. See docs/stale-skill-execution.md.
//
// WIRING (settings.json):
//   - SessionStart  → record/refresh the baseline canonical HEAD on startup|clear;
//                     check + warn on resume|compact.
//   - UserPromptSubmit → check + warn each user turn.
//   (PreToolUse is deliberately NOT used — it cannot emit model-visible
//    additionalContext, only a permission decision. The continuous mid-autonomous-run
//    gap that a PostToolUse wiring would close is documented + deferred in the doc.)
//
// COMPARE AGAINST THE CANONICAL ~/.claude CHECKOUT, never the worktree:
//   Slash commands resolve from ~/.claude/commands/ regardless of cwd, and sibling
//   `/go` runs land their fixes into the canonical checkout's `main`. REPO_ROOT is
//   resolved relative to THIS file's bin/ location (via fileURLToPath, so a space or
//   non-ASCII ancestor dir doesn't percent-encode and misdirect) — so the git
//   comparison always targets the canonical checkout, whatever the caller's cwd.
//
// CONTRACT: best-effort telemetry, mirrors capture-session.mjs. Runs on EVERY
//   session start + user prompt, so it must NEVER disrupt — every path is wrapped,
//   it ALWAYS exits 0, and it emits a warning ONLY on confirmed drift. It writes only
//   non-secret identifiers (commit hashes, session id) to a sidecar.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// This file lives at <canonical-root>/bin/.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_DIR = join(REPO_ROOT, "run", "skill-baseline");

// The injectable surface: a stale session's frozen text is a slash-command body
// (commands/*.md). workflow-conventions.md is re-read fresh at runtime by skills, but
// some skills inline-quote its rules, so it's watched too as cheap defense-in-depth.
const WATCHED_PREFIXES = ["commands/"];
const WATCHED_FILES = ["workflow-conventions.md"];

// --- pure helpers (imported by the test; no I/O) ---

// Parse the hook JSON payload. Returns the fields we branch on.
export function parsePayload(stdinStr) {
  let p;
  try {
    p = JSON.parse(stdinStr);
  } catch {
    return null;
  }
  return {
    event: p.hook_event_name ?? null,
    source: p.source ?? null, // SessionStart only: startup|resume|clear|compact
    sessionId: p.session_id ?? null,
    cwd: p.cwd ?? null,
  };
}

// Keep only the changed paths that belong to the injectable surface.
export function filterWatched(changedFiles) {
  return changedFiles.filter(
    (f) => WATCHED_PREFIXES.some((p) => f.startsWith(p)) || WATCHED_FILES.includes(f)
  );
}

// Pure decision: warn iff both HEADs are known, they differ, a watched file moved,
// and we haven't already warned for this exact current HEAD (dedup → one warning per
// new drift, not per turn).
export function decide({ baseHead, curHead, lastWarnedHead, changedWatched }) {
  const warn =
    !!baseHead &&
    !!curHead &&
    baseHead !== curHead &&
    Array.isArray(changedWatched) &&
    changedWatched.length > 0 &&
    curHead !== lastWarnedHead;
  return { warn };
}

// The model-visible warning text. Pure.
export function buildWarning(changedWatched, baseHead, curHead) {
  const files = changedWatched.join(", ");
  const short = (h) => (h ? h.slice(0, 8) : "?");
  return (
    `⚠️ STALE-SKILL RISK: ${changedWatched.length} command file(s) changed on disk ` +
    `since this session started (canonical ~/.claude ${short(baseHead)} → ${short(curHead)}): ${files}. ` +
    `Your injected slash-command text predates these changes and is NOT auto-refreshed. ` +
    `Before executing any further phase or gate, re-read the relevant on-disk file with Read ` +
    `(e.g. ~/.claude/${changedWatched[0]}) and follow the DISK version over your injected memory.`
  );
}

// The exact hook-output envelope. additionalContext is read by the model for
// SessionStart and UserPromptSubmit. Pure.
export function buildHookOutput(event, additionalContext) {
  return { hookSpecificOutput: { hookEventName: event, additionalContext } };
}

// --- I/O (only runs as a CLI) ---

function git(args) {
  try {
    return execFileSync("git", ["-C", REPO_ROOT, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function sidecarPath(sessionId) {
  return join(BASELINE_DIR, `${sessionId}.json`);
}

function readSidecar(sessionId) {
  try {
    return JSON.parse(readFileSync(sidecarPath(sessionId), "utf8"));
  } catch {
    return null;
  }
}

function writeSidecar(sessionId, record) {
  try {
    mkdirSync(BASELINE_DIR, { recursive: true });
    writeFileSync(sidecarPath(sessionId), JSON.stringify(record, null, 2) + "\n");
  } catch {
    /* best-effort */
  }
}

function changedWatchedBetween(baseHead, curHead) {
  if (!baseHead || !curHead || baseHead === curHead) return [];
  const out = git(["diff", "--name-only", baseHead, curHead]);
  if (out === null) return [];
  const files = out.split("\n").map((s) => s.trim()).filter(Boolean);
  return filterWatched(files);
}

function emit(event, ctx) {
  process.stdout.write(JSON.stringify(buildHookOutput(event, ctx)) + "\n");
}

function main() {
  let payload;
  try {
    payload = parsePayload(readFileSync(0, "utf8"));
  } catch {
    return; // no/!JSON stdin
  }
  if (!payload || !payload.sessionId) return; // can't key a baseline without it

  const { event, source, sessionId } = payload;
  const curHead = git(["rev-parse", "HEAD"]);
  if (!curHead) return; // not a usable git checkout — skip silently

  // startup|clear → (re)baseline a fresh session; no warning possible yet.
  if (event === "SessionStart" && (source === "startup" || source === "clear")) {
    writeSidecar(sessionId, { baseHead: curHead, lastWarnedHead: null });
    return;
  }

  // resume|compact + every UserPromptSubmit → check drift against the baseline.
  const sc = readSidecar(sessionId);
  if (!sc || !sc.baseHead) {
    // First time we observe this session (e.g. it predates the hook) — record a
    // baseline now. We can't recover past drift, but future drift is caught.
    writeSidecar(sessionId, { baseHead: curHead, lastWarnedHead: null });
    return;
  }

  const changedWatched = changedWatchedBetween(sc.baseHead, curHead);
  const { warn } = decide({
    baseHead: sc.baseHead,
    curHead,
    lastWarnedHead: sc.lastWarnedHead ?? null,
    changedWatched,
  });
  if (!warn) return;

  emit(event, buildWarning(changedWatched, sc.baseHead, curHead));
  writeSidecar(sessionId, { baseHead: sc.baseHead, lastWarnedHead: curHead });
}

const isMain = process.argv[1] && process.argv[1].endsWith("check-skill-staleness.mjs");
if (isMain) {
  try {
    main();
  } catch {
    /* never disrupt session start / prompt submit */
  }
  process.exit(0);
}
