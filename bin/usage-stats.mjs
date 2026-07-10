#!/usr/bin/env node
// ~/.claude/bin/usage-stats.mjs
// Replaces /land-ticket §8.5's shell block.
//
// Captures a ticket's usage and links its whole lifecycle. A ticket spans many
// sessions across ≥2 project dirs (CB-122 = 1 session/4 tickets; CB-144 = 4
// sessions/1 ticket), none named for the ticket. Two jobs:
//
//   1. PRIMARY session — the land session whose §8.5 call this is. Identified by
//      IDENTITY, not freshest-mtime: the SessionStart capture-hook sidecar gives the
//      harness-authoritative live transcript_path (rewritten on every resume/compact),
//      so a long/resumed land binds correctly. `--session <id>` pins one explicitly
//      (backfill). Last resort is the V-26 resolver's top content-matched session —
//      never "newest .jsonl in the dir", the bug that made CB-122 grab a co-resident
//      session (V-1 Part 1). Headline totals/tool_calls cover THIS session. The
//      payload also records the primary's `conversation` (its resume-chain root).
//
//   2. RELATED sessions — every OTHER session that mentions the ticket, via the V-26
//      resolver (content-match). LINKED (id, dir, mentions, ts), never summed: the
//      resolver ranks by mention count, and a famous-example ticket is referenced far
//      beyond the sessions that worked on it (CB-144 content-matches ~67 sessions, not
//      4), so summing them would wildly over-count cost. This is V-1 Part 2's
//      sanctioned "declare land-only + link the sibling ids" branch. Each related
//      session also carries `conversation` + `same_conversation` (does it share the
//      primary's thread): the precision signal that separates the handful that truly
//      worked the ticket (one resume chain) from the ~63 that merely name-drop it.
//
// Streaming end-to-end (readline over createReadStream) — a raw transcript is never
// pulled into context. There is NO recency/staleness gate (it rejected exactly the
// long/resumed lands §8.5 must support — V-1 Part 3). The only abort is "primary
// session cannot be resolved", and it FAILS LOUD (exit 1 + a --session hint), never
// the old silent no-op.
//
// Usage:
//   node ~/.claude/bin/usage-stats.mjs --ticket <TICKET-ID> [--pr <n>]
//   node ~/.claude/bin/usage-stats.mjs --ticket <ID> --session <session-id> [--pr <n>]
//       └─ pin a specific transcript as primary (backfill / override). Accepts a
//          short unique PREFIX of the session id (e.g. `8fe27a29`) as well as the
//          full id — a non-unique prefix fails loud, listing the candidates.
//   node ~/.claude/bin/usage-stats.mjs --ticket <ID> --dry-run
//       └─ print the payload, write nothing (debug discovery)
//   node ~/.claude/bin/usage-stats.mjs --ticket <ID> [--session <id>] --by-command
//       └─ also print the per-command (phase) token attribution + per-tool
//          response-payload size tables to console (V-79). Resolves a primary
//          session like the default run, so it still needs --ticket (or --session).
//
// Exit codes:
//   0  stats file written (or dry-run inspection printed)
//   1  primary session unresolvable / has no assistant messages / git/fs error
//   3  bad args

import { execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  appendFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { createReadStream } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { resolveTicket } from "./transcript-resolver.mjs";
import { resolveConversationId } from "./session-identity.mjs";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a?.startsWith("--")) return null;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true; // boolean flag (e.g. --dry-run)
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const HOME = homedir();
const PROJECTS = join(HOME, ".claude/projects");

// --- session-id → jsonl resolution --------------------------------------------
function mtimeOrNeg(p) {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return -1;
  }
}

function findRecursive(root, name) {
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === name) return p;
    }
  }
  return null;
}

function resolveSid(sid, encoded) {
  if (encoded) {
    const guess = join(PROJECTS, encoded, `${sid}.jsonl`);
    if (existsSync(guess)) return guess;
  }
  return findRecursive(PROJECTS, `${sid}.jsonl`);
}

// Collect every transcript under `root` whose session id begins with `prefix`
// (the `${sid}.jsonl` exact case is included). Returns [{ sid, path }].
function findByPrefix(root, prefix) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.endsWith(".jsonl") && e.name.startsWith(prefix)) {
        out.push({ sid: e.name.slice(0, -".jsonl".length), path: p });
      }
    }
  }
  return out;
}

// Pure selection over a list of candidate session ids — the `--session` resolution
// rule, FS-free so it is unit-testable. Exact id wins; otherwise a single prefix
// match is `unique`; zero is `none`; two or more is `ambiguous` (fail loud, never
// silently pick — the V-1 Part-1 wrong-session class).
function selectTranscript(sids, sid) {
  if (sids.includes(sid)) return { kind: "exact", sid };
  const matches = sids.filter((s) => s.startsWith(sid));
  if (matches.length === 0) return { kind: "none" };
  if (matches.length === 1) return { kind: "unique", sid: matches[0] };
  return { kind: "ambiguous", matches };
}

// Read a capture-session.mjs sidecar and return its recorded transcript_path (or null).
function readSidecarPath(file) {
  try {
    const o = JSON.parse(readFileSync(file, "utf8"));
    if (o && typeof o.transcript_path === "string") return o.transcript_path;
  } catch {
    /* missing / unparseable */
  }
  return null;
}

// --- primary-session discovery -------------------------------------------------
// Returns { path, source, rows } for the land/explicit session — `rows` is the
// resolveTicket result when this function had to compute it (content-match path), so
// the caller can reuse it for related_sessions instead of re-scanning the corpus.
// Throws (→ fail loud) only when nothing resolves. Order, most-authoritative first:
//   1. --session <id>            explicit pin
//   2. capture-hook sidecars     harness-authoritative live transcript_path
//   3. session-id env/state hints
//   4. resolveTicket top-ranked  content-match (NOT newest-.jsonl-in-dir — the V-1
//                                Part 1 bug). last resort, e.g. older sessions whose
//                                capture hook never ran.
async function discoverPrimary(ticket, sessionArg) {
  if (sessionArg === true) {
    throw new Error("--session requires a value (a session id).");
  }
  if (typeof sessionArg === "string") {
    const encoded = process.cwd().replace(/\//g, "-");
    const found = resolveSid(sessionArg, encoded);
    if (found) return { path: found, source: "session-flag" };
    // Exact filename miss → treat the value as a session-id PREFIX and resolve it.
    const candidates = findByPrefix(PROJECTS, sessionArg);
    const pick = selectTranscript(
      candidates.map((c) => c.sid),
      sessionArg
    );
    if (pick.kind === "none") {
      throw new Error(
        `--session: no transcript matches id/prefix '${sessionArg}' under ${PROJECTS}. ` +
          `Pass the full session id.`
      );
    }
    if (pick.kind === "ambiguous") {
      throw new Error(
        `--session: prefix '${sessionArg}' is ambiguous — ${pick.matches.length} transcripts match ` +
          `(${pick.matches.join(", ")}). Pass a longer prefix or the full session id.`
      );
    }
    const chosen = candidates.find((c) => c.sid === pick.sid);
    return { path: chosen.path, source: "session-prefix" };
  }

  // Read state.json once (bg jobs): origin cwd + daemon session pointers.
  let state = null;
  const jobDir = process.env.CLAUDE_JOB_DIR;
  if (jobDir && existsSync(join(jobDir, "state.json"))) {
    try {
      state = JSON.parse(readFileSync(join(jobDir, "state.json"), "utf8"));
    } catch (e) {
      throw new Error(`state.json unreadable: ${e.message}`);
    }
  }
  const origin = state?.originCwd ?? state?.cwd ?? process.cwd();
  const encoded = origin.replace(/\//g, "-");

  // (1) Harness-authoritative sidecars — rewritten on every resume/compact.
  const sidecarPaths = [];
  if (jobDir) {
    const p = readSidecarPath(join(jobDir, "transcript.json"));
    if (p) sidecarPaths.push(p);
  }
  const perCwd = readSidecarPath(join(HOME, ".claude/run/transcripts", `${encoded}.json`));
  if (perCwd) sidecarPaths.push(perCwd);
  const liveSidecars = [...new Set(sidecarPaths)].filter((p) => existsSync(p));
  if (liveSidecars.length) {
    liveSidecars.sort((a, b) => mtimeOrNeg(b) - mtimeOrNeg(a));
    return { path: liveSidecars[0], source: "sidecar" };
  }

  // (2) Session-id hints → resolved files (fallback when the capture hook never ran).
  const sids = [];
  if (process.env.CLAUDE_CODE_SESSION_ID) sids.push(process.env.CLAUDE_CODE_SESSION_ID);
  if (state?.resumeSessionId) sids.push(state.resumeSessionId);
  if (state?.sessionId) sids.push(state.sessionId);
  const hintPaths = [];
  for (const s of [...new Set(sids.filter(Boolean))]) {
    const f = resolveSid(s, encoded);
    if (f) hintPaths.push(f);
  }
  if (hintPaths.length) {
    hintPaths.sort((a, b) => mtimeOrNeg(b) - mtimeOrNeg(a));
    return { path: hintPaths[0], source: "id-hint" };
  }

  // (3) Content-match top-ranked (V-26 resolver) — replaces newest-.jsonl-in-dir.
  const rows = await resolveTicket(ticket);
  if (rows.length === 0) {
    throw new Error(
      `cannot resolve a primary session for ${ticket} — no capture-hook sidecar, ` +
        `no session-id hint, and no session mentions ${ticket} across ${PROJECTS}/*. ` +
        `Backfill explicitly: --session <session-id>.`
    );
  }
  console.error(
    `WARN: no sidecar/id-hint; primary = top content-matched session (${rows[0].mentions}× ${rows[0].session_id}).`
  );
  return { path: rows[0].jsonl_path, source: "content-match-top", rows };
}

// --- per-command attribution helpers (V-79) ------------------------------------
// The transcript carries no explicit phase marker, but a slash-command turn injects
// a `<command-name>…</command-name>` tag on its user message (same pattern
// log-pipeline-error.mjs keys off). Maintaining a cursor on the LAST such tag seen
// attributes every following assistant turn (tokens + tool calls) to that command —
// turning the flat session total into a per-phase breakdown without a new data source.
const CMD_RE = /<command-name>\s*\/?([A-Za-z0-9_-]+)\s*<\/command-name>/g;
const NO_CMD = "(uncommanded)"; // turns before/outside any slash-command — never dropped

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((it) =>
        typeof it === "string" ? it : it?.type === "text" ? (it.text ?? "") : ""
      )
      .join("\n");
  }
  return "";
}

function lastCommand(text) {
  const m = [...text.matchAll(CMD_RE)];
  return m.length ? m[m.length - 1][1] : null;
}

function blankBucket() {
  return {
    input: 0,
    output: 0,
    cache_read: 0,
    cache_create: 0,
    assistant_msg_count: 0,
    tool_calls: {},
  };
}

// --- single streaming pass over the primary JSONL ------------------------------
// Sums tokens, counts tool calls, and the Part-4 signals: compound_bash (a Bash
// command stapling steps with ` && `, feeds V-4/V-15) and failed_calls (tool_result
// items flagged is_error, which arrive on user-type messages).
//
// V-79 additively attributes the same per-message usage/tool data BY active command
// (`by_command`) and measures per-tool RESPONSE PAYLOAD size (`tool_result_bytes` /
// `tool_result_count`) by matching each user-side tool_result back to the tool_use id
// that produced it — the evidence for "is Linear expensive because its responses are
// verbose?". Response bytes ≈ context that is re-read at cache-read price every later
// turn, so this is where MCP context cost actually accrues (not the output to emit the
// call). These are additive return fields; scan()'s existing contract is unchanged.
//
// De-dup boundary (V-60): these are RAW COUNTS that corroborate — the census never
// ROUTES call shapes into script/allow/deny. That single classifier lives only in
// session-review.mjs's Lens A (classifyShape), surfaced via /review-session. One
// classifier, not two; do not reintroduce routing here.
async function scan(file) {
  const totals = {
    input: 0,
    output: 0,
    cache_read: 0,
    cache_create: 0,
    assistant_msg_count: 0,
  };
  const toolCalls = {};
  let compoundBash = 0;
  let failedCalls = 0;
  let firstAssistantTs = null;
  let lastAssistantTs = null;

  // V-79 attribution state.
  const byCommand = {};
  let activeCmd = NO_CMD;
  const toolUseIdToName = {}; // tool_use id → tool name (assistant side)
  const toolResultBytesByTool = {}; // tool name → Σ serialized result length (all calls; back-compat)
  const toolResultCountByTool = {}; // tool name → # results observed (all calls; back-compat)
  // V-143 — per-call sizes split by success/error, so a single interrupted/errored
  // call can't pollute the size headline (the V-107 averaged-in 5 KB save_issue).
  const toolResultSizesOkByTool = {}; // tool name → [byte length] for successful calls
  const toolResultSizesErrByTool = {}; // tool name → [byte length] for errored/interrupted calls
  const bucket = (cmd) => (byCommand[cmd] ??= blankBucket());

  const rl = createInterface({
    input: createReadStream(file),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    // User messages: advance the command cursor + census tool_result errors/sizes.
    if (obj.type === "user") {
      const content = obj.message?.content;
      const cmd = lastCommand(textOf(content));
      if (cmd) activeCmd = cmd; // a new slash-command turn → switch phase
      if (Array.isArray(content)) {
        for (const item of content) {
          if (item?.type !== "tool_result") continue;
          const errored = item.is_error === true;
          if (errored) failedCalls++;
          const name = toolUseIdToName[item.tool_use_id];
          if (name) {
            const len =
              typeof item.content === "string"
                ? item.content.length
                : JSON.stringify(item.content ?? "").length;
            toolResultBytesByTool[name] = (toolResultBytesByTool[name] ?? 0) + len;
            toolResultCountByTool[name] = (toolResultCountByTool[name] ?? 0) + 1;
            (errored
              ? (toolResultSizesErrByTool[name] ??= [])
              : (toolResultSizesOkByTool[name] ??= [])
            ).push(len);
          }
        }
      }
      continue;
    }

    if (obj.type !== "assistant") continue;
    totals.assistant_msg_count++;
    const b = bucket(activeCmd);
    b.assistant_msg_count++;
    const usage = obj.message?.usage;
    if (usage) {
      totals.input += usage.input_tokens ?? 0;
      totals.output += usage.output_tokens ?? 0;
      totals.cache_read += usage.cache_read_input_tokens ?? 0;
      totals.cache_create += usage.cache_creation_input_tokens ?? 0;
      b.input += usage.input_tokens ?? 0;
      b.output += usage.output_tokens ?? 0;
      b.cache_read += usage.cache_read_input_tokens ?? 0;
      b.cache_create += usage.cache_creation_input_tokens ?? 0;
    }
    const content = obj.message?.content;
    if (Array.isArray(content)) {
      for (const item of content) {
        if (item?.type === "tool_use" && item.name) {
          toolCalls[item.name] = (toolCalls[item.name] ?? 0) + 1;
          b.tool_calls[item.name] = (b.tool_calls[item.name] ?? 0) + 1;
          if (item.id) toolUseIdToName[item.id] = item.name;
          if (item.name === "Bash" && typeof item.input?.command === "string") {
            if (item.input.command.includes(" && ")) compoundBash++;
          }
        }
      }
    }
    if (obj.timestamp) {
      firstAssistantTs ??= obj.timestamp;
      lastAssistantTs = obj.timestamp;
    }
  }
  return {
    totals,
    toolCalls,
    compoundBash,
    failedCalls,
    firstAssistantTs,
    lastAssistantTs,
    byCommand,
    toolResultBytesByTool,
    toolResultCountByTool,
    toolResultSizesOkByTool,
    toolResultSizesErrByTool,
  };
}

function isoTrim(ts) {
  return ts ? ts.replace(/\.\d+Z$/, "Z") : null;
}

// V-79 — per-Mtok USD pricing (Opus 4.x, from docs usage-stats.md). cache_read is the
// cheap re-read price a verbose tool_result pays on EVERY subsequent turn it sits in
// the cached prefix — which is why response verbosity, not call count, dominates MCP cost.
const PRICE = { input: 15, output: 75, cache_create: 18.75, cache_read: 1.5 };
const usd = (t) =>
  ((t.input ?? 0) * PRICE.input +
    (t.output ?? 0) * PRICE.output +
    (t.cache_create ?? 0) * PRICE.cache_create +
    (t.cache_read ?? 0) * PRICE.cache_read) /
  1e6;
const k = (n) => (n / 1000).toFixed(1) + "k";

// V-143 — distribution helpers over an ascending-sorted number[] (nearest-rank
// percentile, clamped; both 0 on empty). Used for the per-call size headline.
const pct = (sorted, q) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] : 0;
const median = (sorted) => {
  if (!sorted.length) return 0;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : Math.round((sorted[m - 1] + sorted[m]) / 2);
};

// Print the per-command phase breakdown + the per-tool response-payload table.
// Two questions answered: (1) where did the session's $ go, by phase? (2) for the
// expensive tools (esp. mcp__linear__*), how big are their RESPONSES — the bytes that
// re-enter the cached context every following turn?
function printAttribution(scanned) {
  const cmds = Object.entries(scanned.byCommand).sort((a, b) => usd(b[1]) - usd(a[1]));
  const sessTotal = usd(scanned.totals) || 1; // guard /0
  console.log("\n— Token attribution by command (V-79) —");
  console.log("command           msgs    out-tok   cache-rd      $     %sess");
  for (const [cmd, b] of cmds) {
    const cost = usd(b);
    console.log(
      `${cmd.padEnd(16)} ${String(b.assistant_msg_count).padStart(5)}  ${k(b.output).padStart(8)}  ${k(b.cache_read).padStart(9)}  ${("$" + cost.toFixed(2)).padStart(7)}  ${((cost / sessTotal) * 100).toFixed(0).padStart(4)}%`
    );
  }
  console.log(`(session total $${usd(scanned.totals).toFixed(2)})`);
  // V-143/D — %sess demoted to a caveated secondary: it is non-deterministic
  // (swings with how much file-reading a run did — 2% vs 5% on the same session).
  // The deterministic headline is the per-call size distribution below.
  console.log("(%sess is a non-deterministic SECONDARY metric — it varies with per-session file-read volume; the per-call size distribution below is the deterministic headline.)");

  // V-143 — HEADLINE: per-call response-size DISTRIBUTION over SUCCESSFUL calls
  // only (min/median/p95/max), so a single interrupted/errored outlier can't fool
  // the average (the V-107 regression: one interrupted 5 KB save_issue dragged the
  // average 46→364 tok and was invisible). Errored calls are listed apart below.
  const okSizes = scanned.toolResultSizesOkByTool ?? {};
  const errSizes = scanned.toolResultSizesErrByTool ?? {};
  const names = [...new Set([...Object.keys(okSizes), ...Object.keys(errSizes)])];
  const rows = names
    .map((name) => {
      const ok = (okSizes[name] ?? []).slice().sort((a, b) => a - b);
      return { name, ok, sumOk: ok.reduce((s, v) => s + v, 0), err: errSizes[name] ?? [] };
    })
    .sort((a, b) => b.sumOk - a.sumOk);
  console.log("\n— Tool response payload size per SUCCESSFUL call (bytes; V-143 distribution) —");
  console.log("tool                                  n     min   median      p95      max    Σbytes");
  for (const r of rows.slice(0, 15)) {
    const n = r.ok.length;
    console.log(
      `${r.name.padEnd(34)} ${String(n).padStart(5)}  ${String(r.ok[0] ?? 0).padStart(6)}  ${String(median(r.ok)).padStart(7)}  ${String(pct(r.ok, 0.95)).padStart(7)}  ${String(r.ok[n - 1] ?? 0).padStart(7)}  ${String(r.sumOk).padStart(8)}`
    );
  }
  const erroredRows = rows.filter((r) => r.err.length);
  if (erroredRows.length) {
    console.log("\n— Errored / interrupted tool calls (kept OUT of the size headline above) —");
    console.log("tool                                 err-calls   err-bytes");
    for (const r of erroredRows) {
      console.log(
        `${r.name.padEnd(34)} ${String(r.err.length).padStart(9)}  ${String(r.err.reduce((s, v) => s + v, 0)).padStart(9)}`
      );
    }
  }

  // Secondary (V-143/D — caveated): Linear's share of all tool-response bytes is
  // also non-deterministic (varies with session file-read volume), so it sits
  // below the deterministic per-call headline, not as the lead number.
  const tools = Object.entries(scanned.toolResultBytesByTool);
  const linearBytes = tools.filter(([n]) => n.startsWith("mcp__linear__")).reduce((s, [, b]) => s + b, 0);
  const allBytes = tools.reduce((s, [, b]) => s + b, 0) || 1;
  console.log(
    `\nLinear share of all tool-response bytes (SECONDARY, non-deterministic): ${(linearBytes / allBytes * 100).toFixed(0)}% (${k(linearBytes / 4)} tok of response payload).`
  );
}

// ---------------------------------------------------------------------------
// Exports for testing (usage-stats.test.mjs). scan() is the streaming counter;
// discoverPrimary() is the identity-binding resolver; selectTranscript() is the
// pure --session exact/prefix selection rule.
// ---------------------------------------------------------------------------
export { scan, discoverPrimary, selectTranscript };

// ---------------------------------------------------------------------------
// CLI — only when run directly, not when imported by the test.
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && process.argv[1].endsWith("usage-stats.mjs");
if (!isMain) {
  // imported (test) — stop before any CLI side effects
} else {
  await runCli();
}

async function runCli() {
const args = parseArgs(process.argv.slice(2));
if (!args || !args.ticket) {
  console.error("Usage: --ticket <ID> [--pr <n>] [--session <id>] [--dry-run] [--by-command]");
  process.exit(3);
}
const ticket = String(args.ticket);
const pr = args.pr != null ? String(args.pr) : "";

// 1. Resolve + scan the primary session.
let primary;
try {
  primary = await discoverPrimary(ticket, args.session);
} catch (e) {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
}
const primarySid = basename(primary.path, ".jsonl");
const scanned = await scan(primary.path);
if (!scanned.lastAssistantTs) {
  console.error(`ERROR: primary JSONL has no assistant messages: ${primary.path}`);
  process.exit(1);
}

// 2. Link every OTHER session that mentions the ticket (content-match, NOT summed).
//    Reuse the rows discoverPrimary already computed (content-match path) to avoid a
//    second full corpus scan; only scan here when it didn't (sidecar/--session paths).
//    Each related session is tagged with its `conversation` (resume-chain root) and a
//    `same_conversation` flag — whether it shares the primary land session's thread.
//    This separates the few sessions that actually WORKED on the ticket (one resume
//    chain, compacted across turns — CB-144's ~4) from the many that merely MENTION it
//    (CB-144 content-matches ~67): same_conversation:true is high-confidence work,
//    content-match-only is a name-drop. Additive — content-match ranking is untouched.
const primaryConversation = resolveConversationId(primarySid);
let related = [];
try {
  const rows = primary.rows ?? (await resolveTicket(ticket));
  related = rows
    .filter((r) => r.session_id !== primarySid)
    .map((r) => {
      const conversation = resolveConversationId(r.session_id);
      return {
        session_id: r.session_id,
        project_dir: r.project_dir,
        mentions: r.mentions,
        first_ts: r.first_ts,
        last_ts: r.last_ts,
        conversation,
        same_conversation: primaryConversation != null && conversation === primaryConversation,
      };
    });
} catch {
  // resolveTicket throws only when PROJECTS is missing; primary already scanned, so
  // just leave related empty rather than failing the whole run.
}
const sameConvoCount = related.filter((r) => r.same_conversation).length;

console.log(
  `Primary session (${primary.source}): ${primarySid} — ` +
    `${scanned.totals.assistant_msg_count} asst msgs, ${scanned.compoundBash} compound-bash, ${scanned.failedCalls} failed.`
);
console.log(
  `Related sessions mentioning ${ticket} (linked, not summed): ${related.length} ` +
    `(${sameConvoCount} in the primary's conversation, the rest name-drops).`
);

const payload = {
  ticket,
  pr: /^\d+$/.test(pr) ? Number(pr) : pr || null,
  scope: "primary-session", // headline totals cover the primary session only
  session_id: primarySid, // back-compat: top-level mirrors the primary
  conversation: primaryConversation, // the primary land session's thread (resume-chain root)
  session_jsonl: basename(primary.path),
  primary_source: primary.source,
  started_at: isoTrim(scanned.firstAssistantTs),
  completed_at: null, // filled below (skipped on dry-run)
  totals: scanned.totals,
  tool_calls: scanned.toolCalls,
  compound_bash: scanned.compoundBash,
  failed_calls: scanned.failedCalls,
  related_sessions: related,
  // V-79 — per-command attribution + per-tool response-payload size.
  by_command: scanned.byCommand,
  tool_result_bytes: scanned.toolResultBytesByTool,
  tool_result_count: scanned.toolResultCountByTool,
};

// V-79 — `--by-command` prints the per-phase + per-tool cost breakdown to console.
if (args["by-command"]) printAttribution(scanned);

if (args["dry-run"]) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

// 3. Resolve main worktree + write output JSON.
let mainWt;
try {
  const out = execFileSync("git", ["worktree", "list", "--porcelain"], {
    encoding: "utf8",
  });
  mainWt = out
    .split("\n")
    .find((l) => l.startsWith("worktree "))
    ?.slice("worktree ".length);
} catch (e) {
  console.error(`ERROR: git worktree list failed: ${e.message}`);
  process.exit(1);
}
if (!mainWt) {
  console.error("ERROR: could not determine main worktree.");
  process.exit(1);
}

const statsDir = join(mainWt, ".claude/usage-stats");
mkdirSync(statsDir, { recursive: true });

const now = new Date();
const stamp = now.toISOString().replace(/\.\d+Z$/, "Z");
const yyyymmdd = now.toISOString().slice(0, 10);
const hhmmss = now.toISOString().slice(11, 19).replace(/:/g, "");
const outPath = join(statsDir, `${yyyymmdd}-${hhmmss}-${ticket}.json`);

payload.repo = basename(mainWt);
payload.completed_at = stamp;
writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n");
console.log(`Stats written: ${outPath}`);

// 4. Self-heal .gitignore — append the usage-stats line if missing.
const gi = join(mainWt, ".gitignore");
let giContent = "";
try {
  giContent = readFileSync(gi, "utf8");
} catch {
  // .gitignore may not exist (rare) — append creates it
}
const lines = giContent.split("\n");
if (!lines.includes(".claude/usage-stats/")) {
  appendFileSync(
    gi,
    `\n# Claude Code usage stats (gitignored — /land-ticket §8.5)\n.claude/usage-stats/\n`
  );
  console.log(
    "NOTE: appended '.claude/usage-stats/' to .gitignore (one-time legacy backfill — commit at your convenience)."
  );
}
} // end runCli
