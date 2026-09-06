#!/usr/bin/env node
// Tests for crontab-redacted.mjs — the V-594 sanctioned redacting crontab reader.
// Run: node bin/crontab-redacted.test.mjs   (exit 0 = pass, 1 = fail)
//
// The V-594 leak: `crontab -l` dumped a live gmail password into a session transcript. The
// bar here is behavioural — no value survives the reader, whatever the key is named — while
// the schedule and command names (the reason to read a crontab at all) do survive.
//
// Every secret-shaped literal below is synthetic; none is a real credential.

import { redactCrontabLine, redactCrontab, MASK } from "./crontab-redacted.mjs";

let fails = 0;
function check(name, cond) {
  console.log(`[${cond ? "ok" : "FAIL"}] ${name}`);
  if (!cond) fails++;
}
// The whole point: assert on the VALUE's absence, not on the mask's presence.
function hides(name, line, secret) {
  const out = redactCrontabLine(line);
  check(name, !out.includes(secret) && out.includes(MASK));
}

// --- the reported shape: a crontab env line carrying a password ---
hides("env line value masked (the V-594 shape)", "GMAIL_PW=hunter2synthetic", "hunter2synthetic");
hides("MAILTO value masked", "MAILTO=someone@example.com", "someone@example.com");
// Key name carries no signal — this is exactly what a key-name-keyed redactor misses.
hides("innocuously-named key still masked", "NOTES=hunter2synthetic", "hunter2synthetic");
hides("quoted value masked", 'PASSPHRASE="hunter2synthetic"', "hunter2synthetic");

// --- values inside a job command line ---
hides(
  "inline VAR=val in a job command masked",
  "*/5 * * * * TOKEN_X=hunter2synthetic /usr/bin/run-job",
  "hunter2synthetic"
);
hides(
  "--password flag value masked",
  "0 9 * * * /usr/bin/sync --password hunter2synthetic --verbose",
  "hunter2synthetic"
);
hides(
  "--api-key=value form masked",
  "0 9 * * * /usr/bin/sync --api-key=hunter2synthetic",
  "hunter2synthetic"
);
hides(
  "URL userinfo password masked",
  "0 * * * * curl https://bob:hunter2synthetic@example.com/hook",
  "hunter2synthetic"
);

// --- what MUST survive: the schedule, the command, the comments ---
{
  const out = redactCrontabLine("*/5 * * * * TOKEN_X=hunter2synthetic /usr/bin/run-job --verbose");
  check("schedule fields survive", out.startsWith("*/5 * * * *"));
  check("command path survives", out.includes("/usr/bin/run-job"));
  check("non-secret flag survives", out.includes("--verbose"));
  check("key NAME survives (structure is the useful part)", out.includes("TOKEN_X="));
}
{
  const comment = "# harvest job — installed by bin/install-harvest-launchd.sh";
  check("comment line passes through untouched", redactCrontabLine(comment) === comment);
}
{
  const plain = "0 9 * * * /usr/bin/run-harvest";
  check("a value-free job line is unchanged", redactCrontabLine(plain) === plain);
}

// --- multi-line + junk input ---
{
  const out = redactCrontab(
    "MAILTO=a@b.com\nPW=hunter2synthetic\n# note\n0 9 * * * /usr/bin/job\n"
  );
  check("every line processed", !out.includes("hunter2synthetic") && !out.includes("a@b.com"));
  check("line count preserved", out.split("\n").length === 5);
  check("comment preserved in multi-line", out.includes("# note"));
}
check("null input does not throw", redactCrontab(null) === "");
check("undefined line returned as-is", redactCrontabLine(undefined) === undefined);
check("empty string safe", redactCrontab("") === "");

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exitCode = fails === 0 ? 0 : 1;
