#!/usr/bin/env node
// ~/.claude/bin/log-input-request.mjs
// Notification hook (+ manual backstop): append one record per "session paused for
// the human" event to pipeline/audit/input-requests.jsonl — so we can count how often
// a session REQUESTED the user's input, a friction signal nothing else captures. (V-101)
//
// WHY THE Notification EVENT (audit result, V-101):
//   settings.json had NO Notification/Stop hook, so nothing counted input-requests.
//   Claude Code's `Notification` hook fires when the agent is waiting on the human, in
//   two cases we keep DISTINCT:
//     - permission_prompt — the agent needs approval to run a tool. The real
//       "requested input" / friction signal.
//     - idle_prompt       — a turn ended and the agent waits for the next prompt. Often
//       just "user stepped away", NOT a deliberate request — counted SEPARATELY so
//       idle-away noise never inflates the friction number.
//   `Stop` is deliberately NOT used: it fires on EVERY turn-end regardless of whether
//   the human is needed, so it cannot measure input-requests. `AskUserQuestion`
//   (deliberate questions) is ALREADY counted by usage-stats.mjs as a transcript
//   tool-call — a DIFFERENT signal; do not merge the two. (Docs:
//   https://code.claude.com/docs/en/hooks.md — lifecycle table.)
//
// SCHEMA-DEFENSIVE (convention 8 — observe, don't assert; mirrors log-pipeline-error's
//   extractError "docs don't publish the field name"): the Claude Code docs do NOT
//   publish the exact Notification stdin schema, and the new hook cannot be observed
//   live before this branch lands — the worktree's settings.json is not any running
//   session's active config; only ~/.claude/settings.json in the MERGED checkout is. So
//   this logger NEVER hard-codes a field name: classifyType() tries the structured
//   fields that MIGHT carry the permission-vs-idle distinction (notification_type /
//   type / subtype / matcher / notificationType), falls back to a regex over `message`,
//   and the record carries `raw_keys` + the redacted message so the FIRST real fire
//   SELF-DOCUMENTS the true schema for a later one-line tightening of the classifier.
//
// SECRET SAFETY: `message` can in principle carry a path/arg, so it is passed through
//   redact() before being written. raw_keys records key NAMES only (never values).
//
// CONTRACT: best-effort telemetry. Registered on a GLOBAL event that fires for EVERY
//   session, so it must NEVER disrupt one — every path is wrapped and it ALWAYS exits 0.
//
// MODES:
//   hook   (default) — reads the Notification JSON payload on stdin (fd 0).
//   manual (flags)   — backfill / test harness:
//     node ~/.claude/bin/log-input-request.mjs --type permission_prompt [--session <id>] [--message <m>]
//
// Exit codes: always 0 (passive logger — must never block a session).

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { redact } from "./transcript-resolver.mjs";
import { originFromCwd, activeCommandFromTranscript } from "./log-pipeline-error.mjs";

// Repo-rooted sink: this file lives at <root>/bin/, log at <root>/pipeline/audit/.
// fileURLToPath (not new URL(...).pathname) so a space / non-ASCII char in an ancestor
// dir doesn't percent-encode the path and silently misdirect every write. The sink
// pattern pipeline/audit/*.jsonl is already gitignored (.gitignore), so the data file
// is never committed — only this script + its test are tracked.
const LOG_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline", "audit", "input-requests.jsonl");

// --- type classification (schema-defensive) ------------------------------------
// Prefer a structured field if the payload carries one; else read the human-readable
// `message`; else "unknown". Returns one of permission_prompt | idle_prompt | <observed
// structured value> | unknown — never throws.
export function classifyType(p) {
  if (!p || typeof p !== "object") return "unknown";
  const structured =
    p.notification_type ?? p.type ?? p.subtype ?? p.matcher ?? p.notificationType;
  if (typeof structured === "string" && structured) {
    const s = structured.toLowerCase();
    if (s.includes("permission")) return "permission_prompt";
    if (s.includes("idle")) return "idle_prompt";
    return s; // record whatever structured value arrived — self-documents the schema
  }
  const msg = typeof p.message === "string" ? p.message.toLowerCase() : "";
  if (/permission|approve|approval|needs your|wants to|allow/.test(msg)) return "permission_prompt";
  if (/waiting|idle|your input|step(ped)? away/.test(msg)) return "idle_prompt";
  return "unknown";
}

// Build the JSONL record. `nowIso` is injected so the function is pure/testable.
// `raw_keys` (sorted top-level key names of the payload) is the convention-8
// self-documentation: the first real Notification records the ACTUAL schema, so a
// follow-up can tighten classifyType against ground truth rather than an assertion.
export function buildRecord(p, nowIso) {
  const payload = p && typeof p === "object" ? p : {};
  return {
    ts: nowIso,
    session: payload.session_id ?? null,
    type: classifyType(payload),
    activeCommand: payload.activeCommand ?? activeCommandFromTranscript(payload.transcript_path) ?? null,
    origin: originFromCwd(payload.cwd ?? null),
    message: typeof payload.message === "string" ? redact(payload.message) : null,
    raw_keys: Object.keys(payload).sort(),
  };
}

function appendRecord(rec) {
  const line = JSON.stringify(rec) + "\n";
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  appendFileSync(LOG_PATH, line);
}

// --- manual mode (backfill / test) ---------------------------------------------
function parseFlags(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--type") f.type = argv[++i];
    else if (a === "--session") f.session = argv[++i];
    else if (a === "--message") f.message = argv[++i];
  }
  return f;
}

// Pure record builder for the manual path — the analogue of buildRecord (hook path).
export function manualRecord(flags, nowIso) {
  return {
    ts: nowIso,
    session: flags.session ?? process.env.CLAUDE_SESSION_ID ?? null,
    type: flags.type ?? "unknown",
    activeCommand: null,
    origin: originFromCwd(process.cwd()),
    message: typeof flags.message === "string" ? redact(flags.message) : null,
    raw_keys: [],
  };
}

function runManual(flags, nowIso) {
  if (!flags.type) return; // nothing to log; stay silent
  appendRecord(manualRecord(flags, nowIso));
}

function runHook(nowIso) {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return; // no / non-JSON stdin — nothing to log
  }
  // Every Notification is a countable event (both types are wanted) — no noise filter.
  appendRecord(buildRecord(payload, nowIso));
}

function main() {
  const nowIso = new Date().toISOString();
  const argv = process.argv.slice(2);
  if (argv.includes("--type")) runManual(parseFlags(argv), nowIso);
  else runHook(nowIso);
}

// Only run as a CLI/hook, not when imported by the test.
const isMain = process.argv[1] && process.argv[1].endsWith("log-input-request.mjs");
if (isMain) {
  try {
    main();
  } catch {
    /* never disrupt a session */
  }
  process.exit(0);
}
