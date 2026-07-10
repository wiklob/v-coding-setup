#!/usr/bin/env node
// Tests for rotate-errors-log.mjs — the no-drop safety invariant + flags + stamp + path. (V-166)
// Run: node bin/rotate-errors-log.test.mjs   (exit 0 = pass, 1 = fail)
//
// The load-bearing case is `partition()`: it is the encoded proof of Acceptance #2
// ("rotated archives don't drop un-harvested entries"). Every `ts > watermark` line
// must land in `kept` (live); only `ts <= watermark` may be archived.

import { parseFlags, partition, formatStamp, DEFAULT_THRESHOLD_BYTES, resolveLogPath, resolveWatermarkPath, resolveArchivePath } from "./rotate-errors-log.mjs";

let fails = 0;
function check(name, cond) {
  console.log(`[${cond ? "ok" : "FAIL"}] ${name}`);
  if (!cond) fails++;
}

const WM = "2026-06-06T07:13:34.000Z";
const WM_MS = Date.parse(WM);
const line = (ts) => JSON.stringify({ ts, tool: "Bash", error: "boom" });

const PRE = line("2026-06-06T07:00:00.000Z");   // harvested → archivable
const AT = line(WM);                             // exactly watermark → harvested
const POST1 = line("2026-06-06T07:18:16.000Z");  // un-harvested → must stay live
const POST2 = line("2026-06-06T09:30:00.000Z");  // un-harvested → must stay live

// --- parseFlags ---
check("parse --threshold-bytes", parseFlags(["--threshold-bytes", "262144"]).thresholdBytes === 262144);
check("parse --force", parseFlags(["--force"]).force === true);
check("force false by default", parseFlags([]).force === false);

// --- partition: THE no-drop invariant ---
{
  const { archived, kept } = partition([PRE, POST1, AT, POST2], WM_MS);
  check("every un-harvested entry kept live", kept.includes(POST1) && kept.includes(POST2));
  check("no un-harvested entry archived", !archived.includes(POST1) && !archived.includes(POST2));
  check("harvested entries archived (ts < watermark)", archived.includes(PRE));
  check("boundary entry (ts == watermark) archived", archived.includes(AT));
  check("no entry lost (archived + kept == input count)", archived.length + kept.length === 4);
}

// --- partition: absent watermark → keep everything (nothing provably harvested) ---
{
  const { archived, kept } = partition([PRE, POST1, AT], null);
  check("null watermark archives nothing", archived.length === 0);
  check("null watermark keeps all 3", kept.length === 3);
}

// --- partition: fail-safe keep — unclassifiable lines never archived ---
{
  const { archived, kept } = partition(["{bad json", JSON.stringify({ tool: "x" }), line("garbage-ts"), PRE], WM_MS);
  check("malformed JSON kept, not archived", kept.includes("{bad json"));
  check("no-ts entry kept, not archived", kept.includes(JSON.stringify({ tool: "x" })));
  check("garbage-ts entry kept, not archived", kept.includes(line("garbage-ts")));
  check("only the real harvested entry archived", archived.length === 1 && archived.includes(PRE));
}

// --- partition: blank lines dropped (not entries, not data) ---
{
  const { archived, kept } = partition(["", "   ", POST1], WM_MS);
  check("blanks neither archived nor kept", archived.length === 0 && kept.length === 1 && kept[0] === POST1);
}

// --- formatStamp: YYYYMMDD-HHMMSS, sortable, archive-filename-safe ---
{
  const s = formatStamp(new Date("2026-06-06T09:08:07.000Z"));
  check("stamp matches YYYYMMDD-HHMMSS", /^\d{8}-\d{6}$/.test(s));
}

// --- threshold default ---
check("default threshold is 200 KB", DEFAULT_THRESHOLD_BYTES === 200 * 1024);

// --- path resolution: canonical sink, archive under same dir, gitignore-glob-safe name ---
check("log path canonical", resolveLogPath().endsWith("/pipeline/audit/errors.jsonl"));
check("watermark path canonical", resolveWatermarkPath().endsWith("/pipeline/audit/.harvest-watermark"));
check("archive path under audit dir", resolveArchivePath("20260606-090807").endsWith("/pipeline/audit/errors-20260606-090807.jsonl"));
check("archive name matches *.jsonl gitignore glob", /\/errors-[\d-]+\.jsonl$/.test(resolveArchivePath("20260606-090807")));
check("paths not inside bin/", !resolveLogPath().includes("/bin/") && !resolveArchivePath("x").includes("/bin/"));

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
