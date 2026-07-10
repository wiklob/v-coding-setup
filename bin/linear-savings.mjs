#!/usr/bin/env node
// ~/.claude/bin/linear-savings.mjs
// Aggregate pipeline/audit/linear-calls.jsonl (the V-305 PostToolUse capture) into
// PER-SESSION wrapper-vs-hosted savings — the session dimension /stats can't give.
//
// Method: each record is a real wrapper-returned byte count tagged with session.
// Multiply by the per-tool hosted/wrapper RATIO measured by probe-vs-hosted
// (pipeline/audit/linear-wrapper-vs-hosted.md, 2026-06-22) to estimate what hosted
// would have returned, then savings = hosted_est − wrapper_actual. Tools without a
// measured ratio are counted but NOT credited any savings (no overclaiming).
//
// Usage:
//   node ~/.claude/bin/linear-savings.mjs                 # per-session table + totals
//   node ~/.claude/bin/linear-savings.mjs --session <id>  # one session
//   node ~/.claude/bin/linear-savings.mjs --json          # machine-readable
//
// Refresh the ratios by re-running `npm run probe:vs-hosted` and updating RATIOS.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LOG_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline", "audit", "linear-calls.jsonl");

// hosted/wrapper byte ratio per tool (from probe-vs-hosted, 2026-06-22). A ratio R
// means hosted returns ~R× the wrapper's bytes, so estimated hosted = wrapper × R.
// list_issue_statuses < 1 ⇒ wrapper is LARGER there (the V-296 regression).
const RATIOS = {
  get_project: 13.45,
  list_projects: 9.40,
  list_issues: 3.42,
  get_team: 2.09,
  list_teams: 2.08,
  get_issue: 1.43,
  list_issue_statuses: 0.82,
};
const RATIOS_DATE = "2026-06-22";

const TOK = (b) => Math.round(b / 3.5);

function readRecords() {
  let txt;
  try { txt = readFileSync(LOG_PATH, "utf8"); }
  catch { return []; }
  const out = [];
  for (const line of txt.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip a torn line */ }
  }
  return out;
}

function aggregate(records, only) {
  const bySession = new Map();
  let credited = 0, uncredited = 0;
  for (const r of records) {
    if (r.status === "error") continue;
    if (only && r.session !== only) continue;
    const sid = r.session || "(unknown)";
    if (!bySession.has(sid)) bySession.set(sid, { session: sid, conversation: r.conversation || null, calls: 0, wrapperBytes: 0, hostedBytes: 0, lastTs: r.ts });
    const s = bySession.get(sid);
    const ratio = RATIOS[r.tool];
    const bytes = Number(r.bytes) || 0;
    s.calls++;
    s.wrapperBytes += bytes;
    s.hostedBytes += ratio ? bytes * ratio : bytes; // uncredited tools: hosted == wrapper (0 savings)
    if (r.ts > s.lastTs) s.lastTs = r.ts;
    if (ratio) credited++; else uncredited++;
  }
  const sessions = [...bySession.values()].map((s) => ({
    ...s,
    savedBytes: s.hostedBytes - s.wrapperBytes,
    savedPct: s.hostedBytes ? (s.hostedBytes - s.wrapperBytes) / s.hostedBytes * 100 : 0,
  })).sort((a, b) => b.savedBytes - a.savedBytes);
  return { sessions, credited, uncredited };
}

function main() {
  const argv = process.argv.slice(2);
  const only = argv.includes("--session") ? argv[argv.indexOf("--session") + 1] : null;
  const asJson = argv.includes("--json");
  const records = readRecords();
  const { sessions, credited, uncredited } = aggregate(records, only);

  if (asJson) {
    console.log(JSON.stringify({ ratiosDate: RATIOS_DATE, credited, uncredited, sessions }, null, 2));
    return;
  }

  if (!records.length) {
    console.log(`No records yet at ${LOG_PATH}. The PostToolUse hook populates it as Linear calls happen.`);
    return;
  }

  const pad = (s, n) => String(s).padEnd(n);
  const padN = (s, n) => String(s).padStart(n);
  console.log(`Per-session Linear savings (ratios from probe ${RATIOS_DATE}; wrapper bytes × per-tool hosted ratio)\n`);
  console.log(pad("session", 16), padN("calls", 6), padN("wrap.tok", 9), padN("hosted~tok", 11), padN("saved~tok", 10), padN("saved%", 8));
  console.log("-".repeat(64));
  let tw = 0, th = 0, tc = 0;
  for (const s of sessions) {
    tw += s.wrapperBytes; th += s.hostedBytes; tc += s.calls;
    console.log(pad(String(s.session).slice(0, 16), 16), padN(s.calls, 6), padN(TOK(s.wrapperBytes), 9), padN(TOK(s.hostedBytes), 11), padN(TOK(s.savedBytes), 10), padN(s.savedPct.toFixed(1) + "%", 8));
  }
  console.log("-".repeat(64));
  console.log(pad(`TOTAL (${sessions.length} sessions)`, 16), padN(tc, 6), padN(TOK(tw), 9), padN(TOK(th), 11), padN(TOK(th - tw), 10), padN((th ? (th - tw) / th * 100 : 0).toFixed(1) + "%", 8));
  console.log(`\nCredited calls: ${credited} (have a measured ratio) · Uncredited: ${uncredited} (no ratio — counted, 0 savings claimed).`);
}

main();
