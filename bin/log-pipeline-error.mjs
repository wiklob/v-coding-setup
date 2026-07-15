#!/usr/bin/env node
// ~/.claude/bin/log-pipeline-error.mjs
// PostToolUseFailure + PermissionDenied hook (and manual backstop): append every
// GENUINE pipeline tool error to pipeline/audit/errors.jsonl — wrong/failed tool
// calls, permission denials, missing commands/files, MCP/API failures — so the
// pipeline's rough edges are visible and fixable. (V-55)
//
// WHY THESE EVENTS, NOT PostToolUse:
//   Claude Code's `PostToolUse` fires ONLY after a tool call SUCCEEDS. Genuine
//   errors surface on two sibling events:
//     - PostToolUseFailure — a tool call failed (non-zero Bash, MCP/API error,
//       file/command not found).
//     - PermissionDenied   — the auto-mode classifier denied a call.
//   So this logger is registered on those two, not literal PostToolUse (which
//   would log only successes — useless for error capture). Denials from a
//   PreToolUse-deny / manual reject / deny-rule fire NO hook and are out of scope.
//   (Docs: https://code.claude.com/docs/en/hooks — lifecycle table.)
//
// SIGNAL, NOT FIREHOSE: a noise filter drops expected control-flow non-zero exits
//   (grep/rg/diff no-match, `--dry-run` probes, `|| true`, user interrupts).
//   Retry-successes (fail-then-succeed) cannot be filtered from a single failure
//   event — the retry hasn't happened yet; that's a documented limitation,
//   reconciled downstream, never silently dropped (see pipeline/audit/README.md).
//
// SECRET SAFETY: tool_input (e.g. a Bash command) can carry a token, so it is
//   passed through redact() (imported from transcript-resolver.mjs) before being
//   written. The audit log is secret-redacted by construction.
//
// CONTRACT: best-effort telemetry. Runs on every tool failure, so it must NEVER
//   disrupt a session — every path is wrapped and it ALWAYS exits 0.
//
// MODES:
//   hook   (default) — reads the hook JSON payload on stdin (fd 0).
//   manual (flags)   — the behavioral backstop: a command that detects its own
//     semantic error appends a line itself, naming itself as activeCommand:
//       node ~/.claude/bin/log-pipeline-error.mjs --command <self> --error <msg> [--tool <t>] [--session <id>] [--ticket <ID>]
//     --ticket stamps a direct ticket-attribution field (V-234) so a downstream
//     join (the scorecard) can attach the finding to its ticket without the
//     finding→session→usage-stats indirection.
//
// TRACE HANDLES: every record carries `session` (the run) and `conversation` (the
//   resume-chain root — the thread the run belongs to; stable across follow-ups and
//   compaction). Both are resolved without needing CLAUDE_SESSION_ID, which the
//   daemon/FleetView launch path does NOT export: the session id is read from the
//   job's state.json and the conversation is walked from resumeSessionId links.
//   These let /harvest-pipeline-bugs cite where a bug was spotted, traceable via
//   /ingest-convo. (resolveSessionId / resolveConversationId.)
//
// Exit codes: always 0 (passive logger — must never block a tool or a session).

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { redact } from "./transcript-resolver.mjs";
import { resolveSessionId, resolveConversationId } from "./session-identity.mjs";

// Repo-rooted log path: this file lives at <root>/bin/, log at <root>/pipeline/audit/.
// fileURLToPath (not new URL(...).pathname) so a space / non-ASCII char in an
// ancestor dir doesn't percent-encode the path and silently misdirect every write.
const LOG_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline", "audit", "errors.jsonl");

// --- error extraction (defensive: docs don't publish the failure field name) ---
// Try the documented-ish shapes in order, fall back to stringifying the payload
// so an unexpected shape still logs *something* rather than dropping the error.
export function extractError(p) {
  if (typeof p.error === "string" && p.error) return p.error;
  if (typeof p.reason === "string" && p.reason) return p.reason; // PermissionDenied
  const r = p.tool_response;
  if (typeof r === "string" && r) return r;
  if (r && typeof r === "object") {
    if (typeof r.stderr === "string" && r.stderr.trim()) return r.stderr.trim();
    if (typeof r.error === "string" && r.error) return r.error;
    try {
      return JSON.stringify(r);
    } catch {
      /* fall through */
    }
  }
  return `${p.hook_event_name ?? "unknown-event"} on ${p.tool_name ?? "unknown-tool"}`;
}

// Best-effort exit code, for refining the Bash benign-exit heuristic.
function exitCodeOf(p) {
  const cands = [p.exit_code, p.tool_response?.exit_code, p.tool_response?.exitCode, p.code];
  for (const c of cands) if (Number.isInteger(c)) return c;
  const m = String(p.error ?? "").match(/exit(?:ed with)?\s*(?:code|status)\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

// Bash commands whose non-zero exit is normal control flow, not a genuine error.
function looksBenignBash(cmd, exitCode) {
  if (typeof cmd !== "string") return false;
  if (/--dry-run\b/.test(cmd)) return true;
  if (/\|\|\s*true\b/.test(cmd)) return true; // failure explicitly tolerated
  if (/^\s*(test|\[)\s/.test(cmd)) return true; // `test`/`[ ]` conditionals
  // no-match-style tools exit 1 by design; treat exit 1 (or unknown) as benign,
  // but keep a different non-zero (e.g. grep bad-regex exit 2) as a genuine error.
  if (/\b(grep|egrep|fgrep|rg|diff|cmp)\b/.test(cmd) && (exitCode === 1 || exitCode === null)) return true;
  return false;
}

// The noise filter. Returns true when the payload is a genuine error worth logging.
export function shouldLog(p) {
  if (!p || typeof p !== "object") return false;
  const event = p.hook_event_name;
  // PermissionDenied is always genuine (an actual denial occurred).
  if (event === "PermissionDenied") return true;
  // Only failure events carry errors; a stray PostToolUse (success) is never logged.
  if (event && event !== "PostToolUseFailure") return false;
  // User interrupts are not pipeline errors.
  if (p.is_interrupt || p.tool_response?.interrupted) return false;
  // Expected control-flow non-zero exits from Bash.
  if (p.tool_name === "Bash") {
    const cmd = p.tool_input?.command;
    if (looksBenignBash(cmd, exitCodeOf(p))) return false;
  }
  return true;
}

// Render tool_input compactly and redacted (never a raw secret in the log).
function redactedInput(toolInput) {
  if (toolInput == null) return undefined;
  let s;
  try {
    s = typeof toolInput === "string" ? toolInput : JSON.stringify(toolInput);
  } catch {
    s = String(toolInput);
  }
  return redact(s);
}

// Best-effort: the active slash-command, scanned from the tail of the live
// transcript. The hook payload carries no "current command" field, so this is
// null when not derivable. (Manual mode sets it explicitly instead.)
// Exported so sibling Notification/telemetry hooks (e.g. log-input-request.mjs,
// V-101) share the one implementation instead of re-deriving it.
export function activeCommandFromTranscript(transcriptPath) {
  if (!transcriptPath) return null;
  try {
    const text = readFileSync(transcriptPath, "utf8");
    const matches = [...text.matchAll(/<command-name>\s*\/?([A-Za-z0-9_-]+)\s*<\/command-name>/g)];
    return matches.length ? matches[matches.length - 1][1] : null;
  } catch {
    return null;
  }
}

// Best-effort origin: the repo the error fired in, recorded as triage CONTEXT,
// NOT a routing key (V-88 — the whole sink is pipeline-subject and files into the
// one shared `bugs` bucket regardless of origin). Walk up from cwd to the nearest
// entry named `.git` and return the originating repo's basename:
//   - `.git` is a DIR (normal checkout) → basename of that dir.
//   - `.git` is a FILE (git worktree) → it reads `gitdir: <main>/.git/worktrees/<name>`,
//     so resolve back to the MAIN repo root (`<main>`) and return its basename — NOT
//     the managed worktree dir's slug (`repo-wt-v-88`). Pipeline commands run inside
//     per-ticket worktrees, so without this every entry's origin would be a worktree
//     slug instead of the repo it belongs to.
// Falls back to the cwd's own basename when no `.git` is found. Never throws and
// never spawns a subprocess — the logger's always-exit-0 contract must hold on
// every tool failure.
export function originFromCwd(cwd) {
  if (typeof cwd !== "string" || !cwd) return null;
  try {
    let dir = cwd;
    for (;;) {
      const gitPath = join(dir, ".git");
      if (existsSync(gitPath)) {
        if (statSync(gitPath).isFile()) {
          const m = readFileSync(gitPath, "utf8").match(/gitdir:\s*(.+)/);
          const mainRoot = m && m[1].trim().replace(/[/\\]\.git[/\\].*$/, "");
          if (mainRoot) return basename(mainRoot) || null;
        }
        return basename(dir) || null;
      }
      const parent = dirname(dir);
      if (parent === dir) break; // reached the filesystem root
      dir = parent;
    }
    return basename(cwd) || null;
  } catch {
    return null;
  }
}

// Build the JSONL record. `nowIso` is injected so the function is pure/testable.
export function buildRecord(p, nowIso) {
  const session = p.session_id ?? null;
  const rec = {
    ts: nowIso,
    session,
    conversation: resolveConversationId(session),
    activeCommand: p.activeCommand ?? activeCommandFromTranscript(p.transcript_path) ?? null,
    origin: originFromCwd(p.cwd ?? null),
    tool: p.tool_name ?? null,
    error: redact(extractError(p)),
  };
  const input = redactedInput(p.tool_input);
  if (input !== undefined) rec.input = input;
  return rec;
}

function appendRecord(rec) {
  const line = JSON.stringify(rec) + "\n";
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  appendFileSync(LOG_PATH, line);
}

// --- manual mode (the behavioral backstop) ---
function parseFlags(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--command") f.command = argv[++i];
    else if (a === "--error") f.error = argv[++i];
    else if (a === "--tool") f.tool = argv[++i];
    else if (a === "--session") f.session = argv[++i];
    else if (a === "--ticket") f.ticket = argv[++i];
  }
  return f;
}

// Record builder for the manual path — the analogue of buildRecord (hook path).
// Exported so session/conversation resolution is unit-testable without spawning.
export function manualRecord(flags, nowIso) {
  // Explicit --session wins; else CLAUDE_SESSION_ID; else the daemon job's state.json
  // (CLAUDE_JOB_DIR). The job-state fallback is the fix for the long-standing
  // session:null on /report-bug — in the bg/FleetView daemon CLAUDE_SESSION_ID is
  // unset, so the old env-only read recorded null on every manual entry (V-81 fixed
  // the explicit-flag case; this covers the front door that passes no flag).
  const session = resolveSessionId(flags);
  return {
    ts: nowIso,
    session,
    conversation: resolveConversationId(session),
    activeCommand: flags.command ?? null,
    // V-234: optional direct ticket attribution. When a command knows the ticket it
    // is emitting findings for (e.g. /review-session at /land §8.6, invoked with
    // --ticket <ID>), stamp it here so the scorecard can join the finding to its
    // ticket DIRECTLY — mirroring how the tool-fit / produced-review sinks join on a
    // `ticket` field — instead of the fragile finding→session→usage-stats indirection
    // (which missed 0/9 live). Absent → null; the hook path never sets it.
    ticket: flags.ticket ?? null,
    origin: originFromCwd(process.cwd()),
    tool: flags.tool ?? "manual",
    error: redact(flags.error),
  };
}

function runManual(flags, nowIso) {
  // A manual call is genuine by definition — no filter. Requires --error.
  if (!flags.error) return; // nothing to log; stay silent
  appendRecord(manualRecord(flags, nowIso));
}

function runHook(nowIso) {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return; // no / non-JSON stdin — nothing to log
  }
  if (!shouldLog(payload)) return;
  appendRecord(buildRecord(payload, nowIso));
}

function main() {
  const nowIso = new Date().toISOString();
  const argv = process.argv.slice(2);
  if (argv.includes("--command") || argv.includes("--error")) runManual(parseFlags(argv), nowIso);
  else runHook(nowIso);
}

// Only run as a CLI/hook, not when imported by the test.
const isMain = process.argv[1] && process.argv[1].endsWith("log-pipeline-error.mjs");
if (isMain) {
  try {
    main();
  } catch {
    /* never disrupt a session */
  }
  process.exit(0);
}
