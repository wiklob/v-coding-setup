#!/usr/bin/env node
// ~/.claude/bin/register-routine.test.mjs
// Encoded proof for V-306 (test-less repo: a runnable check is the proof analog per
// commands/scope.md §3) that register-routine's upsert is idempotent + additive +
// deterministically sorted — the "self-register" contract the harvest installers
// depend on (re-install must not churn the committed registry; a new routine must
// append exactly one entry).
//
// Run:  node ~/.claude/bin/register-routine.test.mjs   (exit 0 = pass; throws = fail)

import assert from "node:assert/strict";
import { upsert, parseRegistry } from "./register-routine.mjs";

const bug = { label: "com.v-coding-setup.harvest-pipeline-bugs", name: "pipeline-bug harvest", runner: "bin/harvest-pipeline-bugs-runner.sh", log: "pipeline/audit/harvest.log", schedule: "daily 09:07" };
const feedback = { label: "com.v-coding-setup.harvest-feedback", name: "feedback harvest", runner: "bin/harvest-feedback-runner.sh", log: "pipeline/audit/harvest-feedback.log", schedule: "daily 09:17" };

// --- append into empty ---------------------------------------------------------
{
  const r = upsert([], bug);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], bug);
}

// --- idempotent: re-registering the same entry produces an equal array ---------
{
  const once = upsert([], bug);
  const twice = upsert(once, { ...bug });
  assert.deepEqual(twice, once, "re-registering an identical entry must not change the registry (no re-install churn)");
}

// --- upsert-by-label replaces, does not duplicate ------------------------------
{
  const start = upsert([], bug);
  const changed = upsert(start, { ...bug, schedule: "daily 09:07", name: "bug harvest v2" });
  assert.equal(changed.length, 1, "same label must replace, not append");
  assert.equal(changed[0].name, "bug harvest v2");
}

// --- additive + deterministically sorted (schedule, then label) ----------------
{
  // register in reverse schedule order; result must sort ascending by schedule.
  const r = upsert(upsert([], feedback), bug);
  assert.equal(r.length, 2);
  assert.equal(r[0].label, bug.label, "09:07 must sort before 09:17");
  assert.equal(r[1].label, feedback.label);
}

// --- parseRegistry tolerates garbage → [] --------------------------------------
{
  assert.deepEqual(parseRegistry(""), []);
  assert.deepEqual(parseRegistry("not json"), []);
  assert.deepEqual(parseRegistry('{"not":"an array"}'), []);
  assert.deepEqual(parseRegistry('[{"label":"a"}]'), [{ label: "a" }]);
}

console.log("register-routine.test.mjs: all assertions passed");
