#!/usr/bin/env node
// ~/.claude/bin/harvest-cluster.mjs
// Deterministic, committed replacement for the inline-python §4a/§4b clustering
// step of /harvest-pipeline-bugs. (V-429)
//
// WHY THIS EXISTS:
//   §1 and §7 of /harvest-pipeline-bugs already have committed helpers
//   (read-errors-since.mjs, advance-harvest-watermark.mjs, rotate-errors-log.mjs).
//   §4a/§4b — normalize each error, hash it into a `harvest-key`, cluster by root
//   cause — had none: every run hand-rolled the normalizer, and in headless
//   `--yes` mode the only prompt-free way to do that was a deeply-nested inline
//   `python3 -c "…"`. That inline form has already died mid-run on a quoting
//   fault (2026-08-02, session 848a1388), and every hand-authored re-derivation
//   risks normalizing the same error differently, which silently breaks §4c
//   dedupe (a key drift the harvester can't detect — it just refiles).
//
//   This helper makes the key a property of COMMITTED CODE: given the same
//   input, it produces byte-identical `harvest-key` values, run after run,
//   agent after agent. It clusters and keys; it does not decide what to file
//   or route — that stays hook-side judgment in the command.
//
// USAGE (reads the read-errors-since.mjs stream on stdin, one JSONL entry/line):
//   node ~/.claude/bin/read-errors-since.mjs | node ~/.claude/bin/harvest-cluster.mjs
//
// Output: one JSON record per line (JSONL), one per root-cause cluster, sorted by
//   `harvestKey` for a stable, diffable byte-identical rerun. A stdin line that
//   isn't valid JSON is skipped (warned to stderr, never crashes the pass) — the
//   opposite fail-open direction from read-errors-since.mjs's reader, because a
//   line that reaches this stage already passed that reader's own JSON.parse
//   inside keepEntry's fail-open branch only when garbage; genuinely malformed
//   JSON here has no error/route to cluster on, so it cannot be silently folded
//   into a cluster without corrupting rebrandable output.
//
// Exit codes: always 0 (a clustering step must not abort the harvest pass; an
//   empty/absent stdin stream emits nothing).

import { createInterface } from "node:readline";
import { createHash } from "node:crypto";

// --- §2 route classification (manual-shaped detector + route table) ---------

// An entry is manual-shaped iff `tool === "manual"` OR it carries no `input`
// field at all — the logger's runManual() never attaches `input`; buildRecord
// (hook mode) always does for an input-bearing tool. Structural, not a new field.
export function isManualShaped(entry) {
  return entry?.tool === "manual" || entry?.input === undefined;
}

// §2's route table. Weighting/priority is a downstream (§5) concern of the
// command, not this helper — it clusters and keys, it does not decide what to
// file.
export function classifyRoute(entry) {
  if (!isManualShaped(entry)) return "hook";
  if (entry.activeCommand === "report-bug") return "human";
  if (entry.activeCommand === "review-session") return "review";
  return "self-report";
}

// --- §4a normalization -------------------------------------------------------

const LEADING_EXIT_CODE = /^Exit code \d+\n/;
const REDACTED_TOKEN = /«redacted»/gi;
const ABS_PATH = /\/(?:[\w.\-@~]+\/)+[\w.\-@~]*/g;
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g;
const LINE_COL_INLINE = /:\d+:\d+\b/g;
const LINE_WORD = /\bline \d+\b/gi;
const COLUMN_WORD = /\bcolumn \d+\b/gi;
const CHAR_WORD = /\bchar \d+\b/gi;
const BRANCH_PHRASE = /\bbranch(?:es)?[:\s]+[\w./-]+/gi;

// Lens A: `[lens-a/<bucket>] <shape> ×<count> — <reason>`. Strip only the
// volatile `×<count>` repetition count (the × is U+00D7, not ASCII x) — keep
// bucket/shape/reason, they're the stable description of the allow candidate.
// Lens B: `[lens-b/<type>] msg#<N> — <detail>`. Both the message ordinal and
// the trailing per-turn excerpt are volatile per-occurrence noise — key on the
// `[lens-b/<type>]` tag alone so Lens B clusters by failure type.
function stripLensVolatiles(text) {
  if (text.startsWith("[lens-b/")) {
    const m = text.match(/^\[lens-b\/[^\]]+\]/);
    return m ? m[0] : text;
  }
  if (text.startsWith("[lens-a/")) {
    return text.replace(/\s*×\d+/g, "");
  }
  return text;
}

// The highest-risk correctness detail (per the command's own §4a note): kill
// every volatile fragment BEFORE hashing, so two occurrences of one root cause
// always collapse to the same key, and two distinct problems never collide.
// Pure — order matters (lens-strip before generic path/ts/loc stripping, since
// a Lens B tag match short-circuits the rest of the message entirely).
export function normalizeError(errorText) {
  let text = String(errorText ?? "");
  text = text.replace(LEADING_EXIT_CODE, "");
  text = stripLensVolatiles(text);
  text = text.replace(REDACTED_TOKEN, "<REDACTED>");
  text = text.replace(ABS_PATH, "<PATH>");
  text = text.replace(ISO_TIMESTAMP, "<TS>");
  text = text.replace(LINE_COL_INLINE, ":<LOC>");
  text = text.replace(LINE_WORD, "line <N>");
  text = text.replace(COLUMN_WORD, "column <N>");
  text = text.replace(CHAR_WORD, "char <N>");
  text = text.replace(BRANCH_PHRASE, "branch <BRANCH>");
  text = text.replace(/\s+/g, " ").trim();
  return text.slice(0, 240);
}

// --- §4b keying ---------------------------------------------------------------

// `harvest-key = <route>:<short hash of the normalized error>`. sha1, first 8
// hex chars — matches the shape already live on open bucket tickets (e.g.
// `hook:702254c5`). Deterministic: same route + same normalized text, same key,
// every run, no matter which agent computed it.
export function computeHarvestKey(route, normalizedError) {
  const hash = createHash("sha1").update(normalizedError).digest("hex").slice(0, 8);
  return `${route}:${hash}`;
}

// --- richest-representative pick (for the command's §5 Occurrence prose) ----

// Prefer an entry carrying `input` (a reproducible command/call), then the one
// with the most specific (longest) verbatim `error`. Ties broken by original
// stream order so the pick is deterministic across reruns.
export function pickRepresentative(entries) {
  let best = null;
  for (const entry of entries) {
    if (best === null) {
      best = entry;
      continue;
    }
    const bestHasInput = best.input !== undefined;
    const entryHasInput = entry.input !== undefined;
    if (entryHasInput !== bestHasInput) {
      if (entryHasInput) best = entry;
      continue;
    }
    const bestLen = String(best.error ?? "").length;
    const entryLen = String(entry.error ?? "").length;
    if (entryLen > bestLen) best = entry;
  }
  return best;
}

// --- clustering ----------------------------------------------------------------

function distinctSorted(values) {
  const arr = [...new Set(values)];
  arr.sort((a, b) => {
    if (a === b) return 0;
    if (a === null || a === undefined) return 1;
    if (b === null || b === undefined) return -1;
    return String(a) < String(b) ? -1 : 1;
  });
  return arr;
}

// Group entries into one record per (route, normalized-error) cluster — the
// root cause, never per `tool`/`activeCommand` occurrence (§4a's over-narrow-
// clustering trap: those are evidence, not dividers, so they never enter the
// cluster key). Pure — testable without stdin/stdout.
export function buildClusters(entries) {
  const byKey = new Map();
  for (const entry of entries) {
    const route = classifyRoute(entry);
    const normalized = normalizeError(entry?.error);
    const harvestKey = computeHarvestKey(route, normalized);
    if (!byKey.has(harvestKey)) byKey.set(harvestKey, { harvestKey, route, entries: [] });
    byKey.get(harvestKey).entries.push(entry);
  }

  const clusters = [];
  for (const { harvestKey, route, entries: es } of byKey.values()) {
    clusters.push({
      harvestKey,
      route,
      count: es.length,
      tools: distinctSorted(es.map((e) => e.tool)),
      activeCommands: distinctSorted(es.map((e) => e.activeCommand)),
      origins: distinctSorted(es.map((e) => e.origin ?? null)),
      // Parallel per-entry lists (not deduped) — the command's §5 origin-handle
      // logic needs session/conversation paired per occurrence, not a bare set.
      ts: es.map((e) => e.ts ?? null),
      sessions: es.map((e) => e.session ?? null),
      conversations: es.map((e) => e.conversation ?? null),
      representative: pickRepresentative(es),
    });
  }

  clusters.sort((a, b) => (a.harvestKey < b.harvestKey ? -1 : a.harvestKey > b.harvestKey ? 1 : 0));
  return clusters;
}

// --- CLI ------------------------------------------------------------------------

async function main() {
  const entries = [];
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (t === "") continue;
    try {
      entries.push(JSON.parse(t));
    } catch {
      process.stderr.write(`harvest-cluster: skipping unparseable line: ${t.slice(0, 120)}\n`);
    }
  }

  for (const cluster of buildClusters(entries)) {
    process.stdout.write(JSON.stringify(cluster) + "\n");
  }
  process.exit(0);
}

// Only run as a CLI, not when imported by the test.
const isMain = process.argv[1] && process.argv[1].endsWith("harvest-cluster.mjs");
if (isMain) main();
