#!/usr/bin/env node
// Tests for read-errors-since.mjs — flag parse + cutoff resolution + keep logic + path. (V-166)
// Run: node bin/read-errors-since.test.mjs   (exit 0 = pass, 1 = fail)

import { parseFlags, resolveSinceMs, keepEntry, resolveLogPath, resolveWatermarkPath } from "./read-errors-since.mjs";

let fails = 0;
function check(name, cond) {
  console.log(`[${cond ? "ok" : "FAIL"}] ${name}`);
  if (!cond) fails++;
}

const WM = "2026-06-06T07:13:34.000Z";
const WM_MS = Date.parse(WM);
const line = (ts) => JSON.stringify({ ts, tool: "Bash", error: "boom" });

// --- parseFlags ---
check("parse --since", parseFlags(["--since", WM]).since === WM);
check("since absent by default", parseFlags([]).since === undefined);

// --- resolveSinceMs: precedence explicit → watermark → epoch ---
check("explicit since wins", resolveSinceMs(WM, "2020-01-01T00:00:00Z") === WM_MS);
check("watermark used when no --since", resolveSinceMs(undefined, WM) === WM_MS);
check("epoch (-Infinity) when neither", resolveSinceMs(undefined, undefined) === -Infinity);
check("epoch when watermark blank", resolveSinceMs(undefined, "   ") === -Infinity);
check("garbage --since → epoch (fail-open)", resolveSinceMs("not-a-date", WM) === -Infinity);

// --- keepEntry: the cutoff is strict `>` ---
check("post-since entry kept", keepEntry(line("2026-06-06T07:18:16.000Z"), WM_MS) === true);
check("pre-since entry dropped", keepEntry(line("2026-06-06T07:00:00.000Z"), WM_MS) === false);
check("entry exactly at cutoff dropped (strict >)", keepEntry(line(WM), WM_MS) === false);

// --- keepEntry fail-open polarity: never silently drop a real entry ---
check("blank line skipped", keepEntry("   ", WM_MS) === false);
check("malformed JSON emitted (fail-open)", keepEntry("{not json", WM_MS) === true);
check("entry with no ts emitted (fail-open)", keepEntry(JSON.stringify({ tool: "Bash" }), WM_MS) === true);
check("entry with garbage ts emitted (fail-open)", keepEntry(line("nonsense"), WM_MS) === true);

// --- epoch cutoff emits every real entry ---
check("epoch emits old entry", keepEntry(line("1999-01-01T00:00:00Z"), -Infinity) === true);

// --- path resolution: canonical sink, not inside bin/ ---
check("log path canonical", resolveLogPath().endsWith("/pipeline/audit/errors.jsonl"));
check("log path not in bin/", !resolveLogPath().includes("/bin/"));
check("watermark path canonical", resolveWatermarkPath().endsWith("/pipeline/audit/.harvest-watermark"));

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
