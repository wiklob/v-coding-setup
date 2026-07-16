#!/usr/bin/env node
// Tests for sourced pricing, billing classification, and cumulative snapshot allocation.

import {
  PRICING_CATALOG,
  accountModelUsage,
  accountUsageByModel,
  allocateUsageStats,
  resolvePrice,
} from "./usage-accounting.mjs";
import { scan } from "./usage-stats.mjs";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let fails = 0;
function check(name, cond) {
  console.log(`[${cond ? "ok" : "FAIL"}] ${name}`);
  if (!cond) fails++;
}

const usage = { input: 1_000_000, output: 100_000, cache_read: 2_000_000, cache_create: 200_000, assistant_msg_count: 1 };

check(
  "every price carries complete provenance + four rates",
  PRICING_CATALOG.every(
    (p) =>
      p.provider &&
      p.canonical_model &&
      p.source_url.startsWith("https://") &&
      /^\d{4}-\d{2}-\d{2}$/.test(p.retrieved_at) &&
      /^\d{4}-\d{2}-\d{2}$/.test(p.effective_at) &&
      p.currency === "USD" &&
      ["input", "output", "cache_read", "cache_create"].every((k) => Number.isFinite(p.rates_per_million[k]))
  )
);

{
  const r = resolvePrice("gpt-5.6-sol", "2026-07-15T12:00:00Z");
  check("exact known model resolves to its provider", r.status === "priced" && r.price.provider === "openai");
  check("unknown model has no family fallback", resolvePrice("gpt-5.6-sol-custom", "2026-07-15").reason === "unknown-model");
  check("missing model stays missing/unpriced", resolvePrice(null, "2026-07-15").reason === "missing-model");
}

{
  const staleCatalog = [{
    provider: "test",
    canonical_model: "test-model",
    model_ids: ["test-model"],
    source_url: "https://example.com/pricing",
    retrieved_at: "2025-01-01",
    effective_at: "2025-01-01",
    currency: "USD",
    rates_per_million: { input: 1, output: 1, cache_read: 1, cache_create: 1 },
  }];
  const r = resolvePrice("test-model", "2026-07-15", staleCatalog, 90);
  check("stale pricing becomes unpriced", r.status === "unpriced" && r.reason === "stale-pricing");
}

{
  const actual = accountModelUsage("gpt-5.6-sol", usage, {
    asOf: "2026-07-15",
    billingContext: { default_mode: "actual-api" },
  });
  const equivalent = accountModelUsage("gpt-5.6-sol", usage, {
    asOf: "2026-07-15",
    billingContext: { default_mode: "unknown" },
  });
  const subscription = accountModelUsage("gpt-5.6-sol", usage, {
    asOf: "2026-07-15",
    billingContext: { default_mode: "subscription" },
  });
  check("actual API mode labels a bill estimate", actual.classification === "actual API estimate" && actual.estimate_usd > 0);
  check("unknown billing mode labels API-equivalent", equivalent.classification === "API-equivalent estimate" && equivalent.estimate_usd > 0);
  check(
    "subscription has no token bill but retains comparison",
    subscription.classification === "subscription usage — no token bill" && subscription.estimate_usd === null && subscription.api_equivalent_usd > 0
  );
}

{
  const accounted = accountUsageByModel(
    {
      gpt: { model_id: "gpt-5.6-sol", totals: usage },
      mystery: { model_id: "mystery-9", totals: { output: 50, assistant_msg_count: 1 } },
    },
    { asOf: "2026-07-15", billingContext: { default_mode: "subscription", model_overrides: { "gpt-5.6-sol": "actual-api" } } }
  );
  check("per-model billing override wins", accounted.models.find((m) => m.observed_model === "gpt-5.6-sol")?.classification === "actual API estimate");
  check("unknown model remains unknown even under subscription default", accounted.models.find((m) => m.observed_model === "mystery-9")?.classification === "unknown/unpriced");
}

{
  const record = (ordinal, model, output) => ({ ordinal, model_id: model, usage: { output } });
  const rows = [
    {
      ticket: "V-1",
      session_id: "s1",
      completed_at: "2026-07-15T10:00:00Z",
      totals: { output: 30, assistant_msg_count: 2 },
      assistant_usage: [record(1, "claude-opus-4-8", 10), record(2, "gpt-5.6-sol", 20)],
    },
    {
      ticket: "V-2",
      session_id: "s1",
      completed_at: "2026-07-15T11:00:00Z",
      totals: { output: 60, assistant_msg_count: 3 },
      assistant_usage: [record(1, "claude-opus-4-8", 10), record(2, "gpt-5.6-sol", 20), record(3, "gpt-5.6-sol", 30)],
    },
  ];
  const allocations = allocateUsageStats(rows);
  check("record snapshots allocate first land without loss", allocations[0].totals.output === 30);
  check("record snapshots do not double-count on next land", allocations[1].totals.output === 30);
  check("mixed models survive allocation", Object.keys(allocations[0].usage_by_model).length === 2);
}

{
  const legacy = allocateUsageStats([
    { ticket: "V-1", session_id: "old", completed_at: "2026-01-01T10:00:00Z", totals: { output: 100, input: 10 } },
    { ticket: "V-2", session_id: "old", completed_at: "2026-01-01T11:00:00Z", totals: { output: 140, input: 15 } },
  ]);
  check("legacy first snapshot remains readable", legacy[0].totals.output === 100);
  check("legacy later snapshot uses a non-negative delta", legacy[1].totals.output === 40 && legacy[1].totals.input === 5);
  check("legacy deltas are model-unknown/unpriced", legacy[1].accounting.models[0]?.reason === "missing-model");
}

{
  // Reset-aware legacy deltas: a mid-session counter reset must not lose the reset snapshot.
  const legacy = allocateUsageStats([
    { ticket: "V-1", session_id: "r", completed_at: "2026-01-01T10:00:00Z", totals: { output: 100 } },
    { ticket: "V-2", session_id: "r", completed_at: "2026-01-01T11:00:00Z", totals: { output: 20 } },
    { ticket: "V-3", session_id: "r", completed_at: "2026-01-01T12:00:00Z", totals: { output: 40 } },
  ]);
  check("counter reset keeps the reset snapshot's own usage", legacy[1].totals.output === 20 && legacy[2].totals.output === 20);
}

{
  // Prototype-polluting model IDs must not crash aggregation.
  const accounted = accountUsageByModel(
    { poison: { model_id: "__proto__", totals: { output: 5, assistant_msg_count: 1 } } },
    { asOf: "2026-07-15", billingContext: { default_mode: "unknown" } }
  );
  check("prototype-named model is handled safely", accounted.models[0].observed_model === "__proto__" && accounted.models[0].classification === "unknown/unpriced");
}

{
  // Per-record timestamps drive pricing across an effective-date boundary.
  const boundary = accountModelUsage; // referenced for clarity
  void boundary;
  const rows = allocateUsageStats([
    {
      ticket: "V-X",
      session_id: "b",
      completed_at: "2026-09-01T00:10:00Z",
      totals: { output: 2_000_000, assistant_msg_count: 2 },
      billing_context: { default_mode: "actual-api" },
      assistant_usage: [
        { ordinal: 1, timestamp: "2026-08-31T23:50:00Z", model_id: "claude-sonnet-5", usage: { output: 1_000_000 } },
        { ordinal: 2, timestamp: "2026-09-01T00:05:00Z", model_id: "claude-sonnet-5", usage: { output: 1_000_000 } },
      ],
    },
  ]);
  const estimate = rows[0].accounting.totals.actual_api_estimate_usd;
  // Aug 31 tokens priced at $10/Mtok, Sep 1 tokens at $15/Mtok → $25, not 2×$15.
  check("per-record timestamp prices across a rate boundary", Math.round(estimate) === 25);
}

{
  // Legacy → record transition keeps exact model attribution when totals reconcile.
  const rows = allocateUsageStats([
    { ticket: "V-A", session_id: "t", completed_at: "2026-07-15T10:00:00Z", totals: { output: 10, assistant_msg_count: 1 } },
    {
      ticket: "V-B",
      session_id: "t",
      completed_at: "2026-07-15T11:00:00Z",
      totals: { output: 30, assistant_msg_count: 2 },
      billing_context: { default_mode: "actual-api" },
      assistant_usage: [
        { ordinal: 1, model_id: "claude-opus-4-8", usage: { output: 10 } },
        { ordinal: 2, model_id: "gpt-5.6-sol", usage: { output: 20 } },
      ],
    },
  ]);
  check("legacy→record transition allocates only the delta (20), not 50", rows[1].totals.output === 20);
  check("legacy→record transition recovers the exact model", rows[1].usage_by_model["gpt-5.6-sol"]?.totals.output === 20);
}

{
  // Request-level dedup: the transcript repeats the same usage per content block.
  const rid = "req-1";
  const line = (extra) => JSON.stringify({ type: "assistant", timestamp: "2026-07-15T10:00:00.000Z", requestId: rid, message: { model: "gpt-5.6-sol", usage: { output_tokens: 20 }, ...extra } });
  const fixture = join(tmpdir(), `usage-accounting-dedup-${process.pid}.jsonl`);
  writeFileSync(fixture, [line(), line({ content: [{ type: "text", text: "x" }] })].join("\n") + "\n");
  try {
    const r = await scan(fixture);
    check("repeated content-block usage lines count once per request", r.totals.output === 20 && r.assistantUsage.length === 1);
  } finally {
    unlinkSync(fixture);
  }
}

console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILED"}`);
process.exit(fails === 0 ? 0 : 1);
