#!/usr/bin/env node
// ~/.claude/bin/log-gate-audit.mjs
// Sanctioned append path for /go's cross-run gate-audit friction map. (V-75)
//
// WHY THIS EXISTS:
//   /go's end-of-run flush (commands/go.md §4/§6) appends one dated block per run
//   to pipeline/audit/gate-audit.md. That flush runs at §6 — AFTER /land-ticket
//   has, in standalone mode, torn the per-ticket worktree down, so the session is
//   back in the shared checkout where the bg-isolation guard blocks Write/Edit.
//   /go used to dodge the guard with a raw heredoc `cat >> <path> <<'EOF' … EOF`
//   plus a trailing `echo "appended"` (convention-7 violation) and an
//   unconditional `mkdir -p pipeline/audit` (prompts when the dir already exists).
//   This helper is the sanctioned replacement: one allowlisted `node` call
//   (covered by the blanket `Bash(node ~/.claude/bin/*.mjs)` rule), no heredoc,
//   no echo, no separate mkdir.
//
// CANONICAL-LEDGER TARGETING:
//   The friction map must accumulate in the ONE canonical checkout, not in a
//   throwaway worktree's copy of the file. LOG_PATH is resolved relative to THIS
//   file's bin/ location (via fileURLToPath, not new URL(...).pathname, so a space
//   or non-ASCII char in an ancestor dir doesn't percent-encode the path and
//   misdirect the write) — so the append always lands on <root>/pipeline/audit/
//   regardless of the caller's cwd. This is why "flush before teardown while still
//   isolated" can't work instead: the canonical ledger is outside $WT_ABS/**, so
//   Write/Edit is guarded whether or not the worktree still exists.
//
// USAGE (all from /go's already-tracked ledger — flags, never a heredoc):
//   node ~/.claude/bin/log-gate-audit.mjs \
//     --ticket V-75 --outcome "completed" \
//     --pd 2 --intervened 1 --forced 0 \
//     --gate "next-ticket · scope-gate · confirm · p'd — rubber-stamped" \
//     --gate "land-ticket · §5 · confirm · intervened — amended commit msg"
//
//   --outcome is the §4 parenthetical: "completed" or "forced-halt at <phase>".
//   --gate is repeatable, one per gate line, verbatim in the §4 line format.
//   --ticket and --outcome are required; tallies default to 0; gates may be empty.
//
// Exit codes: 0 success · 2 bad/missing required args (surfaced, never a silent
//   malformed append — convention 8).

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This file lives at <root>/bin/, the ledger at <root>/pipeline/audit/gate-audit.md.
const LOG_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline", "audit", "gate-audit.md");

// Local-time minute-precision stamp, matching the §4 "<YYYY-MM-DD HH:MM>" format.
// `now` is injected so the function stays pure/testable.
export function formatStamp(now) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;
}

// Assemble one dated block in the exact §4 format. Returns text with a leading
// blank line so it always separates cleanly from the prior block (or the
// "<!-- runs appended below -->" marker) on append. Pure — no I/O.
export function buildBlock({ ticket, outcome, pd = 0, intervened = 0, forced = 0, gates = [] }, now) {
  const head = `## ${formatStamp(now)} — ${ticket} (${outcome})`;
  const tallies = `Tallies: p'd ${pd} · intervened ${intervened} · forced ${forced}`;
  const lines = gates.map((g) => `- ${g}`);
  return `\n${[head, tallies, ...lines].join("\n")}\n`;
}

// Flag parser. Collects repeatable --gate into an array; numeric tallies coerced.
export function parseFlags(argv) {
  const f = { gates: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ticket") f.ticket = argv[++i];
    else if (a === "--outcome") f.outcome = argv[++i];
    else if (a === "--pd") f.pd = Number(argv[++i]);
    else if (a === "--intervened") f.intervened = Number(argv[++i]);
    else if (a === "--forced") f.forced = Number(argv[++i]);
    else if (a === "--gate") f.gates.push(argv[++i]);
  }
  return f;
}

function main() {
  const f = parseFlags(process.argv.slice(2));
  if (!f.ticket || !f.outcome) {
    process.stderr.write("log-gate-audit: --ticket and --outcome are required\n");
    process.exit(2);
  }
  const block = buildBlock(f, new Date());
  mkdirSync(dirname(LOG_PATH), { recursive: true }); // idempotent — never prompts
  appendFileSync(LOG_PATH, block);
  process.exit(0);
}

// Only run as a CLI, not when imported by the test.
const isMain = process.argv[1] && process.argv[1].endsWith("log-gate-audit.mjs");
if (isMain) main();
