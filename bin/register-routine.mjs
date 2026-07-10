#!/usr/bin/env node
// ~/.claude/bin/register-routine.mjs
// Idempotent upsert into the schedule-registry — the "self-register" mechanism. (V-306)
//
// WHY THIS EXISTS:
//   The daily morning brief (bin/schedule-brief.mjs) iterates a committed registry
//   of scheduled routines (pipeline/schedule-registry.json) and recaps each one's
//   last run. For the brief to need NO per-routine code, a routine declares itself
//   into that registry — and it does so through this helper, called as the final
//   step of its own install-*-launchd.sh installer (which already knows the label,
//   runner, log path, and schedule). That is what "routines self-register" means:
//   the installer that creates the launchd agent also registers its descriptor.
//
//   Upsert is BY `label` and IDEMPOTENT: re-running an installer against an
//   already-registered routine rewrites the identical entry, so the committed
//   registry stays diff-free on re-install; a genuinely new routine's first install
//   appends one entry (a real, intended registry diff to commit). Entries are sorted
//   (schedule, then label) so the on-disk order is deterministic — no churn.
//
//   Run via Bash (`node ~/.claude/bin/register-routine.mjs …`) it is covered by the
//   blanket `Bash(node ~/.claude/bin/*.mjs)` allow rule — prompt-free, unlike an
//   inline `node -e`. It writes the registry with `fs` (writeFileSync), never a
//   Write/`>` (a sensitive-file prompt would freeze the launchd install — V-52/V-110).
//
// PATH TARGETING: the registry is resolved relative to THIS file's bin/ location via
//   fileURLToPath (not new URL(...).pathname, so a space/non-ASCII ancestor dir
//   doesn't percent-encode the path) — always the one canonical checkout's registry,
//   regardless of caller cwd.
//
// USAGE:
//   node ~/.claude/bin/register-routine.mjs \
//     --label com.v-coding-setup.harvest-feedback --name "feedback harvest" \
//     --runner bin/harvest-feedback-runner.sh --log pipeline/audit/harvest-feedback.log \
//     --schedule "daily 09:17"
//
// Exit codes: 0 success · 2 bad/missing required args (surfaced, never a silent
//   malformed write — convention 8).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This file lives at <root>/bin/; the registry at <root>/pipeline/schedule-registry.json.
export function resolveRegistryPath() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline", "schedule-registry.json");
}

const REQUIRED = ["label", "name", "runner", "log", "schedule"];

// Flag parser. Every field is a required string.
export function parseFlags(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--label") f.label = argv[++i];
    else if (a === "--name") f.name = argv[++i];
    else if (a === "--runner") f.runner = argv[++i];
    else if (a === "--log") f.log = argv[++i];
    else if (a === "--schedule") f.schedule = argv[++i];
  }
  return f;
}

// Upsert `entry` into `registry` by label, then sort deterministically (schedule,
// then label). Pure — returns a new array, no I/O. Idempotent: an identical entry
// for an existing label produces an equal array.
export function upsert(registry, entry) {
  const kept = registry.filter((r) => r && r.label !== entry.label);
  kept.push(entry);
  kept.sort((a, b) => {
    if (a.schedule !== b.schedule) return a.schedule < b.schedule ? -1 : 1;
    return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
  });
  return kept;
}

// Read the registry file → array (missing/empty/garbage → []). Pure over injected content.
export function parseRegistry(content) {
  if (typeof content !== "string" || content.trim() === "") return [];
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function main() {
  const f = parseFlags(process.argv.slice(2));
  const missing = REQUIRED.filter((k) => !f[k] || String(f[k]).trim() === "");
  if (missing.length) {
    process.stderr.write(`register-routine: missing required arg(s): ${missing.map((m) => "--" + m).join(", ")}\n`);
    process.exit(2);
  }
  const entry = { label: f.label, name: f.name, runner: f.runner, log: f.log, schedule: f.schedule };
  const path = resolveRegistryPath();
  const current = existsSync(path) ? parseRegistry(readFileSync(path, "utf8")) : [];
  const next = upsert(current, entry);
  mkdirSync(dirname(path), { recursive: true }); // idempotent — never prompts
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n");
  process.stdout.write(`register-routine: registered ${entry.label} (${next.length} routine(s) in registry)\n`);
  process.exit(0);
}

// Only run as a CLI, not when imported by the test.
const isMain = process.argv[1] && process.argv[1].endsWith("register-routine.mjs");
if (isMain) main();
