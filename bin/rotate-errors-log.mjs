#!/usr/bin/env node
// ~/.claude/bin/rotate-errors-log.mjs
// Watermark-aware rotation for the pipeline error sink. (V-166)
//
// WHY THIS EXISTS:
//   pipeline/audit/errors.jsonl is append-only with no rotation; left alone it
//   grows past the 256 KB Read ceiling (the V-166 failure). This helper keeps the
//   LIVE sink small by rolling ALREADY-HARVESTED entries into a dated archive once
//   the log crosses a size threshold — invoked from /harvest-pipeline-bugs §7
//   AFTER the watermark advances, so the daily launchd harvest self-maintains.
//
// THE SAFETY INVARIANT (Acceptance #2 — never drop un-harvested entries):
//   The harvest watermark (pipeline/audit/.harvest-watermark, a single ISO ts of
//   the last-harvested entry) is the one correctness key. partition() archives an
//   entry ONLY when it is provably harvested — `ts <= watermark`. Everything else
//   stays LIVE: entries with `ts > watermark` (un-harvested), entries with an
//   unparseable/missing `ts`, and EVERY entry when the watermark is absent. This
//   keep-live-on-doubt polarity is the opposite of read-errors-since.mjs's
//   fail-open reader polarity, and equally deliberate: rotation must never archive
//   (and so hide from the next harvest read) anything it can't prove was harvested.
//
// TOCTOU (documented limitation, not a premise): a concurrent appendFileSync from
//   the hook logger between this helper's read and its atomic rewrite lands on the
//   pre-rename inode and is lost. Mitigated by archive-first (durable) + atomic
//   temp+rename of the live log, leaving a tiny window; the sink is per-machine and
//   low-frequency, so a lockfile isn't worth it at this volume. (Mirrors the
//   logger's own documented retry-success limitation — pipeline/audit/README.md.)
//
// PATH TARGETING: log/watermark/archive resolved relative to THIS file's bin/
//   location via fileURLToPath (not new URL(...).pathname) — always the one
//   canonical checkout's sink, regardless of caller cwd. The dated archive is named
//   errors-<stamp>.jsonl, which matches the /pipeline/audit/*.jsonl gitignore glob,
//   so archives stay gitignored exactly like the live log.
//
// USAGE:
//   node ~/.claude/bin/rotate-errors-log.mjs                       # rotate iff size >= threshold
//   node ~/.claude/bin/rotate-errors-log.mjs --force               # rotate regardless of size
//   node ~/.claude/bin/rotate-errors-log.mjs --threshold-bytes 262144
//
// Exit codes: 0 success OR a deliberate no-op (under threshold / no watermark /
//   nothing harvested to archive / no log). The no-op reasons are printed so the
//   caller sees why nothing rotated (convention 8). Never a silent partial write.

import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Default rotation threshold: 200 KB, comfortably under the 256 KB Read ceiling.
export const DEFAULT_THRESHOLD_BYTES = 200 * 1024;

// This file lives at <root>/bin/; the sink + watermark at <root>/pipeline/audit/.
function auditDir() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline", "audit");
}
export function resolveLogPath() { return join(auditDir(), "errors.jsonl"); }
export function resolveWatermarkPath() { return join(auditDir(), ".harvest-watermark"); }
export function resolveArchivePath(stamp) { return join(auditDir(), `errors-${stamp}.jsonl`); }

// Flag parser. --threshold-bytes <n> overrides the default; --force ignores size.
export function parseFlags(argv) {
  const f = { force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--threshold-bytes") f.thresholdBytes = Number(argv[++i]);
    else if (argv[i] === "--force") f.force = true;
  }
  return f;
}

// Local-time stamp YYYYMMDD-HHMMSS for the archive filename. Pure (now injected).
export function formatStamp(now) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

// Partition log lines against the watermark (ms). Pure — the core safety logic.
// archived = provably harvested (`ts <= watermarkMs`); kept = everything else.
// watermarkMs null/undefined → keep ALL (nothing provably harvested). Blank lines
// are dropped (not entries). Unparseable / no-ts / bad-ts lines are KEPT — never
// archived — so an unclassifiable line is never hidden from the next harvest.
export function partition(lines, watermarkMs) {
  const archived = [], kept = [];
  for (const line of lines) {
    if (line.trim() === "") continue; // not an entry
    if (watermarkMs === null || watermarkMs === undefined) { kept.push(line); continue; }
    let entry;
    try { entry = JSON.parse(line.trim()); } catch { kept.push(line); continue; }
    const ets = entry && typeof entry.ts === "string" ? Date.parse(entry.ts) : NaN;
    if (Number.isNaN(ets)) { kept.push(line); continue; }
    if (ets <= watermarkMs) archived.push(line); else kept.push(line);
  }
  return { archived, kept };
}

function noop(reason) {
  process.stdout.write(`rotate-errors-log: no-op — ${reason}\n`);
  process.exit(0);
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const threshold = Number.isFinite(flags.thresholdBytes) ? flags.thresholdBytes : DEFAULT_THRESHOLD_BYTES;
  const logPath = resolveLogPath();

  if (!existsSync(logPath)) noop("no errors.jsonl yet");
  const size = statSync(logPath).size;
  if (!flags.force && size < threshold) noop(`log ${size}B < threshold ${threshold}B`);

  // Resolve the watermark — the safety key. Absent/empty/unparseable → keep all
  // (nothing provably harvested), so there's nothing safe to archive: no-op.
  const wmPath = resolveWatermarkPath();
  let watermarkMs = null;
  if (existsSync(wmPath)) {
    const raw = readFileSync(wmPath, "utf8").trim();
    const ms = Date.parse(raw);
    if (!Number.isNaN(ms)) watermarkMs = ms;
  }
  if (watermarkMs === null) noop("no usable watermark — nothing provably harvested, keeping all entries live");

  const lines = readFileSync(logPath, "utf8").split("\n");
  const { archived, kept } = partition(lines, watermarkMs);
  if (archived.length === 0) noop("no harvested entries (ts <= watermark) to archive");

  // Archive first (durable), then atomically rewrite the live log with the
  // un-harvested remainder. Each non-empty content gets a trailing newline so the
  // files stay valid JSONL; an empty `kept` truncates the live log to 0 bytes.
  const stamp = formatStamp(new Date());
  const archivePath = resolveArchivePath(stamp);
  writeFileSync(archivePath, archived.join("\n") + "\n");

  const tmpPath = logPath + ".rotate.tmp";
  writeFileSync(tmpPath, kept.length ? kept.join("\n") + "\n" : "");
  renameSync(tmpPath, logPath);

  // Read-back observability (convention 8): what moved where.
  process.stdout.write(
    `rotate-errors-log: archived ${archived.length} harvested entr${archived.length === 1 ? "y" : "ies"} → ${archivePath}; ${kept.length} kept live in ${logPath}\n`
  );
  process.exit(0);
}

// Only run as a CLI, not when imported by the test.
const isMain = process.argv[1] && process.argv[1].endsWith("rotate-errors-log.mjs");
if (isMain) main();
