#!/usr/bin/env node
// ~/.claude/bin/transcript-resolver.mjs
// V-26: scoped, secret-redacting transcript resolver + reader.
//
// The shared primitive every post-session review (V-5) and §8.5 stats run
// (V-1/V-20/V-21) assumes: given a ticket id, find all its transcripts across
// EVERY ~/.claude/projects/* dir and read them safely.
//
// Two problems it fixes:
//   1. Resolution was artisanal — `grep -rl <TICKET> ~/.claude/projects/*/*.jsonl`
//      reinvented every review, ranked by hand. CB-144 alone spanned 4 sessions
//      across 2 project dirs.
//   2. Raw reads get DENIED — transcripts hold cleartext secrets, so the
//      secret-guard blocks raw python3/grep/awk over the JSONLs. This script is a
//      named, redaction-enforcing verb: every byte it emits passes redact()
//      first, so `Bash(node ~/.claude/bin/*.mjs)` can stay allowlisted while raw
//      reads stay denied. (V-4 angle: allowlist the verb, not the parent dir.)
//
// Ranking rule (V-20/V-21): CONTENT-MATCH WINS. Sessions are ranked by mention
// count, never by recency — recency is a tiebreaker only, so the >5-min staleness
// trap never gates correctness.
//
// Zero-context by default: `resolve` emits only metadata (paths, counts, ts), and
// `read` emits only structured summaries unless --grep / --excerpt is given. A raw
// transcript body is never dumped into the caller's context.
//
// Usage:
//   node ~/.claude/bin/transcript-resolver.mjs resolve <TICKET> [--json] [--limit N]
//   node ~/.claude/bin/transcript-resolver.mjs read <TICKET|sessionId|path> [opts]
//       --session <id>   pin a specific session (overrides ticket top-rank)
//       --grep <pattern> print redacted lines matching pattern (regex, case-insensitive)
//       --excerpt[=N]    print first N (default 40) redacted message-text lines
//       --json           machine-readable summary (read's default mode)
//
// Exit codes (bin/README.md contract):
//   0  success
//   1  domain failure — no sessions found / unreadable transcript / fs error
//   3  bad args

import { readFileSync, existsSync, readdirSync, statSync, createReadStream } from "node:fs";
import { join, basename, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";

const HOME = homedir();
const PROJECTS = join(HOME, ".claude/projects");

// ---------------------------------------------------------------------------
// Arg parsing — leading positional is the subcommand; supports --flag, --flag=v,
// --flag v, and bare boolean --flag.
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) {
          flags[key] = true;
        } else {
          flags[key] = next;
          i++;
        }
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

function die(code, msg) {
  console.error(msg);
  process.exit(code);
}

// ---------------------------------------------------------------------------
// Redaction — keep env-var NAMES + structure, mask VALUES. Self-contained: the
// guard (guard-sensitive-access.py) is a PreToolUse access-decision hook, not a
// reusable redaction lib, so we replicate the secret CLASSES the deny-list knows
// (.env*/TOKEN/SECRET/KEY/CREDENTIAL/Bearer/pem/key) rather than importing it.
// Over-masking is acceptable; leaking is not.
// ---------------------------------------------------------------------------
const MASK = "«redacted»";
// Key-name classes that mark a value as secret.
const SECRET_KEY =
  /(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE[_-]?KEY|API[_-]?KEY|ACCESS[_-]?KEY|ACCESS[_-]?TOKEN|APIKEY|SECRETKEY|_KEY|^KEY$|BEARER|^AUTH$|_AUTH$|^PAT$|DSN)/i;

function isSecretKey(k) {
  return SECRET_KEY.test(k);
}

function redact(text) {
  if (typeof text !== "string" || !text) return text;
  let s = text;

  // 1. shell assignments: [export] KEY=value  (quoted or bare)
  s = s.replace(
    /\b(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(['"]?)([^\s'"]{3,})\3/g,
    (m, exp, key, q, _val) => (isSecretKey(key) ? `${exp || ""}${key}=${q}${MASK}${q}` : m)
  );

  // 2. JSON pairs: "KEY": "value"   and   "KEY": "value" inside escaped JSONL.
  //    Value class greedily consumes anything up to (but not including) the
  //    closing delimiter — so a secret containing an internal ' or " no longer
  //    breaks the match and leaks (review PR#12 [high]).
  s = s.replace(
    /(\\?"|')([A-Za-z0-9_]+)\1\s*:\s*(\\?"|')((?:(?!\3)[^\n])*)\3/g,
    (m, q1, key, q3, _val) => (isSecretKey(key) ? `${q1}${key}${q1}: ${q3}${MASK}${q3}` : m)
  );

  // 3. Authorization headers / bearer tokens (both case-insensitive).
  s = s.replace(/(Authorization\s*:\s*Bearer\s+)\S+/gi, `$1${MASK}`);
  s = s.replace(/\b(Bearer\s+)[A-Za-z0-9._\-]{8,}/gi, `$1${MASK}`);

  // 4. Known token shapes anywhere (prefix-tagged secrets).
  s = s
    .replace(/\bsbp_[A-Za-z0-9]{8,}/g, MASK) // Supabase PAT
    .replace(/\bsk-[A-Za-z0-9_\-]{12,}/g, MASK) // OpenAI/Anthropic-style
    .replace(/\bgh[pousr]_[A-Za-z0-9]{16,}/g, MASK) // GitHub tokens
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{8,}/g, MASK) // Slack tokens
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, MASK) // AWS access key id
    .replace(/\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}/g, MASK); // JWT

  // 5. Last-resort entropy catch: long opaque runs (>=32 chars, no spaces). Masks
  //    leaked secrets that dodged the named classes; over-masks rare long hashes.
  //    32 matches the plan's floor (review PR#12 [high]: 40 let 32-39ch tokens leak).
  s = s.replace(/\b[A-Za-z0-9+/_\-]{32,}={0,2}\b/g, MASK);

  return s;
}

// ---------------------------------------------------------------------------
// Project-dir scan.
// ---------------------------------------------------------------------------
function listProjectDirs() {
  if (!existsSync(PROJECTS)) die(1, `ERROR: no projects dir: ${PROJECTS}`);
  return readdirSync(PROJECTS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(PROJECTS, e.name));
}

function listJsonls(dir) {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

// Whole-token matcher for a ticket id (CB-14 must not match CB-144).
function ticketRegex(ticket) {
  const esc = ticket.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`, "g");
}

// Stream one JSONL once: count ticket mentions, capture first/last assistant ts
// and the first user-text snippet (redacted). No body retained.
async function scanForTicket(file, re) {
  let mentions = 0;
  let firstTs = null;
  let lastTs = null;
  let firstUserText = null;
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const m = line.match(re);
    if (m) mentions += m.length;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type === "assistant" && obj.timestamp) {
      firstTs ??= obj.timestamp;
      lastTs = obj.timestamp;
    }
    if (firstUserText === null && obj.type === "user") {
      const t = extractText(obj.message?.content);
      if (t) firstUserText = redact(t).slice(0, 80);
    }
  }
  return { mentions, firstTs, lastTs, firstUserText };
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c?.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join(" ");
  }
  return "";
}

async function resolveTicket(ticket) {
  const re = ticketRegex(ticket);
  const out = [];
  for (const dir of listProjectDirs()) {
    for (const file of listJsonls(dir)) {
      const { mentions, firstTs, lastTs, firstUserText } = await scanForTicket(file, re);
      if (mentions > 0) {
        out.push({
          project_dir: basename(dir),
          session_id: basename(file, ".jsonl"),
          jsonl_path: file,
          mentions,
          first_ts: firstTs,
          last_ts: lastTs,
          first_user_text: firstUserText,
        });
      }
    }
  }
  // CONTENT-MATCH WINS: mentions desc, recency only as tiebreaker.
  out.sort((a, b) => b.mentions - a.mentions || cmpTs(b.last_ts, a.last_ts));
  return out;
}

function cmpTs(a, b) {
  const pa = a ? Date.parse(a) : 0;
  const pb = b ? Date.parse(b) : 0;
  return (Number.isFinite(pa) ? pa : 0) - (Number.isFinite(pb) ? pb : 0);
}

// ---------------------------------------------------------------------------
// resolve <TICKET>
// ---------------------------------------------------------------------------
async function cmdResolve(ticket, flags) {
  if (!ticket) die(3, "Usage: resolve <TICKET> [--json] [--limit N]");
  let rows = await resolveTicket(ticket);
  if (rows.length === 0) die(1, `No sessions found mentioning ${ticket}.`);
  const limit = flags.limit != null ? Number(flags.limit) : rows.length;
  rows = rows.slice(0, limit);
  if (flags.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  console.log(`${rows.length} session(s) mentioning ${ticket} (content-match ranked):\n`);
  for (const r of rows) {
    console.log(
      `  [${String(r.mentions).padStart(3)}×] ${r.session_id}  (${r.project_dir})`
    );
    console.log(
      `        last: ${r.last_ts ?? "?"}  first-user: ${r.first_user_text ?? ""}`
    );
  }
  console.log(
    `\nRead one with: node ~/.claude/bin/transcript-resolver.mjs read ${ticket} [--excerpt|--grep <p>]`
  );
}

// ---------------------------------------------------------------------------
// read <TICKET|sessionId|path>
// ---------------------------------------------------------------------------
async function resolveReadTarget(target, flags) {
  if (flags.session) {
    const f = findSession(String(flags.session));
    if (!f) die(1, `Session not found: ${flags.session}`);
    return f;
  }
  // explicit path
  if (target && (target.includes("/") || target.endsWith(".jsonl"))) {
    const p = isAbsolute(target) ? target : join(process.cwd(), target);
    if (existsSync(p)) return p;
    die(1, `Path not found: ${target}`);
  }
  // session id (uuid-ish)
  if (target && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(target)) {
    const f = findSession(target);
    if (f) return f;
  }
  // otherwise treat as ticket → top-ranked session
  const rows = await resolveTicket(target);
  if (rows.length === 0) die(1, `No sessions found mentioning ${target}.`);
  return rows[0].jsonl_path;
}

function findSession(sid) {
  for (const dir of listProjectDirs()) {
    const guess = join(dir, `${sid}.jsonl`);
    if (existsSync(guess)) return guess;
  }
  return null;
}

async function cmdRead(target, flags) {
  if (!target && !flags.session) {
    die(3, "Usage: read <TICKET|sessionId|path> [--session id] [--grep p] [--excerpt[=N]] [--json]");
  }
  const file = await resolveReadTarget(target, flags);

  // --grep: redacted matching lines (message text only).
  if (flags.grep) {
    const re = new RegExp(String(flags.grep), "i");
    let hits = 0;
    await eachMessageText(file, (role, text) => {
      const safe = redact(text);
      if (re.test(safe)) {
        console.log(`${role}: ${safe}`);
        hits++;
      }
    });
    console.log(`\n${hits} matching message(s) in ${basename(file)} (redacted).`);
    return;
  }

  // --excerpt[=N]: first N redacted message-text lines.
  if (flags.excerpt != null) {
    const n = flags.excerpt === true ? 40 : Number(flags.excerpt) || 40;
    let shown = 0;
    await eachMessageText(file, (role, text) => {
      if (shown >= n) return;
      const safe = redact(text).replace(/\s+/g, " ").trim();
      if (safe) {
        console.log(`${role}: ${safe.slice(0, 200)}`);
        shown++;
      }
    });
    console.log(`\n(${shown} message-line excerpt of ${basename(file)}, redacted)`);
    return;
  }

  // default: zero-context structured summary — counts only, no body.
  const summary = await summarize(file);
  if (flags.json) {
    console.log(JSON.stringify({ session_jsonl: basename(file), ...summary }, null, 2));
    return;
  }
  console.log(`Transcript: ${basename(file)}`);
  console.log(`  messages: ${summary.messages} (user ${summary.user}, assistant ${summary.assistant})`);
  console.log(`  span: ${summary.first_ts ?? "?"} → ${summary.last_ts ?? "?"}`);
  console.log(`  tool calls: ${JSON.stringify(summary.tool_calls)}`);
  console.log(
    `\n  body is not dumped (zero-context). Use --excerpt or --grep <p> for redacted content.`
  );
}

async function eachMessageText(file, fn) {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type !== "user" && obj.type !== "assistant") continue;
    const text = extractText(obj.message?.content);
    if (text) fn(obj.type, text);
  }
}

async function summarize(file) {
  const s = { messages: 0, user: 0, assistant: 0, tool_calls: {}, first_ts: null, last_ts: null };
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type === "user" || obj.type === "assistant") {
      s.messages++;
      s[obj.type]++;
    }
    if (obj.type === "assistant") {
      if (obj.timestamp) {
        s.first_ts ??= obj.timestamp;
        s.last_ts = obj.timestamp;
      }
      const content = obj.message?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === "tool_use" && c.name) {
            s.tool_calls[c.name] = (s.tool_calls[c.name] ?? 0) + 1;
          }
        }
      }
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Exports — redaction/matcher helpers for transcript-resolver.test.mjs, plus
// resolveTicket as the shared discovery primitive (V-1's usage-stats.mjs imports
// it so §8.5 binds sessions by content-match identity, not freshest-mtime).
// ---------------------------------------------------------------------------
export { redact, ticketRegex, isSecretKey, resolveTicket };

// ---------------------------------------------------------------------------
// Dispatch — only when run as a CLI, not when imported by the test.
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && process.argv[1].endsWith("transcript-resolver.mjs");
if (isMain) {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const sub = positionals[0];
  const arg1 = positionals[1];

  if (sub === "resolve") {
    await cmdResolve(arg1, flags);
  } else if (sub === "read") {
    await cmdRead(arg1, flags);
  } else {
    die(
      3,
      "Usage:\n" +
        "  transcript-resolver.mjs resolve <TICKET> [--json] [--limit N]\n" +
        "  transcript-resolver.mjs read <TICKET|sessionId|path> [--session id] [--grep p] [--excerpt[=N]] [--json]"
    );
  }
}
