#!/usr/bin/env node
// Tests for session-identity.mjs — resolveSessionId precedence + resolveConversationId
// resume-chain walk. Run: node bin/session-identity.test.mjs   (exit 0 = pass, 1 = fail)

import { resolveSessionId, resolveConversationId } from "./session-identity.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fails = 0;
function check(name, cond) {
  console.log(`[${cond ? "ok" : "FAIL"}] ${name}`);
  if (!cond) fails++;
}

// Build a throwaway jobs/ dir with one state.json per (sessionId → resumeSessionId)
// edge, mirroring the daemon layout (dir named by the 8-char short id). Returns the
// base path; caller rmSync's it.
function fakeJobsDir(edges) {
  const base = mkdtempSync(join(tmpdir(), "si-jobs-"));
  for (const [sessionId, resumeSessionId] of edges) {
    const dir = join(base, sessionId.slice(0, 8));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "state.json"), JSON.stringify({ sessionId, resumeSessionId }));
  }
  return base;
}

// --- resolveSessionId precedence (flag > env > daemon job state.json) ---
check("resolveSessionId: flag wins", resolveSessionId({ session: "flag-sid" }, { CLAUDE_SESSION_ID: "env-sid" }) === "flag-sid");
check("resolveSessionId: env when no flag", resolveSessionId({}, { CLAUDE_SESSION_ID: "env-sid" }) === "env-sid");
check("resolveSessionId: null when nothing", resolveSessionId({}, {}) === null);
{
  // The fix: CLAUDE_SESSION_ID absent, but CLAUDE_JOB_DIR points at a job whose
  // state.json carries the full sessionId (the bg/FleetView daemon shape).
  const jobDir = mkdtempSync(join(tmpdir(), "si-jobdir-"));
  try {
    writeFileSync(join(jobDir, "state.json"), JSON.stringify({ sessionId: "84b6834d-6d73-489a-b672-00f3f9669186" }));
    check(
      "resolveSessionId: reads sessionId from CLAUDE_JOB_DIR/state.json when env unset",
      resolveSessionId({}, { CLAUDE_JOB_DIR: jobDir }) === "84b6834d-6d73-489a-b672-00f3f9669186"
    );
  } finally {
    rmSync(jobDir, { recursive: true, force: true });
  }
}

// --- resolveConversationId: walk the resume chain to its furthest-reachable root ---
check("resolveConversationId: null in → null out", resolveConversationId(null) === null);
{
  // Intact chain root→mid→leaf (leaf resumes mid resumes root; root resumes itself).
  const root = "11111111-aaaa-bbbb-cccc-000000000000";
  const mid = "22222222-aaaa-bbbb-cccc-000000000000";
  const leaf = "33333333-aaaa-bbbb-cccc-000000000000";
  const jobs = fakeJobsDir([[root, root], [mid, root], [leaf, mid]]);
  try {
    check("resolveConversationId: leaf resolves to chain root", resolveConversationId(leaf, jobs) === root);
    check("resolveConversationId: mid resolves to root", resolveConversationId(mid, jobs) === root);
    check("resolveConversationId: root resolves to itself (self-resume)", resolveConversationId(root, jobs) === root);
  } finally {
    rmSync(jobs, { recursive: true, force: true });
  }
}
{
  // GC'd ancestor: leaf→mid survive, but mid's parent (root) dir is gone → furthest
  // reachable is mid, not the (untraceable) true root.
  const gone = "99999999-dead-dead-dead-000000000000";
  const mid = "22222222-aaaa-bbbb-cccc-000000000000";
  const leaf = "33333333-aaaa-bbbb-cccc-000000000000";
  const jobs = fakeJobsDir([[mid, gone], [leaf, mid]]);
  try {
    check("resolveConversationId: stops at furthest reachable when ancestor GC'd", resolveConversationId(leaf, jobs) === mid);
  } finally {
    rmSync(jobs, { recursive: true, force: true });
  }
}
{
  // No job state at all → conversation is the session itself (length-1 chain).
  const jobs = mkdtempSync(join(tmpdir(), "si-jobs-empty-"));
  try {
    check("resolveConversationId: untraceable session → itself", resolveConversationId("44444444-x", jobs) === "44444444-x");
  } finally {
    rmSync(jobs, { recursive: true, force: true });
  }
}
{
  // Cycle guard: a→b→a must terminate (returns the furthest before revisiting).
  const a = "aaaaaaaa-0000-0000-0000-000000000000";
  const b = "bbbbbbbb-0000-0000-0000-000000000000";
  const jobs = fakeJobsDir([[a, b], [b, a]]);
  try {
    check("resolveConversationId: cycle terminates", resolveConversationId(a, jobs) === b);
  } finally {
    rmSync(jobs, { recursive: true, force: true });
  }
}

console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILED"}`);
process.exit(fails === 0 ? 0 : 1);
