#!/usr/bin/env node
// Tests for transcript-resolver.mjs — redaction classes + whole-token matching.
// Run: node bin/transcript-resolver.test.mjs   (exit 0 = pass, 1 = fail)
//
// Secret-shaped literals here are synthetic (never real credentials) so the live
// secret-guard never fires on this file's own content.

import { redact, ticketRegex, isSecretKey } from "./transcript-resolver.mjs";

let fails = 0;
function check(name, cond) {
  console.log(`[${cond ? "ok" : "FAIL"}] ${name}`);
  if (!cond) fails++;
}
// A value is "masked" when it no longer appears verbatim AND the marker is present.
function masked(out, secret) {
  return !out.includes(secret) && out.includes("«redacted»");
}

// --- redaction: values masked, names kept ---
{
  const o = redact("export SUPABASE_ACCESS_TOKEN=sbp_0123456789abcdef0123");
  check("shell assignment value masked", masked(o, "sbp_0123456789abcdef0123"));
  check("shell assignment KEY name kept", o.includes("SUPABASE_ACCESS_TOKEN"));
}
{
  const o = redact('{"API_KEY": "abcDEF123456ghiJKL789mno"}');
  check("json secret value masked", masked(o, "abcDEF123456ghiJKL789mno"));
  check("json secret KEY name kept", o.includes("API_KEY"));
}
{
  const o = redact("Authorization: Bearer eyJhbGciOi.eyJzdWIiOi1234.sigABCdef");
  check("bearer token masked", o.includes("«redacted»") && !o.includes("eyJhbGciOi.eyJzdWIiOi1234.sigABCdef"));
  check("Authorization header label kept", o.includes("Authorization"));
}
{
  const o = redact("token sbp_feedfacefeedfacefeedface and key ghp_ABCDEFGHIJKLMNOP0123");
  check("supabase PAT shape masked", !o.includes("sbp_feedfacefeedfacefeedface"));
  check("github token shape masked", !o.includes("ghp_ABCDEFGHIJKLMNOP0123"));
}
{
  const o = redact("aws AKIAIOSFODNN7EXAMPLE here");
  check("aws access key id masked", !o.includes("AKIAIOSFODNN7EXAMPLE"));
}
{
  // review PR#12 [high]: secret value with an internal quote must not leak.
  const o = redact(`{"CLIENT_SECRET": "abc'def\\"ghijklmnop"}`);
  check("json value with internal quote masked", o.includes("«redacted»") && !o.includes("abc'def"));
  check("json value-with-quote KEY name kept", o.includes("CLIENT_SECRET"));
}
{
  // review PR#12 [high]: 32-char opaque token (no key, no prefix) must be masked.
  const o = redact("blob abcdefghij0123456789ABCDEFGHIJKL tail");
  check("32-char opaque run masked", o.includes("«redacted»") && !o.includes("abcdefghij0123456789ABCDEFGHIJKL"));
}
{
  const o = redact("bearer abcdefghijklmnop12345");
  check("lowercase bearer masked", o.includes("«redacted»") && !o.includes("abcdefghijklmnop12345"));
}
{
  const o = redact("long opaque dGhpc2lzYXZlcnlsb25nb3BhcXVldG9rZW5zdHJpbmcxMjM0NTY3 tail");
  check("long entropy run masked", o.includes("«redacted»"));
}

// --- non-secrets stay intact ---
{
  const o = redact("PORT=3000 and NODE_ENV=production");
  check("non-secret PORT kept", o.includes("PORT=3000"));
  check("non-secret NODE_ENV kept", o.includes("NODE_ENV=production"));
}
{
  const o = redact("normal prose with no secrets at all");
  check("plain prose untouched", o === "normal prose with no secrets at all");
}

// --- key classification ---
check("TOKEN is secret key", isSecretKey("GITHUB_TOKEN"));
check("SECRET is secret key", isSecretKey("CLIENT_SECRET"));
check("PASSWORD is secret key", isSecretKey("DB_PASSWORD"));
check("PORT is not secret key", !isSecretKey("PORT"));
check("NODE_ENV is not secret key", !isSecretKey("NODE_ENV"));

// --- whole-token ticket matching (CB-14 must not match CB-144) ---
{
  const re = () => ticketRegex("CB-14");
  check("CB-14 matches CB-14", "see CB-14 here".match(re()) !== null);
  check("CB-14 does NOT match CB-144", "see CB-144 here".match(re()) === null);
}
{
  check("V-26 matches in prose", "ticket V-26 done".match(ticketRegex("V-26")) !== null);
  check("V-26 does NOT match V-260", "ticket V-260 done".match(ticketRegex("V-26")) === null);
}

console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILED"}`);
process.exit(fails === 0 ? 0 : 1);
