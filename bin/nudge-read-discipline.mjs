#!/usr/bin/env node
// ~/.claude/bin/nudge-read-discipline.mjs
// PostToolUse hook on `Read` — make the read-discipline knob BITE. (V-267)
//
// WHY THIS EXISTS:
//   The `read-discipline` knob (pipeline/profiles/opus-4-8.md) is advisory prose:
//   "prefer offset/limit; route bulk reads through a subagent digest." Advice in a
//   profile file may or may not be in a given session's context, and nothing happens
//   when a whole large file is read (and re-read) anyway — CB-284's build spent 438.7k
//   Read tokens (44% of context) on whole-file re-reads. This hook makes the advice
//   MECHANICAL: after a large *whole-file* Read, it injects a just-in-time,
//   model-visible reminder to read only the needed slice or use a subagent digest.
//
// WHY PostToolUse (not PreToolUse):
//   Only SessionStart / UserPromptSubmit / PostToolUse can emit model-visible
//   `additionalContext`; PreToolUse cannot (only a permission decision + stderr),
//   per docs/stale-skill-execution.md:36,40. PostToolUse is the one mid-run channel,
//   and it sees the read's ACTUAL result — so the nudge fires on what was really read.
//   It fires AFTER the read, so it steers FUTURE reads / re-reads (the dominant waste),
//   not the read that just happened; the first read's cost is bounded by the harness's
//   own 25k-token Read ceiling + the per-build footprint meter (bin/read-footprint.mjs).
//
// WHY a NUDGE, not a block/inject:
//   Blocking a whole-file read breaks legitimate full reads and duplicates the 25k
//   ceiling; silently injecting a `limit` would make the model believe it saw a whole
//   file it only partly read (convention 8: observed != intended). A non-blocking,
//   model-visible reminder changes behavior without either failure mode.
//
// CONTRACT: best-effort, NEVER disrupts a read. Every path is wrapped; it ALWAYS
//   exits 0 and emits at most one additionalContext line, only on a confirmed large
//   whole-file read. Fails open (silent) on any parse/size error.

import { statSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

// Threshold in approx tokens (bytes/4). A whole-file read whose result is at least
// this large earns a nudge. Default 15000 — below the harness 25k Read ceiling, above
// routine small-file reads. Override with READ_NUDGE_TOKENS.
const DEFAULT_THRESHOLD_TOKENS = 15000;
const BYTES_PER_TOKEN = 4; // rough heuristic, matches the ~62.7k-token/250k-byte 25k-ceiling failures

export function thresholdTokens(env = process.env) {
  const n = Number(env.READ_NUDGE_TOKENS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_THRESHOLD_TOKENS;
}

export function estimateTokens(bytes) {
  return Math.round((bytes || 0) / BYTES_PER_TOKEN);
}

/** Bytes of a Read result, defensive across the shapes a tool_response can take
 *  (string, MCP `{content:[{text}]}` envelope, `{text}`, or arbitrary object) —
 *  mirrors log-linear-call.mjs' responseBytes. Returns null when unmeasurable. */
export function readResultBytes(toolResponse) {
  try {
    if (toolResponse == null) return null;
    if (typeof toolResponse === "string") return Buffer.byteLength(toolResponse);
    if (typeof toolResponse.text === "string") return Buffer.byteLength(toolResponse.text);
    const content = toolResponse.content;
    if (Array.isArray(content)) {
      let n = 0;
      for (const item of content) {
        const text = item && item.text;
        n += typeof text === "string"
          ? Buffer.byteLength(text)
          : Buffer.byteLength(JSON.stringify(item ?? null));
      }
      return n;
    }
    return Buffer.byteLength(JSON.stringify(toolResponse));
  } catch {
    return null;
  }
}

/** File size in bytes for a whole-file read, as a shape-independent fallback when the
 *  result isn't measurable. Resolves a relative path against the hook's cwd. Null on error. */
export function fileBytes(filePath, cwd) {
  try {
    if (!filePath) return null;
    const abs = isAbsolute(filePath) ? filePath : resolve(cwd || process.cwd(), filePath);
    return statSync(abs).size;
  } catch {
    return null;
  }
}

/** Pure decision. `sizeBytes` = the best available size of what was read (result bytes,
 *  else file bytes). Nudge only a Read that (a) passed neither offset nor limit — a
 *  whole-file read — and (b) is at/over the token threshold. */
export function decideNudge({ toolName, toolInput, sizeBytes, thresholdTok }) {
  if (toolName !== "Read") return { nudge: false };
  const ti = toolInput || {};
  const hasWindow = ti.offset != null || ti.limit != null;
  if (hasWindow) return { nudge: false }; // discipline already followed
  if (sizeBytes == null) return { nudge: false }; // couldn't size → fail open, stay silent
  const tokens = estimateTokens(sizeBytes);
  return { nudge: tokens >= thresholdTok, tokens };
}

/** The model-visible reminder. Pure. */
export function buildNudge(filePath, tokens) {
  return (
    `Read discipline: \`${filePath}\` was read whole (~${tokens.toLocaleString()} tokens, ` +
    `no offset/limit). For a large file, read only the section you need (offset/limit), or ` +
    `route a bulk/exploratory read through a subagent digest so the finding comes back, not ` +
    `the file dump. This avoids re-paying the whole-file cost on every later turn ` +
    `(read-discipline knob, pipeline/profiles/opus-4-8.md).`
  );
}

/** The exact PostToolUse hook-output envelope (mirrors check-skill-staleness.mjs). Pure. */
export function buildHookOutput(additionalContext) {
  return { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } };
}

// --- I/O (only runs as a CLI) ---

function main() {
  let payload;
  try {
    payload = JSON.parse(readAllStdin());
  } catch {
    return; // no / non-JSON stdin — nothing to do
  }
  if (!payload || typeof payload !== "object") return;
  const ev = payload.hook_event_name;
  if (ev && ev !== "PostToolUse") return; // wired to PostToolUse; ignore anything else

  const toolInput = payload.tool_input || {};
  const filePath = String(toolInput.file_path || toolInput.path || "");
  // Prefer the actual result size; fall back to the file's size for a whole-file read.
  const sizeBytes =
    readResultBytes(payload.tool_response) ?? fileBytes(filePath, payload.cwd);

  const { nudge, tokens } = decideNudge({
    toolName: payload.tool_name,
    toolInput,
    sizeBytes,
    thresholdTok: thresholdTokens(),
  });
  if (!nudge) return;

  process.stdout.write(JSON.stringify(buildHookOutput(buildNudge(filePath, tokens))) + "\n");
}

function readAllStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith("nudge-read-discipline.mjs");
if (isMain) {
  try {
    main();
  } catch {
    /* never disrupt a Read */
  }
  process.exit(0);
}
