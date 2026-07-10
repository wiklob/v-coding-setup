#!/usr/bin/env node
// Tests for scorecard.mjs — the pure join/parse/rank logic. (V-81)
// Run: node bin/scorecard.test.mjs   (exit 0 = pass, 1 = fail)
//
// Covers the bits that are easy to get subtly wrong: tolerant JSONL parsing,
// the session→ticket map (lens-a join), and the gate-audit block parser —
// including the dedup that keeps "land-ticket · §5 · …" and "land-ticket §5 · …"
// as ONE gate (a split would have hidden that §6.7 was intervened once).

import { readJsonl, buildSessionTicketMap, parseGateAudit, sessionFindingsFor } from "./scorecard.mjs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fails = 0;
function check(name, cond) {
  console.log(`[${cond ? "ok" : "FAIL"}] ${name}`);
  if (!cond) fails++;
}

// --- readJsonl: tolerant of missing file + malformed lines ---
{
  const r = readJsonl(join(tmpdir(), "definitely-not-here-xyz.jsonl"));
  check("readJsonl missing → empty, not present", r.rows.length === 0 && r.present === false);
}
{
  const dir = mkdtempSync(join(tmpdir(), "sc-jsonl-"));
  try {
    const f = join(dir, "x.jsonl");
    writeFileSync(f, '{"a":1}\nnot json\n\n{"a":2}\n');
    const r = readJsonl(f);
    check("readJsonl parses good lines, skips malformed", r.rows.length === 2 && r.skipped === 1 && r.present === true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- buildSessionTicketMap: primary + related sessions ---
{
  const stats = [
    { ticket: "V-10", session_id: "s1", related_sessions: [{ session_id: "s1b" }] },
    { ticket: "V-11", session_id: "s2", related_sessions: [] },
    { ticket: "V-12", session_id: null }, // no session — ignored
  ];
  const m = buildSessionTicketMap(stats);
  check("map joins primary session→ticket", m.get("s1") === "V-10" && m.get("s2") === "V-11");
  check("map joins related session→ticket", m.get("s1b") === "V-10");
  check("map ignores null session_id", !m.has(null));
}
{
  // same_conversation priority: sX is a name-drop of V-20 (listed first) but real work
  // on V-21 (same_conversation) → binds to V-21 regardless of stats-file order.
  const stats = [
    { ticket: "V-20", session_id: "p20", related_sessions: [{ session_id: "sX", same_conversation: false }] },
    { ticket: "V-21", session_id: "p21", related_sessions: [{ session_id: "sX", same_conversation: true }] },
  ];
  const m = buildSessionTicketMap(stats);
  check("same_conversation related beats a name-drop claim", m.get("sX") === "V-21");
  check("a primary still outranks another ticket's name-drop", m.get("p20") === "V-20" && m.get("p21") === "V-21");
}

// --- parseGateAudit on the real file: shape + the §-dedup invariant ---
{
  const blocks = parseGateAudit();
  // The real gate-audit.md always has ≥1 run; each block must carry the shape.
  check(
    "parseGateAudit returns well-formed blocks from the real file",
    Array.isArray(blocks) &&
      blocks.length > 0 &&
      blocks.every((b) => typeof b.ticket === "string" && Array.isArray(b.gates) && typeof b.pd === "number")
  );

  // The dedup contract: the two on-disk gate-line formats ("land-ticket · §5 · …"
  // and "land-ticket §5 · …") must collapse to ONE key. A regression would
  // produce a doubled-section key like "land-ticket §5 §5", splitting one gate.
  const keys = blocks.flatMap((b) => b.gates.filter((g) => g.resolution).map((g) => g.key));
  check("no gate key has a doubled §section (dedup holds)", !keys.some((k) => /§[\d.]+\s+§[\d.]+/.test(k)));
  // A section with a letter suffix (real marker §1.C) must keep the letter and
  // leave no trailing-dot artifact ("§1." would drop the C and split the gate).
  check("no gate key has a trailing-dot section artifact", !keys.some((k) => /§[\d.]*\.$/.test(k)));

  // Both real land-ticket confirm gates resolve to their canonical single key,
  // and §6.7 retains its real intervention (the CB-160 run) — proving the merge
  // didn't drop data.
  const sixSeven = blocks.flatMap((b) => b.gates).filter((g) => g.key === "land-ticket §6.7" && g.resolution);
  check("land-ticket §6.7 is a real, single key with ≥1 intervention preserved", sixSeven.some((g) => g.resolution === "intervened"));
}

// --- V-234: sessionFindingsFor lens-(a) join — direct ticket field, session-map fallback ---
{
  const rows = [
    { activeCommand: "review-session", tool: "manual", ticket: "V-234", session: "sNoMap", error: "[lens-a/Allow] x ×2 — y" }, // direct ticket → joins even with empty map
    { activeCommand: "review-session", tool: "manual", session: "sLegacy", error: "[lens-a/Deny/Ask] z ×2 — w" }, // no ticket, session in map → joins (legacy path)
    { activeCommand: "review-session", tool: "manual", session: "sOrphan", error: "[lens-a/Allow] q ×2 — r" }, // no ticket, session not in map → no join
    { activeCommand: "review-session", tool: "manual", ticket: "V-999", session: "sOther", error: "[lens-a/Allow] o ×2 — p" }, // other ticket → no join
    { activeCommand: "harvest", tool: "manual", ticket: "V-234", error: "[lens-a/Allow] not review-session" }, // wrong activeCommand → excluded
  ];
  const sessionMap = new Map([["sLegacy", "V-234"]]);
  const res = sessionFindingsFor("V-234", rows, sessionMap);
  check("lens-(a): direct ticket field joins with an empty session-map (the V-234 fix)", res.buckets["lens-a/Allow"] === 1);
  check("lens-(a): legacy row (no ticket) still joins via the session→usage-stats map", res.buckets["lens-a/Deny/Ask"] === 1);
  check("lens-(a): orphan + other-ticket + non-review rows excluded → exactly 2 join", res.count === 2);
}
// Direct ticket is AUTHORITATIVE: a stamped row attributes ONLY to its ticket,
// never also to a different ticket via the session-map (no double-attribution).
{
  const rows = [{ activeCommand: "review-session", tool: "manual", ticket: "V-234", session: "sConflict", error: "[lens-a/Allow] c ×2 — d" }];
  const map = new Map([["sConflict", "V-999"]]); // session maps to a DIFFERENT ticket
  check("lens-(a): a ticket-stamped row joins its own ticket", sessionFindingsFor("V-234", rows, map).count === 1);
  check("lens-(a): a ticket-stamped row does NOT also join the session-map's ticket (no double-attribution)", sessionFindingsFor("V-999", rows, map).count === 0);
}

console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILED"}`);
process.exit(fails === 0 ? 0 : 1);
