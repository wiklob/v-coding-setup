#!/usr/bin/env node
// ~/.claude/bin/wait-for-check.mjs
// Poll a PR's required check until terminal.
// Used by /land-ticket §6.7 (wait-for-green-before-merge) so the skill makes
// ONE allowlisted Bash call instead of composing a sleep+until+gh+python3
// mega-pipeline that triggers a permission prompt every iteration.
//
// Usage:
//   node ~/.claude/bin/wait-for-check.mjs --pr <n> --check <context-name> \
//     [--max-wait <seconds>] [--interval <seconds>]
//
// Exit codes:
//   0  check terminal SUCCESS (or non-blocking terminal — SKIPPED/STALE/NEUTRAL)
//   1  check terminal FAILURE / ERROR / CANCELLED / TIMED_OUT / ACTION_REQUIRED
//   2  --max-wait elapsed before check went terminal (or check never appeared)
//   3  bad args, gh CLI error, or unparseable response
//
// All status updates print to stdout; errors to stderr. The skill reads the
// exit code; the prints are for the user watching the session.

import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (!k?.startsWith("--")) return null;
    out[k.slice(2)] = argv[i + 1];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args || !args.pr || !args.check) {
  console.error(
    "Usage: --pr <n> --check <context-name> [--max-wait <s>] [--interval <s>]"
  );
  process.exit(3);
}

const pr = String(args.pr);
const check = String(args.check);
const maxWaitSec = Number(args["max-wait"] ?? 1800); // 30 min default
const intervalSec = Number(args.interval ?? 20);

const TERMINAL_OK = new Set(["SUCCESS"]);
const TERMINAL_FAIL = new Set([
  "FAILURE",
  "ERROR",
  "CANCELLED",
  "TIMED_OUT",
  "ACTION_REQUIRED",
]);
// Non-blocking terminal states — treat as pass so a skipped/neutral required
// check doesn't gate a merge that should proceed.
const TERMINAL_NEUTRAL = new Set(["SKIPPED", "STALE", "NEUTRAL"]);

function fetchRollup() {
  try {
    const out = execFileSync(
      "gh",
      ["pr", "view", pr, "--json", "statusCheckRollup,mergeStateStatus"],
      { encoding: "utf8" }
    );
    return JSON.parse(out);
  } catch (e) {
    console.error(`gh pr view failed: ${e.message}`);
    process.exit(3);
  }
}

function findCheck(rollup) {
  // Old-style status contexts use `context`; new check-runs use `name`.
  return (rollup ?? []).find(
    (c) => c.context === check || c.name === check
  );
}

const deadline = Date.now() + maxWaitSec * 1000;
let lastReport = "";

while (Date.now() < deadline) {
  const data = fetchRollup();
  const row = findCheck(data.statusCheckRollup);
  // status check: `state`. check run: `conclusion` (terminal) or `status` (in-progress).
  const state = row?.state ?? row?.conclusion ?? row?.status ?? "MISSING";

  const report = `check=${check} state=${state} mergeState=${data.mergeStateStatus}`;
  if (report !== lastReport) {
    console.log(`[${new Date().toISOString()}] ${report}`);
    lastReport = report;
  }

  if (TERMINAL_OK.has(state)) process.exit(0);
  if (TERMINAL_FAIL.has(state)) process.exit(1);
  if (TERMINAL_NEUTRAL.has(state)) {
    console.log(`Check terminal-non-blocking (${state}); treating as pass.`);
    process.exit(0);
  }

  // Non-terminal: IN_PROGRESS, PENDING, QUEUED, EXPECTED, MISSING — keep waiting.
  await new Promise((r) => setTimeout(r, intervalSec * 1000));
}

console.error(
  `Timed out after ${maxWaitSec}s waiting for ${check} on PR ${pr}.`
);
process.exit(2);
