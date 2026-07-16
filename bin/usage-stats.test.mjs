#!/usr/bin/env node
// Tests for usage-stats.mjs — the streaming scan() counters that back §8.5's
// per-session monitoring (V-1 Part 4): token sums, tool-call census, compound-Bash
// detection (` && `), and the failed-call census (tool_result.is_error).
// Run: node bin/usage-stats.test.mjs   (exit 0 = pass, 1 = fail)

import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scan, selectTranscript, parseBillingContext } from "./usage-stats.mjs";

let fails = 0;
function check(name, cond) {
  console.log(`[${cond ? "ok" : "FAIL"}] ${name}`);
  if (!cond) fails++;
}

// A synthetic transcript: 2 assistant turns (one with a compound Bash, one with a
// plain Bash + Edit) and 2 user turns carrying tool_results (2 errors, 1 success).
// Includes a blank line and a malformed line to prove the stream skips both.
const lines = [
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-06-01T10:00:00.000Z",
    message: {
      model: "gpt-5.6-sol",
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: 3,
      },
      content: [{ type: "tool_use", name: "Bash", input: { command: "git add . && git commit -m x" } }],
    },
  }),
  "",
  "{ this is not json",
  JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", is_error: true }, { type: "tool_result", is_error: false }] },
  }),
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-06-01T10:05:00.000Z",
    message: {
      model: "claude-opus-4-8",
      usage: { input_tokens: 1, output_tokens: 2 },
      content: [
        { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
        { type: "tool_use", name: "Edit" },
      ],
    },
  }),
  JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", is_error: true }] } }),
];

const fixture = join(tmpdir(), `usage-stats-test-${process.pid}.jsonl`);
writeFileSync(fixture, lines.join("\n") + "\n");

try {
  const r = await scan(fixture);

  check("sums input tokens across turns", r.totals.input === 11);
  check("sums output tokens across turns", r.totals.output === 22);
  check("sums cache_read", r.totals.cache_read === 5);
  check("sums cache_create", r.totals.cache_create === 3);
  check("counts assistant messages (skips blank + malformed)", r.totals.assistant_msg_count === 2);

  check("tool census: Bash counted twice", r.toolCalls.Bash === 2);
  check("tool census: Edit counted once", r.toolCalls.Edit === 1);

  check("compound-Bash detection fires only on ' && '", r.compoundBash === 1);
  check("failed-call census counts only is_error===true", r.failedCalls === 2);

  check("first assistant ts captured", r.firstAssistantTs === "2026-06-01T10:00:00.000Z");
  check("last assistant ts captured", r.lastAssistantTs === "2026-06-01T10:05:00.000Z");

  check("persists one record per assistant usage", r.assistantUsage.length === 2);
  check("usage records carry stable assistant ordinals", r.assistantUsage[0].ordinal === 1 && r.assistantUsage[1].ordinal === 2);
  check("usage records preserve exact model ids", r.assistantUsage[0].model_id === "gpt-5.6-sol" && r.assistantUsage[1].model_id === "claude-opus-4-8");
  check("aggregates mixed-model usage", r.usageByModel["gpt-5.6-sol"].totals.output === 20 && r.usageByModel["claude-opus-4-8"].totals.output === 2);
  check("per-command bucket retains model split", Object.keys(r.byCommand["(uncommanded)"].usage_by_model).length === 2);
} finally {
  try {
    unlinkSync(fixture);
  } catch {
    /* ignore */
  }
}

// Missing message.model is retained as null and never replaced with a priced model.
{
  const missingFixture = join(tmpdir(), `usage-stats-missing-model-${process.pid}.jsonl`);
  writeFileSync(
    missingFixture,
    JSON.stringify({ type: "assistant", timestamp: "2026-06-01T11:00:00.000Z", message: { usage: { output_tokens: 7 } } }) + "\n"
  );
  try {
    const r = await scan(missingFixture);
    check("missing model is explicit on the usage record", r.assistantUsage[0].model_id === null);
    check("missing model aggregates in its own bucket", r.usageByModel["(missing-model)"].totals.output === 7);
  } finally {
    unlinkSync(missingFixture);
  }
}

// Billing mode defaults are honest and exact model overrides are supported.
{
  const fromEnv = parseBillingContext({}, { V_USAGE_BILLING_MODE: "subscription" });
  check("billing default can come from env", fromEnv.default_mode === "subscription" && fromEnv.source === "env");
  const mixed = parseBillingContext(
    { "billing-mode": "subscription", "billing-model": ["gpt-5.6-sol=actual-api"] },
    {}
  );
  check("per-model billing override parses", mixed.model_overrides["gpt-5.6-sol"] === "actual-api");
}

// --- selectTranscript: the --session exact/prefix resolution rule (V-76) -------
{
  const corpus = [
    "8fe27a29-1111-2222-3333-444455556666",
    "012d7c2a-aaaa-bbbb-cccc-ddddeeeeffff",
    "012d7c2a-9999-8888-7777-666655554444",
    "a25c272e-0000-1111-2222-333344445555",
  ];
  const exact = selectTranscript(corpus, "a25c272e-0000-1111-2222-333344445555");
  check("selectTranscript: full id → exact", exact.kind === "exact");

  const unique = selectTranscript(corpus, "8fe27a29");
  check(
    "selectTranscript: unique prefix → unique + full sid",
    unique.kind === "unique" && unique.sid === "8fe27a29-1111-2222-3333-444455556666"
  );

  const none = selectTranscript(corpus, "deadbeef");
  check("selectTranscript: no match → none", none.kind === "none");

  const ambiguous = selectTranscript(corpus, "012d7c2a");
  check(
    "selectTranscript: prefix matching ≥2 → ambiguous + candidates",
    ambiguous.kind === "ambiguous" && ambiguous.matches.length === 2
  );

  const exactBeatsPrefix = selectTranscript(["abc", "abcdef"], "abc");
  check("selectTranscript: exact wins even when it also prefixes another", exactBeatsPrefix.kind === "exact");
}

console.log(fails === 0 ? "\nAll tests passed." : `\n${fails} test(s) FAILED.`);
process.exit(fails === 0 ? 0 : 1);
