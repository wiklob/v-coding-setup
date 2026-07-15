---
description: Validate an In Progress ticket against current code + produce a per-ticket build plan. Reads ticket + parent plan + affected code, validates each Acceptance item, compile-checks ticket-provided snippets, verifies external-service semantics before accepting a provider toggle on prose, writes docs/plans/<ticket-id-lowercased>-build.md. Full autonomy by default; flags introduce checkpoints.
argument-hint: "[--stop-after-validate | --no-build-check | --no-commit | --force]  (no args = validate → check → write → commit → hand off to /build)"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, mcp__linear, Agent, AskUserQuestion
---

# /scope — per-ticket validation + build plan

Sits between `/next-ticket` (or `/resume-ticket`) and `/build` in the chain:

```
/next-ticket → /scope → /build → /land-ticket
```

`/scope`'s job: **validate the ticket fits the current codebase before any code is written.** Reads the ticket (Goal + Acceptance + any ## Fix code snippets), the parent project plan if there is one, the affected source files, the repo CLAUDE.md. Validates each Acceptance item against current `main`. Compile-checks any ticket-provided code snippets against the real import graph (catches bundle-poisoning that `tsc --noEmit` misses). Verifies the actual documented semantics of any Acceptance item that hinges on external-service behavior (a Supabase Auth toggle, RLS, a host redirect rule, a provider quirk) instead of trusting the ticket's prose. Surfaces what doesn't fit BEFORE `/build` commits. Writes `docs/plans/<ticket-id-lowercased>-build.md` — `/build` follows it. Whether `/scope` runs at all is decided upstream by `/next-ticket`'s scope-necessity gate (its rubric in `next-ticket.md` §5 is the single source of the scope-vs-skip criteria); reaching `/scope` means that gate decided *scope*.

**Default = full autonomy, no stops.** Flags additively introduce checkpoints. Preflight failures stop unconditionally. Mid-run stops only on documented `needs input:` triggers (genuine ambiguity, ticket premise broken, snippet doesn't compile) — rendered per convention 11 (a `needs input:` prose stop, never an `AskUserQuestion` modal).

Read `~/.claude/workflow-conventions.md` first (esp. conventions 1, 3, 4, 12) — convention 12 means also reading the **active model profile** (`pipeline/profiles/`): its `scope-plan-depth` knob keys §6's schema depth. (**Under `/go`** both are already in context from the chain's top-of-run read — skip this re-read per the `read-discipline` knob (V-293); a standalone `/scope` reads them here.) Then `~/.claude/craft/README.md` — the craft register (the judgment substrate; see conventions §10). For §3's core validation judgment, load `~/.claude/craft/judgment.md`: its `## Constraints` + `## Anti-Patterns` are the rail each `implementable` / `needs-eyes` verdict is critiqued against. And load `~/.claude/craft/building.md` — validate Acceptance against the ticket's **goal**, not just its literal text: an item whose literal wording would ship a hollow version of the goal is a `needs-eyes` (the premise is thin), and the build plan should aim the build at the best version of the goal that stays within it.

## What `/scope` is NOT

- Not interactive planning — `/plan` is. `/scope` runs autonomously over an existing ticket against existing code.
- Not implementation — `/build` is. `/scope` produces the plan; `/build` executes it.
- Not architectural redesign — if the ticket's premise is wrong, `/scope` STOPs with `needs input:` and the human (or a fresh `/plan`) decides scope.

## Linear MCP call discipline

One `get_issue` for the ticket. One optional `get_issue` if the ticket's parent project is referenced and needed. No `list_issues`.

## Load config
- `root="$(git rev-parse --show-toplevel)"`; read `$root/.claude/ticket-flow.json` (missing → `/ticket-flow-init`, STOP). Use `linearTeam`, `scopeLabel`, `baseBranch`, `requiredCheck`.
- `WT_ABS="$root"` (assumes the session is inside the ticket's worktree, established by `/next-ticket` or `/resume-ticket`).

## 0. Parse flags

From `$ARGUMENTS`:
- `--stop-after-validate` — stop after §3 (Acceptance validation), before §4's compile-check. Useful when you want to inspect the validation report before committing to the build-check cost.
- `--no-build-check` — skip §4 entirely. Faster, but loses the bundle-poisoning class of detection.
- `--no-commit` — write the plan but don't commit it (working tree dirty for inspection).
- `--force` — proceed past §3's `needs input:` triggers; `/scope` writes the plan with the unresolved items flagged `needs-eyes` instead of stopping. Use when you've already decided how to resolve them.

Multiple flags compose. Default (no flags) = run all phases.

## 1. Load context

- Run `node ~/.claude/bin/ticket-worktree.mjs migrate-binding --worktree "$WT_ABS"` before normal binding read; malformed/conflicting legacy state hard-STOPs. Then read with `node ~/.claude/bin/ticket-worktree.mjs read-binding --worktree "$WT_ABS"` — mode + ticket ID (standalone: `binding.linearIssue`; feature: derive from current branch via one `list_issues project: <bound> state: "In Progress" assignee: "me" limit: 3`). Never access the legacy checkout marker directly.
- `mcp__linear get_issue` on the active ticket. Capture: title, description (Goal + Acceptance + any ## Fix code blocks), `gitBranchName`, parent project.
- Read parent project plan at `$root/docs/plans/<planSlug>.md` if feature mode and `planSlug` set. Locate the ticket's Manifest part + Stack Decision.
- Read repo root `CLAUDE.md`.
- **Identify affected files** from the ticket description + Acceptance:
  - Code blocks reference paths → those files.
  - Acceptance items naming files (`web/src/lib/site-url.ts exports X`) → those files.
  - Path patterns in prose → grep to resolve.
  - For broad searches, spawn an `Explore` subagent (Haiku-routed per `~/.claude/memory/feedback_subagent_haiku_routing.md`) to keep parent context clean.
- Read the affected files. **Pay the CLAUDE.md cascade cost here** — `/scope` is the right phase for it.
- **Design-touching tickets — load the product/design doctrine (V-281).** If `ticket-flow.json` carries a non-empty `designDoctrine` array **and** this ticket is **design-touching** — it carries the `design` issue label, or its Goal/Acceptance touches a user-facing surface (a screen, view, nav, component, layout, or visible end-user flow) — read the configured doctrine docs now. They feed §3's product-quality validation and the `## Implementation design` you write (§6). When `designDoctrine` is unset/empty, or the ticket touches no user-facing surface, skip this — the design/UX gate is a no-op (e.g. the `~/.claude` repo, which sets `designDoctrine: []`).

## 2. Preflight

- **Linear state must be In Progress.** Else → name `/next-ticket <ID>` or `/resume-ticket <ID>`, STOP.
- **Current branch matches the ticket's `gitBranchName`.** Else → STOP, surface drift.
- **Working tree clean** (`git -C "$WT_ABS" status --porcelain` empty). Dirty → STOP and ask user to commit/stash.
- **No existing `docs/plans/<ticket-id-lowercased>-build.md`** unless `--force`. If one exists, it's either stale or a previous run; STOP and ask whether to overwrite. (`--force` overwrites.)

## 3. Validate Acceptance against current code (the core)

Each Acceptance item earns `implementable` only once you've **observed** the thing it rests on — an *asserted* premise is not a *verified* one (craft rail: `craft/judgment.md` `## Constraints` / `## Anti-Patterns`). The per-item checks below gather that observation:

For each Acceptance item:
- **Does the code/UI it references actually exist?** Grep / Read for the referenced symbol, file, route, component.
- **Does the implementation it implies fit the current shape?** E.g., if the ticket says "X uses Y()", is X actually a call site that can be retrofitted, or does X not exist yet?
- **Are referenced dependencies present?** E.g., Acceptance item naming a Playwright test requires Playwright in the repo; check `package.json`.

Produce per-item status:
- `implementable` — code exists, change is straightforward against current state.
- `needs-eyes` — premise missing / referenced code doesn't exist / dependency absent / ambiguous spec.

**Then classify each item by artifact-kind** — the artifact whose presence in the diff proves the item was actually built. `/build` reads this to decide whether an item may be ticked, and `/land-ticket` hard-gates on it before merge, so use these **exact tokens**:
- `code` — a source/spec change in the diff satisfies it (the common case). Proven by the relevant file(s) appearing in the diff.
- `migration` — requires a DB migration file (`supabase/migrations/*`). The class `tsc`/`vitest` can't catch and that's invisible until runtime — a `migration` item ticked as done without its migration file double-lands (the promised mechanism was never built, caught only after an irreversible merge). **The plan's implementation step for a `migration` item routes creation through `sb-new <name>`, never a hand-authored timestamp (V-330)** — `sb-new` mints a collision-free monotonic prefix; a hand-authored round-number `…000000` prefix collides across parallel worktrees (invisible until `db push`) and is rejected at write time by the `guard-migration-authoring` hook (`docs/migration-collision-guard.md`).
- `dashboard-config` — satisfied by a console/provider/dashboard toggle, not by any diff (an OAuth redirect URL, a feature flag set in a UI). No artifact ever appears in the diff; only a human can confirm it.
- `manual-verify` — satisfied only by a human running a flow at runtime (a redirect lands, a toast shows the right copy). No artifact in the diff.
- `invariant` — asserts a **negative / security property**: *X is denied*, *this is the only path*, *Y cannot happen*, *Z is prevented/redacted*. **Keyword-gated** — classify an item `invariant` when its text matches `\b(deny|denied|block|blocked|only path|cannot|prevent|prevented|redacted|is denied|must not)\b`. The defining rule: **an `invariant` item is met ONLY by an encoded regression test/probe that proves the property holds — never by diff-presence.** The artifact whose presence proves it is the *test that exercises the negative*, not the code that supposedly enforces it: shipping a resolver doesn't prove "raw reads are still denied" — enforcement can ship while the asserted negative is literally false. A diff that adds enforcement code but no test asserting the property is **not** a met `invariant` item. *(Test-less repo note: where the repo has no test harness — e.g. this `~/.claude` repo is shell + markdown only — the encoded-proof analog is a **committed probe script or a worked example embedded in the doc** that demonstrates the property; the rule is unchanged — a runnable/inspectable proof of the negative, not mere presence of the artifact it constrains. Worked example: an acceptance item "raw `*.jsonl` read → DENY" is `invariant`; it is met by `guard-access.test` gaining a case that asserts the raw read is denied, **not** by the guard file appearing in the diff.)*

Classify by the artifact that *proves the item was built*, not by where it also has effects: if a migration is required, the kind is `migration`, full stop — even if there's also code; if the item asserts a negative/security property, the kind is `invariant` and only an encoded proof of that property satisfies it. Record the kind on every item in the plan (§6).

**Then flag external-service-semantics dependence** — a provider toggle validated as **text** rather than against its documented behavior ships the wrong flow and forces a re-land. So, separately from artifact-kind, mark every Acceptance item whose correctness hinges on the *behavior* of an external service — not merely its presence. Triggers (non-exhaustive):
- A **provider toggle / setting** named or implied: Supabase Auth config keys (e.g. `mailer_secure_email_change_enabled`, `mailer_autoconfirm`), RLS / storage policies, project settings.
- A **host/CDN rule**: a Cloudflare / Netlify (or other host) redirect, rewrite, or header rule whose match/precedence semantics matter.
- An **OAuth / provider flow quirk**: callback/PKCE behavior, token rotation, consent-screen specifics.
- Any **third-party API** whose effect is non-obvious from its name.

For each flagged item, **verifying the actual documented semantics is a precondition for an `implementable` verdict** (this makes §5 research mandatory for these items — see §5):
- Read the provider doc / API reference for the exact setting or behavior. State the **verified behavior AND its UX consequence** (e.g. `mailer_secure_email_change_enabled = true` ⇒ dual-confirm: click required in both old and new inbox; `= false` + `mailer_notifications_email_changed_enabled = true` ⇒ verify-new + notify-old, the industry standard).
- Compare against what the ticket's prose **assumes**. If they diverge, the ticket's premise is wrong → `needs-eyes` (surface it).
- The verified behavior + a doc/API URL is recorded on the item in the plan (§6).

**A non-obvious provider toggle cannot be judged `implementable` on the ticket's prose alone** — it stays `needs-eyes` until its semantics are doc-verified, recorded, and found to match the ticket's assumption. *Non-obvious* = the effect is not unambiguous from the setting's name (a dual-confirm-vs-passive-notify toggle qualifies; a literal `from_email` string or an on/off flag with one plain meaning does not). When in doubt, treat it as non-obvious and verify.

**Then probe rationale-premises empirically.** Beyond what an item *builds*, check what the ticket's *justification* rests on. When a ticket's rationale depends on a claimed **current-system property** — especially a security baseline ("raw transcript reads are already denied", "this path is the only writer") — that premise is **not** validated by reading the ticket's prose; it is validated only by an **empirical probe of the live system**. Identify any current-system-property the ticket leans on, **run the probe that confirms or refutes it** (grep the actual guard/deny rules, run the access check, exercise the path) before judging the dependent items `implementable`. A premise that probes **false** → the dependent items are `needs-eyes` with the divergence stated (the premise, not just an item, is the defect — surface it for re-scope or a prerequisite ticket). Record the probe + its result on the dependent item(s) in the plan (§6), the same way external-service semantics are recorded. This is `~/.claude/memory/verify-asserted-invariants.md` applied at scope-time, not land-time. **Origin-recovery addendum:** on **any** ticket, when scope/premise verification leaves the session suspecting the ticket's scope or premise is wrong — in **either** direction (a premise that probes **false** so the bug looks *made-up / stale / non-reproducible*, **or** a premise that reads true but whose framing/scope feels off) — do not finalize that `needs-eyes`/made-up verdict or build from the doubted prose yet. First apply `next-ticket.md` §6's origin-transcript recovery (`/ingest-convo` the handle resolved from the ticket's `conversations:`/`sessions:` line, its `/capture` `Source:`, or a stated provenance pointer such as a `report-bug` `errors.jsonl` entry) and re-decide from the source, degrading safely when no handle is recoverable or the transcript is GC'd. (The scope-time face of the safety net `/build` §4 also carries.)

**Then, for a design-touching ticket, fold in the product-quality requirements (V-281).** When §1 loaded the `designDoctrine` docs (the ticket is design-touching), the design must clear a **product** bar, not only an engineering one — the CB-335 class (engineering-correct, product-0/10: internal IDs exposed as the input, the existing app-shell zone never integrated, an unstyled reskin ignoring the doctrine). Carry these into the `## Implementation design` you write (§6), and stamp the `Design-touching: yes — doctrine: <configured paths>` carrier line into that section so `/thesis-check` §0 picks them up:
- **Full surface, not a reskin/harness** — the design delivers the full end-user surface the Acceptance implies (the actual usable feature), not a minimal reskin or a backend-verification harness exposing internal mechanics as the UI.
- **Existing shells/zones integrated** — name the existing app shell/zone the surface belongs in (the established nav / layout / containers) and require the design integrate it, rather than building an isolated island beside it.
- **Doctrine honored** — the Approach honors the loaded doctrine; cite the relevant doctrine points (with their doc path) in the design's `Risks / unverified premises` field.

These are the dimensions `/thesis-check`'s conditional **product sub-bar (P1–P3)** gates on (`thesis-check.md` §1) — recording them in the design + the carrier line is what lets the check fail a design-touching ticket on product quality, not only architecture. For an engineering-only ticket (no `designDoctrine`, or no user-facing surface) write no carrier line and skip this — the seven-item bar stands alone.

**If any items are `needs-eyes` AND `--force` was not passed:** STOP with `needs input: Acceptance items <N, M> are not implementable as-is: <reasons>. Suggested resolution: <e.g., move to a follow-up ticket, waive item, edit ticket>. Confirm or amend.` Wait for the user's decision; do NOT silently proceed or reinterpret.

With `--force`: write all items into the plan, flag `needs-eyes` ones explicitly under "Pre-build validation," and continue.

If `--stop-after-validate` was passed → STOP. Print the per-item validation table and `result: validated <N>/<M> items implementable; /scope --no-build-check to skip §4 or re-run /scope to continue`.

## 4. Compile-check ticket-provided snippets (bundle-poisoning class)

If the ticket description contains code blocks proposing concrete code (look for ``` fenced blocks under headings like `## Fix`, `## Code`, `## Implementation`):
- Apply the snippet to a scratch copy of the named file (don't commit; use `git stash` or a temp branch).
- Run the repo's `<requiredCheck>` equivalent: for Next.js repos, `npm run build` (or `npx next build`); for plain TS, `npx --no-install tsc --noEmit`. **`tsc --noEmit` alone is NOT sufficient** — it doesn't catch the `next/headers`-in-client-bundle class of bug.
- If the build fails: classify the error.
  - **Compile / import error caused by the snippet itself** (e.g., `next/headers` import in a module imported by a client component) → STOP with `needs input: ticket's proposed code doesn't compile in context: <error>. Likely fix: <e.g., dynamic import / restructure / split module>. Confirm the fix approach before /build proceeds.`
  - **Pre-existing failure unrelated to the snippet** (red on `main` already) → flag in the plan's Risks; don't STOP (not /scope's job to fix existing breakage).
- Discard the scratch state cleanly (`git stash drop` / delete temp branch / `git checkout -- <file>`). The working tree must be clean before §5.

`--no-build-check` skips §4. The plan's "Pre-build validation" section then notes "build-check skipped per flag — `/build` will catch any bundle/compile issues itself or `/land-ticket`'s deploy check will."

## 5. Research (only when signaled — Tier-C-style)

For tickets touching genuinely-new territory (any of):
- New library or external service mentioned in the ticket body.
- Sensitive-path keyword in the ticket: `\b(auth|authn|authz|middleware|crypto|acl|rbac|security|csrf|cors|oauth|saml|jwt|session|cookie|password|secret|token)\b` AND the implementation strategy is non-obvious from the ticket.
- Protocol implementation (the ticket asks Claude to implement a protocol, not just consume a library).
- **Mandatory, not optional: any Acceptance item flagged external-service-semantics-dependent in §3.** Its verified semantics gate §3's `implementable` verdict and are recorded in the plan (§6), so this research must run even when the rest of the ticket is otherwise common-case. Research only the flagged settings/behaviors — not the whole ticket.
- **Net-new solution → prior-art recon (always-on for net-new):** any Acceptance item that introduces a **completely new solution** — no existing in-repo pattern to follow, a new dependency/library/service, or a novel capability/protocol/algorithm/security-crypto surface (the same things `/plan`'s Stack Decision would flag as new). Routine changes that follow an existing in-repo pattern → **skip** (the existing code is the prior art).

Spawn a `general-purpose` subagent (Haiku-routed for read-only research) — WebSearch + repo grep for industry-standard patterns + existing precedent in the codebase. Summarize back in 5–10 lines: chosen approach, why, citations. This summary feeds the plan's `## Approach` section. **For each external-service-semantics item, the research must return, per setting/behavior: the verified documented behavior, its UX consequence, and a doc/API URL** — these are the facts §3's verdict and §6's per-item `**Verified semantics:**` line consume; without them the item cannot be judged `implementable`.

**For net-new solutions, delegate prior-art recon to `/research`** — do **not** inline a second copy of the brief logic here (keeps `/scope` lean and stops the two drifting). Auto-invoke it as a subagent — call `/research <the specific net-new solution>` — and paste its returned `## Prior art & standards` block verbatim into the build plan's matching section (§6). `/research` itself reuses `/deep-research` for depth on a thorny standard; `/scope` just consumes the brief (industry standard(s) + candidate implementations + an explicit import/adapt/build-fresh call per candidate, cited). Skip it when the change follows an existing in-repo pattern — the same net-new gate `/research` keys off.

For everything else (the common case), skip §5 entirely — the ticket + current code is enough context to plan against.

## 6. Write the build plan

> **Canonical plan-path casing — lowercase.** Every command derives the build-plan path as `docs/plans/<ticket-id-lowercased>-build.md` (id lowercased at the point of derivation). Writer (`/scope`), readers (`/build` §1, §2, §3, §4.5; `/resume-ticket`; `/land-ticket` §4.8's acceptance gate) must all agree, so the same file resolves on a case-sensitive FS. Always lowercase at the point of derivation — never compute it from a bare `<ticket-id>`.

**Both-casings guard.** Before writing, check for a stray differently-cased copy: `ls "$root/docs/plans/" | grep -i "^<ticket-id>-build\.md$"`. If it returns any name that is NOT the exact lowercase canonical (i.e. a previous run wrote uppercase on a case-sensitive FS), STOP and surface both paths — do not write a second casing. (On a case-insensitive FS the two collapse to one and this is a no-op.)

**Plan depth is profile-keyed** (convention 12 — the `scope-plan-depth` knob) **and ticket-size-conditioned by the `depth-class`** on the `/next-ticket` hand-off / step-4 comment (V-323): a **`deep`** ticket takes the full schema regardless of the profile's floor; **`light`** permits trimming to the always-required contract; absent ⇒ `standard` (today's profile-keyed behavior). The conditioner is **raise-only** — it lifts depth above the profile floor but never below the always-required contract. The **always-required contract** — the sections downstream readers match on literally — is: the header block, `## Goal`, `## Pre-build validation` (every item with its artifact-kind + any `**Verified semantics:**` lines; read by `/build` §4.5 and `/land-ticket` §4.8), and `## Deviations`. `## Implementation design` is required whenever the profile's `design-check` knob will check it (always under `opus-4-8`; under `fable-5` for net-new or cross-cutting/migration-bearing work). The remaining prose sections (`## Approach`, `## Prior art & standards`, `## Implementation steps`, `## Risks / gotchas`, `## Verification strategy`) are **full-schema under `opus-4-8`** — a low-context later session executes better from a rich plan — and under `fable-5` included only where they carry information the builder couldn't derive from the validated ticket + code (a non-obvious constraint, a researched semantics finding, a deliberate sequencing). Omitting a section a profile doesn't require is not a degraded plan; it's the right-sized one.

Write `$root/docs/plans/<ticket-id-lowercased>-build.md`. Full schema:

```markdown
# Build plan: <TICKET-ID> — <title>
Status: ready | needs-eyes
Created: <YYYY-MM-DD> by /scope
Ticket: <linear-url>
Parent plan: <docs/plans/<slug>.md if any, else "none — standalone">

## Goal
<1–2 sentences: behavior-level outcome and shape of the change. Clarified from the ticket — not a paraphrase of the title.>

## Approach
<1–2 paragraphs: implementation strategy. Which files change, why. How the change fits the codebase. If §5 ran, the chosen approach + 1-line rationale.>

## Prior art & standards
<Present only for net-new solutions — the verbatim brief `/research` returned (§5): industry standard(s) + candidate implementations + an explicit import/adapt/build-fresh call per candidate, with cited source URLs. Omit this section entirely for routine changes following an existing in-repo pattern. Heading byte-identical to what `/research` emits, so its block drops straight in.>

## Implementation design
<The critiqued *how* — the artifact `/thesis-check` (B2) gates on and `/build` (B4) reads + follows. Five fields, defined authoritatively in `docs/implementation-design-rung.md` §1 (source them there; do not hard-code a divergent list — B2↔B4 stay in lockstep on the one contract). Author from §3's validation + the affected code you read; for a net-new solution the `## Prior art & standards` brief above feeds the Approach + Alternatives. Keep the heading byte-identical to what `/build` and `/thesis-check` read.>
<**Design-touching carrier (V-281).** When §3 marked the ticket design-touching, add a `Design-touching: yes — doctrine: <configured designDoctrine paths>` line as the first line of this section. `/thesis-check` §0 reads it to load the cited doctrine and apply the conditional product sub-bar (P1–P3); `/build` carries it forward. Omit the line entirely for an engineering-only ticket — its absence is what keeps the product sub-bar off.>
1. **Approach** — the implementation strategy: which mechanism/seams change and *why this way* (names the concrete change, not a goal restatement).
2. **Affected seams/files** — the named integration points the change touches (files, functions, call sites, schema objects, config keys); no "the relevant module".
3. **Intended change shape** — what the change looks like concretely, specific enough that a reviewer could refute it ("that breaks because X").
4. **Alternatives considered** — ≥1 alternative approach and why it was rejected.
5. **Risks / unverified premises** — constraints to honor + any current-system property the design rests on, each obvious or carrying a probe/citation (the §3 external-semantics + rationale-premise probe results land here).

## Pre-build validation
- [x] Acceptance item 1 — implementable · kind: `code`. `<file:line>` exists; change is `<one-line shape>`.
- [x] Acceptance item 2 — implementable · kind: `migration`. Needs `supabase/migrations/*` carrying `<what>`.
- [x] Acceptance item 3 — implementable · kind: `dashboard-config`. **Verified semantics:** `mailer_secure_email_change_enabled = false` + `mailer_notifications_email_changed_enabled = true` ⇒ verify-new + notify-old (industry standard) — [Supabase Auth config](https://supabase.com/docs/guides/auth/auth-email). Ticket's prose assumption confirmed.
- [x] Acceptance item 4 — implementable · kind: `invariant` ("raw `*.jsonl` read **is denied**"). Met by the **encoded proof of the negative**, not the guard file's presence: `guard-access.test` gains a case asserting the raw read → DENY. No such test in the diff ⇒ **needs-eyes** at land, never auto-ticked.
- [ ] Acceptance item N — **needs-eyes** · kind: `code`: `<premise>` is not in `main`. Suggested: `<resolution>`.

Every item records its artifact-kind (`code` / `migration` / `dashboard-config` / `manual-verify` / `invariant`, per §3). `/build` §4.5 reads it to decide whether an item may be ticked (done only when its kind's artifact is in the diff — for `invariant`, the artifact is the *encoded proof of the negative*, not the enforcement code); `/land-ticket` §4.8 reads it to hard-gate before merge (a `migration` item with no migration in the diff → STOP; an `invariant` item with no encoded proof in the diff → carried to the §5 gate as `needs-eyes`, never silently ticked). Keep the tokens byte-identical across this file, `/build`, and `/land-ticket` — the readers match on the literal string.

**External-service-semantics items** (flagged in §3) additionally carry a `**Verified semantics:** <behavior + UX consequence> — <doc/API URL>` line. An item that hinges on a **non-obvious provider toggle is not `implementable` and not `[x]`** unless this line is present and the doc confirms the ticket's assumption — prose alone never validates a provider toggle. If the doc contradicts the ticket, the item is `needs-eyes` with the divergence stated. The `**Verified semantics:**` line is an *added annotation*, not a new artifact-kind token — the kind stays one of the five literals above so `/build` and `/land-ticket` keep matching it.

(Build-check: <pass / fail-with-fix-proposed / skipped per --no-build-check>)

## Implementation steps
1. `<file>` — `<what changes; ~1 line>`. Satisfies Acceptance item(s) <N>.
2. ...

## Risks / gotchas
- `<constraint /build needs to honor — e.g., "site-url.ts is client-imported via google-sign-in-button.tsx, so any server-only import must be dynamic-inside-function">`

## Verification strategy
- `/verify-tests` scope: `<which tests cover the changed paths>`.
- Build check: `<run `next build` locally before push? or rely on /land-ticket's deploy gate?>`.
- Manual: `<any user-visible flow to spot-check, if applicable>`.

## Deviations
<convention 2 — `/build` appends an entry here as implementation diverges from the `## Implementation design` above; "(none yet)" until then.>
```

`Status: ready` if all Acceptance items validated cleanly. `Status: needs-eyes` if any items are flagged needs-eyes (`--force` was passed to write the plan despite unresolved items).

**When `## Implementation design` is written, it is not optional prose** — it is the artifact `/thesis-check` gates on and the contract `/build` follows; populate all five fields from §3's validation and the code you read. Whether the section is required is the profile's `design-check`/`scope-plan-depth` call (see the depth note above); when a plan ships without it, `/build` §3.5's self-check path and `/thesis-check` §0's degrade path read the plan's Goal + validation as the design. The heading stays byte-identical to what `/build` and `/thesis-check` read; the field set is sourced from the rung-spec §1, never re-derived here.

## 7. Commit + hand off

- `--no-commit` set → STOP. Print `result: scope written to docs/plans/<ticket-id-lowercased>-build.md; not committed. Inspect and commit yourself, then /build.`
- Else → commit the plan only:
  - `git -C "$WT_ABS" add docs/plans/<id-lowercased>-build.md`
  - `git -C "$WT_ABS" commit -m "docs(plan): scope for <TICKET-ID>"`
  - Match repo's commit-message style (read `git log -5 --oneline` if unsure).
- **Do NOT push.** `/build` and `/land-ticket` own the push.
- **End — name the next step:** print exactly `/build` (autonomous) — or `/build --force` if Status is `needs-eyes` and the user has decided to proceed despite the unresolved items.

Emit `result:` on its own line: `result: /scope completed for <TICKET-ID> — <N>/<M> Acceptance items validated, build-check <green|skipped|red-fix-needed>, plan committed. Status: <ready|needs-eyes>. Next: /build.`

## Hard rules

- Never changes Linear state. `/next-ticket` owns In Progress; `/land-ticket` owns Done.
- Never edits source code. The only file `/scope` writes is `docs/plans/<ticket-id-lowercased>-build.md`.
- Never pushes. `/build` pushes the branch (or `/land-ticket` does if `/build` was run with `--no-push`).
- Preflight failures stop unconditionally; mid-run only stops at §3 `needs input:` triggers (or compile-failure in §4) — both override-able with `--force`.
- Stops always emit `result:` or `needs input:` on their own line — never silent.
- One ticket per invocation.
- Convention 1: writes a plan before action (the plan IS the action). Convention 4: soft prerequisite check at start (§2), name the next step at end (§7).
