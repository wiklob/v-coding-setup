#!/usr/bin/env node
// Tests for write-memory-note.mjs (V-365).
// Run: node bin/write-memory-note.test.mjs   (exit 0 = pass, 1 = fail)
//
// Never touches the real ~/.claude — every test uses a fake HOME under a temp dir, so
// os.homedir() (read via an injected `home` param, or via a child process's HOME env)
// never resolves to the machine's actual home.

import { expandHome, validateMemoryPath, parseFlags, writeNote } from "./write-memory-note.mjs";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

let fails = 0;
function check(name, cond) {
  console.log(`[${cond ? "ok" : "FAIL"}] ${name}`);
  if (!cond) fails++;
}

const here = dirname(fileURLToPath(import.meta.url));
const FAKE_HOME = "/tmp/fake-home-xyz";

// --- expandHome ---
check("expandHome expands a bare ~", expandHome("~", FAKE_HOME) === FAKE_HOME);
check("expandHome expands ~/...", expandHome("~/.claude/x", FAKE_HOME) === join(FAKE_HOME, ".claude/x"));
check("expandHome leaves an absolute path untouched", expandHome("/abs/path", FAKE_HOME) === "/abs/path");

// --- validateMemoryPath: the shape/containment checks ---
{
  const ok = validateMemoryPath("~/.claude/projects/-Users-x--claude/memory/some-slug.md", FAKE_HOME);
  check("validateMemoryPath accepts a well-formed ~-prefixed memory path", ok === join(FAKE_HOME, ".claude/projects/-Users-x--claude/memory/some-slug.md"));
}
{
  const ok = validateMemoryPath(join(FAKE_HOME, ".claude/memory/some-slug.md"), FAKE_HOME);
  check("validateMemoryPath accepts an already-absolute in-home memory path", ok === join(FAKE_HOME, ".claude/memory/some-slug.md"));
}
const rejects = [
  ["missing --path", undefined],
  ["empty --path", ""],
  ["relative path", ".claude/projects/x/memory/note.md"],
  ["outside home", "/etc/memory/note.md"],
  // Built with plain string concatenation, not path.join — join() normalizes ".."
  // away before validateMemoryPath ever sees it, which would test nothing.
  ["traversal segment", `${FAKE_HOME}/.claude/projects/../../etc/memory/note.md`],
  ["not under a memory/ dir", join(FAKE_HOME, ".claude/projects/x/notes/note.md")],
  ["not a .md file", join(FAKE_HOME, ".claude/projects/x/memory/note.txt")],
  ["memory/ not the immediate parent", join(FAKE_HOME, ".claude/projects/x/memory/sub/note.md")],
];
for (const [label, p] of rejects) {
  let threw = false;
  try {
    validateMemoryPath(p, FAKE_HOME);
  } catch {
    threw = true;
  }
  check(`validateMemoryPath rejects: ${label}`, threw);
}

// --- parseFlags ---
{
  const f = parseFlags(["--path", "~/x/memory/n.md", "--body", "hello"]);
  check("parseFlags reads --path and --body", f.path === "~/x/memory/n.md" && f.body === "hello");
}

// --- writeNote: content required, mkdir idempotent, overwrite on re-run ---
{
  const dir = mkdtempSync(join(tmpdir(), "wmn-write-"));
  try {
    const target = join(dir, "projects", "fake-repo", "memory", "lesson.md");
    writeNote(target, "# Lesson\nfirst\n");
    check("writeNote creates parent dirs + writes content", readFileSync(target, "utf8") === "# Lesson\nfirst\n");
    writeNote(target, "# Lesson\nsecond (re-run)\n");
    check("a re-run OVERWRITES", readFileSync(target, "utf8") === "# Lesson\nsecond (re-run)\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
for (const blank of ["", "   \n", undefined]) {
  let threw = false;
  try {
    writeNote(join(tmpdir(), "wmn-should-not-exist.md"), blank);
  } catch {
    threw = true;
  }
  check(`writeNote rejects empty/missing content (${JSON.stringify(blank)})`, threw);
}

// --- CLI end-to-end: a fake HOME (via child-process env), simulating the real
// bg-isolated / post-teardown scenario — the harness's per-project memory dir lives
// under HOME, never under any worktree, so a fake HOME is the correct isolation
// boundary here (not a mkdtemp "install" copy, since this script deliberately does
// NOT self-locate — see TARGET VALIDATION in the source). Acceptance item 2: an
// actual write + read-back, not an assertion from source inspection. ---
{
  const fakeHome = mkdtempSync(join(tmpdir(), "wmn-home-"));
  try {
    const relPath = "~/.claude/projects/fake-repo/memory/post-teardown-lesson.md";
    const body = "# Post-teardown lesson\nWrites here always go through this helper.\n";
    const out = execFileSync("node", [join(here, "write-memory-note.mjs"), "--path", relPath], {
      env: { ...process.env, HOME: fakeHome },
      input: body,
      encoding: "utf8",
    });
    // NOT realpathSync'd: os.homedir() reads $HOME verbatim (no symlink resolution),
    // unlike the fileURLToPath-based siblings' own-install-location resolution.
    const expectedPath = join(fakeHome, ".claude/projects/fake-repo/memory/post-teardown-lesson.md");
    check("CLI prints the resolved absolute path", out.trim() === `memory note -> ${expectedPath}`);
    check("CLI actually wrote the note (read-back)", existsSync(expectedPath) && readFileSync(expectedPath, "utf8") === body);
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
  }
}
{
  // A path escaping the fake HOME is refused, not silently redirected.
  const fakeHome = mkdtempSync(join(tmpdir(), "wmn-home-escape-"));
  try {
    let code = 0;
    try {
      execFileSync("node", [join(here, "write-memory-note.mjs"), "--path", "/etc/memory/note.md"], {
        env: { ...process.env, HOME: fakeHome },
        input: "content\n",
        encoding: "utf8",
      });
    } catch (e) {
      code = e.status;
    }
    check("CLI exits 2 on an out-of-home --path", code === 2);
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
  }
}

// --- Acceptance item 3 (V-365): no regression to guard-sensitive-access.py for
// genuine shared-checkout scratch/audit writes — this is the one in-repo guard the
// worktree-isolation guard's own escape hatch (Bash, not Edit/Write) must also clear.
// Verified empirically (subprocess against the real guard), not by inspection. ---
{
  const guard = join(here, "guard-sensitive-access.py");
  function guardExit(command) {
    const event = JSON.stringify({ tool_name: "Bash", tool_input: { command } });
    try {
      execFileSync("python3", [guard], { input: event, encoding: "utf8" });
      return 0;
    } catch (e) {
      return e.status;
    }
  }
  check(
    "guard allows the sanctioned memory-write invocation",
    guardExit('printf "%s" "$NOTE" | node ~/.claude/bin/write-memory-note.mjs --path ~/.claude/projects/x/memory/lesson.md') === 0
  );
  check(
    "guard still blocks an unrelated secret read (no regression from adding this helper)",
    guardExit("cat .envrc") === 2
  );
}

console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILED"}`);
process.exit(fails === 0 ? 0 : 1);
