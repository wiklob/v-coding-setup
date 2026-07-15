#!/usr/bin/env node
// Real-Git regression coverage for ticket-worktree.mjs. (V-372)

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  bindingPath,
  bindingStatus,
  legacyBindingPath,
  migrateBinding,
  moveLegacyWorktree,
  readBinding,
  resolveLayout,
  worktreeName,
  writeBinding,
} from "./ticket-worktree.mjs";

let fails = 0;
function check(name, condition) {
  console.log(`[${condition ? "ok" : "FAIL"}] ${name}`);
  if (!condition) fails++;
}
function throws(name, fn, pattern) {
  try {
    fn();
    check(name, false);
  } catch (error) {
    check(name, pattern.test(error.message));
  }
}
function git(...args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout).trim());
  return result.stdout.trim();
}

const home = "/Users/tester";
const ordinary = resolveLayout({
  sourceRoot: "/Users/tester/src/My Repo",
  mode: "standalone",
  issue: "V-372",
  home,
});
check("ordinary repo prefers managed path", ordinary.preferredPath === "/Users/tester/src/My Repo/.claude/worktrees/My-Repo-wt-v-372");
check("ordinary layout preserves legacy sibling candidate", ordinary.legacyPath === "/Users/tester/src/My-Repo-wt-v-372");
check("standalone issue segment lowercases", ordinary.name.endsWith("-wt-v-372"));

const legacySource = resolveLayout({
  sourceRoot: "/Users/tester/.claude",
  mode: "standalone",
  issue: "V-372",
  home,
});
check("exact legacy source retains sibling layout", legacySource.layout === "legacy-source" && legacySource.preferredPath === legacySource.legacyPath);

check(
  "feature naming preserves existing case and 40-char cap",
  worktreeName({ sourceRoot: "/r/Repo", mode: "feature", project: "Pipeline Refinements ABCDEFGHIJKLMNOPQRSTUVWXYZ" }) === "Repo-wt-Pipeline-Refinements-ABCDEFGHIJKLMNOPQRS"
);
check(
  "milestone naming lowercases both capped segments",
  worktreeName({ sourceRoot: "/r/Repo", mode: "milestone", project: "Connectors For Unmonitored Sources", milestone: "M2 Rights & Provenance Foundation" }) === "Repo-wt-connectors-for-unmonitored-sources-m2-rights-provenance-foundation"
);

const box = mkdtempSync(join(tmpdir(), "ticket-worktree-test-"));
try {
  const repo = join(box, "repo");
  const legacy = join(box, "repo-wt-v-1");
  const managed = join(repo, ".claude", "worktrees", "repo-wt-v-1");
  git("init", "-q", "-b", "main", repo);
  git("-C", repo, "config", "user.email", "t@t.test");
  git("-C", repo, "config", "user.name", "test");
  writeFileSync(join(repo, "seed.txt"), "seed\n");
  git("-C", repo, "add", "seed.txt");
  git("-C", repo, "commit", "-qm", "seed");
  git("-C", repo, "worktree", "add", "-q", "-b", "ticket-v-1", legacy, "main");

  const payload = { mode: "standalone", linearIssue: "V-1" };
  const legacyMarker = legacyBindingPath(legacy);
  mkdirSync(join(legacy, ".claude"), { recursive: true });
  writeFileSync(legacyMarker, `${JSON.stringify(payload)}\n`);
  check("legacy binding is detected", bindingStatus(legacy) === "legacy");
  const migrated = migrateBinding(legacy);
  check("legacy binding migrates to private Git metadata", migrated.status === "migrated" && existsSync(bindingPath(legacy)));
  check("legacy checkout marker is removed", !existsSync(legacyMarker));
  check("migrated payload reads back", readBinding(legacy).linearIssue === "V-1");

  const moved = moveLegacyWorktree({ sourceRoot: repo, legacyPath: legacy, managedPath: managed, cwd: repo });
  check("registered sibling moves outside-in to managed path", moved.status === "moved" && existsSync(join(managed, ".git")));
  check("private binding survives worktree move", readBinding(managed).linearIssue === "V-1");
  check("legacy path is vacated", !existsSync(legacy));

  const legacy2 = join(box, "repo-wt-v-2");
  const managed2 = join(repo, ".claude", "worktrees", "repo-wt-v-2");
  git("-C", repo, "worktree", "add", "-q", "-b", "ticket-v-2", legacy2, "main");
  const deferred = moveLegacyWorktree({ sourceRoot: repo, legacyPath: legacy2, managedPath: managed2, cwd: legacy2 });
  check("migration defers when cwd is inside legacy worktree", deferred.status === "deferred-current-worktree" && existsSync(legacy2));

  mkdirSync(managed2, { recursive: true });
  throws(
    "migration refuses any existing managed filesystem target",
    () => moveLegacyWorktree({ sourceRoot: repo, legacyPath: legacy2, managedPath: managed2, cwd: repo }),
    /target exists on disk/
  );
  rmSync(managed2, { recursive: true, force: true });

  writeBinding(legacy2, { mode: "standalone", linearIssue: "V-2" });
  mkdirSync(join(legacy2, ".claude"), { recursive: true });
  writeFileSync(legacyBindingPath(legacy2), '{"mode":"standalone","linearIssue":"V-OTHER"}\n');
  check("conflicting private and legacy bindings are visible", bindingStatus(legacy2) === "conflict");
  throws("conflicting binding migration refuses", () => migrateBinding(legacy2), /binding conflict/);

  throws("primary worktree cannot receive ticket binding", () => bindingPath(repo), /refusing to bind primary worktree/);
} finally {
  rmSync(box, { recursive: true, force: true });
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
