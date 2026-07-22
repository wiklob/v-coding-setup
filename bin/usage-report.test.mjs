#!/usr/bin/env node
// Tests for date/window filtering after global cumulative-snapshot allocation.

import { buildUsageReport, renderUsageReport } from "./usage-report.mjs";

let fails = 0;
function check(name, cond) {
  console.log(`[${cond ? "ok" : "FAIL"}] ${name}`);
  if (!cond) fails++;
}

const rec = (ordinal, model, output) => ({ ordinal, model_id: model, command: "go", usage: { output } });
const billing = { default_mode: "subscription", model_overrides: { "gpt-5.6-sol": "actual-api" } };
const stats = [
  {
    ticket: "V-OLD",
    session_id: "shared",
    completed_at: "2026-07-14T23:55:00Z",
    totals: { output: 10, assistant_msg_count: 1 },
    assistant_usage: [rec(1, "claude-opus-4-8", 10)],
    billing_context: billing,
  },
  {
    ticket: "V-NEW",
    session_id: "shared",
    completed_at: "2026-07-15T00:10:00Z",
    totals: { output: 30, assistant_msg_count: 2 },
    assistant_usage: [rec(1, "claude-opus-4-8", 10), rec(2, "gpt-5.6-sol", 20)],
    billing_context: billing,
  },
  {
    ticket: "V-MIXED",
    session_id: "other",
    completed_at: "2026-07-15T10:00:00Z",
    totals: { output: 12, assistant_msg_count: 2 },
    assistant_usage: [rec(1, "claude-opus-4-8", 5), rec(2, "mystery-route", 7)],
    billing_context: billing,
  },
];

const report = buildUsageReport(stats, { date: "2026-07-15" });
check("date filter runs after allocation", report.lands.find((l) => l.ticket === "V-NEW")?.totals.output === 20);
check("pre-window cumulative usage is not counted", report.totals.output === 32);
check("daily report retains actual API classification", report.accounting.models.some((m) => m.classification === "actual API estimate"));
check("daily report retains subscription no-bill classification", report.accounting.models.some((m) => m.classification === "subscription usage — no token bill"));
check("daily report retains unknown/unpriced classification", report.accounting.models.some((m) => m.classification === "unknown/unpriced"));

const rendered = renderUsageReport(report);
check("markdown renders subscription label", rendered.includes("subscription usage — no token bill"));
check("markdown renders unknown label", rendered.includes("unknown/unpriced"));
check("markdown renders actual API label", rendered.includes("actual API estimate"));

console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILED"}`);
process.exit(fails === 0 ? 0 : 1);
