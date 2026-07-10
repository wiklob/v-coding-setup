#!/usr/bin/env node
// Tests for log-input-request.mjs — type classification + record shape + redaction. (V-101)
// Run: node bin/log-input-request.test.mjs   (exit 0 = pass, 1 = fail)
//
// Secret-shaped literals here are synthetic (never real credentials).

import { classifyType, buildRecord, manualRecord } from "./log-input-request.mjs";

let fails = 0;
function check(name, cond) {
  console.log(`[${cond ? "ok" : "FAIL"}] ${name}`);
  if (!cond) fails++;
}

const TS = "2026-06-04T00:00:00.000Z";

// --- classifyType: structured field wins (whatever field the real schema uses) ---
check("structured notification_type permission → permission_prompt", classifyType({ notification_type: "permission_prompt" }) === "permission_prompt");
check("structured notification_type idle → idle_prompt", classifyType({ notification_type: "idle_prompt" }) === "idle_prompt");
check("structured type field also honored", classifyType({ type: "permission_request" }) === "permission_prompt");
check("structured matcher field also honored", classifyType({ matcher: "idle_prompt" }) === "idle_prompt");
check("unrecognized structured value recorded verbatim (self-documenting)", classifyType({ notification_type: "auth_success" }) === "auth_success");

// --- classifyType: fall back to message text when no structured field ---
check("message 'needs your permission' → permission_prompt", classifyType({ message: "Claude needs your permission to use Bash" }) === "permission_prompt");
check("message 'waiting for your input' → idle_prompt", classifyType({ message: "Claude is waiting for your input" }) === "idle_prompt");
check("no structured field, no message → unknown", classifyType({ session_id: "s" }) === "unknown");

// --- classifyType: never throws on junk ---
check("classifyType null → unknown", classifyType(null) === "unknown");
check("classifyType non-object → unknown", classifyType("nope") === "unknown");

// --- record shape: all required keys present, type tagged, raw_keys self-documents ---
{
  const rec = buildRecord({ hook_event_name: "Notification", session_id: "s-1", notification_type: "permission_prompt", message: "needs your permission", cwd: "/nonexistent-xyz-repo/someapp" }, TS);
  check("record has ts", rec.ts === TS);
  check("record has session", rec.session === "s-1");
  check("record type classified", rec.type === "permission_prompt");
  check("record has activeCommand key (null when not derivable)", "activeCommand" in rec && rec.activeCommand === null);
  check("record stamps origin from cwd basename", rec.origin === "someapp");
  check("record carries redacted message", rec.message === "needs your permission");
  check("raw_keys lists payload keys, sorted", Array.isArray(rec.raw_keys) && rec.raw_keys.join(",") === "cwd,hook_event_name,message,notification_type,session_id");
}

// --- defensive: empty / non-object payload still yields a safe record, no throw ---
{
  const rec = buildRecord({}, TS);
  check("empty payload → type unknown", rec.type === "unknown");
  check("empty payload → session null", rec.session === null);
  check("empty payload → message null", rec.message === null);
  check("empty payload → raw_keys empty array", Array.isArray(rec.raw_keys) && rec.raw_keys.length === 0);
}
{
  const rec = buildRecord(null, TS);
  check("null payload does not throw, type unknown", rec.type === "unknown" && rec.session === null);
}

// --- redaction: a secret leaked into message is masked in the written record ---
{
  const rec = buildRecord({ session_id: "s", notification_type: "permission_prompt", message: "approve: curl -H 'Authorization: Bearer sbp_0123456789abcdef0123' https://x" }, TS);
  check("secret token masked in message", typeof rec.message === "string" && !rec.message.includes("sbp_0123456789abcdef0123") && rec.message.includes("«redacted»"));
}

// --- manual path: --type + --session forwarding ---
{
  const rec = manualRecord({ type: "permission_prompt", session: "sess-abc", message: "backfill" }, TS);
  check("manualRecord carries explicit --type", rec.type === "permission_prompt");
  check("manualRecord carries explicit --session", rec.session === "sess-abc");
  check("manualRecord has raw_keys array", Array.isArray(rec.raw_keys));
}
{
  const saved = process.env.CLAUDE_SESSION_ID;
  delete process.env.CLAUDE_SESSION_ID;
  const rec = manualRecord({ type: "idle_prompt" }, TS);
  check("manualRecord session null when neither flag nor env present", rec.session === null);
  if (saved !== undefined) process.env.CLAUDE_SESSION_ID = saved;
}

console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILED"}`);
process.exit(fails === 0 ? 0 : 1);
