#!/usr/bin/env node
// Tests for log-audit-record.mjs — sink allowlist + ts stamping + deep redaction +
// line shape. (V-335)  Run: node bin/log-audit-record.test.mjs  (exit 0 = pass, 1 = fail)
//
// Secret-shaped literals here are synthetic (never real credentials).

import { finalizeRecord, buildLine, resolveSinkPath, redactDeep, ALLOWED_SINKS, appendRecord, parseFlags, readRecordJson, tailLines } from "./log-audit-record.mjs";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, copyFileSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

let fails = 0;
function check(name, cond) {
  console.log(`[${cond ? "ok" : "FAIL"}] ${name}`);
  if (!cond) fails++;
}
function throws(name, fn) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  check(name, threw);
}

const TS = "2026-07-07T00:00:00.000Z";

// --- ts stamping: absent → injected clock; present → preserved verbatim ---
check("absent ts stamped", finalizeRecord({ lens: "tool-fit" }, TS).ts === TS);
check("present ts preserved", finalizeRecord({ ts: "2020-01-01T00:00:00.000Z", lens: "x" }, TS).ts === "2020-01-01T00:00:00.000Z");

// --- record shape preserved (nested structure intact) ---
{
  const rec = finalizeRecord({ lens: "tool-fit", ticket: "V-335", steps: [{ step: "build", verdict: "right-sized", ceremony: false }] }, TS);
  check("nested fields preserved", rec.ticket === "V-335" && rec.steps[0].verdict === "right-sized" && rec.steps[0].ceremony === false);
}

// --- deep redaction: a secret in a nested free-text leaf is masked; plain words are not ---
{
  const rec = finalizeRecord({
    ticket: "V-335",
    acceptance: [{ item: "no prompt", verdict: "met", evidence: "ran curl -H 'Authorization: Bearer sbp_0123456789abcdef0123'" }],
    quality: { engineering: "fit — minimal targeted change" },
  }, TS);
  check("secret masked in nested evidence", !rec.acceptance[0].evidence.includes("sbp_0123456789abcdef0123") && rec.acceptance[0].evidence.includes("«redacted»"));
  check("plain verdict word untouched", rec.acceptance[0].verdict === "met");
  check("plain quality text untouched", rec.quality.engineering === "fit — minimal targeted change");
}
check("redactDeep leaves non-strings alone", redactDeep(42) === 42 && redactDeep(true) === true && redactDeep(null) === null);

// --- non-object records are rejected ---
throws("array record rejected", () => finalizeRecord([1, 2], TS));
throws("null record rejected", () => finalizeRecord(null, TS));
throws("string record rejected", () => finalizeRecord("nope", TS));

// --- buildLine: exactly one trailing newline, round-trips to the finalized record ---
{
  const line = buildLine({ lens: "tool-fit", ticket: "V-335" }, TS);
  check("line ends with single newline", line.endsWith("\n") && !line.slice(0, -1).includes("\n"));
  check("line round-trips", JSON.parse(line).ticket === "V-335" && JSON.parse(line).ts === TS);
}

// --- sink allowlist: known basenames resolve under pipeline/audit/; others reject ---
check("tool-fit sink allowed", resolveSinkPath("tool-fit.jsonl").endsWith("/pipeline/audit/tool-fit.jsonl"));
check("produced-review sink allowed", resolveSinkPath("produced-review.jsonl").endsWith("/pipeline/audit/produced-review.jsonl"));
check("both sinks registered", ALLOWED_SINKS.has("tool-fit.jsonl") && ALLOWED_SINKS.has("produced-review.jsonl"));
throws("unknown sink rejected", () => resolveSinkPath("errors.jsonl"));
throws("path-traversal sink rejected", () => resolveSinkPath("../secrets.jsonl"));
throws("absent sink rejected", () => resolveSinkPath(undefined));

// --- CLI I/O path: flag parsing + record-source resolution (the surface acceptance hinges on) ---
check("parseFlags maps --sink and --record", (() => {
  const f = parseFlags(["--sink", "tool-fit.jsonl", "--record", '{"a":1}']);
  return f.sink === "tool-fit.jsonl" && f.record === '{"a":1}';
})());
check("readRecordJson parses the --record branch", readRecordJson({ record: '{"a":1}' }).a === 1);
throws("readRecordJson rejects a blank --record", () => readRecordJson({ record: "   " }));

// --- appendRecord creates the dir and appends the line (the mkdirSync+appendFileSync path,
//     tested against a temp dir since the sink path is fixed relative to bin/) ---
{
  const dir = mkdtempSync(join(tmpdir(), "log-audit-record-test-"));
  try {
    const sink = join(dir, "nested", "sub", "tool-fit.jsonl"); // nested → forces mkdirSync(recursive)
    const line = buildLine({ lens: "tool-fit", ticket: "V-335-itest" }, TS);
    appendRecord(sink, line);
    appendRecord(sink, buildLine({ lens: "tool-fit", ticket: "V-335-itest-2" }, TS));
    const written = readFileSync(sink, "utf8").trimEnd().split("\n");
    check("appendRecord created nested dir + first line", JSON.parse(written[0]).ticket === "V-335-itest");
    check("appendRecord is append (not overwrite)", written.length === 2 && JSON.parse(written[1]).ticket === "V-335-itest-2");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- tailLines: the convention-8 read-back surface (V-682) ---------------------
{
  check("tailLines on an absent sink returns [] (not an error)", tailLines(join(tmpdir(), "log-audit-record-no-such-file.jsonl"), 5).length === 0);

  const dir = mkdtempSync(join(tmpdir(), "log-audit-record-tail-test-"));
  try {
    const sink = join(dir, "produced-review.jsonl");
    appendRecord(sink, buildLine({ lens: "produced-review", ticket: "V-682-a" }, TS));
    appendRecord(sink, buildLine({ lens: "produced-review", ticket: "V-682-b" }, TS));
    appendRecord(sink, buildLine({ lens: "produced-review", ticket: "V-682-c" }, TS));

    const last1 = tailLines(sink, 1);
    check("tail 1 returns exactly the last line", last1.length === 1 && JSON.parse(last1[0]).ticket === "V-682-c");

    const last2 = tailLines(sink, 2);
    check(
      "tail 2 returns the last two lines in order",
      last2.length === 2 && JSON.parse(last2[0]).ticket === "V-682-b" && JSON.parse(last2[1]).ticket === "V-682-c"
    );

    const overCount = tailLines(sink, 100);
    check("tail n > line count returns every line, not an error", overCount.length === 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- CLI end-to-end, from a cwd nowhere near this install (V-682 acceptance #3):
//     an isolated copy of this script (+ its one dependency) run from an unrelated
//     tmp cwd — proving both the append AND the documented --tail read-back are
//     cwd-independent, without touching this repo's real pipeline/audit/*.jsonl. ---
{
  const installDir = mkdtempSync(join(tmpdir(), "log-audit-record-install-"));
  const foreignCwd = mkdtempSync(join(tmpdir(), "log-audit-record-foreign-cwd-"));
  try {
    const binDir = join(installDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const here = dirname(fileURLToPath(import.meta.url));
    copyFileSync(join(here, "log-audit-record.mjs"), join(binDir, "log-audit-record.mjs"));
    copyFileSync(join(here, "transcript-resolver.mjs"), join(binDir, "transcript-resolver.mjs"));
    const script = join(binDir, "log-audit-record.mjs");

    const appendOut = execFileSync(
      "node",
      [script, "--sink", "produced-review.jsonl", "--record", JSON.stringify({ lens: "produced-review", ticket: "V-682-e2e" })],
      { cwd: foreignCwd, encoding: "utf8" }
    );
    // realpath both sides: on macOS $TMPDIR (/var/folders/...) is itself a symlink
    // to /private/var/folders/..., which fileURLToPath resolves inside the child
    // process — a literal join(installDir, ...) would spuriously mismatch.
    const expectedSink = join(realpathSync(installDir), "pipeline", "audit", "produced-review.jsonl");
    check("append: prints the resolved absolute sink path", appendOut.includes(`appended to ${expectedSink}`));

    const tailOut = execFileSync("node", [script, "--sink", "produced-review.jsonl", "--tail", "1"], {
      cwd: foreignCwd,
      encoding: "utf8",
    });
    check("--tail: prints the same resolved sink path", tailOut.includes(`sink: ${expectedSink}`));
    check("--tail: shows the just-appended record", tailOut.includes('"ticket":"V-682-e2e"') || tailOut.includes('"ticket": "V-682-e2e"'));
  } finally {
    rmSync(installDir, { recursive: true, force: true });
    rmSync(foreignCwd, { recursive: true, force: true });
  }
}

console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILED"}`);
process.exit(fails === 0 ? 0 : 1);
