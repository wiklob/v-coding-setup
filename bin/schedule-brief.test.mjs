#!/usr/bin/env node
// ~/.claude/bin/schedule-brief.test.mjs
// Encoded proof for V-306 (test-less repo: a runnable worked example is the proof
// analog per commands/scope.md §3). Two things:
//   1. THE REGISTRY-DRIVEN WORKED EXAMPLE (Acceptance item 3): adding a routine to
//      the registry surfaces it in the brief with NO edit to schedule-brief.mjs.
//      We inject a synthetic third routine (not one of the two real harvests) into
//      an in-memory registry + a fake log, run the UNMODIFIED recap(), and assert
//      the synthetic routine appears with its parsed result. If the brief were
//      hard-coded to the two harvests, this would fail — its passing IS the proof
//      the brief is data-driven.
//   2. parseLastRun's three-way outcome contract (ok / failed / never-run) against
//      log text shaped exactly like the real harvest logs.
//
// Run:  node ~/.claude/bin/schedule-brief.test.mjs   (exit 0 = pass; throws = fail)

import assert from "node:assert/strict";
import { recap, parseLastRun, stripInFlight } from "./schedule-brief.mjs";

// --- 1. Registry-driven worked example (Acceptance item 3) ---------------------
{
  // A registry carrying a routine that did NOT exist when schedule-brief.mjs was
  // written — the whole point: the brief has no knowledge of it.
  const registry = [
    { label: "com.example.synthetic-routine", name: "synthetic routine", runner: "bin/x.sh", log: "pipeline/audit/synthetic.log", schedule: "daily 12:00" },
  ];
  // Fake log for it, shaped like the real harvest logs (heartbeat + result line).
  const fakeLogs = {
    "pipeline/audit/synthetic.log":
      "=== synthetic-routine fired 2026-07-02T12:00:03Z (pid 4242) ===\nsome output\nresult: synthetic did 7 things\n",
  };
  const readLog = (rel) => fakeLogs[rel] ?? "";
  const out = recap(registry, readLog, new Date(2026, 6, 2, 12, 30)).join("\n");

  assert.match(out, /synthetic routine \(daily 12:00\)/, "synthetic routine must surface in the brief with no schedule-brief.mjs edit");
  assert.match(out, /synthetic did 7 things/, "the synthetic routine's parsed result must appear");
  assert.match(out, /recapped 1 routine\(s\): 1 ok, 0 failed\/incomplete, 0 never-run/, "summary must count the registry-driven routine");
}

// --- 2. parseLastRun outcome contract ------------------------------------------
{
  // ok: heartbeat + trailing result (and a PRIOR run to prove we take the LAST).
  const okLog =
    "=== harvest fired 2026-07-01T07:00:00Z (pid 1) ===\nresult: old run\n" +
    "=== harvest fired 2026-07-02T07:14:41Z (pid 2) ===\n0 new entries\nresult: found 0 new entries\n";
  const ok = parseLastRun(okLog);
  assert.equal(ok.status, "ok");
  assert.equal(ok.firedAt, "2026-07-02T07:14:41Z", "must read the LAST heartbeat's ts");
  assert.equal(ok.result, "found 0 new entries", "must read the result AFTER the last heartbeat");

  // failed: fired but crashed (heartbeat, no result after it).
  const failedLog =
    "=== feedback-harvest fired 2026-07-01T07:28:13Z (pid 1) ===\nresult: filed 0\n" +
    "=== feedback-harvest fired 2026-07-02T07:28:13Z (pid 2) ===\nAPI Error: Connection closed mid-response\n";
  const failed = parseLastRun(failedLog);
  assert.equal(failed.status, "failed", "a heartbeat with no trailing result is a failed/incomplete run");
  assert.equal(failed.firedAt, "2026-07-02T07:28:13Z");
  assert.equal(failed.result, null);

  // never-run: empty / no heartbeat.
  assert.equal(parseLastRun("").status, "never-run");
  assert.equal(parseLastRun("some noise with no heartbeat\n").status, "never-run");
}

// --- 3. empty registry degrades cleanly ----------------------------------------
{
  const out = recap([], () => "", new Date(2026, 6, 2, 9, 27)).join("\n");
  assert.match(out, /Registry is empty/);
  assert.match(out, /recapped 0 routine\(s\)/);
}

// --- 4. self-recap excludes the in-flight heartbeat (V-306 review fix) ----------
// The brief reads its OWN log mid-run: the runner appends THIS run's heartbeat before
// exec, but the run's `result:` line isn't written yet. Without excluding it, the brief
// misreports itself as failed every morning. --exclude-heartbeat <run-ts> strips it so
// the brief reports its last COMPLETED run instead.
{
  const RUN_TS = "2026-07-03T09:27:01Z";
  const selfLog =
    "=== schedule-brief fired 2026-07-02T09:27:02Z (pid 1) ===\n" +
    "# Morning brief\nresult: schedule-brief — recapped 3 routine(s): 3 ok, 0 failed/incomplete, 0 never-run\n" +
    `=== schedule-brief fired ${RUN_TS} (pid 2) ===\n`; // in-flight: heartbeat, no result yet
  const registry = [
    { label: "com.v-coding-setup.schedule-brief", name: "morning brief", runner: "bin/schedule-brief-runner.sh", log: "pipeline/audit/schedule-brief.log", schedule: "daily 09:27" },
  ];
  const readLog = () => selfLog;

  // Sanity — without the exclude, the in-flight run reads as failed (the bug the review caught).
  const buggy = recap(registry, readLog, new Date(2026, 6, 3, 9, 27)).join("\n");
  assert.match(buggy, /failed\/incomplete run/, "without --exclude-heartbeat the in-flight run is misread as failed (the bug)");

  // With the fix — report the prior COMPLETED run, no false failure.
  const fixed = recap(registry, readLog, new Date(2026, 6, 3, 9, 27), RUN_TS).join("\n");
  assert.match(fixed, /morning brief \(daily 09:27\) — last fired 2026-07-02T09:27:02Z: schedule-brief — recapped 3 routine\(s\)/, "reports the last completed run, not the in-flight one");
  assert.doesNotMatch(fixed, /failed\/incomplete run/, "the in-flight run must not be counted as a failure");
  assert.match(fixed, /recapped 1 routine\(s\): 1 ok, 0 failed\/incomplete, 0 never-run/);

  // stripInFlight is a no-op on a log that doesn't carry the excluded ts (other routines untouched).
  const otherLog = "=== harvest fired 2026-01-01T00:00:00Z ===\nresult: y\n";
  assert.equal(stripInFlight(otherLog, RUN_TS), otherLog);
  assert.equal(stripInFlight(selfLog, null), selfLog);
}

console.log("schedule-brief.test.mjs: all assertions passed");
