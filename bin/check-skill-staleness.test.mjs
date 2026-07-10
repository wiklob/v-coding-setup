#!/usr/bin/env node
// Tests for check-skill-staleness.mjs — payload parse + watched-path filter +
// warn/dedup decision + warning text + hook-output envelope. (V-99)
// Run: node bin/check-skill-staleness.test.mjs   (exit 0 = pass, 1 = fail)
//
// This is the test-less repo's encoded-proof analog (cf. guard-access.test.py,
// log-gate-audit.test.mjs): a runnable demonstration that the detector fires on
// real drift and stays silent otherwise — empirical proof, not asserted presence.

import {
  parsePayload,
  filterWatched,
  decide,
  buildWarning,
  buildHookOutput,
} from "./check-skill-staleness.mjs";

let fails = 0;
function check(name, cond) {
  console.log(`[${cond ? "ok" : "FAIL"}] ${name}`);
  if (!cond) fails++;
}

// --- parsePayload: pulls the fields we branch on; null on garbage ---
const ss = parsePayload(
  JSON.stringify({ hook_event_name: "SessionStart", source: "resume", session_id: "abc", cwd: "/w" })
);
check("parse event", ss.event === "SessionStart");
check("parse source", ss.source === "resume");
check("parse session id", ss.sessionId === "abc");
check("parse garbage → null", parsePayload("not json") === null);

// --- filterWatched: only the injectable surface counts as drift ---
const changed = ["commands/go.md", "bin/check-skill-staleness.mjs", "workflow-conventions.md", "docs/x.md"];
const watched = filterWatched(changed);
check("watched keeps commands/*", watched.includes("commands/go.md"));
check("watched keeps workflow-conventions.md", watched.includes("workflow-conventions.md"));
check("watched drops bin/", !watched.includes("bin/check-skill-staleness.mjs"));
check("watched drops unrelated docs/", !watched.includes("docs/x.md"));

// --- decide: the core warn/no-warn truth table ---
// (a) no drift — identical HEADs → no warning
check(
  "no warn when HEADs equal",
  decide({ baseHead: "h1", curHead: "h1", lastWarnedHead: null, changedWatched: ["commands/go.md"] }).warn === false
);
// (b) real drift touching a watched file → warn
check(
  "warn on drift touching watched file",
  decide({ baseHead: "h1", curHead: "h2", lastWarnedHead: null, changedWatched: ["commands/go.md"] }).warn === true
);
// (c) drift, but only in non-watched paths → filtered to empty → no warning
check(
  "no warn when only non-watched paths moved",
  decide({ baseHead: "h1", curHead: "h2", lastWarnedHead: null, changedWatched: [] }).warn === false
);
// (d) dedup — already warned for this exact current HEAD → silent
check(
  "dedup: no second warn at same HEAD",
  decide({ baseHead: "h1", curHead: "h2", lastWarnedHead: "h2", changedWatched: ["commands/go.md"] }).warn === false
);
// (e) dedup releases when HEAD advances again
check(
  "warn again when HEAD advances past last-warned",
  decide({ baseHead: "h1", curHead: "h3", lastWarnedHead: "h2", changedWatched: ["commands/go.md"] }).warn === true
);
// missing HEAD → never warn (best-effort safety)
check(
  "no warn when curHead unknown",
  decide({ baseHead: "h1", curHead: null, lastWarnedHead: null, changedWatched: ["commands/go.md"] }).warn === false
);

// --- buildWarning: names the file + the STALE marker, instructs a disk re-read ---
const w = buildWarning(["commands/go.md"], "abcdef1234", "9876543210");
check("warning has STALE marker", w.includes("STALE-SKILL RISK"));
check("warning names the changed file", w.includes("commands/go.md"));
check("warning shows short baseline+current hashes", w.includes("abcdef12") && w.includes("98765432"));
check("warning instructs disk re-read", /re-read/i.test(w) && w.includes("~/.claude/commands/go.md"));

// --- buildHookOutput: exact envelope per event ---
const o = buildHookOutput("UserPromptSubmit", "msg");
check("envelope event name", o.hookSpecificOutput.hookEventName === "UserPromptSubmit");
check("envelope additionalContext", o.hookSpecificOutput.additionalContext === "msg");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
