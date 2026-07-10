#!/usr/bin/env node
// validate-settings-json.mjs — PostToolUse guard (V-108).
//
// The source-agnostic backstop for the settings.json-corruption class: any
// Edit/Write to settings.json, or any Bash `git pull`/`merge`/`stash pop` that
// can leave `<<<<<<<` conflict markers in it, makes settings.json INVALID JSON
// — which the harness skips entirely, so every permission allow/deny/ask rule
// silently vanishes until a human notices the Settings Error dialog.
//
// Registered as a PostToolUse hook (matcher: Edit|Write|Bash). PostToolUse
// fires AFTER the tool ran, so it cannot prevent the write — but exit 2 shows
// stderr to Claude as a blocking error, which forces a fix-it follow-up instead
// of the silent walk-away the ticket documents (errors.jsonl entry 272).
//
// The corruptor in entry 272 was an UNCOMMITTED/stale-skill `git stash pop`
// (not a committed pipeline-command line — `git log -S spawn-tickets-temp` over
// the repo = 0 hits), so a per-command fix can't catch it. This guard is
// source-agnostic by design: it validates the result, whatever produced it.
//
// Target resolution (so it is both production-correct and testable):
//   1. process.argv[2], if given            (the .test.sh points it at a fixture)
//   2. else <thisfile>/../settings.json      (bin/ -> repo-root settings.json;
//                                              the canonical shared checkout the
//                                              harness actually loads)
// Exit codes: 0 = clean or file absent/unreadable-as-non-corruption;
//             2 = malformed (conflict markers or unparseable JSON) — blocking.
// Any internal error on an UNRELATED tool call must NOT block the session, so
// everything outside the explicit malformed-settings case falls through to 0.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Git conflict markers: a run of exactly 7 `<`, `=`, or `>` at line start.
// Valid JSON never begins a line with any of these, so this has no false
// positives on a well-formed settings.json.
const CONFLICT_MARKER = /^(<{7}|={7}|>{7})(\s|$)/m;

export function inspect(text) {
  if (CONFLICT_MARKER.test(text)) {
    return { ok: false, reason: "unresolved git conflict markers (<<<<<<< / ======= / >>>>>>>)" };
  }
  try {
    JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: `unparseable JSON — ${e.message}` };
  }
  return { ok: true };
}

export function resolveTarget(argv) {
  if (argv[2]) return argv[2];
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "settings.json");
}

function main() {
  // We deliberately do NOT read the hook payload on stdin: the matcher already
  // scoped us to Edit|Write|Bash and the decision never uses the payload, so a
  // blocking synchronous fd-0 read would only add a latent hang vector on every
  // Bash call for nothing. Node exiting without draining stdin is safe — the
  // harness closes the pipe.
  const target = resolveTarget(process.argv);

  let text;
  try {
    text = readFileSync(target, "utf8");
  } catch {
    // Missing / unreadable settings.json is not corruption this guard caused —
    // never block the session over it.
    process.exit(0);
  }

  const verdict = inspect(text);
  if (verdict.ok) process.exit(0);

  process.stderr.write(
    `settings.json is CORRUPT (${verdict.reason}).\n` +
    `  file: ${target}\n` +
    `  The harness skips an invalid settings.json ENTIRELY — every permission\n` +
    `  allow/deny/ask rule silently vanishes until this is fixed (V-108).\n` +
    `  Resolve the conflict / fix the JSON now; do not continue with it broken.\n`
  );
  process.exit(2);
}

// Only run as a hook when invoked directly; importing for tests must not exit.
if (process.argv[1] && process.argv[1].endsWith("validate-settings-json.mjs")) {
  main();
}
