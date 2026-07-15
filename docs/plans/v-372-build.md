# Build plan: V-372 — EnterWorktree safety-gate worktree migration
Status: ready
Created: 2026-07-15 by /scope
Ticket: V-372 (Linear; private workspace)
Parent plan: none — standalone

## Goal
Move ordinary ticket-flow worktrees into each repository's Claude-managed `.claude/worktrees/` area while preserving deterministic branches, reuse, migration, and teardown. Move ticket binding state out of the protected checkout `.claude/` tree, retain an explicit temporary exception for the legacy `~/.claude` source checkout until V-376 cuts source ownership over, and prove the behavior on Claude Code 2.1.210.

## Approach
Add one installed helper as the source of truth for ticket-worktree layout and binding state. `/next-ticket` and `/resume-ticket` pass the command-launch checkout explicitly as `sourceRoot = git rev-parse --show-toplevel`; the helper never substitutes the shared Git common directory or guesses a canonical checkout. It preserves the existing deterministic basename, prefers `<sourceRoot>/.claude/worktrees/<basename>` for ordinary repositories, exposes the legacy sibling path for migration, retains the sibling path only when `sourceRoot` is exactly the installed legacy `~/.claude` checkout, and stores binding JSON at the target worktree's private Git metadata path resolved by `git -C <worktree> rev-parse --path-format=absolute --git-path claude-ticket-flow.json`.

Path migration is deliberately outside-in. From an unbound source checkout, `/next-ticket` requires the managed target to be absent from both `git worktree list --porcelain` and the filesystem before moving a registered legacy sibling with `git worktree move`; any registered target, non-empty unregistered target, or conflicting binding is a hard stop. If the session is already inside the legacy worktree, it does not move its own cwd: it continues on that path and records migration as deferred until a later entry from the source checkout. After an outside move, `/next-ticket` enters the new managed path; no session is left in a moved/dead cwd. Legacy binding files migrate atomically into Git-private metadata only after parse + equality checks.

Update every command and helper that derives a worktree path or reads `.claude/active-project.json` to use that contract. Add executable regression coverage for source-root selection, target-vacancy refusal, outside-in sibling migration, in-place deferral, binding isolation/migration, orphan classification, and prompt-sensitive runtime probes. For branch-local proof, install the branch into a throwaway `CLAUDE_CONFIG_DIR` with `install.sh --copy`, run the new helper/probe suite against disposable real Git worktrees, and record actual nested-Claude `/next-ticket` and `/go` observations as manual matrix rows when Linear-backed interactive execution cannot be automated without mutating live state.

## Prior art & standards
**Topic:** Claude Code-managed ticket worktrees with per-worktree binding metadata
**Industry standard(s):** Claude Code defaults worktrees to `<repository>/.claude/worktrees/<name>` and requires an unsuppressible approval before entering an existing path outside that directory; Git defines `$GIT_DIR` as the current linked worktree's private administrative state and recommends resolving paths through `git rev-parse` rather than assuming `.git` is a directory — https://code.claude.com/docs/en/worktrees · https://git-scm.com/docs/git-worktree · https://git-scm.com/docs/gitrepository-layout.html
**Candidates:**
- **Claude Code managed worktree layout** (reference architecture) — **adapt**: retain the pipeline's Linear branch naming and deterministic reuse while relocating its paths under the documented managed directory. https://code.claude.com/docs/en/worktrees
- **Git per-worktree administrative directory** (native metadata seam) — **adapt**: store the existing JSON payload at a path resolved from the private `$GIT_DIR`, avoiding both checkout dirtiness and the protected `.claude` write surface. https://git-scm.com/docs/gitrepository-layout.html
- **`git config --worktree`** (native configuration mechanism) — **build-fresh**: do not enable it here because it requires the repository-wide `extensions.worktreeConfig` switch and introduces compatibility/migration concerns for a small opaque JSON binding; use a helper-managed private Git metadata file instead. https://git-scm.com/docs/git-worktree
**Recommendation:** Adapt Claude Code's managed layout plus Git's private worktree metadata. Preserve the current sibling layout only for the legacy `~/.claude` source root until V-376 removes that source-repository special case.

## Implementation design
1. **Approach** — Introduce `bin/ticket-worktree.mjs` as the single executable contract for deterministic path resolution from an explicit command-launch `sourceRoot`, ordinary-repo managed-path preference, exact-`~/.claude` legacy fallback, private binding I/O, and guarded legacy migration. Command prose calls the helper instead of re-deriving paths or touching a protected checkout marker.
2. **Affected seams/files** — `bin/ticket-worktree.mjs` + its tests and isolated-install probe; `commands/next-ticket.md`, `commands/resume-ticket.md`, `commands/bulk-fix.md`; binding readers in `commands/build.md`, `commands/scope.md`, `commands/validate.md`, `commands/thesis-check.md`, `commands/audit-cycle.md`, and `commands/land-ticket.md`; `bin/orphan-detect.sh` + test, `bin/bootstrap-worktree-perms.sh`, `bin/probe-claude-gate.sh`, `bin/run-tests.sh`, `install.sh`'s existing `CLAUDE_CONFIG_DIR`/`--copy` seam, settings fixtures, `.gitignore`, `commands/ticket-flow-init.md`, `workflow-conventions.md`, `workflow-chains.md`, and the permission-matrix doc.
3. **Intended change shape** — The helper receives `sourceRoot` explicitly and returns the unchanged deterministic basename plus managed and legacy absolute paths. Its move operation refuses unless the caller is outside the legacy tree, the legacy path is registered, the managed path is unregistered, and the managed filesystem target is absent; it creates only the managed parent and then runs `git worktree move`. A caller already inside a legacy worktree defers path migration and keeps using it, preventing a dead cwd. Binding commands resolve the target worktree's private `claude-ticket-flow.json`, validate payload shape, migrate an old checkout marker only when private state is absent or byte-equivalent, and refuse conflicts. `/next-ticket` performs vacancy classification before any move, enters only after migration/create completes, writes the binding through the helper, and preserves the exact Linear branch; `/resume-ticket`, `/bulk-fix`, `/land-ticket`, and all readers use the same contract. The isolated-config probe installs this branch with `CLAUDE_CONFIG_DIR=<scratch> ./install.sh --copy`, executes the copied helper and real Git lifecycle fixtures, and proves no active binding file appears under `<worktree>/.claude/`; actual interactive `/next-ticket` and `/go` prompt rows remain observed/manual rather than fabricated.
4. **Alternatives considered** — Using `EnterWorktree(name:)` for creation was rejected because Claude Code controls its `worktree-*` branch and only supports `fresh|head` base selection, while ticket flow must use the Linear branch verbatim and the configured base branch. Moving a worktree while the session is inside it was rejected because it can strand the session in a dead cwd; defer-until-outside is safer than attempting an unverifiable `ExitWorktree` from sessions that may have started directly in the legacy tree. Keeping `.claude/active-project.json` via a shell helper was rejected because it preserves protected checkout state and dirtiness. `git config --worktree` was rejected because enabling `extensions.worktreeConfig` is a repository-wide compatibility decision disproportionate to this JSON binding.
5. **Risks / unverified premises** — Official Claude docs still state external existing paths require approval and managed paths do not; this background `/go` on Claude Code 2.1.210 nevertheless entered the external sibling path without a prompt, so the matrix records normative docs and observed mode-specific behavior separately. A throwaway Git probe on 2026-07-15 verified outside-in `git worktree move` into `<repo>/.claude/worktrees/<name>` and private `git rev-parse --git-path` metadata; it does not justify moving the current cwd, which the design now forbids. `sourceRoot` is always the launch checkout's `git rev-parse --show-toplevel`, passed into the helper, never `$GIT_COMMON_DIR` or the first worktree-list row. Nested managed contents must be ignored by the source checkout. The exact `~/.claude` source root stays on the sibling fallback until V-376 (currently Backlog) completes; this ticket does not patch installed `~/.claude` as source. A scratch `CLAUDE_CONFIG_DIR` proves branch-local installation and helper/lifecycle behavior, while real Linear-backed interactive command rows remain a named human verification if they cannot be run without creating live disposable tickets.

## Pre-build validation
- [x] Acceptance item 1 — implementable · kind: `manual-verify`. Claude Code 2.1.210 is installed; official docs define the external-path confirmation rule, and this background run observed an external `EnterWorktree(path:)` entering silently. Build will add the reproducible matrix/probe and obtain a real interactive observation rather than infer it.
- [x] Acceptance item 2 — implementable · kind: `code`. `commands/next-ticket.md:47-70` contains the complete deterministic sibling path/create/enter seam and can consume one helper-backed managed path.
- [x] Acceptance item 3 — implementable · kind: `code`. Branch creation is isolated at `commands/next-ticket.md:101-113`; reuse/orphan handling is at `commands/next-ticket.md:53-84`; teardown is path-agnostic at `commands/land-ticket.md:423-446` and `bin/worktree-remove.sh`.
- [x] Acceptance item 4 — implementable · kind: `invariant`. The current protected marker write is explicit at `commands/next-ticket.md:61-65`; Git 2.39.5 empirically resolves a private linked-worktree metadata path. Met only when tests/probes prove binding I/O targets Git-private metadata and no active checkout marker is created.
- [x] Acceptance item 5 — implementable · kind: `code`. The implementation will special-case the exact legacy source root, document V-376 as the cutover owner, and make no source edit in installed `~/.claude`; V-376 is Backlog, so this ticket preserves a temporary compatibility branch rather than fabricating its completion.
- [x] Acceptance item 6 — implementable · kind: `invariant`. The repo has `bin/run-tests.sh`; build will add end-to-end fixtures and current-version runtime probes. Prompt absence is not inferred from code presence and remains unverified until the probe/matrix records observed results.

(Build-check: pass — `bash bin/run-tests.sh -q` ran 35 checks with 0 failures on 2026-07-15.)

## Implementation steps
1. `bin/ticket-worktree.mjs` + `bin/ticket-worktree.test.mjs` — implement and prove explicit-source-root managed/legacy resolution, target-vacancy refusal, outside-in registered sibling migration, inside-legacy deferral, private binding storage, atomic legacy-marker migration, and malformed/conflicting-state refusal. Satisfies Acceptance 2–4.
2. `commands/next-ticket.md`, `commands/resume-ticket.md`, `commands/bulk-fix.md` — pass the launch checkout root explicitly, replace sibling derivation with the helper contract, preserve Linear branch/base semantics, classify both registered and filesystem target occupancy before migration, defer migration when already inside a legacy worktree, and enter only after create/move succeeds. Satisfies Acceptance 2–3.
3. `commands/build.md`, `commands/scope.md`, `commands/validate.md`, `commands/thesis-check.md`, `commands/audit-cycle.md`, `commands/land-ticket.md`, `bin/orphan-detect.sh` — route every binding presence/read through the helper; update orphan tests to exercise Git-private binding state. Satisfies Acceptance 3–4.
4. `.gitignore`, `commands/ticket-flow-init.md`, `settings.example.json`, `bin/bootstrap-worktree-perms.sh`, `bin/probe-claude-gate.sh`, `bin/run-tests.sh`, and settings/probe fixtures — ignore managed contents, remove the obsolete protected marker Write allowance, keep scoped permission bootstrap valid, and replace the old marker-write probe with an isolated-`CLAUDE_CONFIG_DIR` branch install + real-Git lifecycle/no-protected-write proof. Satisfies Acceptance 1, 4, and 6.
5. `workflow-conventions.md`, `workflow-chains.md`, and a focused worktree-permission matrix doc — record managed ordinary paths, explicit source-root semantics, safe migration/defer sequencing, the Git-private binding contract, current upstream rules, observed 2.1.210 interactive/background results, and the V-376 legacy-source boundary. Satisfies Acceptance 1 and 5.
6. Run targeted helper/orphan/isolated-install probes and the full `bin/run-tests.sh`; then exercise current-version managed/external `EnterWorktree` rows and actual branch-local `/next-ticket` + `/go` rows where live Linear state permits, leaving any genuinely interactive rows as named manual residue rather than claiming them from headless execution. Do not apply any code-review command. Satisfies Acceptance 6.

## Risks / gotchas
- Preserve the existing worktree basename so legacy sibling detection and migration are deterministic; changing both parent and basename would make ownership ambiguous.
- A managed worktree is nested under a checkout but remains a normal linked worktree; use `git worktree list --porcelain` as authority, never directory presence alone.
- If both managed and legacy registered paths exist for one deterministic name, or the managed filesystem target exists while unregistered, stop as ambiguous; never delete, nest into, or merge them automatically.
- Never move a worktree whose path contains the session's current cwd. Continue on that legacy path and defer migration until a later source-checkout entry.
- The launch checkout's `git rev-parse --show-toplevel` is the explicit `sourceRoot`; do not substitute `$GIT_COMMON_DIR`, the first `git worktree list` row, or a slug-derived guess.
- The binding helper must resolve the worktree's private Git directory from the target worktree itself, not from the caller's current repository.
- The helper may migrate an old checkout marker only after parsing it and proving any existing private binding is identical; conflicting state is a hard failure.
- Keep `~/.claude`'s temporary sibling fallback explicit and narrow. Generalizing it to every path containing `.claude` would defeat the ordinary managed migration.
- Do not claim interactive prompt behavior from a non-interactive/background probe; record each mode's actual observation.

## Verification strategy
- `/verify-tests` scope: `bin/ticket-worktree.test.mjs`, `bin/orphan-detect.test.sh`, the isolated-install/no-protected-write probe, permission fixtures, and all existing shell/Node checks.
- Build check: `bash bin/run-tests.sh -q`, then the full non-quiet suite if a failure needs diagnosis.
- Branch-local automated probe: create a scratch `CLAUDE_CONFIG_DIR`, run this branch's `install.sh --copy`, execute the copied `ticket-worktree.mjs` against disposable real Git repositories/worktrees, and assert source-root selection, target-vacancy refusal, outside-in move, inside-legacy deferral, private binding, reuse, and teardown without touching live `~/.claude`.
- Runtime matrix on Claude Code 2.1.210: separately record managed `EnterWorktree(name:)`, managed `EnterWorktree(path:)`, external sibling `EnterWorktree(path:)`, and actual branch-local `/next-ticket` + `/go` observations. Headless/background results do not stand in for interactive results.
- Manual: if real Linear-backed interactive `/next-ticket` or `/go` cannot be exercised without creating disposable live tickets, the user reports each named interactive row before merge; the build leaves those rows open rather than fabricating prompt absence.

## Deviations
### 2026-07-15 — Thesis-check amendment
Planned: migrate any registered sibling when the managed path was free and run unspecified prompt-sensitive probes.
Did instead: require explicit source-root input, disk + registration vacancy, outside-in move sequencing with in-place deferral, and an isolated `CLAUDE_CONFIG_DIR` branch-install probe plus separately observed interactive rows.
Why: the first thesis-check found material missing seams: moving the active cwd can strand the session, a filesystem target can exist without registration, and live commands must load this branch rather than the installed command set.

## Thesis-check — 2026-07-15
Verdict: missing-seam
Bar: 1:pass 2:fail 3:pass 4:pass 5:fail 6:fail 7:pass
Product: n/a — not design-touching
Materiality: material
Reasoning:
- Bar 1: the single helper, managed-path preference, Git-private binding, migration, and legacy-source exception form a concrete approach.
- Bar 2: no seam defines disk-level target vacancy, migration while the session is inside the legacy worktree, or loading worktree-local commands for pre-merge runtime probes.
- Bar 3: the intended shape is refutable; probes showed `git worktree move` nests under an existing directory and moving the current worktree leaves a dead cwd.
- Bar 4: `EnterWorktree(name:)`, checkout-local binding, and `git config --worktree` are considered with valid rejections.
- Bar 5: Acceptance 3 lacks safe sequencing for reuse-time migration, and Acceptance 6 lacks a mechanism such as an isolated `CLAUDE_CONFIG_DIR` install to run the changed `/next-ticket` and `/go` before merge.
- Bar 6: the design does not verify its load-bearing assumptions that registration absence makes a move target free, that moving an entered worktree preserves session usability, or that runtime probes resolve commands from this branch; source-root computation is also unspecified.
- Bar 7: the thesis is explicit and attackable: one helper owns managed layout, migration, and Git-private binding state.
Trigger: bar 2, bar 5, bar 6   ·   Suggestion: amend-design — require disk absence before move, specify `ExitWorktree` → move → `EnterWorktree` sequencing or defer in-place migration, define exact source-root resolution, and add an isolated-config end-to-end probe path.

## Thesis-check — 2026-07-15
Verdict: sound
Bar: 1:pass 2:pass 3:pass 4:pass 5:pass 6:pass 7:pass
Product: n/a — not design-touching
Materiality: none
Reasoning:
- Bar 1: the helper-owned contract concretely defines explicit launch-checkout source-root resolution, managed/legacy paths, private binding state, guarded migration, and command integration.
- Bar 2: all material integration seams are named; the settings-schema test is transitively covered by the named settings-fixture seam and is build-surfaceable.
- Bar 3: the shape is refutable through precise preconditions for disk and registration vacancy, outside-only moves, inside-worktree deferral, binding conflict handling, and isolated installation.
- Bar 4: `EnterWorktree(name:)`, active-worktree moves, checkout-local binding, and `git config --worktree` are considered and rejected with load-bearing reasons.
- Bar 5: all six Acceptance items have mechanisms spanning the helper, command consumers, private metadata, legacy exception, automated fixtures, and separately observed interactive matrix rows.
- Bar 6: source-root and Git-private metadata behavior were probed; `install.sh --copy` honors isolated `CLAUDE_CONFIG_DIR`; prompt behavior remains explicit manual residue rather than an asserted result.
- Bar 7: the thesis is explicit and attackable: one helper owns deterministic managed layout, guarded legacy migration, and Git-private binding while preserving exact branch semantics.
Trigger: none   ·   Suggestion: proceed-with-ack — the amendment closes source-root resolution, disk-level target vacancy, safe migration sequencing, and branch-local isolated-config probing.
