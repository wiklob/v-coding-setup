#!/usr/bin/env node
// ~/.claude/bin/scorecard.mjs
// A5 (V-81): per-ticket scorecard + cross-session ceremony-vs-load-bearing aggregate.
//
// WHAT THIS IS:
//   The synthesis step of the "Pipeline self-review" project. It rolls the four
//   landed review lenses into ONE view per ticket, and aggregates across all
//   tickets/sessions into a ranked "what's ceremony vs load-bearing" verdict that
//   names ≥1 concrete pipeline change. It is, for the full chain, what
//   bin/log-gate-audit.mjs + gate-audit.md is for /go's gates.
//
// THE FOUR LENSES IT COMBINES (+ the gate-friction model):
//   (a) session-report  — errors.jsonl rows tagged activeCommand:"review-session",
//                         tool:"manual" (V-60). Payload `error` is a bracketed
//                         fix-class, e.g. "[lens-a/Allow] …" / "[lens-b/error-swallow] …".
//                         Rows carry only `session` (often null) — joined to a
//                         ticket via the session→ticket map built from usage-stats.
//   (b) tool-fit        — tool-fit.jsonl rows {lens,ticket,session,steps:[{step,
//                         ran,verdict,ceremony,evidence}]} (V-78). Direct `ticket` join.
//   (c) token economics — .claude/usage-stats/*.json {ticket,session_id,totals,
//                         by_command,tool_result_bytes,…} (V-79). Direct `ticket` join.
//   (e) produced-code   — produced-review.jsonl rows {subject:"review-produced",
//                         ticket,acceptance:[{verdict}],quality:{…}} (V-80). Direct join.
//   (f) human feedback  — feedback.jsonl rows {ts,session,conversation,subject,note}
//                         (V-173). The subjective human lens /report-feedback writes.
//                         Rows carry NO `ticket` field — only `session` — so per-ticket
//                         attribution uses the session→ticket map (the lens-(a) legacy
//                         join); `subject` (the command/topic) drives the by-command block.
//   (model) gate-audit  — gate-audit.md per-run markdown blocks (V-75). Grep by ticket.
//
// PATHS — read the CANONICAL checkout, always:
//   Like usage-stats.mjs, the main worktree is resolved via `git worktree list`
//   (first entry). The audit sinks (pipeline/audit/*) and usage-stats
//   (.claude/usage-stats/*) live in that one source-of-truth checkout; the
//   *.jsonl sinks are gitignored runtime data and are absent from feature
//   worktrees, so self-locating to the script's own copy would read empty dirs.
//   Resolving the main worktree means the scorecard reads real data no matter
//   which checkout's copy is invoked.
//
// GRACEFUL DEGRADE (convention 8):
//   A missing/empty sink yields "no data for lens X" — never a crash. Reads
//   surface their own failures rather than silently dropping records.
//
// USAGE:
//   node ~/.claude/bin/scorecard.mjs <TICKET-ID>     # per-ticket scorecard
//   node ~/.claude/bin/scorecard.mjs --aggregate     # cross-session ranked verdict
//   node ~/.claude/bin/scorecard.mjs --json <TICKET-ID|--aggregate>   # machine output
//
// Exit codes: 0 success · 2 bad/missing args.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { allocateUsageStats, summarizeAllocations, summarizeAccounting } from "./usage-accounting.mjs";

// ---------------------------------------------------------------------------
// Path resolution — canonical (main) checkout.
// ---------------------------------------------------------------------------
function resolveMainWt() {
  const out = execFileSync("git", ["worktree", "list", "--porcelain"], { encoding: "utf8" });
  const wt = out.split("\n").find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
  if (!wt) throw new Error("could not determine main worktree");
  return wt;
}

const MAIN_WT = resolveMainWt();
const AUDIT_DIR = join(MAIN_WT, "pipeline", "audit");
const STATS_DIR = join(MAIN_WT, ".claude", "usage-stats");
const P = {
  errors: join(AUDIT_DIR, "errors.jsonl"),
  toolFit: join(AUDIT_DIR, "tool-fit.jsonl"),
  produced: join(AUDIT_DIR, "produced-review.jsonl"),
  feedback: join(AUDIT_DIR, "feedback.jsonl"),
  gateAudit: join(AUDIT_DIR, "gate-audit.md"),
};

// ---------------------------------------------------------------------------
// Tolerant loaders — missing → empty; malformed line → skipped (counted).
// ---------------------------------------------------------------------------
function readJsonl(path) {
  if (!existsSync(path)) return { rows: [], skipped: 0, present: false };
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    process.stderr.write(`scorecard: WARN could not read ${path}: ${e.message}\n`);
    return { rows: [], skipped: 0, present: false };
  }
  const rows = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      skipped++;
    }
  }
  return { rows, skipped, present: true };
}

function loadUsageStats() {
  if (!existsSync(STATS_DIR)) return [];
  const out = [];
  for (const f of readdirSync(STATS_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(readFileSync(join(STATS_DIR, f), "utf8")));
    } catch (e) {
      process.stderr.write(`scorecard: WARN bad usage-stats ${f}: ${e.message}\n`);
    }
  }
  return out;
}

// session_id → ticket, from usage-stats primary + related sessions.
//
// Priority (highest first) so a session claimed by several tickets binds to the one
// it actually WORKED, not whichever stats file happened to be read first:
//   1. primary  — the land session IS that ticket's, authoritative.
//   2. related + same_conversation:true — it shares the ticket's land thread (one
//      resume chain): real work on the ticket (V-1 conversation signal).
//   3. related (content-match only) — a name-drop: it merely mentions the ticket.
//      First-wins among these (the legacy behavior).
// `same_conversation` is used only to PRIORITIZE, never to FILTER: it is best-effort
// (degrades to false once a thread's job-state is GC'd), so a missing/false signal
// falls straight through to the legacy content-match mapping — no attribution is ever
// dropped, only disambiguated when the signal is present.
function buildSessionTicketMap(stats) {
  const m = new Map();
  const set = (sid, ticket) => {
    if (sid && ticket && !m.has(sid)) m.set(sid, ticket);
  };
  // 1. primaries (authoritative) — claimed before any related session.
  for (const s of stats) set(s.session_id, s.ticket);
  // 2. same-conversation related sessions (real work) beat name-drops.
  for (const s of stats) for (const r of s.related_sessions || []) if (r.same_conversation) set(r.session_id, s.ticket);
  // 3. remaining content-match related sessions (legacy first-wins).
  for (const s of stats) for (const r of s.related_sessions || []) set(r.session_id, s.ticket);
  return m;
}

// Parse gate-audit.md into per-run blocks: {ticket, stamp, outcome, pd, intervened,
// forced, gates:[{key, resolution, raw}]}.
function parseGateAudit(path = P.gateAudit) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const blocks = [];
  let cur = null;
  for (const line of text.split("\n")) {
    const head = line.match(/^##\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s+—\s+(\S+)\s+\((.*)\)\s*$/);
    if (head) {
      if (cur) blocks.push(cur);
      cur = { stamp: head[1], ticket: head[2], outcome: head[3], pd: 0, intervened: 0, forced: 0, gates: [] };
      continue;
    }
    if (!cur) continue;
    const tally = line.match(/Tallies:\s*p'd\s+(\d+)\s*·\s*intervened\s+(\d+)\s*·\s*forced\s+(\d+)/);
    if (tally) {
      cur.pd = +tally[1];
      cur.intervened = +tally[2];
      cur.forced = +tally[3];
      continue;
    }
    if (line.startsWith("- ")) {
      const raw = line.slice(2);
      // Resolution token: the literal pipeline vocabulary, scanned in priority order.
      let resolution = null;
      if (/\bintervened\b/.test(raw)) resolution = "intervened";
      else if (/\bforced\b/.test(raw)) resolution = "forced";
      else if (/\bp'd\b/.test(raw)) resolution = "p'd";
      // Gate key: normalize the two on-disk formats ("phase · §N · …" and
      // "phase §N · …") to ONE key so a single gate isn't split (which would
      // hide, e.g., that §6.7 was intervened once). Strip any §marker already
      // embedded in the phase field before re-appending the canonical one.
      // The section token must keep a trailing letter (real markers like §1.C)
      // and never leave a trailing-dot artifact (§1.C → "§1." would drop the C
      // and split that gate across runs) — match digits/dots + an optional letter.
      const SECTION = /§[\d.]+[A-Za-z]?/g;
      const fields = raw.split(" · ").map((f) => f.trim());
      const phase = (fields[0] || "?").replace(SECTION, "").trim();
      const section = ((raw.match(SECTION) || [])[0] || "").replace(/\.$/, "");
      const key = section ? `${phase} ${section}` : fields[1] ? `${phase} · ${fields[1]}` : phase;
      cur.gates.push({ key, resolution, raw });
    }
  }
  if (cur) blocks.push(cur);
  return blocks;
}

// ---------------------------------------------------------------------------
// Per-lens extraction for a single ticket.
// ---------------------------------------------------------------------------
function tokenEconomicsFor(ticket, stats) {
  const mine = stats.filter((s) => s.ticket === ticket);
  if (!mine.length) return null;
  const summary = summarizeAllocations(mine);
  const byTool = {};
  for (const s of mine) {
    for (const [t, b] of Object.entries(s.tool_result_bytes || {})) byTool[t] = (byTool[t] || 0) + b;
  }
  const byCommand = {};
  for (const s of mine) {
    for (const [c, v] of Object.entries(s.by_command || {})) {
      byCommand[c] = (byCommand[c] || 0) + (v.output || 0);
    }
  }
  return {
    sessions: new Set(mine.map((s) => s.session_id).filter(Boolean)).size || mine.length,
    statsFiles: mine.length,
    output: summary.totals.output,
    input: summary.totals.input,
    cacheRead: summary.totals.cache_read,
    cacheCreate: summary.totals.cache_create,
    models: Object.values(summary.usage_by_model).sort((a, b) => b.totals.output - a.totals.output),
    accounting: summary.accounting,
    topTools: Object.entries(byTool).sort((a, b) => b[1] - a[1]).slice(0, 5),
    topCommands: Object.entries(byCommand).sort((a, b) => b[1] - a[1]).slice(0, 5),
  };
}

function toolFitFor(ticket, toolFitRows) {
  const mine = toolFitRows.filter((r) => r.ticket === ticket);
  if (!mine.length) return null;
  const steps = [];
  for (const r of mine) for (const st of r.steps || []) steps.push(st);
  return { records: mine.length, steps };
}

function producedFor(ticket, producedRows) {
  const mine = producedRows.filter((r) => r.ticket === ticket);
  if (!mine.length) return null;
  const tally = { met: 0, partial: 0, missed: 0 };
  const quality = [];
  for (const r of mine) {
    for (const a of r.acceptance || []) if (tally[a.verdict] != null) tally[a.verdict]++;
    if (r.quality) quality.push(r.quality);
  }
  return { records: mine.length, tally, quality };
}

function sessionFindingsFor(ticket, errorRows, sessionMap) {
  // V-234: a review-session finding attributes to this ticket via the direct
  // `ticket` field (stamped at emit by /review-session --ticket, the /land §8.6
  // case) — the robust join that mirrors how the tool-fit/produced sinks attribute
  // and sidesteps the finding→session→usage-stats indirection that missed 0/9 live.
  // The direct field is AUTHORITATIVE: when a row carries one, it attributes ONLY
  // to that ticket (never also to a different ticket via the session-map). The
  // session→usage-stats map is the fallback *only* for legacy rows that predate the
  // field — so a stamped row can't double-attribute when its `ticket` and its
  // session's map entry disagree.
  const mine = errorRows.filter(
    (r) =>
      r.activeCommand === "review-session" &&
      r.tool === "manual" &&
      (r.ticket != null
        ? r.ticket === ticket
        : r.session != null && sessionMap.get(r.session) === ticket)
  );
  const buckets = {};
  for (const r of mine) {
    const cls = (String(r.error || "").match(/^\[([^\]]+)\]/) || [])[1] || "other";
    buckets[cls] = (buckets[cls] || 0) + 1;
  }
  return { count: mine.length, buckets };
}

// (f) human feedback for one ticket. Feedback rows carry no direct `ticket`
// field (only `session`/`conversation` — /report-feedback is a zero-decision
// front door that never stamps one), so attribution is the same indirect join
// pre-V-234 session-findings use: session → ticket via the usage-stats map.
// Grouped by `subject` (the command/topic the feedback was about).
function feedbackFor(ticket, feedbackRows, sessionMap) {
  const mine = feedbackRows.filter((r) => r.session != null && sessionMap.get(r.session) === ticket);
  if (!mine.length) return null;
  const bySubject = {};
  for (const r of mine) {
    const subj = r.subject || "(no subject)";
    (bySubject[subj] ||= []).push(r.note || "");
  }
  return { count: mine.length, bySubject };
}

function gateFrictionFor(ticket, blocks) {
  const mine = blocks.filter((b) => b.ticket === ticket);
  if (!mine.length) return null;
  const tally = mine.reduce(
    (a, b) => ({ pd: a.pd + b.pd, intervened: a.intervened + b.intervened, forced: a.forced + b.forced }),
    { pd: 0, intervened: 0, forced: 0 }
  );
  return { runs: mine.length, tally, outcomes: mine.map((b) => b.outcome) };
}

// ---------------------------------------------------------------------------
// Per-ticket scorecard.
// ---------------------------------------------------------------------------
function buildScorecard(ticket) {
  const stats = allocateUsageStats(loadUsageStats());
  const sessionMap = buildSessionTicketMap(stats);
  const errors = readJsonl(P.errors);
  const toolFit = readJsonl(P.toolFit);
  const produced = readJsonl(P.produced);
  const feedback = readJsonl(P.feedback);
  const blocks = parseGateAudit();
  return {
    ticket,
    tokenEconomics: tokenEconomicsFor(ticket, stats),
    toolFit: toolFitFor(ticket, toolFit.rows),
    producedReview: producedFor(ticket, produced.rows),
    sessionFindings: sessionFindingsFor(ticket, errors.rows, sessionMap),
    feedback: feedbackFor(ticket, feedback.rows, sessionMap),
    gateFriction: gateFrictionFor(ticket, blocks),
    _sinks: { errors: errors.present, toolFit: toolFit.present, produced: produced.present, feedback: feedback.present, usageStats: stats.length > 0 },
  };
}

function fmtBytes(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}KB`;
  return `${n}B`;
}
function fmtNum(n) {
  return n.toLocaleString("en-US");
}
function fmtUsd(n) {
  return `$${(n || 0).toFixed(2)}`;
}
function renderAccountingLines(accounting, prefix = "- ") {
  const lines = [];
  for (const model of accounting?.models || []) {
    const name = model.observed_model || "(missing-model)";
    let amount = "";
    if (model.classification === "subscription usage — no token bill") amount = ` · API equivalent ${fmtUsd(model.api_equivalent_usd)}`;
    else if (model.estimate_usd != null) amount = ` · ${fmtUsd(model.estimate_usd)}`;
    const reason = model.reason ? ` · ${model.reason}` : "";
    lines.push(`${prefix}${name}: ${model.classification}${amount}${reason} · output ${fmtNum(model.totals.output)}`);
  }
  return lines;
}

function renderScorecard(sc) {
  const L = [];
  L.push(`# Scorecard — ${sc.ticket}`);
  L.push("");
  // (c) token economics
  L.push("## (c) Token economics");
  if (sc.tokenEconomics) {
    const te = sc.tokenEconomics;
    const files = te.statsFiles !== te.sessions ? ` · ${te.statsFiles} cumulative snapshot(s)` : "";
    L.push(`- ${te.sessions} session(s)${files} · output ${fmtNum(te.output)} · input ${fmtNum(te.input)} · cache-read ${fmtNum(te.cacheRead)}`);
    L.push(...renderAccountingLines(te.accounting));
    if (te.topCommands.length) L.push(`- top output by command: ${te.topCommands.map(([c, v]) => `${c} ${fmtNum(v)}`).join(" · ")}`);
    if (te.topTools.length) L.push(`- top tool_result re-read bytes: ${te.topTools.map(([t, b]) => `${t} ${fmtBytes(b)}`).join(" · ")}`);
  } else L.push("- no data for lens (c) — no usage-stats file for this ticket");
  // (b) tool-fit
  L.push("");
  L.push("## (b) Tool-fit");
  if (sc.toolFit) {
    for (const st of sc.toolFit.steps) {
      L.push(`- ${st.step}: ${st.verdict}${st.ceremony ? " · CEREMONY" : ""} — ${st.evidence || ""}`);
    }
  } else L.push("- no data for lens (b) — no tool-fit.jsonl record for this ticket");
  // (e) produced-code
  L.push("");
  L.push("## (e) Produced-code review");
  if (sc.producedReview) {
    const t = sc.producedReview.tally;
    L.push(`- acceptance: met ${t.met} · partial ${t.partial} · missed ${t.missed}`);
    for (const q of sc.producedReview.quality) {
      L.push(`- quality: clarity=${q.clarity || "?"} · reuse=${q.reuse || "?"} · engineering=${q.engineering || "?"} · conventions=${q.conventions || "?"}`);
    }
  } else L.push("- no data for lens (e) — no produced-review.jsonl record for this ticket");
  // (a) session-report
  L.push("");
  L.push("## (a) Session-review findings");
  if (sc.sessionFindings.count) {
    L.push(`- ${sc.sessionFindings.count} finding(s): ${Object.entries(sc.sessionFindings.buckets).map(([k, v]) => `${k} ×${v}`).join(" · ")}`);
  } else {
    L.push(`- no attributable findings for this ticket (no review-session row carries this ticket directly or via the session→usage-stats map; pre-V-234 rows join only through the map — see aggregate)`);
  }
  // (f) human feedback
  L.push("");
  L.push("## (f) Human feedback");
  if (sc.feedback) {
    L.push(`- ${sc.feedback.count} attributable note(s):`);
    for (const [subj, notes] of Object.entries(sc.feedback.bySubject)) {
      L.push(`  - ${subj} ×${notes.length}: ${notes.map((n) => `"${n}"`).join(" · ")}`);
    }
  } else if (sc._sinks.feedback) {
    L.push("- no data for lens (f) — no feedback.jsonl row attributable to this ticket (rows join only via the session→usage-stats map; see the aggregate's by-command block for unattributed feedback)");
  } else {
    L.push("- no data for lens (f) — feedback.jsonl empty/absent");
  }
  // (model) gate friction
  L.push("");
  L.push("## (model) Gate friction");
  if (sc.gateFriction) {
    const g = sc.gateFriction;
    L.push(`- ${g.runs} /go run(s) — p'd ${g.tally.pd} · intervened ${g.tally.intervened} · forced ${g.tally.forced} · outcomes: ${g.outcomes.join("; ")}`);
  } else L.push("- no /go run recorded for this ticket in gate-audit.md");
  return L.join("\n");
}

// ---------------------------------------------------------------------------
// Cross-session aggregate.
// ---------------------------------------------------------------------------
function buildAggregate() {
  const stats = allocateUsageStats(loadUsageStats());
  const sessionMap = buildSessionTicketMap(stats);
  const errors = readJsonl(P.errors);
  const toolFit = readJsonl(P.toolFit);
  const produced = readJsonl(P.produced);
  const feedback = readJsonl(P.feedback);
  const blocks = parseGateAudit();

  // Cost — normalized allocations prevent cumulative session snapshots from being
  // counted twice. Keep output-token rankings for compatibility and add billing classes.
  const byTicketOutput = {};
  const byTicketAccounting = {};
  const byToolBytes = {};
  for (const s of stats) {
    if (s.ticket) {
      byTicketOutput[s.ticket] = (byTicketOutput[s.ticket] || 0) + (s.totals?.output || 0);
      (byTicketAccounting[s.ticket] ||= []).push(s.accounting);
    }
    for (const [t, b] of Object.entries(s.tool_result_bytes || {})) byToolBytes[t] = (byToolBytes[t] || 0) + b;
  }
  const costTickets = Object.entries(byTicketOutput).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const costTools = Object.entries(byToolBytes).sort((a, b) => b[1] - a[1]).slice(0, 10);
  // Rank per class separately — the four billing classes are never comparable,
  // so a single cross-class scalar would be meaningless (V-378). Each ranking is
  // sorted by its own class total; a ticket may appear in more than one.
  const ranked = Object.entries(byTicketAccounting).map(([ticket, rows]) => ({ ticket, accounting: summarizeAccounting(rows) }));
  const rankBy = (sel) => ranked.filter((r) => sel(r.accounting.totals) > 0).sort((a, b) => sel(b.accounting.totals) - sel(a.accounting.totals)).slice(0, 10).map((r) => ({ ticket: r.ticket, usd: sel(r.accounting.totals), accounting: r.accounting }));
  const billingTickets = {
    actual_api: rankBy((t) => t.actual_api_estimate_usd),
    api_equivalent: rankBy((t) => t.api_equivalent_estimate_usd),
    subscription_api_equivalent: rankBy((t) => t.subscription_api_equivalent_usd),
    unknown_output_tokens: rankBy((t) => t.unknown_unpriced_tokens.output),
  };
  const accounting = summarizeAccounting(stats.map((s) => s.accounting));

  // Quality — produced-review missed/partial by ticket.
  const qualTickets = {};
  for (const r of produced.rows) {
    if (!r.ticket) continue;
    const q = (qualTickets[r.ticket] ||= { partial: 0, missed: 0 });
    for (const a of r.acceptance || []) {
      if (a.verdict === "partial") q.partial++;
      if (a.verdict === "missed") q.missed++;
    }
  }
  const qualOffenders = Object.entries(qualTickets)
    .map(([t, q]) => [t, q.missed * 2 + q.partial, q])
    .filter((x) => x[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Ceremony — tool-fit steps flagged ceremony / overkill / underdelivered.
  const ceremonySteps = {};
  for (const r of toolFit.rows) {
    for (const st of r.steps || []) {
      if (st.ceremony || st.verdict === "overkill" || st.verdict === "underdelivered") {
        const k = `${st.step}/${st.verdict}${st.ceremony ? "+ceremony" : ""}`;
        (ceremonySteps[k] ||= { count: 0, tickets: [] }).count++;
        if (r.ticket) ceremonySteps[k].tickets.push(r.ticket);
      }
    }
  }

  // Gate ceremony-vs-load-bearing — per gate key across all runs.
  const gateStats = {};
  for (const b of blocks) {
    for (const g of b.gates) {
      if (!g.resolution) continue; // skip "no gate fired" lines
      const gs = (gateStats[g.key] ||= { pd: 0, intervened: 0, forced: 0 });
      gs[g.resolution.replace("'", "")] = (gs[g.resolution.replace("'", "")] || 0) + 1;
    }
  }
  const gateRows = Object.entries(gateStats)
    .map(([k, v]) => ({ key: k, ...v, total: (v.pd || 0) + (v.intervened || 0) + (v.forced || 0) }))
    .sort((a, b) => b.total - a.total);

  // (f) Human feedback by command — group ALL feedback rows by `subject` (the
  // command/topic), the block where the signal lives (most rows aren't ticket-
  // attributable). Each subject: count + the most-recent note as a sample.
  const feedbackBySubject = {};
  for (const r of feedback.rows) {
    const subj = r.subject || "(no subject)";
    const fb = (feedbackBySubject[subj] ||= { count: 0, latest: null, latestTs: "" });
    fb.count++;
    if ((r.ts || "") >= fb.latestTs) {
      fb.latestTs = r.ts || "";
      fb.latest = r.note || "";
    }
  }
  const feedbackRows = Object.entries(feedbackBySubject)
    .map(([subject, v]) => ({ subject, ...v }))
    .sort((a, b) => b.count - a.count);

  // Session-review attribution health.
  const reviewRows = errors.rows.filter((r) => r.activeCommand === "review-session" && r.tool === "manual");
  const withSession = reviewRows.filter((r) => r.session).length;
  // V-234: a row is attributable if it carries a direct `ticket` field OR its
  // session resolves to a ticket via the usage-stats map (legacy path).
  const attributable = reviewRows.filter((r) => r.ticket || (r.session && sessionMap.get(r.session))).length;

  // ---- Recommendations: concrete pipeline changes, each evidence-cited. ----
  const recs = [];

  // R1: the dominant context-footprint tool (V-79 offender class), quantified.
  if (costTools.length) {
    const [tool, bytes] = costTools[0];
    recs.push(
      `Trim the biggest context-footprint offender: tool \`${tool}\` accounts for ${fmtBytes(bytes)} of tool_result re-read across ${stats.length} session(s) — the largest re-read cost. Narrow its responses / reads (cf. V-79 token-economics finding).`
    );
  }

  // R2: gate prune vs keep — any confirm gate that NEVER intervened over ≥N runs is ceremony.
  const PRUNE_MIN = 5;
  const pruneCandidates = gateRows.filter((g) => g.total >= PRUNE_MIN && (g.intervened || 0) === 0 && (g.forced || 0) === 0);
  const loadBearing = gateRows.filter((g) => (g.intervened || 0) > 0);
  if (pruneCandidates.length) {
    for (const g of pruneCandidates) {
      recs.push(
        `Prune/collapse gate \`${g.key}\`: p'd ${g.pd}/${g.total} runs, never intervened — ceremony candidate. Consider folding it into an adjacent gate.`
      );
    }
  } else if (gateRows.length) {
    const top = gateRows.slice(0, 2).map((g) => `${g.key} (p'd ${g.pd}/${g.total}, intervened ${g.intervened || 0})`).join("; ");
    recs.push(
      `No confirm gate is pure ceremony — every recurring gate has intervened ≥1× (most-exercised: ${top}). Keep them; the friction is load-bearing.`
    );
  }

  // R3: data-pipeline defect — session-review findings are unattributable.
  if (reviewRows.length && attributable / reviewRows.length < 0.5) {
    const withTicket = reviewRows.filter((r) => r.ticket).length;
    recs.push(
      `Fix lens-(a) attribution: ${reviewRows.length - attributable}/${reviewRows.length} review-session findings are unattributable to a ticket (${reviewRows.length - withSession}/${reviewRows.length} carry session:null; ${reviewRows.length - withTicket}/${reviewRows.length} lack a direct \`ticket\` field). /review-session --emit should pass --ticket (the /land §8.6 invocation does) so each finding carries a direct \`ticket\` field and joins like the tool-fit/produced sinks (V-234); pre-V-234 rows attribute only via the session→usage-stats map.`
    );
  }

  return {
    sessionsAnalyzed: new Set(stats.map((s) => s.session_id).filter(Boolean)).size || stats.length,
    statsFilesAnalyzed: stats.length,
    costTickets,
    billingTickets,
    accounting,
    costTools,
    qualOffenders,
    ceremonySteps,
    gateRows,
    pruneCandidates,
    loadBearing,
    reviewAttribution: { total: reviewRows.length, withSession, attributable },
    feedbackRows,
    feedbackTotal: feedback.rows.length,
    recommendations: recs,
    _sinks: { errors: errors.present, toolFit: toolFit.present, produced: produced.present, feedback: feedback.present, usageStats: stats.length > 0 },
  };
}

function renderAggregate(ag) {
  const L = [];
  L.push(`# Cross-session aggregate — ceremony vs load-bearing`);
  const files = ag.statsFilesAnalyzed !== ag.sessionsAnalyzed ? ` from ${ag.statsFilesAnalyzed} cumulative snapshot(s)` : "";
  L.push(`Analyzed ${ag.sessionsAnalyzed} usage-stats session(s)${files} · ${ag.gateRows.length} distinct gate(s) · review-session findings: ${ag.reviewAttribution.total} (${ag.reviewAttribution.attributable} ticket-attributable)`);
  L.push("");
  L.push("## Top cost offenders");
  L.push("### by output tokens (ticket)");
  for (const [t, v] of ag.costTickets) L.push(`- ${t}: ${fmtNum(v)} output tokens`);
  L.push("### by model-aware accounting (per class — classes never combined)");
  const classLabels = [
    ["actual_api", "actual API estimate"],
    ["api_equivalent", "API-equivalent estimate"],
    ["subscription_api_equivalent", "subscription usage — no token bill (API equivalent)"],
    ["unknown_output_tokens", "unknown/unpriced output tokens"],
  ];
  for (const [key, label] of classLabels) {
    const rows = ag.billingTickets[key] || [];
    if (!rows.length) continue;
    L.push(`#### ${label}`);
    for (const row of rows) L.push(`- ${row.ticket}: ${key === "unknown_output_tokens" ? `${fmtNum(row.usd)} tok` : fmtUsd(row.usd)}`);
  }
  L.push("### categorized totals (never combined into one bill)");
  L.push(...renderAccountingLines(ag.accounting));
  L.push("### by tool_result re-read bytes (tool)");
  for (const [t, b] of ag.costTools) L.push(`- ${t}: ${fmtBytes(b)}`);
  L.push("");
  L.push("## Top quality offenders (produced-review)");
  if (ag.qualOffenders.length) for (const [t, score, q] of ag.qualOffenders) L.push(`- ${t}: missed ${q.missed} · partial ${q.partial} (score ${score})`);
  else L.push("- no data — produced-review.jsonl empty/absent");
  L.push("");
  L.push("## Ceremony candidates (tool-fit)");
  if (Object.keys(ag.ceremonySteps).length) for (const [k, v] of Object.entries(ag.ceremonySteps)) L.push(`- ${k}: ×${v.count} ${v.tickets.length ? `(${v.tickets.join(",")})` : ""}`);
  else L.push("- no data — tool-fit.jsonl empty/absent");
  L.push("");
  L.push("## Gate ceremony vs load-bearing (gate-audit)");
  for (const g of ag.gateRows) L.push(`- ${g.key}: p'd ${g.pd || 0} · intervened ${g.intervened || 0} · forced ${g.forced || 0} (${g.total} total)`);
  L.push("");
  L.push("## Human feedback by command (feedback.jsonl)");
  if (ag.feedbackRows.length) {
    L.push(`${ag.feedbackTotal} feedback note(s) across ${ag.feedbackRows.length} subject(s):`);
    for (const f of ag.feedbackRows) {
      const sample = f.latest.length > 200 ? `${f.latest.slice(0, 200)}…` : f.latest;
      L.push(`- ${f.subject}: ×${f.count} — latest: "${sample}"`);
    }
  } else if (ag._sinks.feedback) L.push("- no data — feedback.jsonl present but empty");
  else L.push("- no data — feedback.jsonl empty/absent");
  L.push("");
  L.push("## Recommendations — concrete pipeline changes");
  if (ag.recommendations.length) ag.recommendations.forEach((r, i) => L.push(`${i + 1}. ${r}`));
  else L.push("- (none derived — insufficient data)");
  return L.join("\n");
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------
function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const rest = argv.filter((a) => a !== "--json");
  const wantAggregate = rest.includes("--aggregate");
  const ticket = rest.find((a) => !a.startsWith("--"));

  if (!wantAggregate && !ticket) {
    process.stderr.write("usage: scorecard.mjs <TICKET-ID> | --aggregate [--json]\n");
    process.exit(2);
  }
  if (wantAggregate) {
    const ag = buildAggregate();
    process.stdout.write((asJson ? JSON.stringify(ag, null, 2) : renderAggregate(ag)) + "\n");
  } else {
    const sc = buildScorecard(ticket);
    process.stdout.write((asJson ? JSON.stringify(sc, null, 2) : renderScorecard(sc)) + "\n");
  }
  process.exit(0);
}

const isMain = process.argv[1] && process.argv[1].endsWith("scorecard.mjs");
if (isMain) main();

export { readJsonl, buildSessionTicketMap, parseGateAudit, sessionFindingsFor, feedbackFor, tokenEconomicsFor, buildAggregate, buildScorecard };
