#!/usr/bin/env node
// Shared model-aware token accounting for usage-stats, scorecard, and daily reports.
// Prices are estimates, never invoices: the billing mode determines whether a
// priced record is an actual API estimate, an API-equivalent comparison, or
// subscription usage with no token bill.

const TOKEN_KEYS = ["input", "output", "cache_read", "cache_create"];
const MISSING_MODEL_KEY = "(missing-model)";
const PRICE_MAX_AGE_DAYS = 180;
const BILLING_MODES = new Set(["actual-api", "subscription", "unknown"]);

// Official first-party API prices, USD per million tokens. IDs are exact aliases;
// an unlisted route/model stays unknown rather than inheriting family pricing.
const PRICING_CATALOG = [
  {
    provider: "anthropic",
    canonical_model: "claude-fable-5",
    model_ids: ["claude-fable-5"],
    source_url: "https://platform.claude.com/docs/en/docs/about-claude/pricing",
    retrieved_at: "2026-07-15",
    effective_at: "2026-06-09",
    currency: "USD",
    rates_per_million: { input: 10, output: 50, cache_create: 12.5, cache_read: 1 },
  },
  {
    provider: "anthropic",
    canonical_model: "claude-opus-4-8",
    model_ids: ["claude-opus-4-8"],
    source_url: "https://www.anthropic.com/news/claude-opus-4-8",
    retrieved_at: "2026-07-15",
    effective_at: "2026-05-28",
    currency: "USD",
    rates_per_million: { input: 5, output: 25, cache_create: 6.25, cache_read: 0.5 },
  },
  {
    provider: "anthropic",
    canonical_model: "claude-sonnet-5",
    model_ids: ["claude-sonnet-5"],
    source_url: "https://platform.claude.com/docs/en/docs/about-claude/pricing",
    retrieved_at: "2026-07-15",
    effective_at: "2026-06-30",
    expires_at: "2026-08-31",
    currency: "USD",
    rates_per_million: { input: 2, output: 10, cache_create: 2.5, cache_read: 0.2 },
  },
  {
    provider: "anthropic",
    canonical_model: "claude-sonnet-5",
    model_ids: ["claude-sonnet-5"],
    source_url: "https://platform.claude.com/docs/en/docs/about-claude/pricing",
    retrieved_at: "2026-07-15",
    effective_at: "2026-09-01",
    currency: "USD",
    rates_per_million: { input: 3, output: 15, cache_create: 3.75, cache_read: 0.3 },
  },
  {
    provider: "anthropic",
    canonical_model: "claude-haiku-4-5",
    model_ids: ["claude-haiku-4-5", "claude-haiku-4-5-20251001"],
    source_url: "https://platform.claude.com/docs/en/docs/about-claude/pricing",
    retrieved_at: "2026-07-15",
    effective_at: "2025-10-01",
    currency: "USD",
    rates_per_million: { input: 1, output: 5, cache_create: 1.25, cache_read: 0.1 },
  },
  {
    provider: "openai",
    canonical_model: "gpt-5.6-sol",
    model_ids: ["gpt-5.6-sol"],
    source_url: "https://openai.com/index/gpt-5-6/",
    retrieved_at: "2026-07-15",
    effective_at: "2026-07-09",
    currency: "USD",
    rates_per_million: { input: 5, output: 30, cache_create: 6.25, cache_read: 0.5 },
  },
  {
    provider: "openai",
    canonical_model: "gpt-5.6-terra",
    model_ids: ["gpt-5.6-terra"],
    source_url: "https://openai.com/index/gpt-5-6/",
    retrieved_at: "2026-07-15",
    effective_at: "2026-07-09",
    currency: "USD",
    rates_per_million: { input: 2.5, output: 15, cache_create: 3.125, cache_read: 0.25 },
  },
  {
    provider: "openai",
    canonical_model: "gpt-5.6-luna",
    model_ids: ["gpt-5.6-luna"],
    source_url: "https://openai.com/index/gpt-5-6/",
    retrieved_at: "2026-07-15",
    effective_at: "2026-07-09",
    currency: "USD",
    rates_per_million: { input: 1, output: 6, cache_create: 1.25, cache_read: 0.1 },
  },
];

function blankUsage() {
  return { input: 0, output: 0, cache_read: 0, cache_create: 0, assistant_msg_count: 0 };
}

function normalizeUsage(value = {}) {
  const out = blankUsage();
  for (const key of TOKEN_KEYS) out[key] = Number(value[key]) || 0;
  out.assistant_msg_count = Number(value.assistant_msg_count) || 0;
  return out;
}

function addUsage(target, value) {
  const src = normalizeUsage(value);
  for (const key of TOKEN_KEYS) target[key] = (target[key] || 0) + src[key];
  target.assistant_msg_count = (target.assistant_msg_count || 0) + src.assistant_msg_count;
  return target;
}

function diffUsage(current, previous) {
  const now = normalizeUsage(current);
  const before = normalizeUsage(previous);
  const reset = [...TOKEN_KEYS, "assistant_msg_count"].some((key) => now[key] < before[key]);
  if (reset) return now;
  const out = blankUsage();
  for (const key of TOKEN_KEYS) out[key] = now[key] - before[key];
  out.assistant_msg_count = now.assistant_msg_count - before.assistant_msg_count;
  return out;
}

function usageFromRecord(record = {}) {
  return normalizeUsage({ ...(record.usage || record), assistant_msg_count: 1 });
}

function modelKey(modelId) {
  return typeof modelId === "string" && modelId.trim() ? modelId.trim() : MISSING_MODEL_KEY;
}

function addModelUsage(map, modelId, usage) {
  const key = modelKey(modelId);
  let entry = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
  if (!entry || !entry.totals) {
    entry = { model_id: key === MISSING_MODEL_KEY ? null : key, totals: blankUsage() };
    map[key] = entry;
  }
  addUsage(entry.totals, usage);
  return entry;
}

function usageByModelFromRecords(records = []) {
  const out = Object.create(null);
  for (const record of records) addModelUsage(out, record.model_id, usageFromRecord(record));
  return out;
}

function usageByCommandFromRecords(records = []) {
  const out = Object.create(null);
  for (const record of records) {
    const command = record.command || "(uncommanded)";
    const bucket = (out[command] ||= { ...blankUsage(), tool_calls: {}, usage_by_model: {} });
    const usage = usageFromRecord(record);
    addUsage(bucket, usage);
    addModelUsage(bucket.usage_by_model, record.model_id, usage);
  }
  return out;
}

function diffByCommand(current = {}, previous = {}) {
  const out = Object.create(null);
  for (const command of new Set([...Object.keys(current), ...Object.keys(previous)])) {
    const totals = diffUsage(current[command], previous[command]);
    if (TOKEN_KEYS.some((key) => totals[key]) || totals.assistant_msg_count) {
      out[command] = { ...totals, tool_calls: {}, usage_by_model: {} };
    }
  }
  return out;
}

function diffNumberMap(current = {}, previous = {}) {
  const out = Object.create(null);
  for (const key of new Set([...Object.keys(current || {}), ...Object.keys(previous || {})])) {
    const now = Number(current?.[key]) || 0;
    const before = Number(previous?.[key]) || 0;
    const delta = now < before ? now : now - before;
    if (delta) out[key] = delta;
  }
  return out;
}

function validDate(value) {
  const n = Date.parse(value || "");
  return Number.isFinite(n) ? n : null;
}

function resolvePrice(modelId, asOf, catalog = PRICING_CATALOG, maxAgeDays = PRICE_MAX_AGE_DAYS) {
  if (!modelId) return { status: "unpriced", reason: "missing-model", price: null };
  const at = validDate(asOf);
  if (asOf && at == null) return { status: "unpriced", reason: "invalid-as-of", price: null };
  const candidates = catalog
    .filter((entry) => entry.model_ids.includes(modelId))
    .filter((entry) => {
      const effective = validDate(entry.effective_at);
      const expires = validDate(entry.expires_at);
      return at == null || ((effective == null || effective <= at) && (expires == null || at <= expires + 86_399_999));
    })
    .sort((a, b) => (validDate(b.effective_at) || 0) - (validDate(a.effective_at) || 0));
  const price = candidates[0];
  if (!price) return { status: "unpriced", reason: "unknown-model", price: null };

  const retrieved = validDate(price.retrieved_at);
  const ageDays = at != null && retrieved != null ? Math.floor((at - retrieved) / 86_400_000) : 0;
  if (ageDays > maxAgeDays) {
    return { status: "unpriced", reason: "stale-pricing", price, age_days: ageDays };
  }
  return { status: "priced", reason: null, price, age_days: Math.max(0, ageDays) };
}

function normalizeBillingMode(value) {
  const mode = value == null || value === "" ? "unknown" : String(value);
  if (!BILLING_MODES.has(mode)) throw new Error(`invalid billing mode '${mode}' (expected actual-api, subscription, or unknown)`);
  return mode;
}

function billingModeFor(modelId, context = {}) {
  const overrides = context.model_overrides || {};
  try {
    if (modelId && Object.prototype.hasOwnProperty.call(overrides, modelId)) return normalizeBillingMode(overrides[modelId]);
    return normalizeBillingMode(context.default_mode);
  } catch {
    return "unknown"; // tolerate malformed historical/runtime JSON; writers validate on input
  }
}

function estimateUsd(usage, rates) {
  const t = normalizeUsage(usage);
  return TOKEN_KEYS.reduce((sum, key) => sum + t[key] * (rates[key] || 0), 0) / 1e6;
}

function accountModelUsage(modelId, usage, { asOf, billingContext = {}, catalog = PRICING_CATALOG, maxAgeDays } = {}) {
  const totals = normalizeUsage(usage);
  const resolved = resolvePrice(modelId, asOf, catalog, maxAgeDays);
  const billingMode = billingModeFor(modelId, billingContext);
  const base = {
    observed_model: modelId || null,
    canonical_model: resolved.price?.canonical_model ?? null,
    provider: resolved.price?.provider ?? null,
    billing_mode: billingMode,
    totals,
    currency: resolved.price?.currency ?? null,
    classification: "unknown/unpriced",
    estimate_usd: null,
    api_equivalent_usd: null,
    reason: resolved.reason,
    pricing: resolved.price
      ? {
          provider: resolved.price.provider,
          canonical_model: resolved.price.canonical_model,
          source_url: resolved.price.source_url,
          retrieved_at: resolved.price.retrieved_at,
          effective_at: resolved.price.effective_at,
          expires_at: resolved.price.expires_at ?? null,
          currency: resolved.price.currency,
          rates_per_million: resolved.price.rates_per_million,
          age_days: resolved.age_days ?? null,
        }
      : null,
  };
  if (resolved.status !== "priced") return base;

  const equivalent = estimateUsd(totals, resolved.price.rates_per_million);
  base.api_equivalent_usd = equivalent;
  base.reason = null;
  if (billingMode === "actual-api") {
    base.classification = "actual API estimate";
    base.estimate_usd = equivalent;
  } else if (billingMode === "subscription") {
    base.classification = "subscription usage — no token bill";
  } else {
    base.classification = "API-equivalent estimate";
    base.estimate_usd = equivalent;
  }
  return base;
}

function accountUsageByModel(usageByModel = {}, options = {}) {
  const models = Object.values(usageByModel)
    .map((entry) => accountModelUsage(entry.model_id, entry.totals, options))
    .sort((a, b) => (b.api_equivalent_usd || 0) - (a.api_equivalent_usd || 0));
  const totals = {
    actual_api_estimate_usd: 0,
    api_equivalent_estimate_usd: 0,
    subscription_api_equivalent_usd: 0,
    unknown_unpriced_tokens: blankUsage(),
  };
  for (const model of models) {
    if (model.classification === "actual API estimate") totals.actual_api_estimate_usd += model.estimate_usd || 0;
    else if (model.classification === "API-equivalent estimate") totals.api_equivalent_estimate_usd += model.estimate_usd || 0;
    else if (model.classification === "subscription usage — no token bill") totals.subscription_api_equivalent_usd += model.api_equivalent_usd || 0;
    else addUsage(totals.unknown_unpriced_tokens, model.totals);
  }
  return { currency: "USD", models, totals };
}

function accountingForRecords(records, options = {}) {
  return summarizeAccounting(
    records.map((record) =>
      accountUsageByModel(
        { [modelKey(record.model_id)]: { model_id: record.model_id ?? null, totals: usageFromRecord(record) } },
        { ...options, asOf: record.timestamp || options.asOf }
      )
    )
  );
}

function allocationFromRecords(stat, records) {
  const usageByModel = usageByModelFromRecords(records);
  const totals = Object.values(usageByModel).reduce((sum, entry) => addUsage(sum, entry.totals), blankUsage());
  const billingContext = stat.billing_context || { default_mode: "unknown", model_overrides: {} };
  return {
    ...stat,
    totals,
    assistant_usage: records,
    usage_by_model: usageByModel,
    by_command: usageByCommandFromRecords(records),
    accounting: accountingForRecords(records, { asOf: stat.completed_at, billingContext }),
  };
}

function usageEqual(a, b) {
  const left = normalizeUsage(a);
  const right = normalizeUsage(b);
  return [...TOKEN_KEYS, "assistant_msg_count"].every((key) => left[key] === right[key]);
}

function unknownAllocation(stat, totals, byCommand, note) {
  const usageByModel = Object.create(null);
  const hasUsage = [...TOKEN_KEYS, "assistant_msg_count"].some((key) => totals[key]);
  if (hasUsage) addModelUsage(usageByModel, null, totals);
  return {
    ...stat,
    totals,
    assistant_usage: [],
    usage_by_model: usageByModel,
    by_command: byCommand,
    accounting: accountUsageByModel(usageByModel, {
      asOf: stat.completed_at,
      billingContext: stat.billing_context || {},
    }),
    allocation_note: note,
  };
}

// Stats files may be cumulative snapshots or v2 delta-record snapshots. Stable
// ordinals assign each request once; legacy/malformed boundaries fall back to a
// reset-aware top-level delta and remain model-unknown rather than double-counting.
function allocateUsageStats(stats = []) {
  const ordered = stats
    .map((stat, index) => ({ stat, index }))
    .sort((a, b) => {
      const completed = String(a.stat.completed_at || "").localeCompare(String(b.stat.completed_at || ""));
      if (completed) return completed;
      if (a.stat.session_id && a.stat.session_id === b.stat.session_id) {
        const snapshot = (Number(a.stat.snapshot_ordinal) || 0) - (Number(b.stat.snapshot_ordinal) || 0);
        if (snapshot) return snapshot;
      }
      return String(a.stat._source_file || "").localeCompare(String(b.stat._source_file || "")) || a.index - b.index;
    });
  const states = new Map();
  const allocations = [];

  for (const { stat, index } of ordered) {
    const sessionKey = stat.session_id || `file:${index}`;
    const state = states.get(sessionKey) || {
      seenOrdinals: new Set(),
      previousTotals: blankUsage(),
      previousByCommand: {},
      previousToolBytes: {},
      previousToolCounts: {},
      legacyBoundary: false,
    };
    const expected = diffUsage(stat.totals, state.previousTotals);
    const commandDelta = diffByCommand(stat.by_command, state.previousByCommand);
    let allocation;

    if (Array.isArray(stat.assistant_usage) && stat.assistant_usage.every((r) => Number.isInteger(r.ordinal) && r.ordinal > 0)) {
      const records = stat.assistant_usage;
      if (state.legacyBoundary) {
        const suffix = records.filter(
          (record) => record.ordinal > state.previousTotals.assistant_msg_count && !state.seenOrdinals.has(record.ordinal)
        );
        const candidate = allocationFromRecords(stat, suffix);
        allocation = usageEqual(candidate.totals, expected)
          ? candidate
          : unknownAllocation(stat, expected, commandDelta, "legacy/record boundary could not preserve exact model attribution");
        for (const record of records) state.seenOrdinals.add(record.ordinal);
        state.legacyBoundary = false;
      } else {
        const fresh = records.filter((record) => {
          if (state.seenOrdinals.has(record.ordinal)) return false;
          state.seenOrdinals.add(record.ordinal);
          return true;
        });
        allocation = allocationFromRecords(stat, fresh);
      }
    } else {
      allocation = unknownAllocation(
        stat,
        expected,
        commandDelta,
        Array.isArray(stat.assistant_usage)
          ? "assistant usage records lacked stable ordinals; top-level delta retained as model-unknown"
          : "legacy cumulative snapshot delta; model unavailable"
      );
      state.legacyBoundary = true;
    }

    allocation.tool_result_bytes = diffNumberMap(stat.tool_result_bytes, state.previousToolBytes);
    allocation.tool_result_count = diffNumberMap(stat.tool_result_count, state.previousToolCounts);
    state.previousTotals = normalizeUsage(stat.totals);
    state.previousByCommand = stat.by_command || {};
    state.previousToolBytes = stat.tool_result_bytes || {};
    state.previousToolCounts = stat.tool_result_count || {};
    states.set(sessionKey, state);
    allocations.push(allocation);
  }
  return allocations;
}

function mergeUsageByModel(target, source) {
  for (const entry of Object.values(source || {})) addModelUsage(target, entry.model_id, entry.totals);
  return target;
}

function summarizeAccounting(accountings = []) {
  const models = new Map();
  const totals = {
    actual_api_estimate_usd: 0,
    api_equivalent_estimate_usd: 0,
    subscription_api_equivalent_usd: 0,
    unknown_unpriced_tokens: blankUsage(),
  };
  for (const accounting of accountings) {
    const sourceTotals = accounting?.totals || {};
    totals.actual_api_estimate_usd += sourceTotals.actual_api_estimate_usd || 0;
    totals.api_equivalent_estimate_usd += sourceTotals.api_equivalent_estimate_usd || 0;
    totals.subscription_api_equivalent_usd += sourceTotals.subscription_api_equivalent_usd || 0;
    addUsage(totals.unknown_unpriced_tokens, sourceTotals.unknown_unpriced_tokens);
    for (const model of accounting?.models || []) {
      const key = [model.observed_model, model.billing_mode, model.classification, model.reason, model.pricing?.source_url, model.pricing?.effective_at].join("|");
      const merged = models.get(key) || {
        ...model,
        totals: blankUsage(),
        estimate_usd: model.estimate_usd == null ? null : 0,
        api_equivalent_usd: model.api_equivalent_usd == null ? null : 0,
      };
      addUsage(merged.totals, model.totals);
      if (model.estimate_usd != null) merged.estimate_usd += model.estimate_usd;
      if (model.api_equivalent_usd != null) merged.api_equivalent_usd += model.api_equivalent_usd;
      models.set(key, merged);
    }
  }
  return {
    currency: "USD",
    models: [...models.values()].sort((a, b) => (b.api_equivalent_usd || 0) - (a.api_equivalent_usd || 0)),
    totals,
  };
}

function summarizeAllocations(allocations = []) {
  const totals = blankUsage();
  const usageByModel = {};
  for (const row of allocations) {
    addUsage(totals, row.totals);
    mergeUsageByModel(usageByModel, row.usage_by_model);
  }
  return {
    totals,
    usage_by_model: usageByModel,
    accounting: summarizeAccounting(allocations.map((row) => row.accounting)),
  };
}

export {
  TOKEN_KEYS,
  MISSING_MODEL_KEY,
  PRICE_MAX_AGE_DAYS,
  PRICING_CATALOG,
  blankUsage,
  normalizeUsage,
  addUsage,
  diffUsage,
  usageFromRecord,
  modelKey,
  addModelUsage,
  usageByModelFromRecords,
  usageByCommandFromRecords,
  diffByCommand,
  diffNumberMap,
  resolvePrice,
  normalizeBillingMode,
  billingModeFor,
  estimateUsd,
  accountModelUsage,
  accountUsageByModel,
  accountingForRecords,
  allocateUsageStats,
  mergeUsageByModel,
  summarizeAccounting,
  summarizeAllocations,
};
