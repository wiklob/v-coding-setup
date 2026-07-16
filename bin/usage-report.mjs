#!/usr/bin/env node
// Model-aware usage window reader. It always allocates the complete stats history
// before filtering, so a cumulative snapshot inside the requested window cannot
// re-count usage captured by an earlier land.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { allocateUsageStats, summarizeAllocations } from "./usage-accounting.mjs";

function loadUsageStats(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(readFileSync(join(dir, file), "utf8")));
    } catch (e) {
      process.stderr.write(`usage-report: WARN bad usage-stats ${file}: ${e.message}\n`);
    }
  }
  return out;
}

function inWindow(row, { date, since, until } = {}) {
  const completed = row.completed_at || "";
  if (date && !completed.startsWith(date)) return false;
  if (since && completed < since) return false;
  if (until && completed >= until) return false;
  return true;
}

function buildUsageReport(stats, window = {}) {
  const allocations = allocateUsageStats(stats);
  const selected = allocations.filter((row) => inWindow(row, window));
  const summary = summarizeAllocations(selected);
  return {
    window: {
      date: window.date || null,
      since: window.since || null,
      until: window.until || null,
    },
    stats_files_scanned: stats.length,
    sessions_scanned: new Set(stats.map((s) => s.session_id).filter(Boolean)).size || stats.length,
    lands: selected.map((row) => ({
      ticket: row.ticket ?? null,
      pr: row.pr ?? null,
      completed_at: row.completed_at ?? null,
      session_id: row.session_id ?? null,
      totals: row.totals,
      usage_by_model: row.usage_by_model,
      accounting: row.accounting,
      allocation_note: row.allocation_note ?? null,
    })),
    totals: summary.totals,
    usage_by_model: summary.usage_by_model,
    accounting: summary.accounting,
  };
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString("en-US");
}
function fmtUsd(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function accountingText(model) {
  const name = model.observed_model || "(missing-model)";
  if (model.classification === "subscription usage — no token bill") {
    return `${name}: subscription usage — no token bill (API equivalent ${fmtUsd(model.api_equivalent_usd)})`;
  }
  if (model.classification === "unknown/unpriced") return `${name}: unknown/unpriced (${model.reason || "no price"})`;
  return `${name}: ${model.classification} ${fmtUsd(model.estimate_usd)}`;
}

function renderUsageReport(report) {
  const L = [];
  const label = report.window.date || `${report.window.since || "beginning"} → ${report.window.until || "now"}`;
  L.push(`# Usage report — ${label}`);
  L.push("");
  L.push(`- ${report.lands.length} land allocation(s) · output ${fmtNum(report.totals.output)} · input ${fmtNum(report.totals.input)} · cache-read ${fmtNum(report.totals.cache_read)} · cache-create ${fmtNum(report.totals.cache_create)}`);
  for (const model of report.accounting.models) L.push(`- ${accountingText(model)}`);
  L.push("");
  L.push("## Lands");
  if (!report.lands.length) L.push("- none");
  for (const land of report.lands) {
    L.push(`- ${land.ticket || "(unknown ticket)"} · output ${fmtNum(land.totals.output)} · cache-read ${fmtNum(land.totals.cache_read)}`);
    for (const model of land.accounting.models) L.push(`  - ${accountingText(model)}`);
  }
  return L.join("\n");
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") out.json = true;
    else if (["--date", "--since", "--until", "--stats-dir"].includes(arg)) {
      if (!argv[i + 1]) return null;
      out[arg.slice(2)] = argv[++i];
    } else return null;
  }
  return out;
}

function resolveMainWt() {
  const out = execFileSync("git", ["worktree", "list", "--porcelain"], { encoding: "utf8" });
  const wt = out.split("\n").find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
  if (!wt) throw new Error("could not determine main worktree");
  return wt;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write("usage: usage-report.mjs [--date YYYY-MM-DD | --since ISO [--until ISO]] [--json] [--stats-dir PATH]\n");
    process.exit(2);
  }
  const statsDir = args["stats-dir"] || join(resolveMainWt(), ".claude", "usage-stats");
  const report = buildUsageReport(loadUsageStats(statsDir), args);
  process.stdout.write((args.json ? JSON.stringify(report, null, 2) : renderUsageReport(report)) + "\n");
}

const isMain = process.argv[1] && process.argv[1].endsWith("usage-report.mjs");
if (isMain) main();

export { loadUsageStats, inWindow, buildUsageReport, renderUsageReport, accountingText };
