#!/usr/bin/env node
// ~/.claude/bin/write-memory-note.mjs
// Sanctioned writer for the harness's per-project auto-memory notes. (V-365)
//
// CONTEXT: a background-isolated session, after its worktree is torn down, is back in
// the shared checkout. The harness's Edit/Write tools then decline to touch that
// shared checkout — correctly, for the repo's own tracked files. But the model's
// per-project auto-memory notes (`~/.claude/projects/<encoded-cwd>/memory/<slug>.md`
// — distinct from this repo's tracked `memory/` register layer, see
// memory/README.md) live outside any worktree entirely, under `~/.claude/projects/`,
// so there is no worktree to re-enter for them either. Without a writer that reaches
// them another way, a lesson learned at exactly that moment has nowhere to land.
//
// This helper writes the note via plain Node `fs`, the same pattern
// log-audit-record.mjs and advance-periodic-review-watermark.mjs already use for
// audit/watermark writes that must survive worktree teardown (see
// workflow-conventions.md, "Scratch & audit writes ... go through a sanctioned
// helper").
//
// TARGET VALIDATION: unlike its audit-sink siblings, this helper cannot self-locate
// its target (a memory dir's encoded-cwd segment is per-project), so the caller
// names it via --path. To keep the target honest, the path is checked before
// writing: it must resolve to an absolute location inside the caller's home
// directory, contain no `..` segment, and end in `memory/<basename>.md` — the
// shape every per-project auto-memory note has. A path that fails any check is
// refused (exit 2) rather than written somewhere unexpected.
//
// USAGE:
//   <write the note prose> | node ~/.claude/bin/write-memory-note.mjs \
//     --path ~/.claude/projects/<project-slug>/memory/<slug>.md
//   or:  node ~/.claude/bin/write-memory-note.mjs --path <path> --body "<text>"
//
//   --path  (required) the note's target — absolute or `~`-prefixed; checked as above.
//   --body  (optional) the note content inline; omit to read it from stdin.
//   Content is written verbatim (no redaction — auto-memory is per-machine,
//   gitignored, never shipped); empty/whitespace-only content is refused rather than
//   producing a blank note.
//
// On success, prints `memory note -> <absolute path>` — read the file back at that
// path to confirm the write landed, rather than trusting a clean exit code alone.
//
// Exit codes: 0 success · 2 bad args (missing/invalid --path, empty content).

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { homedir } from "node:os";

export function expandHome(p, home = homedir()) {
  if (p === "~") return home;
  if (p.startsWith("~/")) return join(home, p.slice(2));
  return p;
}

// See TARGET VALIDATION above.
export function validateMemoryPath(rawPath, home = homedir()) {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    throw new Error("--path is required");
  }
  const expanded = expandHome(rawPath, home);
  if (!isAbsolute(expanded)) {
    throw new Error(`--path must be absolute or ~-prefixed (got ${JSON.stringify(rawPath)})`);
  }
  const homeWithSlash = home.endsWith("/") ? home : `${home}/`;
  if (!(expanded + "/").startsWith(homeWithSlash) && expanded !== home) {
    throw new Error(`--path must stay inside the home directory (${home}), got ${expanded}`);
  }
  if (expanded.split("/").includes("..")) {
    throw new Error(`--path must not contain a ".." segment (got ${expanded})`);
  }
  if (!/\/memory\/[^/]+\.md$/.test(expanded)) {
    throw new Error(`--path must name a file directly under a "memory/" directory, ending in .md (got ${expanded})`);
  }
  return expanded;
}

export function parseFlags(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--path") f.path = argv[++i];
    else if (a === "--body") f.body = argv[++i];
  }
  return f;
}

export function writeNote(path, content) {
  if (!content || !String(content).trim()) {
    throw new Error("no note content provided (pass --body <text> or pipe it on stdin)");
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const path = validateMemoryPath(flags.path);
  const content = flags.body !== undefined ? flags.body : readFileSync(0, "utf8");
  writeNote(path, content);
  process.stdout.write(`memory note -> ${path}\n`);
}

const isMain = process.argv[1] && process.argv[1].endsWith("write-memory-note.mjs");
if (isMain) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`write-memory-note: ${err.message}\n`);
    process.exit(2);
  }
  process.exit(0);
}
