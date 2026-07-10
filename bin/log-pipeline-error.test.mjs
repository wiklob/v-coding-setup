#!/usr/bin/env node
// Tests for log-pipeline-error.mjs — noise filter + record shape + redaction. (V-55)
// Run: node bin/log-pipeline-error.test.mjs   (exit 0 = pass, 1 = fail)
//
// Secret-shaped literals here are synthetic (never real credentials).

// session/conversation resolution lives in session-identity.mjs (tested there);
// here we only assert the record builders STAMP those handles into each entry.
import { shouldLog, buildRecord, extractError, originFromCwd, manualRecord } from "./log-pipeline-error.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fails = 0;
function check(name, cond) {
  console.log(`[${cond ? "ok" : "FAIL"}] ${name}`);
  if (!cond) fails++;
}

const TS = "2026-06-02T00:00:00.000Z";

// --- noise filter: DROP expected control-flow non-zero exits ---
check(
  "grep no-match (exit 1) dropped",
  !shouldLog({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "grep foo file.txt" }, error: "exited with code 1" })
);
check(
  "--dry-run probe dropped",
  !shouldLog({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "sb-push --dry-run" }, error: "exited with code 1" })
);
check(
  "|| true tolerated failure dropped",
  !shouldLog({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "rmdir maybe || true" }, error: "exited with code 1" })
);
check(
  "user interrupt dropped",
  !shouldLog({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "sleep 9" }, is_interrupt: true })
);
check(
  "PostToolUse success event never logged",
  !shouldLog({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_response: { stdout: "ok" } })
);

// --- noise filter: KEEP genuine errors ---
check(
  "missing command (exit 127) kept",
  shouldLog({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "frobnicate --x" }, error: "command not found, exited with code 127" })
);
check(
  "grep bad-regex (exit 2) kept (not a no-match)",
  shouldLog({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "grep '[' f" }, error: "exited with code 2" })
);
check(
  "MCP/API failure kept",
  shouldLog({ hook_event_name: "PostToolUseFailure", tool_name: "mcp__linear__get_issue", tool_input: { id: "V-999" }, error: "API error: not found" })
);
check(
  "permission denial always kept",
  shouldLog({ hook_event_name: "PermissionDenied", tool_name: "Bash", tool_input: { command: "rm -rf /" }, reason: "denied by classifier" })
);
check(
  "file-not-found Read error kept",
  shouldLog({ hook_event_name: "PostToolUseFailure", tool_name: "Read", tool_input: { file_path: "/nope" }, error: "ENOENT: no such file" })
);

// --- record shape: all required keys present ---
{
  const rec = buildRecord(
    { hook_event_name: "PostToolUseFailure", session_id: "s-1", tool_name: "Bash", tool_input: { command: "false" }, error: "exited with code 1" },
    TS
  );
  check("record has ts", rec.ts === TS);
  check("record has session", rec.session === "s-1");
  check("record has conversation (falls back to session when chain untraceable)", rec.conversation === "s-1");
  check("record has activeCommand key (null when not derivable)", "activeCommand" in rec && rec.activeCommand === null);
  check("record has origin key (null when no cwd)", "origin" in rec && rec.origin === null);
  check("record has tool", rec.tool === "Bash");
  check("record has error", typeof rec.error === "string" && rec.error.includes("exited"));
  check("record carries redacted input", rec.input === "{\"command\":\"false\"}");
}

// --- origin stamp (V-88): triage context = the repo the error fired in ---
check("originFromCwd null on empty", originFromCwd("") === null);
check("originFromCwd null on non-string", originFromCwd(null) === null);
check(
  "originFromCwd falls back to cwd basename when no .git found",
  originFromCwd("/nonexistent-xyz-repo/someapp") === "someapp"
);
{
  const rec = buildRecord(
    { hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "false" }, cwd: "/nonexistent-xyz-repo/someapp", error: "exited with code 1" },
    TS
  );
  check("buildRecord stamps origin from payload.cwd", rec.origin === "someapp");
}
{
  // worktree: `.git` is a FILE pointing at <main>/.git/worktrees/<name> → origin
  // resolves to the MAIN repo basename, not the worktree dir's slug.
  const base = mkdtempSync(join(tmpdir(), "lpe-origin-"));
  try {
    const main = join(base, "myrepo");
    const wt = join(base, "myrepo-wt-feature");
    mkdirSync(join(main, ".git"), { recursive: true });
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, ".git"), `gitdir: ${join(main, ".git", "worktrees", "myrepo-wt-feature")}\n`);
    check("originFromCwd resolves a worktree .git file to the main repo basename", originFromCwd(wt) === "myrepo");
    check("originFromCwd returns dir basename for a normal .git directory", originFromCwd(main) === "myrepo");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

// --- redaction: a secret in tool_input is masked in the written record ---
{
  const rec = buildRecord(
    {
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_input: { command: "curl -H 'Authorization: Bearer sbp_0123456789abcdef0123' https://x" },
      error: "exited with code 7",
    },
    TS
  );
  check("secret token masked in input", !rec.input.includes("sbp_0123456789abcdef0123") && rec.input.includes("«redacted»"));
}
{
  // a secret leaked into the error string itself is also masked
  const rec = buildRecord(
    { hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "x" }, error: "auth failed for token sbp_feedfacefeedfacefeedface" },
    TS
  );
  check("secret in error string masked", !rec.error.includes("sbp_feedfacefeedfacefeedface"));
}

// --- manual path: --session forwarding (V-81 lens-a attribution fix) ---
{
  const rec = manualRecord({ command: "review-session", session: "sess-abc", error: "[lens-a/Allow] x ×1 — y" }, TS);
  check("manualRecord carries explicit --session", rec.session === "sess-abc");
  check("manualRecord tags activeCommand", rec.activeCommand === "review-session");
  check("manualRecord defaults tool to manual", rec.tool === "manual");
  check("manualRecord stamps conversation (falls back to session)", rec.conversation === "sess-abc");
}
// --- manual path: --ticket forwarding (V-234 direct-attribution fix) ---
{
  const rec = manualRecord({ command: "review-session", session: "sess-abc", ticket: "V-234", error: "[lens-a/Allow] x ×1 — y" }, TS);
  check("manualRecord stamps explicit --ticket for direct scorecard attribution", rec.ticket === "V-234");
}
{
  const rec = manualRecord({ command: "review-session", session: "sess-abc", error: "[lens-a/Allow] x ×1 — y" }, TS);
  check("manualRecord ticket is null when --ticket absent (back-compatible)", rec.ticket === null);
}
{
  // No --session, no env var, no job dir → null (truly unresolvable). Must clear
  // CLAUDE_JOB_DIR too: the daemon-state fallback would otherwise resolve the real
  // running job's session id.
  const savedSid = process.env.CLAUDE_SESSION_ID;
  const savedJob = process.env.CLAUDE_JOB_DIR;
  delete process.env.CLAUDE_SESSION_ID;
  delete process.env.CLAUDE_JOB_DIR;
  const rec = manualRecord({ command: "review-session", error: "[test]" }, TS);
  check("manualRecord session null when flag, env, and job-dir all absent", rec.session === null);
  check("manualRecord conversation null when session null", rec.conversation === null);
  if (savedSid !== undefined) process.env.CLAUDE_SESSION_ID = savedSid;
  if (savedJob !== undefined) process.env.CLAUDE_JOB_DIR = savedJob;
}

// --- defensive error extraction ---
check("extractError prefers .error", extractError({ error: "boom" }) === "boom");
check("extractError falls back to .reason", extractError({ reason: "denied" }) === "denied");
check("extractError reads tool_response.stderr", extractError({ tool_response: { stderr: "  bad  " } }) === "bad");
check(
  "extractError never empty",
  extractError({ hook_event_name: "PostToolUseFailure", tool_name: "Bash" }).length > 0
);

console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILED"}`);
process.exit(fails === 0 ? 0 : 1);
