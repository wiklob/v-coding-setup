#!/usr/bin/env node
// ~/.claude/bin/schedule-brief.mjs
// Registry-driven daily morning brief — recaps every scheduled routine's last run. (V-306)
//
// WHY THIS EXISTS:
//   The scheduled-routine fleet (feedback harvest, bug harvest, and this brief) was
//   only discoverable implicitly, by naming convention. This brief makes the fleet
//   legible from one place: it reads the committed registry
//   (pipeline/schedule-registry.json) and, for each routine, parses that routine's
//   own plain-text run log for its LAST run's outcome. It is REGISTRY-DRIVEN — it
//   iterates whatever the registry lists, so a routine added to the registry
//   surfaces here with NO edit to this file (the encoded proof is
//   bin/schedule-brief.test.mjs, which injects a synthetic entry and asserts it
//   appears). The brief itself is registered too (schedule 09:27), so its own run is
//   recapped the next morning.
//
//   Deliberately NOT an LLM pass (no `claude -p`, no skill): the recap is pure log
//   parsing with no judgment content, so a plain `node` run is cheaper and has no
//   extra failure surface. bin/schedule-brief-runner.sh is the launchd wrapper.
//
// LOG FORMAT CONTRACT (mirrors the harvest logs verbatim): each run appends a
//   heartbeat line `=== <name> fired <ISO-ts> (pid N) ===` (emitted by the runner
//   before it execs the work), then free-form output, ending — on success — in a
//   greppable `result: …` summary line. A run that fired but crashed (e.g. an API
//   error) leaves the heartbeat with NO trailing `result:` line. So the last run's
//   outcome is: last heartbeat's ts + the last `result:` after it (ok), or the
//   heartbeat with no result (failed/incomplete), or no heartbeat at all (never run).
//
// PATH TARGETING: the registry and every routine log are resolved relative to THIS
//   file's bin/ location via fileURLToPath (not new URL(...).pathname) — always the
//   one canonical checkout's files, regardless of caller cwd. Registry `log` paths
//   are repo-relative (e.g. "pipeline/audit/harvest.log").
//
// USAGE:  node ~/.claude/bin/schedule-brief.mjs      # prints the brief to stdout
// Exit codes: always 0 (a read-only recap must not fail the launchd run; a missing
//   registry or log degrades to a "never run" / empty-fleet line, never a throw).

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function resolveRegistryPath() {
  return join(ROOT, "pipeline", "schedule-registry.json");
}

// Minute-precision local stamp for the brief header. `now` injected → pure/testable.
export function formatStamp(now) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;
}

// Parse a routine's log text → its LAST run's outcome. Pure.
//   { firedAt, result, status }  where status ∈ ok | failed | never-run
// - no recognizable heartbeat (empty/garbage log)      → never-run
// - last heartbeat present, no `result:` after it       → failed  (fired but crashed)
// - last heartbeat + a trailing `result:` line          → ok
export function parseLastRun(logText) {
  if (typeof logText !== "string" || logText.trim() === "") {
    return { firedAt: null, result: null, status: "never-run" };
  }
  const heartbeatRe = /^=== .*? fired (\S+).*===\s*$/gm;
  let m;
  let last = null;
  while ((m = heartbeatRe.exec(logText)) !== null) {
    last = { endIndex: m.index + m[0].length, firedAt: m[1] };
  }
  if (!last) return { firedAt: null, result: null, status: "never-run" };
  const tail = logText.slice(last.endIndex);
  const results = [...tail.matchAll(/^result:\s*(.*)$/gm)];
  if (results.length === 0) return { firedAt: last.firedAt, result: null, status: "failed" };
  return { firedAt: last.firedAt, result: results[results.length - 1][1].trim(), status: "ok" };
}

// Truncate a log at the in-flight heartbeat whose timestamp === excludeFiredAt, so the
// brief reading its OWN log mid-run reports its last COMPLETED run — not this run, whose
// `result:` line has not been written yet. Without this the brief misreports itself as
// failed/incomplete every morning (it is the one routine that reads a log while that log
// is being appended to by its own run). No-op when excludeFiredAt is null or absent from
// the log, so it only ever affects the brief's own log — the sole log carrying a
// heartbeat with this exact run timestamp (the runner passes it as --exclude-heartbeat).
export function stripInFlight(logText, excludeFiredAt) {
  if (!excludeFiredAt || typeof logText !== "string") return logText;
  const re = new RegExp(`^=== .*? fired ${escapeRe(excludeFiredAt)}.*===\\s*$`, "m");
  const m = re.exec(logText);
  return m ? logText.slice(0, m.index) : logText;
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Build the brief's lines from a registry + a log reader. Pure over injected
// `readLog(relPath) → string` and `now`. `excludeFiredAt` (the current run's heartbeat
// ts, passed by the runner) strips the brief's own in-flight run from its self-recap.
// Ends with a `result:` summary line so the brief's own run log is itself parseable by
// parseLastRun next morning.
export function recap(registry, readLog, now, excludeFiredAt = null) {
  const lines = [`# Morning brief — scheduled routines — ${formatStamp(now)}`];
  if (!Array.isArray(registry) || registry.length === 0) {
    lines.push("Registry is empty — no scheduled routines registered.");
    lines.push("");
    lines.push("result: schedule-brief — recapped 0 routine(s): registry empty.");
    return lines;
  }
  lines.push(`Registry: ${registry.length} routine(s).`, "");
  let ok = 0;
  let failed = 0;
  let never = 0;
  for (const r of registry) {
    const { firedAt, result, status } = parseLastRun(stripInFlight(readLog(r.log), excludeFiredAt));
    if (status === "ok") {
      ok++;
      lines.push(`- ${r.name} (${r.schedule}) — last fired ${firedAt}: ${result}`);
    } else if (status === "failed") {
      failed++;
      lines.push(`- ${r.name} (${r.schedule}) — ⚠ fired ${firedAt} but no result line (failed/incomplete run)`);
    } else {
      never++;
      lines.push(`- ${r.name} (${r.schedule}) — never run (no log entry at ${r.log})`);
    }
  }
  lines.push("");
  lines.push(
    `result: schedule-brief — recapped ${registry.length} routine(s): ${ok} ok, ${failed} failed/incomplete, ${never} never-run.`,
  );
  return lines;
}

// Read the registry file → array (missing/empty/garbage → []). Fail-open.
export function loadRegistry(path) {
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function main() {
  const args = process.argv.slice(2);
  const ei = args.indexOf("--exclude-heartbeat");
  const excludeFiredAt = ei !== -1 ? (args[ei + 1] ?? null) : null;
  const registry = loadRegistry(resolveRegistryPath());
  const readLog = (rel) => {
    const p = join(ROOT, rel);
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  };
  const lines = recap(registry, readLog, new Date(), excludeFiredAt);
  process.stdout.write(lines.join("\n") + "\n");
  process.exit(0);
}

// Only run as a CLI, not when imported by the test.
const isMain = process.argv[1] && process.argv[1].endsWith("schedule-brief.mjs");
if (isMain) main();
