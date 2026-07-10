#!/usr/bin/env node
// ~/.claude/bin/read-errors-since.mjs
// Streaming post-watermark reader for the pipeline error sink. (V-166)
//
// WHY THIS EXISTS:
//   pipeline/audit/errors.jsonl is append-only and unbounded; it has crossed the
//   Read tool's 256 KB ceiling, so /harvest-pipeline-bugs §1's whole-file `Read`
//   of the log fails outright (File content (NNN KB) exceeds maximum allowed size
//   (256KB)). Harvest only needs the entries newer than its watermark, so this
//   helper STREAMS the log line-by-line (readline, never a whole-file load) and
//   emits only the JSONL entries with `ts > <since>` to stdout. Harvest §1 calls
//   it instead of Read, so it never trips the ceiling regardless of log size.
//
//   Run via Bash (`node ~/.claude/bin/read-errors-since.mjs …`) it is covered by
//   the blanket `Bash(node ~/.claude/bin/*.mjs)` allow rule — prompt-free, unlike
//   an inline `node -e`.
//
// FAIL-OPEN (reader polarity): a line that is blank is skipped, but a line that
//   does NOT parse as JSON, or carries no/garbage `ts`, is EMITTED. For a reader,
//   the safe failure is to over-emit (harvest dedupes downstream), never to
//   silently drop a real entry from harvest's view. (Rotation's helper has the
//   OPPOSITE, equally-correct polarity: keep-live on doubt, never archive what it
//   can't prove is harvested.)
//
// PATH TARGETING: log + watermark are resolved relative to THIS file's bin/
//   location via fileURLToPath (not new URL(...).pathname, so a space/non-ASCII
//   ancestor dir doesn't percent-encode the path) — always the one canonical
//   checkout's sink, regardless of caller cwd.
//
// USAGE:
//   node ~/.claude/bin/read-errors-since.mjs --since 2026-06-06T07:00:00.000Z
//   node ~/.claude/bin/read-errors-since.mjs        # --since omitted → .harvest-watermark, else epoch (all)
//
// Exit codes: always 0 (a reader must not block harvest; a missing log → emit
//   nothing). Output: the kept lines, verbatim, one JSONL entry per line.

import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This file lives at <root>/bin/; the sink + watermark at <root>/pipeline/audit/.
export function resolveLogPath() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline", "audit", "errors.jsonl");
}
export function resolveWatermarkPath() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline", "audit", ".harvest-watermark");
}

// Flag parser. Only --since is meaningful.
export function parseFlags(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--since") f.since = argv[++i];
  }
  return f;
}

// Resolve the cutoff (ms). Precedence: explicit --since → watermark file → epoch.
// Pure — the watermark file's content is injected so the function stays testable.
// An absent/empty/unparseable cutoff resolves to -Infinity (emit everything) —
// the reader's fail-open polarity: when in doubt, over-emit, never under-emit.
export function resolveSinceMs(sinceFlag, watermarkContent) {
  let candidate;
  if (typeof sinceFlag === "string" && sinceFlag.trim() !== "") candidate = sinceFlag.trim();
  else if (typeof watermarkContent === "string" && watermarkContent.trim() !== "") candidate = watermarkContent.trim();
  if (candidate === undefined) return -Infinity;
  const ms = Date.parse(candidate);
  return Number.isNaN(ms) ? -Infinity : ms;
}

// Decide whether a single log line should be emitted. Pure.
// - blank line → false (not an entry)
// - unparseable JSON / no `ts` / garbage `ts` → true (fail-open: never drop a real entry)
// - well-formed → ts > sinceMs
export function keepEntry(line, sinceMs) {
  const t = line.trim();
  if (t === "") return false;
  let entry;
  try { entry = JSON.parse(t); } catch { return true; }
  if (!entry || typeof entry.ts !== "string") return true;
  const ets = Date.parse(entry.ts);
  if (Number.isNaN(ets)) return true;
  return ets > sinceMs;
}

async function main() {
  const { since } = parseFlags(process.argv.slice(2));
  const wmPath = resolveWatermarkPath();
  let watermarkContent;
  if (since === undefined && existsSync(wmPath)) {
    try { watermarkContent = readFileSync(wmPath, "utf8"); } catch { /* fall through to epoch */ }
  }
  const sinceMs = resolveSinceMs(since, watermarkContent);

  const logPath = resolveLogPath();
  if (!existsSync(logPath)) process.exit(0); // no sink yet → nothing to emit

  const rl = createInterface({ input: createReadStream(logPath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (keepEntry(line, sinceMs)) process.stdout.write(line + "\n");
  }
  process.exit(0);
}

// Only run as a CLI, not when imported by the test.
const isMain = process.argv[1] && process.argv[1].endsWith("read-errors-since.mjs");
if (isMain) main();
