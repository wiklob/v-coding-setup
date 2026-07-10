#!/usr/bin/env node
// ~/.claude/bin/read-footprint.mjs
// Per-build Read-token footprint + regression flag. (V-267)
//
// WHY THIS EXISTS:
//   The enforcement nudge (bin/nudge-read-discipline.mjs) steers a single read in the
//   moment; this is the accountability half — it measures how many Read tokens a whole
//   BUILD burned and flags a regression against recent builds, so waste is visible
//   instead of silent (V-232 shipped the guidance but left measurement open; its AC4 —
//   "a later build's Read footprint is lower" — was deferred as non-gatable-at-land).
//
//   It does NOT re-meter: bin/usage-stats.mjs already streams each session's transcript
//   and persists per-tool result bytes to .claude/usage-stats/<date>-<time>-<TICKET>.json
//   as `tool_result_bytes` (V-79). This consumes `tool_result_bytes.Read` and adds the
//   per-build rollup + rolling-baseline regression flag that machinery lacks.
//
// SCOPE — primary-session footprint (matches usage-stats' own `scope: "primary-session"`).
//   Each usage-stats file sums ONE (the primary/land) session's Read bytes; `usage-stats.mjs`
//   deliberately LINKS related sessions (`related_sessions`) rather than summing them, because
//   its content-match over-includes incidental mentions and summing would over-count. So this
//   meter measures the ticket's primary-session Read footprint — a consistent, apples-to-apples
//   per-ticket metric — NOT a sum across every session that touched the build. That is the right
//   trade: comparing each ticket's land-session footprint against the baseline of other tickets'
//   land-session footprints is the honest, over-count-free signal. `--ticket X` selects that
//   ticket's LATEST stats file (its most representative measurement).
//
// USAGE:
//   node bin/read-footprint.mjs [--ticket <ID> | latest]
//        [--window N] [--margin M] [--dir <stats-dir>] [--json] [--strict]
//   Default target = the newest build. Regression = target > median(prior N builds) * margin.
//   Exit 0 always, UNLESS --strict AND a regression is detected → exit 3 (so a land/scorecard
//   caller can gate on it); otherwise the printed verdict line is the flag.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const BYTES_PER_TOKEN = 4; // matches nudge-read-discipline.mjs' heuristic
const DEFAULT_WINDOW = 10; // prior builds in the rolling baseline
const DEFAULT_MARGIN = 1.5; // regression when target exceeds baseline median by this factor

// This file lives at <canonical-root>/bin/; usage-stats persists under <root>/.claude/usage-stats.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export function defaultStatsDir() {
  return join(REPO_ROOT, ".claude", "usage-stats");
}

export function bytesToTokens(bytes) {
  return Math.round((bytes || 0) / BYTES_PER_TOKEN);
}

export function median(nums) {
  const xs = nums.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/** Load builds that carry a numeric tool_result_bytes.Read, chronological (filenames
 *  begin with <date>-<time>, so a filename sort is chronological). Older pre-V-79 files
 *  without the field are skipped — they can't be compared. */
export function loadBuilds(dir) {
  let names;
  try {
    names = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const builds = [];
  for (const name of names.sort()) {
    let j;
    try {
      j = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch {
      continue;
    }
    const readBytes = j && j.tool_result_bytes && j.tool_result_bytes.Read;
    if (!Number.isFinite(readBytes)) continue; // no Read footprint recorded → not comparable
    builds.push({
      file: name,
      ticket: j.ticket ?? ticketFromName(name),
      readBytes,
      readTokens: bytesToTokens(readBytes),
    });
  }
  return builds;
}

function ticketFromName(name) {
  // <date>-<time>-<TICKET>.json → TICKET
  const m = basename(name, ".json").match(/^\d{4}-\d{2}-\d{2}-\d{6}-(.+)$/);
  return m ? m[1] : null;
}

/** Pick the target build: the latest for --ticket, else the newest overall. */
export function selectTarget(builds, { ticket } = {}) {
  if (!builds.length) return { target: null, index: -1 };
  if (ticket) {
    for (let i = builds.length - 1; i >= 0; i--) {
      if (builds[i].ticket === ticket) return { target: builds[i], index: i };
    }
    return { target: null, index: -1 };
  }
  return { target: builds[builds.length - 1], index: builds.length - 1 };
}

/** Assess the target against the rolling baseline (the `window` builds immediately
 *  before it). Returns the footprint, baseline, and whether it regressed. */
export function assess({ builds, ticket, window = DEFAULT_WINDOW, margin = DEFAULT_MARGIN }) {
  const { target, index } = selectTarget(builds, { ticket });
  if (!target) return { target: null };
  const prior = builds.slice(0, index).slice(-window);
  const baselineTokens = median(prior.map((b) => b.readTokens));
  const threshold = baselineTokens == null ? null : baselineTokens * margin;
  const regression = threshold != null && target.readTokens > threshold;
  return {
    target,
    baselineTokens,
    baselineSize: prior.length,
    margin,
    threshold,
    regression,
  };
}

// --- CLI ---

function parseArgs(argv) {
  const a = { window: DEFAULT_WINDOW, margin: DEFAULT_MARGIN };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--ticket") a.ticket = argv[++i];
    else if (t === "--window") a.window = Number(argv[++i]) || DEFAULT_WINDOW;
    else if (t === "--margin") a.margin = Number(argv[++i]) || DEFAULT_MARGIN;
    else if (t === "--dir") a.dir = argv[++i];
    else if (t === "--json") a.json = true;
    else if (t === "--strict") a.strict = true;
    else if (t === "latest") a.ticket = undefined;
  }
  return a;
}

const fmtTok = (t) => (t == null ? "n/a" : `${t.toLocaleString()} tok (~${(t / 1000).toFixed(1)}k)`);

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.dir || defaultStatsDir();
  const builds = loadBuilds(dir);
  const r = assess({ builds, ticket: args.ticket, window: args.window, margin: args.margin });

  if (!r.target) {
    const who = args.ticket ? `for ticket ${args.ticket}` : "";
    if (args.json) { console.log(JSON.stringify({ target: null, reason: "no build with a Read footprint " + who })); }
    else { console.log(`read-footprint: no build with a recorded Read footprint ${who} in ${dir}`); }
    return 0;
  }

  const out = {
    ticket: r.target.ticket,
    file: r.target.file,
    read_tokens: r.target.readTokens,
    read_bytes: r.target.readBytes,
    baseline_tokens: r.baselineTokens,
    baseline_builds: r.baselineSize,
    margin: r.margin,
    threshold_tokens: r.threshold == null ? null : Math.round(r.threshold),
    regression: r.regression,
  };

  if (args.json) {
    console.log(JSON.stringify(out));
  } else {
    console.log(`read-footprint — ${r.target.ticket} (${r.target.file})`);
    console.log(`  Read footprint: ${fmtTok(r.target.readTokens)}`);
    if (r.baselineTokens == null) {
      console.log(`  baseline: insufficient history (${r.baselineSize} prior builds with a Read footprint) — no regression check`);
    } else {
      console.log(`  baseline: ${fmtTok(r.baselineTokens)} median over ${r.baselineSize} prior builds; regression threshold ${fmtTok(Math.round(r.threshold))} (×${r.margin})`);
      console.log(r.regression ? `  VERDICT: REGRESSION — this build's Read footprint exceeds the baseline threshold` : `  VERDICT: OK — within baseline`);
    }
  }

  return args.strict && r.regression ? 3 : 0;
}

const isMain = process.argv[1] && process.argv[1].endsWith("read-footprint.mjs");
if (isMain) {
  let code = 0;
  try {
    code = main();
  } catch (e) {
    console.error(`read-footprint: ${e.message}`);
    code = 0; // measurement is best-effort — never fail a caller on a meter bug
  }
  process.exit(code);
}
