#!/usr/bin/env node
// ~/.claude/bin/session-review.mjs
// V-5: the post-session review ENGINE. Given a ticket (or session id / transcript
// path), stream the resolved transcript ONCE and emit a per-session report on two
// lenses:
//
//   Lens A — repetitive-call mining. Group every Bash command (+ tool call) into a
//     normalized SHAPE, count recurrence, and bucket each recurring shape into
//     Script / Allow / Deny-or-Ask (feeds V-4's permission model + V-23's helper
//     scripts — this is how wait-for-check.mjs / usage-stats.mjs were born).
//
//   Lens B — correctness-flag CANDIDATES (never verdicts; V-6/V-7 class). Surfaces
//     failed-then-claimed-success, error-swallowing Bash, and committed docs that
//     assert external state. Framed for a human read — the CB-123 lesson is that the
//     real catch needed READING the migration history, so the engine surfaces, it
//     does not adjudicate.
//
// Reuse, not reinvention:
//   - session resolution: discoverPrimary() from usage-stats.mjs (--session pin →
//     capture-hook sidecar → id-hint → V-26 content-match top, fail-loud).
//   - redaction: redact() from transcript-resolver.mjs. EVERY emitted byte passes it
//     first; tool_result BODIES are never printed (only is_error flags + counts),
//     keeping the report safe-by-construction. Treat output as low-risk, not
//     certified secret-free (same caveat as the resolver).
//
// V-5 is the ENGINE. The written SOP (lenses, routing, output schemas, method
// caveats) is pipeline/review-standard.md (V-25) — read it for the standard this
// engine implements.
//
// Usage:
//   node ~/.claude/bin/session-review.mjs --ticket <ID> [--session <id>] [--json] [--emit] [--min-count N] [--fab]
//   node ~/.claude/bin/session-review.mjs --session <session-id> [opts]
//   node ~/.claude/bin/session-review.mjs <path-to.jsonl> [opts]
//       --min-count N  Lens A: only report shapes seen ≥ N times (default 2)
//       --fab          enable best-effort, low-confidence fabricated-identifier scan
//       --json         machine-readable report instead of Markdown
//       --emit         V-60: append each finding to pipeline/audit/errors.jsonl via
//                      V-55's logger (activeCommand:"review-session", tool:"manual");
//                      prints a one-line summary, not the report. The machine path
//                      that closes the V-5 loop (/review-session + /land §8.5).
//
// Exit codes (bin/README.md contract):
//   0  success
//   1  domain failure — session unresolvable / unreadable / fs error
//   3  bad args
//
// CAVEAT (V-25): shell-aware decomposition is APPROXIMATE. The shape signature does
// not split inside quotes, but a naïve operator scan is still fooled by heredocs and
// exotic quoting — this is a good-enough normalizer, not a shell parser.

import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { redact } from "./transcript-resolver.mjs";
import { discoverPrimary } from "./usage-stats.mjs";

// ---------------------------------------------------------------------------
// Arg parsing — leading positional may be a transcript path; supports --flag,
// --flag=v, --flag v, and bare boolean --flag.
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
// Shell-ish helpers (approximate — see CAVEAT above).
// ---------------------------------------------------------------------------
// Tokenize respecting single/double quotes; quotes are stripped from tokens.
function tokenize(cmd) {
  const toks = [];
  let cur = "";
  let q = null;
  for (const ch of cmd) {
    if (q) {
      if (ch === q) q = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      q = ch;
    } else if (/\s/.test(ch)) {
      if (cur) {
        toks.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur) toks.push(cur);
  return toks;
}

// Split a command on top-level &&, ||, |, ; (outside quotes).
function splitTopLevel(cmd) {
  const segs = [];
  let cur = "";
  let q = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (q) {
      cur += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
      continue;
    }
    if ((ch === "&" && cmd[i + 1] === "&") || (ch === "|" && cmd[i + 1] === "|")) {
      segs.push(cur);
      cur = "";
      i++;
      continue;
    }
    if (ch === "|" || ch === ";") {
      segs.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) segs.push(cur);
  return segs.map((s) => s.trim()).filter(Boolean);
}

const LAUNCHERS = new Set(["node", "bash", "sh", "python", "python3", "npx", "npm", "env"]);

// verb + meaningful sub-token of ONE segment, e.g. "git status", "node session-review.mjs".
function verbSig(seg) {
  let t = tokenize(seg);
  // Drop leading `VAR=val` env-assignment prefixes (`WT=/path git …` → `git …`).
  while (t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0])) t = t.slice(1);
  // Drop a leading `cd <target>` — it's navigation noise; the real verb follows.
  if (t.length >= 2 && t[0] === "cd") t = t.slice(2);
  if (!t.length) return "";
  let verb = t[0];
  if (verb.includes("/")) verb = verb.split("/").pop();
  let sub = "";
  if (LAUNCHERS.has(verb)) {
    const script = t.slice(1).find((x) => /\.(mjs|sh|py|js)$/.test(x));
    if (script) sub = script.split("/").pop();
    else {
      const w = t.slice(1).find((x) => /^[A-Za-z][\w-]*$/.test(x));
      if (w) sub = w;
    }
  } else {
    const w = t.slice(1).find((x) => /^[A-Za-z][\w-]*$/.test(x) && !x.startsWith("-"));
    if (w) sub = w;
  }
  return sub ? `${verb} ${sub}` : verb;
}

// Whole-command signature: chain of per-segment verb-sigs. A compound command groups
// by its sequence ("git add && git commit"); a simple one by its verb-sig.
function shapeSignature(cmd) {
  const segs = splitTopLevel(cmd);
  const sig = segs.map(verbSig).filter(Boolean).join(" && ");
  return { sig: sig || cmd.trim().slice(0, 40), compound: segs.length > 1 };
}

// ---------------------------------------------------------------------------
// Lens A classification.
// ---------------------------------------------------------------------------
// Read-only single verbs that are safe to blanket-allow when recurring.
const READ_SIGS =
  /^(ls|cat|jq|rg|grep|head|tail|wc|find|echo|pwd|which|stat|tree|git status|git log|git diff|git branch|git show|git worktree|gh pr view|gh pr list)\b/;

// Sensitive / prod-mutating / destructive — recurring or not, these want a gate.
const SENSITIVE_RE =
  /(git\s+push\s+--force|--force-with-lease|\brm\s+-rf\b|supabase\s+db\s+push|sb-push\s+[^\n]*--apply|sb-mgmt\s+(PATCH|POST|PUT|DELETE)|\bprintenv\b|env\s*\||cat\s+[^\n|]*\.env|\.env[^\n]*\|\s*cat|>\s*\.env|\bcurl\b[^\n]*(-d|--data|-X\s*(POST|PUT|PATCH|DELETE)))/i;

function classifyShape(sig, { compound, sample }) {
  if (SENSITIVE_RE.test(sample || sig)) {
    return { bucket: "Deny/Ask", reason: "sensitive / prod-mutating / secret-touching — wants an explicit gate" };
  }
  if (compound) {
    return { bucket: "Script", reason: "compound multi-step command — script it (one allowlisted verb)" };
  }
  if (READ_SIGS.test(sig)) {
    return { bucket: "Allow", reason: "recurring read-only verb — safe to blanket-allow" };
  }
  return { bucket: "Allow", reason: "recurring non-compound, non-sensitive — low-risk allow candidate" };
}

// ---------------------------------------------------------------------------
// V-132: settings-awareness. An "Allow" candidate the permission model ALREADY
// grants is not a candidate at all — without this check --emit re-floods
// errors.jsonl with the same already-allowed tools on every run.
// ---------------------------------------------------------------------------
// Read permissions.allow from settings.json. Resolved by the caller relative to
// this file's dir (like emitToLog resolves the logger) so it works from any cwd.
// Fail-quiet: a missing/unreadable settings file yields [] ⇒ no suppression ⇒
// exactly the pre-V-132 behavior (better to over-emit than silently drop).
function loadAllowList(settingsPath) {
  try {
    const json = JSON.parse(readFileSync(settingsPath, "utf8"));
    const allow = json?.permissions?.allow;
    return Array.isArray(allow) ? allow : [];
  } catch {
    return [];
  }
}

// Permission-pattern glob → anchored RegExp; only `*` is special (→ `.*`). `s` flag
// so `*` also spans newlines (e.g. `Bash(*)` matches a multi-line command).
function globToRe(glob) {
  return new RegExp("^" + glob.replace(/[.+^${}()|[\]\\?]/g, "\\$&").replace(/\*/g, ".*") + "$", "s");
}

// Is a recurring shape already granted by settings permissions.allow?
//   - tool:<Name> shapes (Read, mcp__linear__*, Write/Edit…): Write/Edit/MultiEdit
//     are ALWAYS dropped (intentionally path-scoped — never a blanket-allow
//     candidate, so the engine flagging them is itself wrong); otherwise allowed
//     when an entry equals <Name>, starts `<Name>(`, or is an MCP server prefix of it.
//   - Bash shapes: the raw sample matches some `Bash(<glob>)` entry — so `Bash(*)`
//     blanket-suppresses and `Bash(git *)` suppresses `git …`.
function isAlreadyAllowed(sig, sample, allow) {
  if (sig.startsWith("tool:")) {
    const tool = sig.slice(5);
    if (tool === "Write" || tool === "Edit" || tool === "MultiEdit") return true;
    return allow.some((e) => e === tool || e.startsWith(tool + "(") || tool.startsWith(e + "__"));
  }
  const cmd = (sample || sig).trim();
  return allow.some((e) => {
    const m = /^Bash\((.*)\)$/.exec(e);
    return m ? globToRe(m[1]).test(cmd) : false;
  });
}

// ---------------------------------------------------------------------------
// Lens B detectors.
// ---------------------------------------------------------------------------
const SUCCESS_RE =
  /\b(done|verified|confirmed|passing|now active|created|applied|deployed|fixed|works|complete|completed|all set|green|success(ful)?)\b/i;
const SWALLOW_RE = /(2>\s*\/dev\/null|\|\|\s*true\b|\|\|\s*echo\b|\|\|\s*:|;\s*true\b)/;
const STATE_RE = /\b(deployed|applied|migrated|live|now active|enabled|merged|pushed to prod|in production)\b/i;
// id-shaped tokens for the best-effort fabricated-id scan.
const ID_RE =
  /(https?:\/\/\S+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\bPR\s*#?\d+|\b#\d{2,}|\b[0-9a-f]{7,40}\b)/gi;

// V-132: read-only existence-probe verbs. Error-swallowing on a probe built only
// from these (cat … 2>/dev/null || echo MISSING) is intentional, not a hidden
// failure — so it must NOT trip the error-swallow flag.
const READONLY_PROBE_VERBS = new Set([
  "cat", "ls", "grep", "rg", "head", "tail", "wc", "find", "echo", "stat",
  "test", "[", "pwd", "which", "file", "sort", "uniq", "cut", "tr",
  "dirname", "basename", "true", ":",
]);

// True when `cmd` is a benign read-only existence-probe: no file-creating redirect
// remains after dropping `…>/dev/null`/`2>&1`, AND every top-level segment's leading
// verb is read-only. Reuses tokenize/splitTopLevel (same approximate-shell caveat).
function isReadOnlyProbe(cmd) {
  const stripped = cmd.replace(/[12]?>>?\s*\/dev\/null/g, "").replace(/2>&1/g, "");
  if (/>/.test(stripped)) return false; // a real output redirect ⇒ writes a file ⇒ not a probe
  const segs = splitTopLevel(cmd);
  if (!segs.length) return false;
  return segs.every((seg) => {
    let t = tokenize(seg);
    while (t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0])) t = t.slice(1);
    if (t.length >= 2 && t[0] === "cd") t = t.slice(2);
    if (!t.length) return true;
    let verb = t[0];
    if (verb.includes("/")) verb = verb.split("/").pop();
    return READONLY_PROBE_VERBS.has(verb);
  });
}

// V-132: ephemeral docs (build plans, PR bodies, changelog) legitimately describe
// state/intent — only committed System docs should trip doc-asserts-state.
function isEphemeralDoc(filePath) {
  const b = basename(filePath).toLowerCase();
  return /-build\.md$/.test(b) || /-pr-body\.md$/.test(b) || b === "changelog.md";
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

function excerpt(text, n = 160) {
  return redact(text).replace(/\s+/g, " ").trim().slice(0, n);
}

// ---------------------------------------------------------------------------
// Single streaming pass.
// ---------------------------------------------------------------------------
async function analyze(file, { fab = false } = {}) {
  const shapes = new Map(); // sig → { count, compound, sample }
  const toolCounts = {};
  const lensB = []; // { type, msg, detail }
  const meta = { session: basename(file, ".jsonl"), assistant: 0, user: 0, first_ts: null, last_ts: null };

  let prevUserHadError = false; // a tool_result.is_error landed on the previous user msg
  const seenIds = new Set(); // tokens observed in tool_result bodies (read internally, never emitted)

  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (obj.type === "user") {
      meta.user++;
      let hadError = false;
      const content = obj.message?.content;
      if (Array.isArray(content)) {
        for (const item of content) {
          if (item?.type !== "tool_result") continue;
          if (item.is_error === true) hadError = true;
          // fabricated-id support: harvest id tokens from result bodies WITHOUT emitting them.
          if (fab) {
            const body = typeof item.content === "string" ? item.content : extractText(item.content);
            if (body) for (const m of body.matchAll(ID_RE)) seenIds.add(m[0].toLowerCase());
          }
        }
      }
      prevUserHadError = hadError;
      continue;
    }

    if (obj.type !== "assistant") continue;
    meta.assistant++;
    const msg = meta.assistant;
    if (obj.timestamp) {
      meta.first_ts ??= obj.timestamp;
      meta.last_ts = obj.timestamp;
    }

    const content = obj.message?.content;
    const text = extractText(content);
    let hasToolUse = false;

    if (Array.isArray(content)) {
      for (const item of content) {
        if (item?.type !== "tool_use" || !item.name) continue;
        hasToolUse = true;
        toolCounts[item.name] = (toolCounts[item.name] ?? 0) + 1;

        if (item.name === "Bash" && typeof item.input?.command === "string") {
          const cmd = item.input.command;
          const { sig, compound } = shapeSignature(cmd);
          const rec = shapes.get(sig) ?? { count: 0, compound, sample: cmd };
          rec.count++;
          rec.compound = rec.compound || compound;
          shapes.set(sig, rec);
          // Lens B: error-swallowing — but not on a benign read-only existence-probe (V-132).
          if (SWALLOW_RE.test(cmd) && !isReadOnlyProbe(cmd)) {
            lensB.push({ type: "error-swallow", msg, detail: excerpt(cmd) });
          }
        } else {
          // Non-Bash tool: a tool:<Name> shape (groups MCP/Read/Edit recurrence).
          const sig = `tool:${item.name}`;
          const rec = shapes.get(sig) ?? { count: 0, compound: false, sample: item.name };
          rec.count++;
          shapes.set(sig, rec);
        }

        // Lens B: a doc asserting external state — only committed System docs, not
        // ephemeral build-plans / PR-bodies / changelog (V-132).
        if ((item.name === "Write" || item.name === "Edit") && typeof item.input?.file_path === "string") {
          if (item.input.file_path.endsWith(".md") && !isEphemeralDoc(item.input.file_path)) {
            const docText = item.input.content ?? item.input.new_string ?? "";
            if (typeof docText === "string" && STATE_RE.test(docText)) {
              lensB.push({
                type: "doc-asserts-state",
                msg,
                detail: `${basename(item.input.file_path)}: ${excerpt(docText, 120)}`,
              });
            }
          }
        }
      }
    }

    // Lens B: failed-then-claimed — error on the immediately prior user turn, and this
    // assistant turn asserts success with NO retrying tool_use.
    if (prevUserHadError && !hasToolUse && text && SUCCESS_RE.test(text)) {
      lensB.push({ type: "failed-then-claimed", msg, detail: excerpt(text) });
    }

    // Lens B (best-effort, opt-in): a success sentence naming an id never seen in any
    // prior tool_result body — a fabricated-identifier candidate.
    if (fab && text && SUCCESS_RE.test(text) && !hasToolUse) {
      for (const m of text.matchAll(ID_RE)) {
        if (!seenIds.has(m[0].toLowerCase())) {
          lensB.push({ type: "fabricated-id?", msg, detail: `unseen id "${redact(m[0])}" in: ${excerpt(text, 120)}` });
          break;
        }
      }
    }

    // Reset the error carry once the following assistant turn is processed.
    prevUserHadError = false;
  }

  return { shapes, toolCounts, lensB, meta };
}

// ---------------------------------------------------------------------------
// Report rendering — every emitted string is redacted.
// ---------------------------------------------------------------------------
function buildReport(analysis, { minCount, allow = [] }) {
  const { shapes, toolCounts, lensB, meta } = analysis;
  const lensA = [];
  for (const [sig, rec] of shapes) {
    if (rec.count < minCount) continue;
    const { bucket, reason } = classifyShape(sig, { compound: rec.compound, sample: rec.sample });
    // V-132: an already-granted tool / blanket-allowed Bash verb is not an "allow this"
    // candidate — drop it so --emit stops re-flooding the sink with settings-known tools.
    // `allow` defaults to [] (no suppression) so callers/tests that omit it are unchanged.
    if (bucket === "Allow" && isAlreadyAllowed(sig, rec.sample, allow)) continue;
    lensA.push({ shape: redact(sig), count: rec.count, bucket, reason, example: excerpt(rec.sample, 80) });
  }
  lensA.sort((a, b) => b.count - a.count || a.shape.localeCompare(b.shape));
  return { meta, lensA, lensB, toolCounts };
}

function renderMarkdown(report) {
  const { meta, lensA, lensB, toolCounts } = report;
  const out = [];
  out.push(`# Session review — ${meta.session}`);
  out.push(
    `messages: ${meta.assistant + meta.user} (assistant ${meta.assistant}, user ${meta.user}) · span ${meta.first_ts ?? "?"} → ${meta.last_ts ?? "?"}`
  );
  out.push("");

  out.push(`## Lens A — repetitive-call mining (${lensA.length} recurring shape(s))`);
  if (lensA.length) {
    out.push("| Shape | Count | Bucket | Reason | Example |");
    out.push("|---|---|---|---|---|");
    for (const r of lensA) {
      out.push(`| \`${r.shape}\` | ${r.count} | ${r.bucket} | ${r.reason} | \`${r.example}\` |`);
    }
  } else {
    out.push("_No command shape recurred ≥ min-count._");
  }
  out.push("");

  out.push(`## Lens B — correctness-flag candidates (${lensB.length}) — human review, not verdicts`);
  if (lensB.length) {
    for (const f of lensB) {
      out.push(`- **[${f.type}]** msg#${f.msg} — ${f.detail}`);
    }
    out.push("");
    out.push(
      "_Candidates only. Confirm by reading the surrounding transcript (e.g. `transcript-resolver.mjs read ... --excerpt`). Per V-25, the real catch often needs reading the history, not a heuristic._"
    );
  } else {
    out.push("_No mechanical correctness candidate fired. (Lens B is conservative; a clean pass is not proof of correctness — spot-read still warranted.)_");
  }
  out.push("");

  const tools = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]);
  out.push(`## Tool census`);
  out.push(tools.length ? tools.map(([n, c]) => `${n}×${c}`).join(", ") : "_none_");
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// V-60 emit: format each finding into ONE fix-class-bearing log payload, then
// append it to pipeline/audit/errors.jsonl by CALLING V-55's logger in manual
// mode (the single sink — no second writer, no report parser downstream). The
// fix-class leads (bracketed) so V-52's harvester routes near-directly; the rest
// is human-readable. emitPayloads is pure (testable without spawning).
//
// V-165: the emit/harvest path carries ONLY findings that map to a fixable
// committed artifact. The pervasive convention-7/8 *pattern* flags — Lens A/Script
// (conv 7, "script it": per-session agent behavior, no single command at fault),
// Lens B/error-swallow (conv 8), and Lens B/doc-asserts-state (conv 8 read-back;
// mostly System docs correctly describing current state — structurally high-FP) —
// restate a per-transcript behavior the conventions already govern, so emitting
// them floods the bugs bucket with non-patchable noise that collapses every harvest
// into ~4 generic clusters. They are SUPPRESSED from the sink but kept in the human
// Markdown report (renderMarkdown is deliberately untouched — the report is the
// meta read where allowlist/script signals and doc candidates still surface).
//
// V-180: the SAME patchable/non-patchable test indicts the rest of Lens B.
// Lens B/failed-then-claimed + fabricated-id? are correctness CANDIDATES, never
// verdicts (this engine's own header says so) — they map to "go read this session,"
// not a committed-artifact fix, so by V-165's own contract they belong in the patch
// sink no more than error-swallow did. They are now suppressed too and live only in
// the human report (their designed "framed for a human read" home). So ALL of Lens B
// is suppressed from --emit; what survives to the sink is purely Lens A/Allow +
// Deny/Ask (→ settings.json permission patches). The --emit summary still counts and
// names every suppressed finding (the report keeps them), so the worst-failure-class
// candidates are visible-but-not-filed, never silently dropped (incl. the /land §8.6
// auto-trigger). A NEW Lens type still defaults to emit (over-emit beats silent-drop
// — the V-132 stance), surfacing for triage. NOTE both suppressions are FORWARD-only:
// they filter new emits, they do not purge historical [lens-b/*] rows already in the
// log — harvest §2 routes those away from patch-target (its lens-split row).
// ---------------------------------------------------------------------------
const EMIT_SUPPRESS_LENS_A = new Set(["Script"]);                          // conv 7
const EMIT_SUPPRESS_LENS_B = new Set(["error-swallow", "doc-asserts-state", "failed-then-claimed", "fabricated-id?"]); // conv 8 (V-165) + correctness candidates (V-180)

function emitPayloads(report) {
  const out = [];
  for (const r of report.lensA) {
    // bucket ∈ {Script, Allow, Deny/Ask} — the script/allow/ask/deny routing class.
    if (EMIT_SUPPRESS_LENS_A.has(r.bucket)) continue; // V-165: non-patchable conv-7 flag
    out.push(`[lens-a/${r.bucket}] ${r.shape} ×${r.count} — ${r.reason}`);
  }
  for (const f of report.lensB) {
    // type ∈ {error-swallow, doc-asserts-state, failed-then-claimed, fabricated-id?}.
    if (EMIT_SUPPRESS_LENS_B.has(f.type)) continue; // V-165: non-patchable conv-8 flag
    out.push(`[lens-b/${f.type}] msg#${f.msg} — ${f.detail}`);
  }
  return out;
}

// Spawn the V-55 logger once per payload, by ABSOLUTE path (resolved from this
// file's dir, like the logger resolves its own LOG_PATH) so --emit works from any
// cwd and always writes the main-checkout log. NO --tool: the default "manual" is
// what V-52's harvester keys on (tool==="manual" / no input → route "review").
// The logger always exits 0 and is secret-redacting + append-only by construction.
function emitToLog(payloads, session, ticket) {
  const logger = join(dirname(fileURLToPath(import.meta.url)), "log-pipeline-error.mjs");
  // Forward the resolved session UUID (report.meta.session) so each finding is
  // ticket-attributable downstream (V-81 lens-a). The spawned logger can't read
  // CLAUDE_SESSION_ID from this process, so without --session every emit was null.
  const sessionFlag = session ? ["--session", session] : [];
  // V-234: forward the KNOWN ticket too (present when invoked as `--ticket <ID>`,
  // the /land §8.6 case). It stamps a direct `ticket` field on each finding so the
  // scorecard joins lens (a) directly on the ticket — like the tool-fit/produced
  // sinks — instead of the finding→session→usage-stats indirection that resolved a
  // different primary than usage-stats and missed 0/9 live. Run without --ticket
  // (a bare path / --session) → no flag, and the scorecard's session-map fallback
  // still attributes the legacy way.
  const ticketFlag = ticket ? ["--ticket", ticket] : [];
  for (const p of payloads) {
    execFileSync("node", [logger, "--command", "review-session", ...sessionFlag, ...ticketFlag, "--error", p], { stdio: "ignore" });
  }
}

// ---------------------------------------------------------------------------
// Transcript resolution.
// ---------------------------------------------------------------------------
async function resolveTarget(positional, flags) {
  // Explicit path.
  if (positional && (positional.includes("/") || positional.endsWith(".jsonl"))) {
    const p = isAbsolute(positional) ? positional : join(process.cwd(), positional);
    if (existsSync(p)) return p;
    die(1, `Path not found: ${positional}`);
  }
  // --ticket (with optional --session pin) or --session alone → discoverPrimary.
  if (flags.ticket || flags.session) {
    try {
      const primary = await discoverPrimary(flags.ticket ? String(flags.ticket) : "", flags.session);
      return primary.path;
    } catch (e) {
      die(1, `ERROR: ${e.message}`);
    }
  }
  die(3, "Usage: session-review.mjs --ticket <ID> | --session <id> | <path.jsonl> [--json] [--min-count N] [--fab]");
}

export {
  analyze,
  classifyShape,
  shapeSignature,
  buildReport,
  emitPayloads,
  EMIT_SUPPRESS_LENS_A,
  EMIT_SUPPRESS_LENS_B,
  loadAllowList,
  isAlreadyAllowed,
  isReadOnlyProbe,
  isEphemeralDoc,
};

// ---------------------------------------------------------------------------
// CLI — only when run directly, not when imported by the test.
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && process.argv[1].endsWith("session-review.mjs");
if (isMain) {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const file = await resolveTarget(positionals[0], flags);
  const minCount = flags["min-count"] != null ? Math.max(1, Number(flags["min-count"]) || 2) : 2;
  const analysis = await analyze(file, { fab: !!flags.fab });
  if (!analysis.meta.last_ts && analysis.meta.assistant === 0) {
    die(1, `No assistant messages in ${basename(file)} — not a readable transcript.`);
  }
  // V-132: load settings.json permissions.allow (resolved relative to this file's
  // dir, like emitToLog resolves the logger) so already-granted tools are suppressed.
  const allow = loadAllowList(join(dirname(fileURLToPath(import.meta.url)), "..", "settings.json"));
  const report = buildReport(analysis, { minCount, allow });
  if (flags.emit) {
    // Machine path: append every finding to the single sink, print a terse summary
    // (or an explicit "none") so an automated trigger needs no human read.
    const payloads = emitPayloads(report);
    emitToLog(payloads, report.meta.session, flags.ticket ? String(flags.ticket) : null);
    // V-165/V-180: emitted counts come from the FILTERED payloads; suppressed = the
    // non-patchable findings dropped from the sink but kept in the report — the
    // conv-7/8 *pattern* flags (V-165) AND now the Lens B correctness *candidates*
    // (V-180: failed-then-claimed / fabricated-id?, candidates-not-verdicts → human
    // read, not a patch). Surface the count so the drop is observable, never silent
    // (the worst-failure-class candidates stay visible at the /land §8.6 auto-trigger).
    const emittedA = payloads.filter((p) => p.startsWith("[lens-a/")).length;
    const emittedB = payloads.length - emittedA; // structurally 0 post-V-180 (all Lens B suppressed)
    const suppressed = report.lensA.length + report.lensB.length - payloads.length;
    const supNote = suppressed
      ? `; suppressed ${suppressed} non-patchable finding(s) — conv-7/8 pattern flags + Lens B correctness candidates — kept in report for human read`
      : "";
    console.log(
      payloads.length === 0
        ? `review-session: no patchable findings${supNote} (${report.meta.session}).`
        : `review-session: emitted ${payloads.length} patchable finding(s) → errors.jsonl (Lens A ${emittedA}, Lens B ${emittedB})${supNote} [${report.meta.session}].`
    );
  } else if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderMarkdown(report));
  }
}
