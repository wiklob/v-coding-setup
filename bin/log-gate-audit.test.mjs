#!/usr/bin/env node
// Tests for log-gate-audit.mjs — flag parse + block assembly + stamp format. (V-75)
// Run: node bin/log-gate-audit.test.mjs   (exit 0 = pass, 1 = fail)

import { formatStamp, buildBlock, parseFlags } from "./log-gate-audit.mjs";

let fails = 0;
function check(name, cond) {
  console.log(`[${cond ? "ok" : "FAIL"}] ${name}`);
  if (!cond) fails++;
}

// Fixed instant (local-time fields are what formatStamp reads).
const NOW = new Date(2026, 5, 3, 11, 50); // 2026-06-03 11:50 local

// --- formatStamp: zero-padded minute-precision local stamp ---
check("stamp format", formatStamp(NOW) === "2026-06-03 11:50");
check("stamp pads single digits", formatStamp(new Date(2026, 0, 9, 4, 5)) === "2026-01-09 04:05");

// --- parseFlags: required fields, numeric tallies, repeatable --gate ---
const f = parseFlags([
  "--ticket", "V-75", "--outcome", "completed",
  "--pd", "2", "--intervened", "1", "--forced", "0",
  "--gate", "next-ticket · scope-gate · confirm · p'd — rubber-stamped",
  "--gate", "land-ticket · §5 · confirm · intervened — amended commit msg",
]);
check("parse ticket", f.ticket === "V-75");
check("parse outcome", f.outcome === "completed");
check("parse tallies numeric", f.pd === 2 && f.intervened === 1 && f.forced === 0);
check("parse repeatable gates", f.gates.length === 2 && f.gates[1].startsWith("land-ticket"));
check("gates default empty", parseFlags([]).gates.length === 0);

// --- buildBlock: exact §4 format, leading blank-line separator ---
const block = buildBlock(f, NOW);
check("block leads with blank-line separator", block.startsWith("\n## "));
check("block trails with newline", block.endsWith("\n"));
check(
  "block header line",
  block.includes("## 2026-06-03 11:50 — V-75 (completed)")
);
check(
  "block tallies line",
  block.includes("Tallies: p'd 2 · intervened 1 · forced 0")
);
check(
  "block gate lines prefixed with '- '",
  block.includes("- next-ticket · scope-gate · confirm · p'd — rubber-stamped") &&
  block.includes("- land-ticket · §5 · confirm · intervened — amended commit msg")
);

// --- buildBlock: tallies default to 0, no gate lines when none given ---
const minimal = buildBlock({ ticket: "V-99", outcome: "forced-halt at land-ticket" }, NOW);
check("minimal block defaults tallies to 0", minimal.includes("Tallies: p'd 0 · intervened 0 · forced 0"));
check("minimal block has no gate lines", !minimal.includes("\n- "));
check("minimal block forced-halt outcome", minimal.includes("— V-99 (forced-halt at land-ticket)"));

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
