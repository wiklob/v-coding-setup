#!/usr/bin/env node
// Tests for log-feedback.mjs — record shape + subject normalization + redaction. (V-86)
// Run: node bin/log-feedback.test.mjs   (exit 0 = pass, 1 = fail)
//
// Secret-shaped literals here are synthetic (never real credentials).

import { buildRecord } from "./log-feedback.mjs";

let fails = 0;
function check(name, cond) {
  console.log(`[${cond ? "ok" : "FAIL"}] ${name}`);
  if (!cond) fails++;
}

const TS = "2026-06-03T00:00:00.000Z";

// --- record shape: all consumer-required keys present (V-81 scorecard contract) ---
{
  const rec = buildRecord({ note: "/scope felt like overkill here", subject: "scope", session: "s-1", conversation: "c-1" }, TS);
  check("record has ts", rec.ts === TS);
  check("record has session", rec.session === "s-1");
  check("record has conversation", rec.conversation === "c-1");
  check("record has subject", rec.subject === "scope");
  check("record has verbatim note", rec.note === "/scope felt like overkill here");
  check("record has exactly the 5 contract keys", JSON.stringify(Object.keys(rec).sort()) === JSON.stringify(["conversation", "note", "session", "subject", "ts"]));
}

// --- subject normalization: leading slash stripped, absent/blank → null ---
check("subject leading slash stripped", buildRecord({ note: "x", subject: "/go" }, TS).subject === "go");
check("subject trimmed", buildRecord({ note: "x", subject: "  land-ticket  " }, TS).subject === "land-ticket");
check("absent subject → null", buildRecord({ note: "x" }, TS).subject === null);
check("blank subject → null", buildRecord({ note: "x", subject: "   " }, TS).subject === null);
check("absent session → null", buildRecord({ note: "x" }, TS).session === null);
check("absent conversation → null", buildRecord({ note: "x" }, TS).conversation === null);

// --- redaction: a secret pasted into the note is masked in the written record ---
{
  const rec = buildRecord({ note: "broke after I ran curl -H 'Authorization: Bearer sbp_0123456789abcdef0123'", subject: null }, TS);
  check("secret token masked in note", !rec.note.includes("sbp_0123456789abcdef0123") && rec.note.includes("«redacted»"));
}

console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILED"}`);
process.exit(fails === 0 ? 0 : 1);
