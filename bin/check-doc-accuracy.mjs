#!/usr/bin/env node
// ~/.claude/bin/check-doc-accuracy.mjs
// Deterministic factual-accuracy checker for the pipeline's markdown docs. (V-141)
//
// WHY THIS EXISTS:
//   The first /review-produced runs surfaced 3 factual-accuracy defects in
//   already-Done tickets: a miscited convention number, an overstated command
//   count, and a (since-resolved) broken link. They shipped because nothing at
//   land checks citation/link/count accuracy. Hand-auditing the docs is the very
//   failure class — there are ~800 "convention N"/§N citations and ~160
//   ~/.claude/… link references; a human audit at that volume is infeasible and
//   itself error-prone (asserted-not-observed, convention 8). This checker is the
//   deterministic instrument: it IS the sweep (run whole-tree) and the standing
//   land-time guard (run --paths <changed docs>, surfaced as an advisory at
//   land-ticket §5). The heavyweight /review-produced auto-fire is a sibling
//   concern owned by V-171; this is the cheap deterministic half.
//
// THREE DETECTORS (each scoped to what has an unambiguous on-disk referent):
//   (1) convention-number cross-ref — flags a reference TO a workflow-conventions.md
//       convention whose number isn't a real numbered heading there. Keyed on the
//       phrases `convention N` and `workflow-conventions.md §N` / `conventions §N`
//       / `convention §N` — NOT bare `§N`. Bare §N is dominated by in-file section
//       refs ("land-ticket §6.7", "/scope §3") that point at a command's OWN
//       sections, not at conventions; cross-referencing those would be a
//       false-positive flood. This phrase-scoping is the core correctness call.
//   (2) link resolution — resolves every `~/.claude/<path>` reference and every
//       relative markdown link `](path)` against the repo root / the file's dir,
//       flags non-resolving targets. (Anchors, http(s):, and mailto: are skipped.)
//   (3) count assertion — verifies two structured claims: (3a) the workflow-chains.md
//       "N commands … in `~/.claude/commands/`" claim against the live `commands/*.md`
//       count, and (3b) the "the N conventions every skill/command (reads|follows)"
//       claim (anywhere) against the count of numbered conventions in
//       workflow-conventions.md. Subset counts ("which of the 5 [authoring]
//       conventions", a "~5–10 files" budget ceiling) have no machine-checkable
//       referent and are left to the hand sweep — reported as an advisory note,
//       never silently dropped.
//
// ROOT RESOLUTION:
//   Scan root is resolved from THIS file's bin/ location via fileURLToPath (not
//   new URL().pathname — a space/non-ASCII ancestor dir would percent-encode and
//   misdirect), mirroring log-gate-audit.mjs. So it scans the canonical ~/.claude
//   doc tree regardless of the caller's cwd — including from a torn-down
//   standalone worktree at land time.
//
// USAGE:
//   node ~/.claude/bin/check-doc-accuracy.mjs            # whole-tree sweep
//   node ~/.claude/bin/check-doc-accuracy.mjs --paths a.md b.md   # scope to files
//   node ~/.claude/bin/check-doc-accuracy.mjs --json     # machine-readable findings
//
// EXIT CODES: 0 clean · 1 findings (the sweep/guard signal) · 2 bad args / no docs.
//   A non-zero exit is the land-time advisory trigger; it never hard-blocks a merge
//   (land-ticket §5 surfaces findings as `doc-accuracy-risk`, advisory).

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOME = resolve(ROOT, ".."); // ~/.claude lives at <home>/.claude; ~ expands here

// The doc set the sweep covers (relative to ROOT). Mirrors the ticket's listed
// surface: commands/*.md, craft/*.md, the two top-level docs, pipeline/**/*.md.
const SCAN_DIRS = ["commands", "craft", "pipeline"];
const SCAN_FILES = ["workflow-conventions.md", "workflow-chains.md"];

const CONVENTIONS_DOC = "workflow-conventions.md";
const CHAINS_DOC = "workflow-chains.md";

// ── helpers ──────────────────────────────────────────────────────────────────

function walkMarkdown(absDir, acc) {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) walkMarkdown(abs, acc);
    else if (entry.isFile() && entry.name.endsWith(".md")) acc.push(abs);
  }
}

// Is an absolute path within the guard's defined scan scope? Used to keep --paths
// (land-time, the PR's changed docs) consistent with the whole-tree sweep: a
// changed .md outside this scope — a docs/plans/<id>-build.md planning artifact, a
// stray README — is NOT a doc the guard governs (it legitimately carries
// placeholder citations/links like `](relative/path)` or "convention N"), so it is
// skipped by design rather than false-flagged.
function inScanScope(abs) {
  for (const d of SCAN_DIRS) {
    if (abs === join(ROOT, d) || abs.startsWith(join(ROOT, d) + "/")) return true;
  }
  return SCAN_FILES.some((f) => abs === join(ROOT, f));
}

// Re-anchor an absolute path that lives OUTSIDE ROOT (a worktree copy handed in at
// land time, e.g. `$PWD/commands/foo.md`) to its ROOT counterpart, keyed on the
// deepest scan-dir segment or a scan-file basename. Returns null when the path
// names no governed doc — so a genuinely out-of-scope absolute path (a worktree
// docs/plans/*) is left alone rather than force-mapped into scope.
function reanchorToRoot(absPath) {
  const parts = absPath.split("/");
  for (let i = parts.length - 2; i >= 0; i--) {
    if (SCAN_DIRS.includes(parts[i])) return join(ROOT, parts.slice(i).join("/"));
  }
  const base = parts[parts.length - 1];
  if (SCAN_FILES.includes(base)) return join(ROOT, base);
  return null;
}

// Resolve a --paths entry to the file the guard should scan. The guard governs
// ROOT's own doc tree, so a changed-doc path — repo-relative from
// `gh pr diff --name-only`, or an absolute worktree copy at land time — must map to
// its ROOT counterpart. The prior `existsSync(resolve(p)) ? resolve(p) : join(ROOT, p)`
// preferred the cwd-relative copy, so a run from a worktree resolved every path into
// the worktree tree — OUTSIDE ROOT — and inScanScope then rejected all of them: the
// V-336 false "no markdown docs to scan". Prefer the in-scope ROOT candidate; fall
// back to any existing copy (so an out-of-scope doc is still recognized, not a typo).
function toRootDoc(p) {
  const candidates = [];
  if (p.startsWith("/")) {
    candidates.push(p); // absolute as-given (already under ROOT, or a worktree copy)
    const reanchored = reanchorToRoot(p);
    if (reanchored) candidates.push(reanchored);
  } else {
    candidates.push(join(ROOT, p)); // repo-relative → ROOT counterpart (the common caller)
    candidates.push(resolve(p)); // cwd-relative fallback
  }
  for (const abs of candidates) {
    if (abs.endsWith(".md") && existsSync(abs) && inScanScope(abs)) return { abs, inScope: true };
  }
  for (const abs of candidates) {
    if (abs.endsWith(".md") && existsSync(abs)) return { abs, inScope: false };
  }
  return null; // resolves to no existing .md — a typo, surface it
}

function collectScanFiles() {
  const files = [];
  for (const d of SCAN_DIRS) {
    const abs = join(ROOT, d);
    if (existsSync(abs)) walkMarkdown(abs, files);
  }
  for (const f of SCAN_FILES) {
    const abs = join(ROOT, f);
    if (existsSync(abs)) files.push(abs);
  }
  return files;
}

// Parse workflow-conventions.md → the set of real numbered convention headings.
// A convention is a top-level "## N. <title>" line.
function readConventionSet() {
  const abs = join(ROOT, CONVENTIONS_DOC);
  const nums = new Set();
  let max = 0;
  if (!existsSync(abs)) return { nums, max };
  for (const line of readFileSync(abs, "utf8").split("\n")) {
    const m = line.match(/^##\s+(\d+)\.\s/);
    if (m) {
      const n = Number(m[1]);
      nums.add(n);
      if (n > max) max = n;
    }
  }
  return { nums, max };
}

// Live count of command files (the only count claim with a clean on-disk referent).
function commandFileCount() {
  const abs = join(ROOT, "commands");
  if (!existsSync(abs)) return 0;
  return readdirSync(abs).filter((n) => n.endsWith(".md")).length;
}

// Resolve a `~/.claude/...` or relative link target. Returns true if it resolves
// on disk. Skips anchors / external / mail links (not our concern).
function linkResolves(target, fileAbs) {
  let t = target.trim();
  if (!t || t.startsWith("#") || /^(https?:|mailto:|tel:)/.test(t)) return true;
  if (t.includes("<") || t.includes(">")) return true; // template placeholder, e.g. ](<PR url>)
  t = t.split("#")[0].split("?")[0]; // drop anchor / query
  if (!t) return true;
  // Candidate absolute paths — resolves if ANY exists. A `~/.claude/X` path is
  // checked against BOTH the scanned repo root (so it works in a worktree and at
  // land time, where the merged file lives under ROOT, not yet under the real
  // ~/.claude) AND the literal ~/.claude home (so harness-only paths like
  // projects/<encoded-home>--claude/memory/ — outside the git repo — still resolve).
  const candidates = [];
  if (t.startsWith("~/.claude/")) {
    const rest = t.slice("~/.claude/".length);
    candidates.push(join(ROOT, rest), join(HOME, ".claude", rest));
  } else if (t.startsWith("~/")) {
    candidates.push(join(HOME, t.slice(2)));
  } else if (t.startsWith("/")) {
    candidates.push(t);
  } else {
    candidates.push(resolve(dirname(fileAbs), t)); // relative to the file
  }
  return candidates.some((abs) => {
    try {
      statSync(abs);
      return true;
    } catch {
      return false;
    }
  });
}

// ── detectors ────────────────────────────────────────────────────────────────

// (1) convention-number cross-ref. Phrase-scoped — never bare §N.
const CONV_PATTERNS = [
  /\bconvention\s+(\d+)\b/gi, // "convention 9"
  /\b(?:workflow-conventions\.md|conventions?)\s+§\s*(\d+)\b/gi, // "workflow-conventions.md §9", "conventions §9"
  /\bconvention\s+§\s*(\d+)\b/gi, // "convention §9"
];

function checkConventions(fileAbs, text, convSet, findings) {
  const rel = relative(ROOT, fileAbs);
  // The conventions doc itself defines the numbers; self-references to "§N" are headings, skip.
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const pat of CONV_PATTERNS) {
      pat.lastIndex = 0;
      let m;
      while ((m = pat.exec(line)) !== null) {
        const n = Number(m[1]);
        if (!convSet.nums.has(n)) {
          findings.push({
            file: rel,
            line: i + 1,
            kind: "conv",
            ref: m[0],
            why: `cites convention ${n}, but workflow-conventions.md has no §${n} (valid: 1–${convSet.max})`,
          });
        }
      }
    }
  });
}

// (2) link resolution.
const TILDE_LINK = /~\/\.claude\/[A-Za-z0-9._\/-]+/g;
const MD_LINK = /\]\(([^)]+)\)/g;

function checkLinks(fileAbs, text, findings) {
  const rel = relative(ROOT, fileAbs);
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    TILDE_LINK.lastIndex = 0;
    let m;
    while ((m = TILDE_LINK.exec(line)) !== null) {
      const target = m[0].replace(/[.,;:)]+$/, ""); // trim trailing punctuation
      if (!linkResolves(target, fileAbs)) {
        findings.push({ file: rel, line: i + 1, kind: "link", ref: target, why: "~/.claude path does not resolve on disk" });
      }
    }
    MD_LINK.lastIndex = 0;
    while ((m = MD_LINK.exec(line)) !== null) {
      const target = m[1];
      // Only check local-looking targets; skip URLs/anchors (linkResolves also guards).
      if (/^(https?:|mailto:|tel:|#)/.test(target.trim())) continue;
      if (!linkResolves(target, fileAbs)) {
        findings.push({ file: rel, line: i + 1, kind: "link", ref: `](${target})`, why: "relative markdown link does not resolve on disk" });
      }
    }
  });
}

// (3) count assertion — the one structured, machine-checkable claim.
// Match "<N> [global] commands" only when the SAME line also references the
// commands directory (lookahead allows dots — the path is `~/.claude/commands/`).
// This pins the claim to the directory's file count and ignores deliberate
// sub-counts like "17 procedural commands" (no `commands/` path follows them).
const CMD_COUNT = /\b(\d+)\s+(?:global\s+)?commands?\b(?=[^\n]*?commands\/)/gi;

// "the N conventions every skill/command reads|follows|binds" — a structured claim
// about the TOTAL number of numbered conventions in workflow-conventions.md. Tight
// phrasing avoids the subset false positives ("which of the 5 [authoring] conventions",
// a budget "~5–10 files"): only the total-asserting "the N conventions every …" form.
const CONV_TOTAL = /\bthe\s+(\d+)\s+conventions\s+every\s+(?:skill|command)/gi;

function checkCounts(fileAbs, text, liveCount, convMax, findings) {
  const rel = relative(ROOT, fileAbs);
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    // (3a) command-count claim — only the chains doc carries it
    if (rel === CHAINS_DOC) {
      CMD_COUNT.lastIndex = 0;
      let m;
      while ((m = CMD_COUNT.exec(line)) !== null) {
        const claimed = Number(m[1]);
        if (claimed !== liveCount) {
          findings.push({
            file: rel,
            line: i + 1,
            kind: "count",
            ref: m[0].trim(),
            why: `claims ${claimed} commands, but commands/*.md has ${liveCount} on disk`,
          });
        }
      }
    }
    // (3b) convention-total claim — anywhere
    CONV_TOTAL.lastIndex = 0;
    let c;
    while ((c = CONV_TOTAL.exec(line)) !== null) {
      const claimed = Number(c[1]);
      if (claimed !== convMax) {
        findings.push({
          file: rel,
          line: i + 1,
          kind: "count",
          ref: c[0].trim(),
          why: `claims ${claimed} conventions, but workflow-conventions.md has ${convMax} numbered conventions`,
        });
      }
    }
  });
}

// ── main ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { paths: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") out.json = true;
    else if (argv[i] === "--paths") {
      out.paths = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) out.paths.push(argv[++i]);
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const convSet = readConventionSet();
  const liveCount = commandFileCount();

  let files;
  let scopedNoOp = false;
  if (args.paths) {
    // Scope to caller-supplied files (land-time, the PR's changed docs). Each entry
    // is mapped to the ROOT doc it names (toRootDoc); keep only in-scope existing
    // .md files. Surface any entry that resolved to nothing on stderr — a silently
    // dropped scan path reads as "covered" when it wasn't (convention 8).
    files = [];
    const dropped = [];
    for (const p of args.paths) {
      const r = toRootDoc(p);
      if (!r) dropped.push(p); // does not resolve to an existing .md → a typo, surface it
      else if (r.inScope) files.push(r.abs); // in-scope: scan it
      // else: exists but outside the guard's doc scope (docs/plans/*, stray README) → skip by design, silent
    }
    if (dropped.length) {
      process.stderr.write(`check-doc-accuracy: skipped ${dropped.length} --paths entr${dropped.length === 1 ? "y" : "ies"} that did not resolve to an existing .md file: ${dropped.join(", ")}\n`);
    }
    scopedNoOp = files.length === 0; // --paths given but nothing in scope — a legitimate no-op, not an error
  } else {
    files = collectScanFiles();
  }

  if (files.length === 0) {
    if (scopedNoOp) {
      // --paths resolved to no governed doc (only out-of-scope docs changed, e.g.
      // docs/plans/*). "Nothing to scan" here is a no-op, not a land-blocking error
      // (land-ticket §4.7b is advisory) — exit 0 with a note rather than a false exit 2.
      process.stdout.write("check-doc-accuracy: no in-scope markdown docs among the --paths given — nothing to scan.\n");
      process.exit(0);
    }
    // Whole-tree sweep found no docs at all → a broken/empty checkout, a real error.
    process.stderr.write("check-doc-accuracy: no markdown docs to scan\n");
    process.exit(2);
  }

  const findings = [];
  for (const fileAbs of files) {
    const text = readFileSync(fileAbs, "utf8");
    checkConventions(fileAbs, text, convSet, findings);
    checkLinks(fileAbs, text, findings);
    checkCounts(fileAbs, text, liveCount, convSet.max, findings);
  }

  if (args.json) {
    process.stdout.write(JSON.stringify({ findings, scanned: files.length, liveCommandCount: liveCount }, null, 2) + "\n");
  } else if (findings.length === 0) {
    process.stdout.write(`check-doc-accuracy: clean — ${files.length} file(s) scanned, no accuracy defects.\n`);
  } else {
    process.stdout.write(`check-doc-accuracy: ${findings.length} finding(s) across ${files.length} file(s):\n`);
    for (const f of findings) {
      process.stdout.write(`  ${f.file}:${f.line}  [${f.kind}]  ${JSON.stringify(f.ref)} — ${f.why}\n`);
    }
    process.stdout.write(
      `\nNote: count-checking covers the structured "N commands … commands/" and "the N conventions every skill/command" claims only; subset counts ("which of the 5 conventions", "~5–10 files") have no machine referent and are left to the hand sweep.\n`,
    );
  }
  process.exit(findings.length > 0 ? 1 : 0);
}

main();
