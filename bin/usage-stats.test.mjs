#!/usr/bin/env node
// Tests for usage-stats.mjs — the streaming scan() counters that back §8.5's
// per-session monitoring (V-1 Part 4): token sums, tool-call census, compound-Bash
// detection (` && `), and the failed-call census (tool_result.is_error).
// Run: node bin/usage-stats.test.mjs   (exit 0 = pass, 1 = fail)

import { writeFileSync, unlinkSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { scan, selectTranscript, resolveMainWorktree } from "./usage-stats.mjs";

let fails = 0;
function check(name, cond) {
  console.log(`[${cond ? "ok" : "FAIL"}] ${name}`);
  if (!cond) fails++;
}

// A synthetic transcript: 2 assistant turns (one with a compound Bash, one with a
// plain Bash + Edit) and 2 user turns carrying tool_results (2 errors, 1 success).
// Includes a blank line and a malformed line to prove the stream skips both.
const lines = [
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-06-01T10:00:00.000Z",
    message: {
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: 3,
      },
      content: [{ type: "tool_use", name: "Bash", input: { command: "git add . && git commit -m x" } }],
    },
  }),
  "",
  "{ this is not json",
  JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", is_error: true }, { type: "tool_result", is_error: false }] },
  }),
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-06-01T10:05:00.000Z",
    message: {
      usage: { input_tokens: 1, output_tokens: 2 },
      content: [
        { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
        { type: "tool_use", name: "Edit" },
      ],
    },
  }),
  JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", is_error: true }] } }),
];

const fixture = join(tmpdir(), `usage-stats-test-${process.pid}.jsonl`);
writeFileSync(fixture, lines.join("\n") + "\n");

try {
  const r = await scan(fixture);

  check("sums input tokens across turns", r.totals.input === 11);
  check("sums output tokens across turns", r.totals.output === 22);
  check("sums cache_read", r.totals.cache_read === 5);
  check("sums cache_create", r.totals.cache_create === 3);
  check("counts assistant messages (skips blank + malformed)", r.totals.assistant_msg_count === 2);

  check("tool census: Bash counted twice", r.toolCalls.Bash === 2);
  check("tool census: Edit counted once", r.toolCalls.Edit === 1);

  check("compound-Bash detection fires only on ' && '", r.compoundBash === 1);
  check("failed-call census counts only is_error===true", r.failedCalls === 2);

  check("first assistant ts captured", r.firstAssistantTs === "2026-06-01T10:00:00.000Z");
  check("last assistant ts captured", r.lastAssistantTs === "2026-06-01T10:05:00.000Z");
} finally {
  try {
    unlinkSync(fixture);
  } catch {
    /* ignore */
  }
}

// --- selectTranscript: the --session exact/prefix resolution rule (V-76) -------
{
  const corpus = [
    "8fe27a29-1111-2222-3333-444455556666",
    "012d7c2a-aaaa-bbbb-cccc-ddddeeeeffff",
    "012d7c2a-9999-8888-7777-666655554444",
    "a25c272e-0000-1111-2222-333344445555",
  ];
  const exact = selectTranscript(corpus, "a25c272e-0000-1111-2222-333344445555");
  check("selectTranscript: full id → exact", exact.kind === "exact");

  const unique = selectTranscript(corpus, "8fe27a29");
  check(
    "selectTranscript: unique prefix → unique + full sid",
    unique.kind === "unique" && unique.sid === "8fe27a29-1111-2222-3333-444455556666"
  );

  const none = selectTranscript(corpus, "deadbeef");
  check("selectTranscript: no match → none", none.kind === "none");

  const ambiguous = selectTranscript(corpus, "012d7c2a");
  check(
    "selectTranscript: prefix matching ≥2 → ambiguous + candidates",
    ambiguous.kind === "ambiguous" && ambiguous.matches.length === 2
  );

  const exactBeatsPrefix = selectTranscript(["abc", "abcdef"], "abc");
  check("selectTranscript: exact wins even when it also prefixes another", exactBeatsPrefix.kind === "exact");
}

// --- resolveMainWorktree: cwd-independent sink resolution (V-681) --------------
{
  const ownRoot = resolveMainWorktree(null);
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  check(
    "no --cwd: resolves to this script's own install root, never inherited cwd",
    ownRoot === join(scriptDir, "..")
  );

  // A non-git directory (a bare tmpdir) must never crash the caller — it hits
  // the branch that used to throw "not a git repository" when the caller's
  // inherited cwd (e.g. $HOME post-teardown) wasn't a repo. With no --cwd at
  // all, resolveMainWorktree never touches git, so it can't hit that failure.
  const bareDir = mkdtempSync(join(tmpdir(), "usage-stats-bare-"));
  try {
    let threw = false;
    try {
      resolveMainWorktree(null);
    } catch {
      threw = true;
    }
    check("no --cwd: never depends on git worktree list at all", threw === false);
  } finally {
    rmSync(bareDir, { recursive: true, force: true });
  }

  // Explicit --cwd pointing at a non-existent dir → usage error (exit 3), never
  // silently ignored (the old, worse behavior this ticket replaces).
  {
    let err;
    try {
      resolveMainWorktree(join(tmpdir(), "usage-stats-does-not-exist-" + process.pid));
    } catch (e) {
      err = e;
    }
    check("--cwd non-existent dir: fails loud with code 3", err?.code === 3);
  }

  // Explicit --cwd pointing at a real dir that is NOT a git repo → fails loud,
  // not silently ignored.
  {
    const notARepo = mkdtempSync(join(tmpdir(), "usage-stats-notrepo-"));
    let err;
    try {
      resolveMainWorktree(notARepo);
    } catch (e) {
      err = e;
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
    check("--cwd non-repo dir: fails loud with code 3", err?.code === 3);
  }

  // Explicit --cwd pointing at a real git repo → resolves to that repo's main
  // worktree, honoring the override instead of ignoring it.
  {
    const repoDir = mkdtempSync(join(tmpdir(), "usage-stats-repo-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: repoDir });
      const resolved = resolveMainWorktree(repoDir);
      // Resolve both sides through realpath-equivalent comparison (macOS tmpdir
      // is often a symlink, e.g. /tmp -> /private/tmp) by re-deriving via git.
      const gitMain = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: repoDir, encoding: "utf8" })
        .split("\n")
        .find((l) => l.startsWith("worktree "))
        ?.slice("worktree ".length);
      check("--cwd real repo: honors the override", resolved === gitMain);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  }
}

console.log(fails === 0 ? "\nAll tests passed." : `\n${fails} test(s) FAILED.`);
process.exit(fails === 0 ? 0 : 1);
