#!/usr/bin/env node
// Probe for nudge-read-discipline.mjs (V-267). In a test-less repo (shell + markdown),
// a committed runnable probe is the encoded proof of the guard's behaviour — it asserts
// the silent / nudge-fires / fail-open truth table, not the file's mere presence.
// Run: `node bin/nudge-read-discipline.test.mjs` (exit 0 = all pass).

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decideNudge,
  readResultBytes,
  estimateTokens,
  thresholdTokens,
  buildHookOutput,
} from "./nudge-read-discipline.mjs";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "nudge-read-discipline.mjs");
let pass = 0,
  fail = 0;
const ok = (cond, msg) => (cond ? (pass++, console.log("  ok  " + msg)) : (fail++, console.error("FAIL  " + msg)));

const TOK = thresholdTokens(); // default 15000
const bigBytes = (TOK + 5000) * 4; // comfortably over threshold
const smallBytes = 1000;

// --- pure: decideNudge ---
ok(decideNudge({ toolName: "Read", toolInput: {}, sizeBytes: bigBytes, thresholdTok: TOK }).nudge === true,
  "large whole-file Read → nudge");
ok(decideNudge({ toolName: "Read", toolInput: { offset: 100 }, sizeBytes: bigBytes, thresholdTok: TOK }).nudge === false,
  "Read with offset → silent (discipline followed)");
ok(decideNudge({ toolName: "Read", toolInput: { limit: 50 }, sizeBytes: bigBytes, thresholdTok: TOK }).nudge === false,
  "Read with limit → silent (discipline followed)");
ok(decideNudge({ toolName: "Read", toolInput: {}, sizeBytes: smallBytes, thresholdTok: TOK }).nudge === false,
  "small whole-file Read → silent");
ok(decideNudge({ toolName: "Edit", toolInput: {}, sizeBytes: bigBytes, thresholdTok: TOK }).nudge === false,
  "non-Read tool → silent");
ok(decideNudge({ toolName: "Read", toolInput: {}, sizeBytes: null, thresholdTok: TOK }).nudge === false,
  "unmeasurable size → fail open (silent)");

// --- pure: readResultBytes across shapes ---
ok(readResultBytes("abcd") === 4, "readResultBytes(string)");
ok(readResultBytes({ content: [{ text: "abcd" }, { text: "ef" }] }) === 6, "readResultBytes(MCP content envelope)");
ok(readResultBytes({ text: "abcde" }) === 5, "readResultBytes({text})");
ok(readResultBytes(null) === null, "readResultBytes(null) → null");
ok(estimateTokens(4000) === 1000, "estimateTokens(bytes/4)");
ok(buildHookOutput("hi").hookSpecificOutput.hookEventName === "PostToolUse", "envelope hookEventName=PostToolUse");

// --- e2e: run the hook as the harness would (stdin JSON → stdout) ---
function run(payload) {
  try {
    return execFileSync("node", [HOOK], { input: typeof payload === "string" ? payload : JSON.stringify(payload), encoding: "utf8" });
  } catch (e) {
    // the hook must never exit non-zero; treat a throw as a test failure signal
    return "__THREW__:" + (e.status ?? e.message);
  }
}

const bigStr = "x".repeat(bigBytes);
const outBig = run({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "/tmp/huge.ts" }, tool_response: bigStr });
ok(outBig.includes("Read discipline:") && outBig.includes("additionalContext"), "e2e: large whole-file Read emits additionalContext nudge");
ok(outBig.includes("/tmp/huge.ts"), "e2e: nudge names the file");

const outLimited = run({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "/tmp/huge.ts", limit: 100 }, tool_response: bigStr });
ok(outLimited.trim() === "", "e2e: Read with limit → no output");

const outSmall = run({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "/tmp/small.ts" }, tool_response: "x".repeat(smallBytes) });
ok(outSmall.trim() === "", "e2e: small Read → no output");

const outNonRead = run({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" }, tool_response: bigStr });
ok(outNonRead.trim() === "", "e2e: non-Read tool → no output");

const outGarbage = run("this is not json");
ok(outGarbage.trim() === "" && !outGarbage.startsWith("__THREW__"), "e2e: garbage stdin → exit 0, no output (fail-open)");

const outEmpty = run("");
ok(outEmpty.trim() === "" && !outEmpty.startsWith("__THREW__"), "e2e: empty stdin → exit 0, no output (fail-open)");

console.log(`\nnudge-read-discipline: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
