#!/usr/bin/env node
// Tests for log-linear-call.mjs — byte measurement + linear-only guard + record shape. (V-305)
// Run: node bin/log-linear-call.test.mjs   (exit 0 = pass, 1 = fail)
//
// session/conversation resolution lives in session-identity.mjs (tested there);
// here we only assert the record builder STAMPS those handles + the right bytes/tool.

import { responseBytes, shouldLog, buildRecord } from "./log-linear-call.mjs";

let fails = 0;
function check(name, cond) {
  console.log(`[${cond ? "ok" : "FAIL"}] ${name}`);
  if (!cond) fails++;
}

const TS = "2026-06-24T00:00:00.000Z";

// --- responseBytes: measures the MCP text envelope across shapes ---
check("content[].text summed", responseBytes({ content: [{ type: "text", text: "abc" }, { type: "text", text: "de" }] }) === 5);
check("bare string measured", responseBytes("hello") === 5);
check("null → 0", responseBytes(null) === 0);
check("arbitrary object → json bytes", responseBytes({ id: "V-1" }) === Buffer.byteLength(JSON.stringify({ id: "V-1" })));
check("non-ascii counted as bytes not chars", responseBytes({ content: [{ text: "€" }] }) === 3);

// --- shouldLog: linear successes only ---
check("linear PostToolUse logged", shouldLog({ hook_event_name: "PostToolUse", tool_name: "mcp__linear__get_issue" }));
check("non-linear tool dropped", !shouldLog({ hook_event_name: "PostToolUse", tool_name: "Bash" }));
check("wrong event dropped", !shouldLog({ hook_event_name: "PostToolUseFailure", tool_name: "mcp__linear__get_issue" }));
check("missing event still ok if linear (manual pipe)", shouldLog({ tool_name: "mcp__linear__list_issues" }));
check("garbage payload dropped", !shouldLog(null) && !shouldLog({}) && !shouldLog({ tool_name: 42 }));

// --- buildRecord: shape + bare tool name + status ---
const rec = buildRecord(
  { hook_event_name: "PostToolUse", tool_name: "mcp__linear__save_issue", session_id: "abc12345-0000", tool_response: { content: [{ text: '{"id":"V-1"}' }] }, cwd: "/tmp" },
  TS,
);
check("ts stamped", rec.ts === TS);
check("session from payload", rec.session === "abc12345-0000");
check("tool name de-prefixed", rec.tool === "save_issue");
check("bytes measured", rec.bytes === Buffer.byteLength('{"id":"V-1"}'));
check("status ok by default", rec.status === "ok");
check("conversation key present", "conversation" in rec);

const errRec = buildRecord({ tool_name: "mcp__linear__save_issue", session_id: "s", tool_response: { isError: true, content: [{ text: "boom" }] } }, TS);
check("status error when isError", errRec.status === "error");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
