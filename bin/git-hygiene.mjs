#!/usr/bin/env node
// ~/.claude/bin/git-hygiene.mjs
// Repo-agnostic git hygiene: fast-forward local main, prune landed branches +
// stale tracking refs, remove landed worktrees. (V-282)
//
// WHY THIS EXISTS:
//   The pipeline hits the "stale main" bug — the canonical checkout's local
//   `main` drifts behind origin because it is only fast-forwarded during a land
//   (/land-ticket §7), so a stretch without landing leaves it stale (this session
//   hand-fast-forwarded a 3-behind main). And landed branches/worktrees pile up:
//   ~24 worktrees, ~11 stranded at main's tip. Nothing pruned them — orphan-detect.sh
//   only CLASSIFIES a worktree, it never removes one. This helper is the missing
//   sweep, run daily against every repo it is pointed at so mains
//   stay current and dead refs don't accumulate even when nothing lands.
//
//   Run via Bash (`node ~/.claude/bin/git-hygiene.mjs <repo> …`) it is covered by
//   the blanket `Bash(node ~/.claude/bin/*.mjs)` allow rule — prompt-free.
//
// SAFETY (the load-bearing invariant — proven by git-hygiene.test.sh):
//   Dry-run by DEFAULT; NOTHING destructive happens without `--apply` (the
//   `sb-push --apply` gate, applied to git). Even under --apply it is merged-only
//   and clean-only and never forces where force could lose work:
//     - local branches: `branch -d` (git refuses an unmerged branch) for merged
//       ones; `branch -D` ONLY for a branch whose upstream is GONE — provably
//       landed (its remote ref was deleted by a successful /land §7), so its
//       commits are already squashed into main and nothing is lost.
//     - remote branches (--remote only): deleted only when merged into origin/base
//       and under the pipeline's own `flingelms30/*` namespace.
//     - worktrees: AUTO-removed only when CLEAN and the branch's upstream is GONE
//       (a landed ticket whose worktree escaped /land teardown), via
//       worktree-remove.sh (which refuses on uncommitted changes, never forces).
//       Detached / binding-less / ambiguous worktrees are REPORTED, never deleted
//       — they may hold active ad-hoc work (V-282 thesis-check Deviation 2).
//   Never touches the main worktree. Never uses push --force / reset --hard / clean -f
//   (all hard-denied in settings.json anyway).
//
// PATH TARGETING: the REPO being cleaned comes from the <repo> arg (this helper
//   lives in V but operates on OTHER repos too), while the sibling helpers it shells
//   to (worktree-remove.sh, orphan-detect.sh) are resolved relative to THIS file's
//   bin/ via fileURLToPath — always V's own copies, regardless of the target repo.
//
// USAGE:
//   node ~/.claude/bin/git-hygiene.mjs <repo-path> [--apply] [--remote] [--base <branch>]
//     (no --apply)  dry-run: print every WOULD-do action, mutate nothing.
//     --apply       perform the pruning/FF.
//     --remote      also delete merged remote `flingelms30/*` branches (default off).
//     --base <b>    base branch (default: main).
//
// Exit codes: 0 on a completed sweep (individual step failures are surfaced and
//   skipped, never aborting the run); 2 on a usage error (missing/!git repo).

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = dirname(fileURLToPath(import.meta.url));
const WORKTREE_REMOVE = join(BIN, "worktree-remove.sh");
const ORPHAN_DETECT = join(BIN, "orphan-detect.sh");

// ---- args ----
const argv = process.argv.slice(2);
let repo = null;
let apply = false;
let remote = false;
let base = "main";
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--apply") apply = true;
  else if (a === "--remote") remote = true;
  else if (a === "--base") base = argv[++i];
  else if (!a.startsWith("--") && repo === null) repo = a;
}
if (!repo) {
  console.error("git-hygiene: usage: git-hygiene.mjs <repo-path> [--apply] [--remote] [--base <branch>]");
  process.exit(2);
}

// The pipeline's own branch namespace. The force-delete (`-D`) of a gone-but-unmerged branch, and
// the remote-branch prune, are BOTH scoped to it: inside it a `[gone]` upstream provably means a
// squash-land (/land §7 deleted the remote ref); outside it `[gone]` only proves the remote ref was
// deleted, not that the commits reached base — so a non-namespace branch is never force-deleted.
const NS = "flingelms30/";

// ---- git plumbing (each call surfaces its own failure; a failing step never aborts the sweep) ----
function git(dir, args, { allowFail = false } = {}) {
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    if (allowFail) return null;
    const msg = (e.stderr || e.stdout || e.message || "").toString().trim();
    throw new Error(msg);
  }
}
function tryGit(dir, args) {
  return git(dir, args, { allowFail: true });
}

const MODE = apply ? "APPLY" : "DRY-RUN";
const log = (m) => console.log(m);
const act = (would, did) => log(apply ? did : `WOULD ${would}`);

// Validate repo is a git work tree.
if (!existsSync(repo) || tryGit(repo, ["rev-parse", "--is-inside-work-tree"]) !== "true") {
  console.error(`git-hygiene: '${repo}' is not a git work tree`);
  process.exit(2);
}

// Resolve the repo's MAIN worktree (first `worktree list --porcelain` entry) — the
// only place we touch `base`; and enumerate all linked worktrees for step (e).
const porcelain = tryGit(repo, ["worktree", "list", "--porcelain"]) || "";
const worktrees = [];
{
  let cur = null;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      cur = { path: line.slice("worktree ".length), branch: null, detached: false, bare: false };
      worktrees.push(cur);
    } else if (line.startsWith("branch ") && cur) cur.branch = line.slice("branch ".length).replace("refs/heads/", "");
    else if (line === "detached" && cur) cur.detached = true;
    else if (line === "bare" && cur) cur.bare = true;
  }
}
const mainWt = worktrees.find((w) => !w.bare)?.path || repo;
const checkedOutBranches = new Set(worktrees.map((w) => w.branch).filter(Boolean));

log(`=== git-hygiene [${MODE}] repo=${repo} base=${base} ===`);

// ---- (a) fast-forward local main ----
try {
  const cur = tryGit(mainWt, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  git(mainWt, ["fetch", "origin", base]);
  const mainStatus = tryGit(mainWt, ["status", "--porcelain"]);
  if (cur !== base) {
    log(`FF: skipped — main worktree is on '${cur || "(detached)"}', not '${base}'; not switching under a hygiene sweep.`);
  } else if (mainStatus !== "") {
    // non-empty = dirty; null = status couldn't be determined → fail safe, don't FF a tree we can't confirm clean.
    log(`FF: skipped — main worktree ${mainStatus === null ? "status could not be determined" : "has uncommitted changes"}; not fast-forwarding.`);
  } else {
    const before = tryGit(mainWt, ["rev-parse", "HEAD"]);
    const target = tryGit(mainWt, ["rev-parse", `origin/${base}`]);
    if (before === target) log(`FF: ${base} already even with origin/${base}.`);
    else if (apply) {
      const out = tryGit(mainWt, ["merge", "--ff-only", `origin/${base}`]);
      log(out ? `FF: ${out.split("\n")[0]}` : `FF: ${base} fast-forwarded to origin/${base}.`);
      if (tryGit(mainWt, ["rev-parse", "HEAD"]) !== target)
        log(`FF: WARNING — ${base} did not reach origin/${base} (divergent history; resolve by hand, never forced).`);
    } else log(`WOULD fast-forward ${base}: ${before?.slice(0, 8)} → ${target?.slice(0, 8)} (origin/${base}).`);
  }
} catch (e) {
  log(`FF: step failed (skipped): ${e.message}`);
}

// ---- (b) prune stale remote-tracking refs ----
try {
  const dry = tryGit(repo, ["remote", "prune", "origin", "--dry-run"]) || "";
  const stale = dry.split("\n").filter((l) => l.includes("would prune") || l.includes("* [would prune]"));
  if (!stale.length) log("prune-refs: no stale remote-tracking refs.");
  else {
    stale.forEach((l) => act(`prune tracking ref:${l.replace(/.*would prune\]?/, "").trim()}`, `pruned tracking ref:${l.replace(/.*would prune\]?/, "").trim()}`));
    if (apply) git(repo, ["remote", "prune", "origin"]);
  }
} catch (e) {
  log(`prune-refs: step failed (skipped): ${e.message}`);
}

// ---- (c) prune landed local branches (merged OR upstream-gone) ----
try {
  // `git branch --merged` marks the current branch `*` and a branch checked out in
  // ANOTHER worktree `+`; strip either marker, and drop the `(HEAD detached …)` pseudo-rows.
  const merged = new Set(
    (tryGit(mainWt, ["branch", "--merged", base]) || "")
      .split("\n").map((l) => l.trim().replace(/^[*+]\s+/, ""))
      .filter((b) => b && b !== base && !b.startsWith("("))
  );
  // upstream-gone = a branch that HAS a configured upstream whose ref no longer exists (landed, remote-deleted).
  const gone = new Set();
  for (const l of (tryGit(mainWt, ["for-each-ref", "--format=%(refname:short) %(upstream:track)", "refs/heads"]) || "").split("\n")) {
    const [name, ...rest] = l.split(" ");
    if (name && name !== base && rest.join(" ").includes("[gone]")) gone.add(name);
  }
  const candidates = new Set([...merged, ...gone]);
  for (const b of candidates) {
    if (checkedOutBranches.has(b)) { log(`branch: skip '${b}' — checked out in a worktree.`); continue; }
    const isMerged = merged.has(b);
    // A gone-but-unmerged branch is force-deleted (`-D`) ONLY inside the pipeline namespace, where
    // `[gone]` provably means a squash-land. Outside it, `[gone]` proves only the remote was deleted
    // (not that commits reached base), so never force it — `-d` would rightly refuse an unmerged
    // branch; skip + report instead (reflog-preserving). Symmetric with step (d)'s namespace scope.
    if (!isMerged && !b.startsWith(NS)) {
      log(`branch: skip '${b}' — upstream gone but outside '${NS}' namespace; not force-deleting (may hold unmerged commits).`);
      continue;
    }
    const flag = isMerged ? "-d" : "-D";
    const why = isMerged ? "merged" : "upstream-gone (landed)";
    act(`delete local branch '${b}' (${why}, ${flag})`, `deleted local branch '${b}' (${why}, ${flag})`);
    if (apply) {
      const r = tryGit(mainWt, ["branch", flag, b]);
      if (r === null) log(`branch: FAILED to delete '${b}' (git refused — left intact).`);
    }
  }
  if (!candidates.size) log("branches: no landed local branches to prune.");
} catch (e) {
  log(`branches: step failed (skipped): ${e.message}`);
}

// ---- (d) prune merged remote branches under the pipeline namespace (--remote only) ----
if (remote) {
  try {
    const mergedRemote = (tryGit(repo, ["branch", "-r", "--merged", `origin/${base}`]) || "")
      .split("\n").map((l) => l.trim())
      .filter((l) => l.startsWith(`origin/${NS}`) && !l.includes("->"));
    if (!mergedRemote.length) log(`remote-branches: no merged '${NS}*' remote branches to prune.`);
    for (const r of mergedRemote) {
      const name = r.replace(/^origin\//, "");
      act(`delete remote branch 'origin/${name}' (merged)`, `deleted remote branch 'origin/${name}' (merged)`);
      if (apply) {
        const out = tryGit(repo, ["push", "origin", "--delete", name]);
        if (out === null) log(`remote-branches: FAILED to delete 'origin/${name}' (left intact).`);
      }
    }
  } catch (e) {
    log(`remote-branches: step failed (skipped): ${e.message}`);
  }
} else {
  log("remote-branches: skipped (pass --remote to prune merged remote branches).");
}

// ---- (e) prune landed worktrees (clean + upstream-gone auto-remove; others reported) ----
try {
  let removed = 0, reported = 0;
  for (const w of worktrees) {
    if (w.bare) continue;
    if (w.path === mainWt) continue; // never the main worktree
    // empty string = clean; null = status couldn't be determined → fail safe (treat as NOT clean).
    const clean = tryGit(w.path, ["status", "--porcelain"]) === "";
    // upstream-gone = the branch has a configured upstream whose ref no longer exists
    // (a landed ticket whose remote branch /land §7 deleted). `%(upstream:track)` reports
    // `[gone]` from config even after the tracking ref is pruned — more robust than `@{u}`,
    // which stops resolving once the ref is gone. refs/heads is shared, so read it from mainWt.
    let goneUpstream = false;
    if (w.branch) {
      const track = tryGit(mainWt, ["for-each-ref", "--format=%(upstream:track)", `refs/heads/${w.branch}`]);
      goneUpstream = !!track && track.includes("[gone]");
    }
    if (clean && goneUpstream) {
      act(`remove worktree '${w.path}' (branch '${w.branch}' landed — upstream gone, clean)`,
          `removing worktree '${w.path}' (branch '${w.branch}' landed — upstream gone, clean)`);
      if (apply) {
        try { execFileSync("bash", [WORKTREE_REMOVE, w.path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); removed++; }
        catch (err) { log(`worktree: FAILED to remove '${w.path}' — ${(err.stderr || err.message || "").toString().trim()} (left intact).`); }
      }
    } else if (!clean) {
      log(`worktree: keep '${w.path}' — dirty (may hold uncommitted work).`); reported++;
    } else {
      // clean but not upstream-gone: classify + REPORT only, never auto-delete (may be active ad-hoc work).
      const verdict = w.branch ? execFileSyncQuiet("bash", [ORPHAN_DETECT, w.path, base]) : null;
      log(`worktree: REPORT '${w.path}' — ${w.detached ? "detached HEAD" : `branch '${w.branch}'`}${verdict ? `, orphan-detect: ${verdict}` : ""}; resolve by hand (not auto-removed).`);
      reported++;
    }
  }
  if (!removed && !reported) log("worktrees: none to prune.");
} catch (e) {
  log(`worktrees: step failed (skipped): ${e.message}`);
}

function execFileSyncQuiet(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  catch { return null; }
}

log(`=== git-hygiene [${MODE}] done ===`);
process.exit(0);
