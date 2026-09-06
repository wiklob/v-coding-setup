#!/usr/bin/env node
// ~/.claude/bin/crontab-redacted.mjs
// V-594: the sanctioned way to READ a crontab.
//
// Why this exists: `crontab -l` prints the crontab verbatim, and a crontab routinely
// carries credentials inline — an env-assignment line (`MAILTO=`, `PASS=`), a job command
// with `--password …`, a URL with `user:pass@host`. On 2026-08-27 that dumped a live gmail
// password straight into a session transcript (the second credential-to-transcript leak that
// day; V-587 was the first, by a different route). A PreToolUse hook decides allow/deny — it
// cannot filter a command's OUTPUT — so `crontab -l` is now denied outright by
// guard-sensitive-access.py, and this script is the redacting verb that replaces it.
//
// Same shape as transcript-resolver.mjs (V-26/V-38): allowlist the VERB, not the source.
// Every byte it emits passes redaction first, so the schedule stays inspectable while the
// values do not reach the transcript.
//
// Redaction is deliberately BROADER than transcript-resolver's redact(): that one masks only
// values whose KEY looks secret (TOKEN/SECRET/KEY/…), which is exactly what missed the V-594
// leak — a plain gmail password under an unremarkable name. Here EVERY `NAME=value` value is
// masked regardless of the name, plus secret-looking flag values and URL userinfo, and
// redact() runs as a second pass for the token shapes it knows. Over-masking is acceptable;
// leaking is not. What survives is the useful part: the schedule fields, the command names,
// and the comments.
//
// Usage:
//   node ~/.claude/bin/crontab-redacted.mjs           # this user's crontab, redacted
//   node ~/.claude/bin/crontab-redacted.mjs -u <user> # another user's crontab, redacted
// Exit: crontab's own exit code (so "no crontab for <user>" still reads as a failure).

import { spawnSync } from "node:child_process";
import { redact } from "./transcript-resolver.mjs";

export const MASK = "«redacted»";

// A crontab env line, or an inline `VAR=val` in a job command. The V-594 leak shape: the key
// name carries no signal, so the value is masked unconditionally.
const ASSIGNMENT = /(^|[\s;&|(])([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(\S+)/g;
// `--password foo` / `--api-key=foo` / `-p foo` on a job command line.
const SECRET_FLAG =
  /(--?[A-Za-z0-9-]*(?:pass(?:word|wd)?|token|secret|key|cred(?:ential)?s?|auth)[A-Za-z0-9-]*)([ \t]+|=)(\S+)/gi;
// Credentials in a URL's userinfo: scheme://user:pass@host
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)([^\s:/@]+):([^\s@]+)@/gi;

/** Redact one crontab line. Comment lines pass through untouched (they carry no values). */
export function redactCrontabLine(line) {
  if (typeof line !== "string" || !line) return line;
  if (/^\s*#/.test(line)) return line;
  let s = line;
  s = s.replace(URL_USERINFO, (_m, scheme, user) => `${scheme}${user}:${MASK}@`);
  s = s.replace(SECRET_FLAG, (_m, flag, sep, _val) => `${flag}${sep}${MASK}`);
  s = s.replace(ASSIGNMENT, (_m, lead, key, _val) => `${lead}${key}=${MASK}`);
  return redact(s); // second pass: Bearer/token shapes transcript-resolver already knows
}

export function redactCrontab(text) {
  return String(text ?? "")
    .split("\n")
    .map(redactCrontabLine)
    .join("\n");
}

function main(argv) {
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-u" && i + 1 < argv.length) {
      args.push("-u", argv[++i]);
    } else if (argv[i] === "-l") {
      // implicit — this script only ever lists
    } else {
      process.stderr.write(
        `crontab-redacted: unsupported argument '${argv[i]}'. This verb only LISTS ` +
          `(usage: crontab-redacted.mjs [-u <user>]). Writes go through \`crontab -e\`/\`-\`, ` +
          `which the access guard gates on purpose.\n`
      );
      return 2;
    }
  }
  const r = spawnSync("crontab", [...args, "-l"], { encoding: "utf8" });
  if (r.error) {
    process.stderr.write(`crontab-redacted: could not run crontab: ${r.error.message}\n`);
    return 1;
  }
  if (r.stderr) process.stderr.write(redactCrontab(r.stderr));
  if (r.stdout) process.stdout.write(redactCrontab(r.stdout));
  return r.status ?? 1;
}

const isMain = process.argv[1] && process.argv[1].endsWith("crontab-redacted.mjs");
// exitCode (not process.exit) so a piped stdout flushes before the process ends.
if (isMain) process.exitCode = main(process.argv.slice(2));
