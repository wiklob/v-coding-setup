# Worktree permission and evidence matrix

Scope: V-372 on Claude Code **2.1.210**, recorded 2026-07-15. This document keeps three kinds of claim separate:

- **Official / normative** — behavior stated by Claude Code or Git documentation.
- **Observed / probed** — behavior actually seen in this V-372 run or its recorded Git probe.
- **Pending** — not exercised in the named mode; do not infer it from docs, helper code, another mode, or a nearby row.

## Canonical ticket-flow contract

- An ordinary ticket-flow worktree lives at `<sourceRoot>/.claude/worktrees/<unchanged deterministic basename>`.
- `sourceRoot` is the command-launch checkout's `git rev-parse --show-toplevel`, passed explicitly to `ticket-worktree.mjs`; it is never the common Git directory or the first worktree-list row.
- Only an exact installed `~/.claude` source checkout retains the deterministic sibling path until V-376.
- The binding is `claude-ticket-flow.json` in the linked worktree's private Git administrative directory, resolved from the target worktree with `git rev-parse --path-format=absolute --git-path`; `<worktree>/.claude/active-project.json` is legacy migration input, not active state.
- A registered legacy sibling moves only from outside it and only when the managed target is absent from both Git registration and the filesystem. A caller already inside the legacy worktree defers migration. Any dual presence, occupied target, malformed binding, or binding mismatch stops.

## Matrix

| Surface | Official / normative behavior | V-372 evidence on 2.1.210 | Status |
|---|---|---|---|
| Claude-created named worktree | `claude --worktree <name>` and `EnterWorktree(name:)` create under `<repository>/.claude/worktrees/<name>`; Claude's default Git branch is `worktree-<name>`. | Ticket flow does not use Claude's creation path because it must preserve Linear's exact branch and the configured base branch. No interactive `EnterWorktree(name:)` run was recorded for V-372. | **Pending interactive observation** |
| Enter an existing managed path | Claude documents direct switching to another worktree under `.claude/worktrees/`; no external-path approval rule applies to that location. | The helper computes and Git registers the managed path, but an actual interactive `EnterWorktree(path:)` into the branch-local managed worktree was not recorded. | **Pending interactive observation** |
| Enter an existing external sibling path | Claude documents a mandatory approval before entering a path outside the repository's `.claude/worktrees/`; permission rules and “don't ask again” do not suppress it, and only `bypassPermissions` skips it. The docs say this gate applies from v2.1.206 onward. | This V-372 **background** `/go` run entered an external sibling through `EnterWorktree(path:)` without a visible prompt. That is a mode-specific observation that conflicts with the documented rule; it is not evidence that interactive entry is silent or that the official gate can be relied on as absent. | **Observed background discrepancy** |
| Interactive external sibling entry | Same official approval rule as above. | Not exercised interactively in this V-372 documentation run. | **Pending interactive observation** |
| Deterministic ticket-flow layout | Claude's managed directory is `<repository>/.claude/worktrees/`; Git permits manually created worktrees when callers need exact branch/location control. | `bin/ticket-worktree.mjs` resolves ordinary repos to the managed directory while preserving the existing feature/standalone/milestone basename. It selects the sibling only when `sourceRoot` is exactly `<home>/.claude`. `bin/ticket-worktree.test.mjs` encodes both cases. | **Helper evidence** |
| Outside-in legacy migration | Git provides `git worktree list --porcelain -z` as stable machine-readable registration state and `git worktree move <worktree> <new-path>` as the supported move operation. | The 2026-07-15 throwaway Git probe recorded in `docs/plans/v-372-build.md` moved a registered sibling into `<repo>/.claude/worktrees/<name>`. The helper also checks registration plus filesystem vacancy, returns `deferred-current-worktree` when cwd is inside the legacy tree, and refuses occupied/conflicting targets. | **Git probe + helper evidence** |
| Binding in private Git metadata | Git defines `$GIT_DIR` as the current worktree's private administrative directory, `$GIT_COMMON_DIR` as shared repository administration, and warns callers not to assume `.git` is a directory; resolve internal paths with `git rev-parse`. | The recorded Git probe resolved a linked-worktree-private metadata path. The helper rejects the primary worktree, resolves `claude-ticket-flow.json` from the target linked worktree, migrates an identical legacy marker, and refuses malformed or conflicting state. The regression fixture also checks that the binding survives `git worktree move`. | **Git probe + helper evidence** |
| Scoped edit-permission bootstrap | Claude's external-entry safety gate and protected-path handling are separate from project permission rules. Official worktree docs do not promise that a project-local allow rule overrides either gate. | `bin/bootstrap-worktree-perms.sh` recognizes both `<repo>/.claude/worktrees/<name>` and deterministic `*-wt-*` siblings, writes a scoped worktree-local settings file, and denies edits to that settings file. This proves configuration shape only, not prompt behavior. | **Static helper evidence; runtime prompt effect unproven** |
| Actual branch-local `/next-ticket` | No official statement covers this repository's command semantics. | Not run interactively from the isolated branch installation against disposable/live Linear state. Do not infer success or prompt absence from helper tests. | **Pending manual observation** |
| Actual branch-local `/go` | No official statement covers this repository's orchestration command. | The silent external entry above came from this background run, but it is not a complete branch-local `/go` lifecycle proof from the isolated installation. | **Pending manual observation** |
| Teardown | Git recommends `git worktree remove`; clean linked worktrees remove normally, while dirty worktrees require force. The main worktree cannot be removed. | Ticket flow exits the entered worktree before removal so the session is not left in a dead cwd, uses the non-forcing `worktree-remove.sh`, keeps feature/milestone worktrees until their final scoped ticket, and removes standalone worktrees after one ticket. Actual branch-local end-to-end teardown remains part of the pending command rows above. | **Documented implementation; end-to-end pending** |

## Operational reading

Use the official column to design the safe default. Use the observed column only for the exact version and mode named. A silent background entry does not waive the documented external-path gate, and a helper/Git probe does not prove Claude Code's interactive permission UI. Before V-372 lands, the unresolved interactive and branch-local rows must remain pending or be filled with direct observations; they must not be converted to “pass” from inference.

## Sources

- [Claude Code worktrees](https://code.claude.com/docs/en/worktrees)
- [Git worktree](https://git-scm.com/docs/git-worktree)
- [Git repository layout](https://git-scm.com/docs/gitrepository-layout.html)
