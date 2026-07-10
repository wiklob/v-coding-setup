#!/usr/bin/env node
// ~/.claude/bin/log-linear-call.mjs
// PostToolUse hook: append one record per SUCCESSFUL Linear MCP call to
// pipeline/audit/linear-calls.jsonl, giving the wrapper's byte savings a
// SESSION dimension the server-side /stats byte-log structurally lacks. (V-305)
//
// WHY THIS EXISTS:
//   The wrapper is a shared-bearer HTTP server — it cannot see the Claude session
//   id, so its /stats byte-log (V-143) is session-anonymous. But the SESSION side
//   knows both: a PostToolUse hook fires with `session_id` AND the returned
//   payload (`tool_response`). So we capture, per session+tool, the wrapper's
//   downstream byte count here; `bin/linear-savings.mjs` multiplies those by the
//   per-tool vs-hosted ratios (probe-vs-hosted) to estimate per-session savings.
//
// WHY PostToolUse (not PostToolUseFailure): PostToolUse fires only on SUCCESS, and
//   a successful call is the one with a real payload to measure. Failed Linear
//   calls carry no useful payload and are already captured by log-pipeline-error
//   on PostToolUseFailure. So this logger records successes only (status "ok").
//
// SECRET SAFETY: we store the byte COUNT and metadata (tool, session, status),
//   NEVER the payload content — so no credential can land in this log by
//   construction. (Contrast log-pipeline-error, which redacts tool_input.)
//
// CONTRACT: best-effort telemetry; runs on every Linear call, so it must NEVER
//   disrupt a session — every path is wrapped and it ALWAYS exits 0.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSessionId, resolveConversationId } from "./session-identity.mjs";
import { originFromCwd } from "./log-pipeline-error.mjs";

// Repo-rooted log path: this file lives at <root>/bin/, log at <root>/pipeline/audit/.
// fileURLToPath (not new URL(...).pathname) so a space / non-ASCII ancestor dir
// doesn't percent-encode the path and silently misdirect every write. Registered
// by its ABSOLUTE ~/.claude path in settings.json, so worktree cwds still write
// the one global log.
const LOG_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline", "audit", "linear-calls.jsonl");

const LINEAR_PREFIX = "mcp__linear__";

/** Bytes of the returned payload — measured off the MCP text envelope
 *  (`{ content: [{ type, text }], isError? }`), mirroring instrument.ts'
 *  downstreamBytesOf so the session-side count matches the server-side one.
 *  Defensive across shapes: array-of-content, string, or arbitrary object. */
export function responseBytes(toolResponse) {
  try {
    if (toolResponse == null) return 0;
    if (typeof toolResponse === "string") return Buffer.byteLength(toolResponse);
    const content = toolResponse.content;
    if (Array.isArray(content)) {
      let n = 0;
      for (const item of content) {
        const text = item && item.text;
        n += typeof text === "string" ? Buffer.byteLength(text) : Buffer.byteLength(JSON.stringify(item ?? null));
      }
      return n;
    }
    return Buffer.byteLength(JSON.stringify(toolResponse));
  } catch {
    return 0;
  }
}

/** True only for a successful Linear MCP tool call worth recording. */
export function shouldLog(p) {
  if (!p || typeof p !== "object") return false;
  const ev = p.hook_event_name;
  if (ev && ev !== "PostToolUse") return false; // successes only; failures handled elsewhere
  if (typeof p.tool_name !== "string" || !p.tool_name.startsWith(LINEAR_PREFIX)) return false;
  return true;
}

/** Build the JSONL record. `nowIso` injected so the function is pure/testable. */
export function buildRecord(p, nowIso) {
  const session = p.session_id ?? resolveSessionId({}) ?? null;
  const r = p.tool_response;
  const status = r && typeof r === "object" && r.isError ? "error" : "ok";
  return {
    ts: nowIso,
    session,
    conversation: resolveConversationId(session),
    tool: p.tool_name.slice(LINEAR_PREFIX.length), // store the bare tool name
    bytes: responseBytes(r),
    status,
    origin: originFromCwd(p.cwd ?? null),
  };
}

function appendRecord(rec) {
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  appendFileSync(LOG_PATH, JSON.stringify(rec) + "\n");
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

const isMain = process.argv[1] && process.argv[1].endsWith("log-linear-call.mjs");
if (isMain) {
  try {
    runHook(new Date().toISOString());
  } catch {
    /* never disrupt a session */
  }
  process.exit(0);
}
