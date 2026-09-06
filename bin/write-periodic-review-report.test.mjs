#!/usr/bin/env node
// Tests for write-periodic-review-report.mjs (V-446).
// Run: node bin/write-periodic-review-report.test.mjs   (exit 0 = pass, 1 = fail)
//
// Covers: --date validation, the stdin→file write, cwd-independence (mirroring the
// log-audit-record.mjs CLI test's isolated-install-dir pattern — never touches the
// real ~/.claude checkout), and — acceptance item 2 — an EMPIRICAL check that
// guard-sensitive-access.py does not block the sanctioned invocation, run as a real
// subprocess against the guard, not asserted from source inspection.

import { resolveReportPath, parseFlags, writeReport } from "./write-periodic-review-report.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, realpathSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

let fails = 0;
function check(name, cond) {
  console.log(`[${cond ? "ok" : "FAIL"}] ${name}`);
  if (!cond) fails++;
}

const here = dirname(fileURLToPath(import.meta.url));

// --- resolveReportPath: strict --date validation ---
{
  const p = resolveReportPath("2026-08-24");
  check("resolveReportPath accepts YYYY-MM-DD, names periodic-review-<date>.md", p.endsWith("/pipeline/audit/periodic-review-2026-08-24.md"));
}
for (const bad of [undefined, "", "2026-8-24", "08-24-2026", "2026/08/24", "2026-08-24T00:00:00Z", 20260824]) {
  let threw = false;
  try {
    resolveReportPath(bad);
  } catch {
    threw = true;
  }
  check(`resolveReportPath rejects malformed --date (${JSON.stringify(bad)})`, threw);
}

// --- writeReport: content required, mkdir idempotent, overwrite on re-run ---
{
  const dir = mkdtempSync(join(tmpdir(), "wprr-write-"));
  try {
    const target = join(dir, "nested", "periodic-review-2026-08-24.md");
    writeReport(target, "# Periodic review — 2026-08-24\nfirst\n");
    check("writeReport creates parent dirs + writes content", readFileSync(target, "utf8") === "# Periodic review — 2026-08-24\nfirst\n");
    writeReport(target, "# Periodic review — 2026-08-24\nsecond (re-run)\n");
    check("a re-run for the same date OVERWRITES (idempotent retry)", readFileSync(target, "utf8") === "# Periodic review — 2026-08-24\nsecond (re-run)\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
for (const blank of ["", "   \n"]) {
  let threw = false;
  try {
    writeReport(join(tmpdir(), "wprr-should-not-exist.md"), blank);
  } catch {
    threw = true;
  }
  check(`writeReport rejects empty/whitespace-only content (${JSON.stringify(blank)})`, threw);
}

// --- parseFlags ---
{
  const f = parseFlags(["--date", "2026-08-24"]);
  check("parseFlags reads --date", f.date === "2026-08-24");
}

// --- CLI end-to-end: an isolated "install" dir, invoked from an unrelated foreign cwd
// (mirrors log-audit-record.test.mjs) — proves the write is global/cwd-independent and
// exercises the real stdin path, not just the exported pure functions. ---
{
  const installDir = mkdtempSync(join(tmpdir(), "wprr-install-"));
  const foreignCwd = mkdtempSync(join(tmpdir(), "wprr-foreign-cwd-"));
  try {
    const installBin = join(installDir, "bin");
    mkdirSync(installBin, { recursive: true });
    copyFileSync(join(here, "write-periodic-review-report.mjs"), join(installBin, "write-periodic-review-report.mjs"));

    const script = join(installBin, "write-periodic-review-report.mjs");
    const body = "# Periodic review — 2026-08-24\n\n## Actions\n- none\n";
    const out = execFileSync("node", [script, "--date", "2026-08-24"], { cwd: foreignCwd, input: body, encoding: "utf8" });

    const expectedPath = join(realpathSync(installDir), "pipeline", "audit", "periodic-review-2026-08-24.md");
    check("CLI prints the resolved (install-root, not foreign-cwd) path", out.trim() === `periodic-review report -> ${expectedPath}`);
    check("CLI wrote the exact stdin content to that path", existsSync(expectedPath) && readFileSync(expectedPath, "utf8") === body);
  } finally {
    rmSync(installDir, { recursive: true, force: true });
    rmSync(foreignCwd, { recursive: true, force: true });
  }
}
{
  // Missing --date fails loud (exit 2), never writes a mis-named/default file.
  const installDir = mkdtempSync(join(tmpdir(), "wprr-install-baddate-"));
  try {
    const installBin = join(installDir, "bin");
    mkdirSync(installBin, { recursive: true });
    copyFileSync(join(here, "write-periodic-review-report.mjs"), join(installBin, "write-periodic-review-report.mjs"));
    let code = 0;
    try {
      execFileSync("node", [join(installBin, "write-periodic-review-report.mjs")], { input: "content\n", encoding: "utf8" });
    } catch (e) {
      code = e.status;
    }
    check("CLI exits 2 on missing --date", code === 2);
    check("CLI writes nothing under pipeline/audit/ when --date is missing", !existsSync(join(installDir, "pipeline")));
  } finally {
    rmSync(installDir, { recursive: true, force: true });
  }
}

// --- Acceptance item 2 (V-446): guard-sensitive-access.py does not block the
// sanctioned invocation — verified empirically by running the real guard as a
// subprocess against a synthetic PreToolUse Bash event, not by source inspection. ---
{
  const guard = join(here, "guard-sensitive-access.py");
  function guardExit(command) {
    const event = JSON.stringify({ tool_name: "Bash", tool_input: { command } });
    try {
      execFileSync("python3", [guard], { input: event, encoding: "utf8" });
      return 0;
    } catch (e) {
      return e.status;
    }
  }
  check(
    "guard allows the sanctioned report-write invocation",
    guardExit('printf "%s" "$REPORT" | node ~/.claude/bin/write-periodic-review-report.mjs --date 2026-08-24') === 0
  );
  // Documents the failure mode this helper was built to avoid: a report body that
  // mentions "credentials" (as this very report legitimately does, describing the
  // bug) embedded as a literal in an inline `node -e` fallback puts a SECRET_PATH
  // match (`credentials`) in the same segment as a SECRET_TOUCH verb (`node`) — the
  // guard's reader-verb heuristic — and blocks. This is exactly why the sanctioned
  // writer takes the body over stdin instead.
  check(
    "an inline `node -e` fallback quoting \"credentials\" in the report body DOES trip the guard (the bug this helper avoids)",
    guardExit(
      "node -e \"require('fs').writeFileSync('/Users/x/.claude/pipeline/audit/periodic-review-2026-08-24.md', 'guard-sensitive-access.py credentials false positive')\""
    ) === 2
  );
}

console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILED"}`);
process.exit(fails === 0 ? 0 : 1);
