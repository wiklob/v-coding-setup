#!/usr/bin/env node
// Probe for read-footprint.mjs (V-267). Encoded proof (test-less repo): computes a
// per-build Read footprint from fixture usage-stats JSON and flags a synthetic
// regression. Run: `node bin/read-footprint.test.mjs` (exit 0 = all pass).

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { median, bytesToTokens, loadBuilds, selectTarget, assess } from "./read-footprint.mjs";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "read-footprint.mjs");
let pass = 0,
  fail = 0;
const ok = (cond, msg) => (cond ? (pass++, console.log("  ok  " + msg)) : (fail++, console.error("FAIL  " + msg)));

// --- pure ---
ok(median([3, 1, 2]) === 2, "median odd");
ok(median([1, 2, 3, 4]) === 2.5, "median even");
ok(median([]) === null, "median empty → null");
ok(bytesToTokens(4000) === 1000, "bytesToTokens bytes/4");

// --- fixtures ---
const dir = mkdtempSync(join(tmpdir(), "read-footprint-test-"));
const write = (name, obj) => writeFileSync(join(dir, name), JSON.stringify(obj) + "\n");

try {
  // 6 baseline builds ~400k bytes (=100k tokens each), chronological
  write("2026-07-01-100000-V-100.json", { ticket: "V-100", tool_result_bytes: { Read: 400000 } });
  write("2026-07-02-100000-V-101.json", { ticket: "V-101", tool_result_bytes: { Read: 410000 } });
  write("2026-07-03-100000-V-102.json", { ticket: "V-102", tool_result_bytes: { Read: 390000 } });
  write("2026-07-04-100000-V-103.json", { ticket: "V-103", tool_result_bytes: { Read: 405000 } });
  write("2026-07-05-100000-V-104.json", { ticket: "V-104", tool_result_bytes: { Read: 395000 } });
  write("2026-07-06-100000-V-105.json", { ticket: "V-105", tool_result_bytes: { Read: 400000 } });
  // an older pre-V-79 file WITHOUT tool_result_bytes.Read — must be skipped
  write("2026-06-01-100000-V-050.json", { ticket: "V-050", tool_result_bytes: { Bash: 5000 } });

  const baseline = loadBuilds(dir);
  ok(baseline.length === 6, "loadBuilds skips the file lacking tool_result_bytes.Read (6 of 7)");
  ok(baseline[0].readTokens === 100000, "loadBuilds computes readTokens (bytes/4)");

  // Regressing target: 1.2M bytes = 300k tokens, well over baseline median (~100k) * 1.5
  write("2026-07-07-100000-V-267.json", { ticket: "V-267", tool_result_bytes: { Read: 1200000 } });
  const withReg = loadBuilds(dir);
  const rReg = assess({ builds: withReg, ticket: "V-267" });
  ok(rReg.target && rReg.target.readTokens === 300000, "assess targets the V-267 build");
  ok(rReg.baselineTokens === 100000, "assess baseline = median of prior builds (100k tok)");
  ok(rReg.regression === true, "assess flags the synthetic regression (300k > 100k×1.5)");

  // Within-margin target: 440k bytes = 110k tokens < 100k*1.5=150k → OK
  rmSync(join(dir, "2026-07-07-100000-V-267.json"));
  write("2026-07-07-100000-V-267.json", { ticket: "V-267", tool_result_bytes: { Read: 440000 } });
  const withOk = loadBuilds(dir);
  const rOk = assess({ builds: withOk, ticket: "V-267" });
  ok(rOk.regression === false, "assess does NOT flag a within-margin build (110k < 150k)");

  // --ticket selection: latest matching build
  const rSel = selectTarget(withOk, { ticket: "V-102" });
  ok(rSel.target && rSel.target.ticket === "V-102", "selectTarget picks the named ticket");

  // insufficient history: a lone build → baseline null, no regression
  const solo = mkdtempSync(join(tmpdir(), "read-footprint-solo-"));
  try {
    writeFileSync(join(solo, "2026-07-07-100000-V-900.json"), JSON.stringify({ ticket: "V-900", tool_result_bytes: { Read: 999999 } }) + "\n");
    const rSolo = assess({ builds: loadBuilds(solo), ticket: "V-900" });
    ok(rSolo.baselineTokens === null && rSolo.regression === false, "single build → baseline null, no regression flag");
  } finally {
    rmSync(solo, { recursive: true, force: true });
  }

  // --- e2e CLI ---
  // restore the regressing target for the CLI checks
  rmSync(join(dir, "2026-07-07-100000-V-267.json"));
  write("2026-07-07-100000-V-267.json", { ticket: "V-267", tool_result_bytes: { Read: 1200000 } });

  const jsonOut = execFileSync("node", [CLI, "--dir", dir, "--ticket", "V-267", "--json"], { encoding: "utf8" });
  const parsed = JSON.parse(jsonOut);
  ok(parsed.regression === true && parsed.read_tokens === 300000, "e2e --json reports the regression");

  // --strict exits 3 on regression
  let strictCode = 0;
  try {
    execFileSync("node", [CLI, "--dir", dir, "--ticket", "V-267", "--strict"], { encoding: "utf8" });
  } catch (e) {
    strictCode = e.status;
  }
  ok(strictCode === 3, "e2e --strict exits 3 on regression");

  // without --strict, exit 0 even on regression
  const humanOut = execFileSync("node", [CLI, "--dir", dir, "--ticket", "V-267"], { encoding: "utf8" });
  ok(humanOut.includes("REGRESSION"), "e2e human output prints REGRESSION verdict, exit 0");

  // missing ticket → graceful note, exit 0
  const missOut = execFileSync("node", [CLI, "--dir", dir, "--ticket", "V-999"], { encoding: "utf8" });
  ok(missOut.includes("no build with a recorded Read footprint"), "e2e missing ticket → graceful note");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\nread-footprint: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
