#!/usr/bin/env node
// Tests for advance-harvest-watermark.mjs — flag parse + content format + path. (V-116)
// Run: node bin/advance-harvest-watermark.test.mjs   (exit 0 = pass, 1 = fail)

import { parseFlags, formatWatermark, resolveWatermarkPath } from "./advance-harvest-watermark.mjs";

let fails = 0;
function check(name, cond) {
  console.log(`[${cond ? "ok" : "FAIL"}] ${name}`);
  if (!cond) fails++;
}

const NOW = new Date("2026-06-04T09:00:00.000Z");

// --- parseFlags: --ts captured, absent when not given ---
check("parse ts", parseFlags(["--ts", "2026-06-04T09:00:00.000Z"]).ts === "2026-06-04T09:00:00.000Z");
check("ts absent by default", parseFlags([]).ts === undefined);

// --- formatWatermark: explicit ts echoed verbatim, single line + newline ---
check("explicit ts verbatim", formatWatermark("2026-06-04T09:00:00.000Z", NOW) === "2026-06-04T09:00:00.000Z\n");
check("explicit ts trimmed", formatWatermark("  2026-06-04T09:00:00.000Z  ", NOW) === "2026-06-04T09:00:00.000Z\n");
check("content is single line", (formatWatermark("2026-06-04T09:00:00.000Z", NOW).match(/\n/g) || []).length === 1);

// --- formatWatermark: no ts → current time (injected now) ---
check("default to now", formatWatermark(undefined, NOW) === "2026-06-04T09:00:00.000Z\n");

// --- formatWatermark: invalid/empty ts → null (caller surfaces + exits 2) ---
check("empty ts rejected", formatWatermark("", NOW) === null);
check("whitespace ts rejected", formatWatermark("   ", NOW) === null);
check("garbage ts rejected", formatWatermark("not-a-date", NOW) === null);

// --- resolveWatermarkPath: under bin/../pipeline/audit/, the canonical dotfile ---
const p = resolveWatermarkPath();
check("path ends at canonical watermark", p.endsWith("/pipeline/audit/.harvest-watermark"));
check("path is not inside bin/", !p.includes("/bin/"));

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
