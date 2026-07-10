---
description: Scoped pre-land test gate — runs tsc + vitest + playwright on what changed, triages failures scoped, asks tier-4 only when no coverage + user-visible. Designed to cost ~0 *output* tokens on green (the host session's inherited cache-read still applies).
argument-hint: "[--full]  (--full: re-run the whole suite ignoring scope; default: scoped)"
allowed-tools: Bash, Read, Edit, Glob, Grep, Write, Agent
---

# /verify-tests — scoped pre-land test gate

Runs the project's checks against what the current branch actually changed. Designed so the **pass case is cheap**: the green path runs on a cheaper model in a slim, fresh subagent frame (§0.5) — little output, none of the host session's cache-read (the dominant cost; see `docs/v-174-token-cost-thesis-check-verify-tests.md`) — and the strong model is reached only when something needs triage.

Read `~/.claude/workflow-conventions.md` first. Standalone command — runs between build and `/land-ticket`. May be invoked from `/build`. Exits with a clear `result:` line; downstream skills can consume that.

> Blind on *why* something failed at runtime (auth flow, migration/RLS, worker, e2e)? → consult your product's log-reading playbook (a per-product doc mapping situation → log source → exact read-only command), if one exists.

## Hard cost rules — the green path stays cheap

These govern whoever runs the green path — under §0.5 that is the cheap-model subagent; on the fallback, the current model:

- All three layers pass (tsc + vitest + playwright). Print one-line result and exit. **Do not read any test file, any diff, or any source code.**
- A passing test runs against files in the diff. **Do not re-validate "for context" — green means green.**

Strong-model **output** is spent only on failures (§4 triage) or the tier-4 branch (§5) — the escalation handlers the §0.5 dispatch bounces a non-green verdict to.

## 0. Load context (cheap reads only)

- `root="$(git rev-parse --show-toplevel)"`
- `cfg="$root/.claude/ticket-flow.json"` — read `baseBranch` (default `main`).
- `npm_dir`: the directory containing `package.json` with test scripts. For repos whose app lives in a subdir that's e.g. `$root/web`. Detect with `[ -f "$root/web/package.json" ] && echo "$root/web" || echo "$root"`.
- If `$ARGUMENTS` contains `--full`, set `MODE=full`; else `MODE=scoped`.

## 0.5 Cheap-path dispatch — run the green path on a cheaper model

The green/scoped run — the common case — is mechanical: one scope computation, a few Bash test invocations, a classification, a `result:` line. It needs no strong-model reasoning (the cost finding: a green run is ~7.4K output over ~1 Bash call). So **dispatch the green path to a cheaper model and reach the strong model only when a failure or a tier-4 judgment actually engages it.** Triage (§4) reads code and proposes fixes; tier-4 (§5) is an objective coverage judgment — both are quality-critical and stay on the strong model.

The split crosses a **model-frame boundary** (dispatch), never a frontmatter `model:` — a static `model:` governs the whole invocation, would leak the cheap model into the caller's strong-model turns (`/build` §5 commits/merge-gates after this), and wouldn't give the green run its slim fresh context.

**Dispatch** a subagent — `Agent`, `subagent_type: Explore`, `model: haiku` — to execute the **§1–§4 protocol** (loading the §0 context it needs first) against the current worktree, and return **exactly one** verdict line. **`Explore`, not `general-purpose`, is deliberate and load-bearing: `Explore` is a read-only agent type (no `Edit`/`Write`/`NotebookEdit`) that *keeps* `Bash`/`Read`/`Grep`/`Glob` — exactly the green path's needs (run the test commands, return a verdict). The green path is read-only by the §0 hard cost rules, but a `general-purpose` dispatch carries `*` tools including `Edit`/`Write`, and a haiku subagent used them — it patched a failing value-pin into a test file instead of returning `RED`, leaving an unreviewed working-tree edit the parent had to catch at land (V-243). Removing the capability is the structural guard; the standing rule below is defense-in-depth, not the primary fence. (Keep `model: haiku` — the `model` override composes with the `Explore` `subagent_type`.)

- `GREEN: <the §6 green result: line>` — tsc + vitest + playwright all exit 0 **and** no `code-prod` path is uncovered+user-visible.
- `SKIP: <the §6 docs-only result: line>` — docs-only PR (§1's shortcut).
- `RED: <tier 1|2|3> · <failing file> · <minimal failing output>` — a layer exited non-zero. **Return it; do not triage** (triage is the parent's strong-model job).
- `TIER4: <uncovered user-visible paths>` — all green, but §5's uncovered+user-visible trigger fires.
- `INFRA-STOP: <signal>` — Playwright's webServer never booted (§4.C.0 signals). Explicitly **not** green.

The subagent's standing rule, and the load-bearing one: **when uncertain whether a path is covered or whether a failure is real, return `RED`/`TIER4` — never `GREEN`.** GREEN is reserved for the unambiguous all-pass + fully-covered case; everything else escalates. This preserves the skill's no-false-green invariant — the cheaper model can only ever *under*-claim, never *over*-claim green. The subagent does not read source, propose fixes, or make tier-4 judgments — those bounce to the parent. It also has **no edit tools** (the read-only `Explore` frame above), so a failing assertion — a value-pin that doesn't match, a drifted snapshot — is a `RED` to *return*, never a file to *patch*: the fix belongs to the parent strong model, which reviews and commits it. (This is the V-243 failure mode — the green frame reports the red, it does not repair it.)

The subagent reads the protocol from the canonical skill file (`~/.claude/commands/verify-tests.md` §0–§4) — single-sourced, so this section never duplicates §1–§4's logic. The env discipline (§4: source the worktree-root `.envrc` in the *same* invocation that launches Playwright) is part of the protocol it executes verbatim.

**Branch on the returned verdict:**
- `GREEN` / `SKIP` → print the returned `result:` line and exit. The strong-model frame spent ~nothing.
- `RED` → enter §4 triage (this frame, strong model), scoped to the failing tier/file the verdict names.
- `TIER4` → enter §5 (this frame, strong model) for the named uncovered flows.
- `INFRA-STOP` → enter §4.C.0 (this frame) — confirm/fix the worktree `.envrc`, re-run, and STOP with the §6 infra-STOP line if it still won't boot.

**Fallback:** if the `Agent` tool is unavailable in this session, run §1–§4 inline on the current model (a loud one-line note that the cheap-path dispatch was skipped), then §5/§6 as written — the skill still works, it just doesn't get the cheap green path this run.

## 1. Compute scope (one git command — never read source)

```bash
git -C "$root" diff --name-only "origin/<baseBranch>...HEAD"
```

That output is the **changed-files set**. Classify each path into one of:

- `code-prod` — `<npm_dir>/src/**`, `supabase/migrations/**`, `<npm_dir>/proxy.ts`, `<npm_dir>/next.config.*`
- `code-test` — `<npm_dir>/tests/**`, `**/*.spec.*`, `**/*.test.*`
- `docs` — `docs/**`, `**/*.md`, `**/CLAUDE.md`, `**/AGENTS.md`
- `infra` — `.github/**`, `.claude/**`, `package*.json`, `tsconfig*.json`
- `other`

**Docs-only PR shortcut**: every changed path is `docs` AND nothing else → print `result: verify skipped — docs-only PR (N files)`. STOP.

## 2. Map changed files → relevant e2e tests (one Glob, no reads)

Convention from `<npm_dir>/tests/e2e/README.md`:
- `tests/e2e/<area>.spec.ts` covers `src/app/(app)/<area>/**`, `src/app/<area>/**`, `src/lib/<area>*.ts`.
- `tests/e2e/smoke.spec.ts` is the always-relevant baseline.

For each `code-prod` path:
1. Strip leading `web/src/app/(app)/` or `web/src/app/` → first path segment = `<area>`.
2. Strip leading `web/src/lib/` → filename stem before first `.` or `-` = `<area>`.
3. If `<npm_dir>/tests/e2e/<area>.spec.ts` exists → it's a relevant test.

Also Glob `<npm_dir>/tests/e2e/*.spec.ts` for any spec with a `// covers:` front matter line — Grep them for globs that match any changed path. Read **only the first 3 lines** of each spec file to extract that comment; do not read the whole spec.

Result:
- `RELEVANT_TESTS` = `[smoke.spec.ts, <matched area specs>...]`
- `UNCOVERED_PROD_PATHS` = `code-prod` paths with no matching test

## 3. Run tsc + vitest (no Claude reads)

From `$npm_dir`:
```bash
npx --no-install tsc --noEmit
```
- Exit 0 → continue.
- Exit ≠ 0 → tier-1 triage (§4.A).

```bash
npx vitest run --reporter=dot
```
- Exit 0 → continue.
- Exit ≠ 0 → tier-2 triage (§4.B).

## 4. Run playwright (no Claude reads on green)

If `<npm_dir>/playwright.config.ts` does not exist → skip to §5.

Playwright's `webServer` (`npm run dev`) is spawned as a child of the `npx playwright test` process and **inherits that process's environment** (Playwright merges `webServer.env` on top of it — it never replaces it). In a worktree the Supabase env lives in `.envrc` at the **worktree root** (`$root` = `git rev-parse --show-toplevel`), symlinked there by `bin/ensure-envrc.sh` — **not** in `$npm_dir` (`web/`). So `.envrc` must be sourced from `$root` **in the same shell invocation** that launches Playwright (Claude's `cd`/env don't persist across Bash calls). Sourcing relative to `web/`, or in a separate Bash call, is exactly the env-discipline bug — the dev server then boots with no `NEXT_PUBLIC_SUPABASE_URL` / `…_ANON_KEY` and crashes with `Your project's URL and Key are required to create a Supabase client!`.

From `$npm_dir`, run the **whole suite always** (running ≠ reading; CI minutes are free, scoping decides Claude attention not test execution) — sourcing the worktree-root `.envrc` first, guarded on its presence, all in one invocation:
```bash
( cd "$npm_dir" \
  && { [ -f "$root/.envrc" ] && { set -a; . "$root/.envrc"; set +a; }; } \
  && npx playwright test --reporter=line )
```
(Sanctioned env pattern per `workflow-conventions.md` §5. Never `direnv exec`; no env-verification step — go straight to the test run.)
- Exit 0 → continue. **Do not read the suite. Do not summarize tests. Do not read the diff.**
- Exit ≠ 0 → **read the Playwright output first**: if the webServer never booted (the §4.C.0 signals) → infra-STOP (§4.C.0), do NOT enter test-level triage; otherwise a real test failed → tier-3 triage (§4.C), **scoped to the failing test(s) only**.

> **Triage (§4.A–§4.C) is the strong-model escalation handler.** Under the §0.5 cheap-path dispatch, you reach these subsections only when the green-path subagent returned `RED` (or `INFRA-STOP` for §4.C.0) — i.e. a failure that needs code reading and a proposed fix, which is why it ran here on the strong model rather than in the cheap green frame. (When the dispatch was skipped via the §0.5 fallback, you reach them directly off §3/§4's exit-≠-0 the same way.) The verdict names the failing tier and file; scope to it.

### 4.A — TSC failure
Read **only** the tsc error output. Identify the file(s) in error. Read **only** those files at the reported line ±15. Propose the minimal fix as a diff. Surface to user.

### 4.B — Vitest failure
Read **only** the failing test's output. Read **only** the failing test file + the one source file it imports under test. Classify:
- Code bug → propose fix scoped to that source file.
- Stale test (Acceptance comment no longer describes desired behavior) → propose delete or rewrite, **anchored to the Acceptance comment**, not to the current implementation.
- Flaky → re-run once. Two reds in a row = treat as real failure.

**Do not** read the rest of the test suite or the rest of the diff.

### 4.C.0 — webServer failed to boot (infra-STOP, NOT a skip)
**Before any test-level triage**, check whether the suite failed because Playwright's `webServer` never came up — categorically distinct from a test that ran and failed. Signals in the Playwright output:
- `[WebServer] Error: …` — notably `Your project's URL and Key are required to create a Supabase client!`
- `Timed out waiting <N>ms from config.webServer` · `Process from config.webServer exited early`

This means **zero tests ran**. It is **not a pass, not a flaky test, and not a license to skip.** Do NOT rationalize it as "structurally unaffected / my diff is vitest-only / CI will run e2e on the PR" — that is the false-green shape this skill's env-discipline change exists to kill. Instead:
1. **It's almost always the env.** Confirm `.envrc` is present at the worktree root (`ls -l "$root/.envrc"` — a symlink placed by `bin/ensure-envrc.sh`; missing → `bash ~/.claude/bin/ensure-envrc.sh "$root"`). Then re-run §4's command **exactly** — sourced from `$root`, one invocation. A "URL and Key are required" crash *after* a clean source means the source didn't reach the webServer child (wrong cwd, or a separate Bash call): fix that, don't skip.
2. Re-run once. Boots green → continue §4 normally.
3. Still won't boot after the env is confirmed sourced → **STOP** (see the §6 infra-STOP `result:` line). Only a deliberate, **written, surfaced** waiver may proceed past a never-booted e2e suite — never a silent self-certification that the change is "e2e-clean."

### 4.C — Playwright failure (webServer booted, a test failed)
Read **only** the failing spec file + its first 3 lines (the `// Acceptance:` comment is your source of truth for what the test means). Read the test's failure trace. Classify:
- **Code bug** — the Acceptance still describes correct behavior; code drifted. Propose fix in the source file the spec covers.
- **Stale test** — the ticket / acceptance has changed. The current Acceptance comment is wrong. Propose: rewrite the Acceptance comment + the spec body from the new ticket's acceptance, or **delete** the test if the flow is gone. Per `tests/e2e/README.md` rule 3, deletion is a first-class action — do not fight to keep stale tests green.
- **Flaky / infra** — selector race, timeout, an *individual* test's transient error (the webServer **did** boot and tests ran). Re-run once with `--retries=1`. Two reds = treat as real failure. (A webServer that never booted is **not** this case — that's §4.C.0's infra-STOP, handled before you reach here; don't fold it into a flaky re-run.)

**Do not** browse other passing tests, do not re-read the full diff, do not "verify the suite is still healthy".

## 5. Tier-4 decision: uncovered + user-visible change

> **Tier-4 is the strong-model escalation handler for the judgment case.** Under the §0.5 cheap-path dispatch, you reach §5 only when the green-path subagent returned `TIER4` — all layers green, but an uncovered user-visible flow needs a write-a-test-vs-spot-check-vs-skip judgment. That judgment is *objective judgment over the change*, so per the routing register (`~/.claude/memory/feedback_subagent_haiku_routing.md`) it belongs on the strong model and in a context separate from the one that produced the work — make the call here in the parent frame (or, when the blast radius warrants a fresh perspective, dispatch the decision to a separate strong-model `Agent` and act on its returned recommendation). The cheap green frame never makes this call; it only flags the uncovered flow and bounces it here.

Triggered when **§4 was all green** AND `UNCOVERED_PROD_PATHS` is non-empty AND any of those paths is **user-visible**:
- `web/src/app/**` (routes, including server actions inline in `page.tsx`)
- `web/src/components/**`
- `web/src/lib/feed.ts`, `web/src/lib/edition/**`, `web/src/lib/widgets/**`

**Always-on rail for a genuinely-new reusable user-visible surface (CB-326 / V-257).** When the change *introduces* a new reusable user-visible surface — a new route, screen, or shared component that end-users will hit repeatedly (not a one-shot tweak to an existing one) — authoring its regression proof is **required, not an optional judgment**: option (a) is the mandated action, and (b)/(c) are not available for it. This is the CB-326 ask ("always-on e2e for the user-visible surface") scoped to exactly the case that earns it — a durable, reusable surface with no coverage — so a new user-facing surface never lands without a regression proof. It does **not** widen `/verify` into an always-run test-writer: the rail fires *only* inside the existing tier-4 trigger (uncovered **and** user-visible), so green code with no new user-visible surface still reaches no §5 prompt and pays ~0 output tokens (the cost discipline below is preserved, not relaxed). The (b)/(c) judgment still applies to the *non-new-reusable* uncovered flows: a one-shot tweak or an internal-only path.

**Test-less repo (no e2e toolchain) — the proof analog.** In a repo with no Playwright/vitest toolchain (e.g. the `~/.claude` pipeline repo, shell + markdown only), the "user-visible surface" of the change is the command/behavior it ships, and the always-on rail's required proof is the same encoded-proof analog `scope.md` §3 uses for an `invariant`: a **committed probe script or an embedded worked example** demonstrating the surface's behavior, committed alongside the change. The rail is unchanged — a durable proof of the new surface is required; only the *medium* differs (Playwright where a toolchain exists, a probe/worked-example where it doesn't). This keeps the rail non-vacuous even in a repo that has no runner.

For each uncovered user-visible flow, ask once (or, if invoked from autonomous `/build`, decide by the defaults below):

```
Uncovered flow: <path> (no test under tests/e2e/<area>.spec.ts).
  (a) Write a Playwright test now — persists forever, ~$1   [REQUIRED for a genuinely-new reusable surface — CB-326/V-257]
  (b) Live spot-check — Claude narrates what to manually verify, user looks — ~$0.05
  (c) Skip with reason: <reason>
```

**Autonomous defaults** (when called from `/build` in unattended mode):
- **Genuinely-new reusable user-visible surface** (a new route, screen, or shared component) → **(a), required** — the always-on rail; not downgradeable to (b)/(c). In a test-less repo, the probe/worked-example analog above.
- Reusable-but-pre-existing flow (a change to an existing route/shared component) → (a)
- One-shot tweak (single-page UI fix, copy change) → (b)
- Internal-only / not in `(app)` shell → (c)

(b) is the "watch what Claude saw" mode: Claude writes a short bullet list — `Navigate to /X, log in as Y, click Z, expect W` — and runs `npm run dev` in background. User opens the browser, follows the list, says ✅ or ❌. If a Playwright MCP server is installed (`mcp__playwright`), use it to drive the browser headed; otherwise fall back to the narrate-and-ask form.

**Skip the tier-4 prompt entirely when**:
- `RELEVANT_TESTS` already covered all `code-prod` paths in scope, OR
- The diff is entirely `code-test` + `docs` + `infra` (no production code).

## 6. Report — exit cleanly

Print one of:

- `result: verify green — tsc + vitest + playwright (<N> tests). <S>s. No tokens spent on triage.`
- `result: verify red — <tier> failure in <file>:<line>. Triage proposed above; awaiting user.`
- `result: verify red — e2e webServer failed to boot (infra-STOP): <signal>. Supabase env never reached the dev server; not a skip. Confirmed/fixed worktree-root .envrc and re-ran from $root — still red. Surface root cause or record an explicit written waiver; do NOT self-certify the change as e2e-clean.`
- `result: verify skipped — docs-only PR (N files).`
- `result: verify green; tier-4 deferred — <N> uncovered user-visible flows (see prompts above).`

The `result:` line is the contract `/build` and `/land-ticket` read. Nothing else.

## Hard rules

- **Pass case = ~0 *output* tokens** (the host session's inherited cache-read still applies — see the header). If you read a test file, a source file, or a diff line on a green run, the skill is wrong. Surface this so the user can flag the bug.
- **Scope failures.** One red test = read one test file + one source file. Not the suite, not the full diff.
- **Deletion is allowed.** A stale spec is worse than no spec. Do not rewrite code to make a wrong test pass.
- **No "while we're here" improvements.** `/verify` does not refactor, does not add tests beyond §5(a), does not "tidy up". It gates, it reports, it stops.
- **No new tests for green code — with one scoped exception.** If §4 passes, do not add tests just because the diff touched something. Tier-4 fires only when nothing covers the change AND it's user-visible. The always-on rail (§5, CB-326/V-257) does **not** widen this: it strengthens tier-4 option (a) from optional to **required** *only* for a genuinely-new reusable user-visible surface — a case that already lives inside the "uncovered AND user-visible" trigger. Green code with **no new user-visible surface** still gets no §5 prompt and no new test, so the ~0-output-token pass case is preserved. The exception mandates authoring for a new reusable surface; it never licenses speculative tests for green-and-covered code.
