---
description: Adversarial thesis-check on a ticket's implementation design — red-team the agreed *how* against the "sufficient to build from" bar, emit a verdict (sound | wrong-approach | simpler-alternative | missing-seam) with reasoning, and gate a non-sound verdict (stop / require ack) before any code is written.
argument-hint: "<ticket-id | path to build plan>  (defaults to the active ticket's docs/plans/<id>-build.md)"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, Agent, mcp__linear
---

# /thesis-check — adversarial design review, gated before /build

The "question the thesis" rung. Given a ticket's **implementation design** (the critiqued *how* — approach + seams + intended change shape — specced in `docs/implementation-design-rung.md`), this skill red-teams it: *is this the right approach? is there a simpler path? what seam is missing? does it actually serve the ticket's Acceptance?* It emits a verdict and **gates a non-`sound` one** — surfacing it as a stop that requires an explicit ack, amend, or re-scope, rather than letting a wrong thesis sail into `/build`.

It sits at the design→build boundary:

```
/next-ticket → /scope (writes the design) → /thesis-check → /build → /land-ticket
```

With a human driving, the human was this rung; `/go` removed the human, so the chain could execute a wrong thesis unquestioned.

**When this fires automatically is profile policy, not this file's** — the active profile's `design-check` knob (convention 12; `pipeline/profiles/`) routes `/build` §3.5 to this subagent check or to a recorded self-check against the same §1 bar, **conditioned raise-only by the ticket's `depth-class`** (V-323, derived at `/next-ticket` §5 and read off the hand-off / step-4 comment): **`deep` ⇒ this subagent check fires regardless of the profile's self-check setting**; absent ⇒ `standard`, the profile's routing unchanged — size raises rigor above the profile floor, never lowers a gate. Invoked directly (`/thesis-check <ID>`), it always runs in full, regardless of profile.

Read `~/.claude/workflow-conventions.md` first, then `~/.claude/craft/README.md` — the craft register (the judgment substrate; conventions §10). This skill **is** the judgment rail; its operational discipline is carried in §2's reviewer prompt and the hard rules. Read `~/.claude/craft/judgment.md` too — its `## Constraints` / `## Anti-Patterns` are what a verdict self-critiques against before it's emitted.

## What `/thesis-check` is NOT (boundary — B3/B4)

- **Not the chain wiring.** Making `/go` run this check between `/scope` and `/build` and instrument its gate (`p'd` / `intervened` / `forced`) is **B3**. This skill exposes a clean, instrumentable gate; it does not edit `commands/go.md`.
- **Not the design producer.** Adding the `## Implementation design` section to `/scope`'s build-plan schema and the inline form to `/build` §3, and making `/build` follow it, is **B4**. This skill *reads* the design; it does not edit `commands/scope.md` or `commands/build.md`.
- **Not a re-plan.** If the design is wrong, this skill returns it for revision or routes to re-scope — it does not redesign. `/scope` (re-run) or the human owns the fix.

## Linear MCP call discipline

At most one `get_issue` (the ticket — for its Goal + Acceptance, which the design's every item must map to). The only `list_issues` permitted is the single feature-mode no-arg derivation in §0 — one call (`project: <bound> state: "In Progress" assignee: "me" limit: 3`, matched on `gitBranchName`, the same idiom `/scope` and `/build` use); pass a ticket-id or build-plan path to skip it.

## Load config
- `root="$(git rev-parse --show-toplevel)"`; read `$root/.claude/ticket-flow.json` (missing → `/ticket-flow-init`, STOP). `WT_ABS="$root"` (assumes the session is inside the ticket's worktree).

## 0. Resolve + read the design

Resolve the target design from `$ARGUMENTS`:
- A **build-plan path** (`docs/plans/<id>-build.md`) → read it directly.
- A **ticket id** (`ENG-83`) → the plan is `docs/plans/<ticket-id-lowercased>-build.md` (lowercase at the point of derivation — the same casing rule `/scope` writes and `/build` reads, so the file resolves on a case-sensitive FS).
- **No arg** → derive the active ticket from `$WT_ABS/.claude/active-project.json` (standalone: `binding.linearIssue`; feature: the In Progress issue whose `gitBranchName` matches the current branch), then its lowercased build-plan path.

Read the design from the plan's **`## Implementation design`** section. Its required fields are defined once, authoritatively, in the spec's field section — `docs/implementation-design-rung.md` **§1** (distinct from the bar in that spec's **§3**, which this command mirrors in its own §1 below). Read the fields from there; do not hard-code a divergent list (B2↔B4 must stay in lockstep on the one contract; a field rename there must not silently desync this check):

1. **Approach** — the implementation strategy: which mechanism/seams change and *why this way* (names the concrete change, not a goal restatement).
2. **Affected seams/files** — the named integration points the change touches (files, functions, call sites, schema objects, config keys).
3. **Intended change shape** — what the change looks like concretely, specific enough to refute.
4. **Alternatives considered** — ≥1 alternative approach and why it was rejected.
5. **Risks / unverified premises** — constraints to honor + any current-system property the design rests on, each obvious or carrying a probe/citation.

Also capture the ticket's **Goal + Acceptance** (from the plan's `## Goal` / `## Pre-build validation`, or one `get_issue`) — bar item 5 checks every Acceptance item has a design path.

**Then, if the design is design-touching, load the product/design doctrine (V-281).** Check the `## Implementation design` section for a `Design-touching: yes — doctrine: <paths>` carrier line (`/scope` §3 / `/build` §3 write it when `designDoctrine` is configured and the ticket touches a user-facing surface). If present → **read the cited doctrine docs** and capture their content to thread into §2's reviewer, and apply the conditional **product sub-bar (P1–P3)** in §1. If absent (an engineering-only ticket, or a repo with no `designDoctrine`) → no doctrine to load, P1–P3 are N/A, and the check runs the seven-item bar alone. Degrade gracefully — a carrier naming a doc that doesn't resolve → note `Design-touching carrier present but doctrine doc <path> unreadable; running the seven-item bar only` and proceed (never STOP on this).

**Then load the parent plan's reconciliation record** — the spec collisions the project already reconciled, which `/thesis-check` must treat as authoritative so an apparent collision that was *already resolved upstream* cannot drive a false `wrong-approach` (the failure this rung's V-190 fix closes: a build that had reconciled a spec collision in its project plan was gated `wrong-approach` because the check never read that record). Resolve and read it:
- Read the build plan's **`Parent plan:` header line** (a fixed field `/scope` §6 always writes). **Extract the `docs/plans/<slug>.md` path token only** — real headers append trailing prose after the path (`Parent plan: docs/plans/connectors.md (Manifest P2)`), so match the path, not the whole line.
- If the token names a real plan file → read that parent plan's **`## Stack Decision`** and **`## Deviations`** sections (the reconciliation record: a `## Deviations` entry's *planned / did-instead / why* and a `## Stack Decision` are exactly where a spec collision gets reconciled). Capture their text to thread into §2's reviewer (an input, not a new bar item).
- **Degrade gracefully — never STOP:** the header is `none — standalone`, names no resolvable path, the file is absent, or it carries neither section → note `no parent-plan reconciliation record` and proceed with an empty record. The common standalone ticket has no parent plan; this must not gain a stop or an error.

**Then read the cross-project decision ledger** — `pipeline/decision-ledger.md` (V-307). The parent-plan record above covers only *this* ticket's own project; the ledger is the consolidated **cross-project** index of deliberate decisions, so a decision settled in **another** project's plan (invisible to the parent-plan read) is still surfaced and can't drive a false non-`sound`. It generalizes the same V-190 catch from own-plan to cross-project. Read the ledger and capture the entries relevant to this ticket's surface to thread into §2's reviewer (an input, alongside the reconciliation record — the ledger's own rows are pointers, so follow a relevant row's source link when the one-line gloss isn't enough to judge). **Degrade gracefully — never STOP:** `pipeline/decision-ledger.md` absent or empty → note `no decision ledger` and proceed with an empty ledger (the ledger is grounding, never a gate).

**Degrade gracefully (legacy plan).** If the plan has no `## Implementation design` section, don't fail: assemble the best available design from the plan's `## Approach` / `## Implementation steps` / `## Risks` and check *that*, printing a one-line note: `no ## Implementation design section; checking the plan's Approach/Steps/Risks as the design (legacy plan)`. The check still runs; it just has thinner material, which itself often surfaces as a `missing-seam`.

If no build plan exists at all → STOP: `needs input: no design to check at docs/plans/<id>-build.md. Run /scope <ID> first, or pass an inline design path.`

## 1. The bar it checks against

A design **passes** (`sound`) only when **all seven** hold — this list is `docs/implementation-design-rung.md` §3 verbatim; it is the single source, mirrored here so the check is self-contained, and it must stay byte-aligned with the spec:

1. **Approach is concrete, not a goal restatement** — names the mechanism/change, distinguishable from the Goal sentence.
2. **Every affected seam/file is named** — no "the relevant module"; a reviewer can open each named seam.
3. **Intended change shape is refutable** — specific enough that a reviewer could say "that breaks because X." A shape no one could disagree with is too vague to have been designed.
4. **≥1 alternative considered, with why-not** — the chosen approach is shown to have beaten at least one other.
5. **Every Acceptance item has a design path** — each item maps to a named seam + change; none is left unaddressed.
6. **No unverified load-bearing premise** — every current-system property the design rests on (security baseline, "only writer", provider-toggle behavior) is obvious or carries a probe/citation (convention 8). An unprobed premise fails the bar.
7. **The thesis is stated explicitly enough to attack** — the design names *the* approach as a claim ("we will do X because Y"). A design that hedges across approaches gives the check nothing to refute and fails.

The four framing questions the adversarial pass asks, and how they map to a non-`sound` verdict:
- *Is this the right approach? Does it serve the Acceptance?* → `wrong-approach` (bar 1, 3, 5, 7).
- *Is there a materially simpler path the design missed or under-weighted?* → `simpler-alternative` (bar 4).
- *What integration point is unaddressed?* → `missing-seam` (bar 2, 5).

**Conditional product sub-bar — design-touching tickets only (P1–P3; V-281).** When the design carries a `Design-touching: yes — doctrine: <paths>` line (§0 loaded the cited doctrine), the design additionally clears three **product** items — this list is `docs/implementation-design-rung.md` §3's conditional sub-bar verbatim, copied here so the check stays self-contained (the same byte-aligned-with-the-spec rule the seven above use):

P1. **Doctrine honored** — the design honors the configured product/design doctrine (the `designDoctrine` docs); it does not ignore or contradict a stated product/UX standard.
P2. **Existing shells/zones integrated** — the design integrates the existing app shells/zones the surface belongs in (the established nav / layout / containers), rather than building an isolated island or a parallel surface beside them.
P3. **Full surface, not a reskin/harness** — the design delivers the full end-user surface the Acceptance implies (the actual usable feature), not a minimal reskin or a backend-verification harness with internal mechanics exposed as the UI.

A design-touching design failing P1–P3 returns the **existing** verdicts — no new word: a doctrine/UX-wrong approach (P1/P3) → `wrong-approach`; an un-integrated existing shell/zone (P2) → `missing-seam`. P1–P3 apply **only** when the carrier is present; for an engineering-only ticket they are N/A. The materiality threshold below governs P1–P3 exactly as it governs the seven (a real reskin / genuinely un-integrated zone is material and gates; a cosmetic build-surfaceable detail is a note). The CB-335 worked example in §5 demonstrates the catch.

### Materiality threshold — a non-`sound` verdict requires a *material* failure (V-302)

A bar item can technically fail on an omission `/build` would catch and fix on its own — and gating on that is exactly the token sink this rung became (V-302): a missing render-input in an enumeration, an uncarried prop, an under-named-but-derivable detail trips bar 2 or bar 5, drives a non-`sound`, and costs a human amend → re-`/thesis-check` round for something `/build` §4's own compile / type-check / implement step would have surfaced anyway. So a failed bar item drives a non-`sound` verdict **only when the failure is *material*** — a thing the build cannot surface or self-correct:

- **Material** (gates — emit the non-`sound`): a wrong approach (the mechanism can't meet the Goal); a missing **integration seam** — a real unaddressed place the change meets existing code (the §5 cache-invalidation seam, *not* a missing field in a list); an Acceptance item with **no mechanism at all** (not merely an under-enumerated one); a real regression the design introduces; an **unprobed load-bearing premise** (a current-system property the design rests on, unverified — convention 8). These are the catches the project's Validation measures; the rung exists for them.
- **Build-surfaceable** (does **not** gate — record, don't stop): an omission `/build` §4's compile / type-check / implement step would surface and carry **without a design decision** — a missing render-input/prop on an otherwise-named seam, an under-specified-but-derivable detail, an enumeration that lists most-but-not-all members of a named set. Record it in the verdict's REASONING as a `build-surfaceable note` so it isn't lost, but it does **not** lower the verdict below `sound`.

The test is **"can the build catch and carry this without a *design* decision?"** Yes → build-surfaceable note. It needs a design decision the build can't make for itself → material, gate it. When genuinely unsure, treat it as material (the rung's bias is to catch real flaws) — but never manufacture an enumeration-completeness objection to look thorough; that manufactured objection *is* the sink this threshold removes. This bounds the amend thrash at its cause: the build-surfaceable non-`sound`s that drove the multi-round amends never fire, so there is no cycle to "cap" — and there is no machine re-check loop to cap regardless (`/build` §3.5 is idempotent; a re-check happens only when a human deliberately re-runs `/thesis-check`).

## 2. Run the adversarial check

Spawn an `Agent` subagent (`subagent_type: general-purpose`, Opus default — this is quality-critical reasoning, not read-and-summarize, so don't route it to Haiku). It evaluates the design against §1 from a **red-team posture**: its job is to try to *refute* the thesis, not to bless it. Prompt template:

> You are an adversarial design reviewer. A ticket is about to be built from the implementation design below. Your job is to find the way it is wrong **before** any code is written — not to approve it.
>
> **Ticket Goal:** `<goal>`
> **Acceptance:** `<the checklist, verbatim>`
> **Implementation design (the five fields):** `<approach / seams / change-shape / alternatives / risks-premises>`
> **Reconciliation record (parent project plan — already-agreed `## Stack Decision` / `## Deviations`):** `<the §0 record text, or "none — no parent plan / no reconciliation record">`
> **Decision ledger (cross-project deliberate decisions — `pipeline/decision-ledger.md`, V-307):** `<the §0 ledger entries relevant to this ticket's surface, or "none — empty/absent ledger">`
> **Product doctrine (design-touching tickets only — the `Design-touching` carrier's cited docs, loaded in §0):** `<the doctrine content, or "none — not a design-touching ticket">`
>
> Evaluate the design against this seven-item bar (a design is sound only if all seven hold): `<the §1 list, verbatim>`. Then answer the four framing questions: is this the right approach? is there a materially simpler path? what seam is unaddressed? does it serve every Acceptance item? **Spend your budget on those approach-steering questions** — whether the *thesis* is right — not on cataloguing every render-input, prop, or field the build will carry; the latter is where this check became a token sink.
>
> **If a product doctrine is provided above (a design-touching ticket), also evaluate the conditional product sub-bar (P1–P3): `<the §1 P1–P3 list, verbatim>`.** This is the CB-335 class — engineering-correct but product-0/10. A *material* product flaw gates: a minimal reskin or a backend-verification harness exposed as the UI (P3); an existing app shell/zone the surface belongs in left un-integrated, an island built beside it (P2); an approach that ignores or contradicts the doctrine (P1). Map a product failure to the **existing** verdicts — doctrine/UX-wrong → `wrong-approach`; an un-integrated existing zone → `missing-seam` — no new verdict word. A cosmetic detail the build will carry without a design decision is a build-surfaceable note, not a gate (same materiality threshold). **When the doctrine is "none" (not design-touching), ignore P1–P3 entirely** and judge on the seven alone.
>
> Discipline — the materiality threshold (V-302): flag only **material** issues — a thing the build cannot surface or self-correct (a wrong approach; a missing **integration seam** — a real unaddressed place the change meets existing code, not a missing field in a list; an Acceptance item with **no mechanism at all**; a real regression; an **unprobed load-bearing premise**). Each must name the specific bar item it trips and either the seam that breaks or the concrete simpler alternative. An omission `/build`'s own compile / type-check / implement step would catch and carry **without a design decision** (a missing render-input/prop on an otherwise-named seam, an under-specified-but-derivable detail, an enumeration missing some members of a named set) is **build-surfaceable**: record it in REASONING as a `build-surfaceable note` and do **not** lower the verdict below `sound` for it. The test is "can the build catch and carry this without a *design* decision?" — yes → note, not gate. Do not manufacture an enumeration-completeness objection to look thorough; if the design genuinely passes all seven on *material* grounds, say `sound`. Probe any current-system premise the design rests on rather than accepting it (you may grep the repo to check). Default to a non-`sound` verdict only when you can name what *materially* breaks. **Honor the reconciliation record AND the decision ledger:** if an apparent collision you would flag is already reconciled in the parent-plan record (the project plan's `## Stack Decision` / `## Deviations` made a deliberate, recorded decision about that collision) **or is a deliberate decision recorded in the cross-project decision ledger** (a decision another project settled — e.g. "build-fresh raw GraphQL, deliberately not `@linear/sdk`"), it is *resolved* — do not return `wrong-approach`, `simpler-alternative`, or any non-`sound` verdict on its basis; treat the recorded decision as authoritative and check the design against *it*, not against the superseded spec or the alternative it already rejected. The ledger is what lets you honor a decision made in a plan you never read.
>
> Return exactly this block and nothing else:
> ```
> VERDICT: <sound | wrong-approach | simpler-alternative | missing-seam>
> BAR: 1:<pass|fail> 2:<pass|fail> 3:<pass|fail> 4:<pass|fail> 5:<pass|fail> 6:<pass|fail> 7:<pass|fail>
> PRODUCT: <P1:<pass|fail> P2:<pass|fail> P3:<pass|fail> — design-touching | n/a — not design-touching>
> MATERIALITY: <material — a bar failure the build cannot self-correct drove the verdict | build-surfaceable — the only bar misses are ones /build would catch; noted in REASONING, did not gate | none — no bar failures>
> REASONING:
> - <one line per dimension you judged, citing the bar item and what breaks / what you verified; tag any build-surfaceable miss `build-surfaceable note`>
> TRIGGER: <the bar item(s) that drove a non-sound verdict, or "none">
> SUGGESTION: <amend-design | re-scope | proceed-with-ack> — <one line>
> ```

For a large or cross-subsystem design, you may spawn a small panel (e.g. three subagents with distinct lenses — *right-approach*, *simpler-path*, *missing-seam*) in parallel and take the most severe verdict, with the union of triggers. A single reviewer is the default; reach for the panel only when the blast radius warrants it.

## 3. The verdict

Read the returned block. The verdict is one of:
- **`sound`** — all seven bar items pass; the thesis survives. The design is sufficient to build from.
- **`wrong-approach`** — the named approach is not the right one, or does not serve the Acceptance (bar 1/3/5/7). The catch the project's Validation measures.
- **`simpler-alternative`** — the approach works, but a materially simpler path exists that the design missed or under-weighted (bar 4).
- **`missing-seam`** — a required integration point is unaddressed, or an Acceptance item has no design path (bar 2/5). The catch the project's Validation measures.

Each verdict carries the per-dimension reasoning and, when non-`sound`, the triggering bar item(s) and a suggestion. Surface the full block to the user — never collapse it to the bare verdict word (the reasoning is what makes the gate actionable).

**A build-surfaceable bar miss is recorded, not gated (V-302; the materiality threshold of §1).** Read the `MATERIALITY:` line alongside the verdict: a non-`sound` verdict must rest on a **material** failure — one the build cannot surface or self-correct. A bar item that "fails" only on a build-surfaceable omission (a missing render-input/prop on an otherwise-named seam, an under-specified-but-derivable detail — the things `/build` §4's own compile / type-check / implement step carries without a design decision) is a `build-surfaceable note` in REASONING and **stays `sound`**. So `BAR: … 5:fail …` with `MATERIALITY: build-surfaceable` is still verdict `sound` — the fail is noted, not gated. Only a material miss drives `wrong-approach` / `simpler-alternative` / `missing-seam`. This is what keeps the gate from firing on the enumeration nits that made it a token sink.

## 4. Write back + gate

**Write back first (observed-state, convention 8).** Append a dated `## Thesis-check` block to the build plan so the verdict is durable, greppable, and the surface `/go` (B3) reads for its gate-audit — do not let the verdict live only in the turn's output:

```markdown
## Thesis-check — <YYYY-MM-DD>
Verdict: <verdict>
Bar: 1:<pass|fail> … 7:<pass|fail>
Product: <P1:<pass|fail> P2:<pass|fail> P3:<pass|fail> — design-touching | n/a — not design-touching>
Materiality: <material | build-surfaceable | none>
Reasoning:
- <…>
Trigger: <…>   ·   Suggestion: <…>
```

(The `Product:` line is present for a design-touching ticket — carrying the P1–P3 product sub-bar result — and `n/a` otherwise; it does not change the `## Thesis-check` heading or the `Verdict:`/`Bar:` lines the readers (`/build` §3.5, `/go`'s gate-audit) match on.)

Append it with `Edit`/`Write` to `docs/plans/<id>-build.md` (inside the worktree — the bg-isolation guard permits `$WT_ABS/**` writes per convention 5). Stamp the date from `date +%F` in a Bash call (the harness has no clock in-model). **Appending is all `/thesis-check` does — it does not commit; committing this block is owned by `/build` §3.5 (V-226), which stages + commits the plan on the proceed branch so the verdict reaches the PR and the tree is clean for `/land-ticket` §7 teardown. Don't add a commit here too — that double-commits and breaks the single-owner contract (V-140).**

**Then gate on the verdict:**
- **`sound`** → no gate. Emit `result: /thesis-check <ID> — verdict sound (7/7 bar items pass); design is sufficient to build from. Next: /build.`
- **Non-`sound`** → this is a gate, not a note. STOP with the halt in the **convention-11 human-readable shape** — a `<TICKET-ID>: <goal>` restatement line on top, a legible verdict/reasoning line, then the `needs input:` line — never the bare verdict word:
  ```
  <TICKET-ID>: <one-line goal>
  Thesis-check verdict: <verdict> — <reasoning> (bar: <triggering item(s)>)
  needs input: the design did not pass the thesis-check. It can be resolved in-session — amend the `## Implementation design` and re-run `/thesis-check <ID>`, or re-scope (`/scope <ID>`); or build the design as-is despite the verdict, a deliberate override (`--force`). Reply with how to proceed.
  ```
  The **amend** and the **re-scope** are drivable in-session — by the agent or the human — producing a fresh design to re-check; the **build-despite ack** is the one deliberate override, kept explicit (`--force`; the human's under `/go`, never auto-injected). Do **not** auto-proceed to `/build` and do **not** rubber-stamp — the gate's whole value is that a non-`sound` verdict pauses the chain.

This stop mirrors `/scope`'s `needs-eyes` shape, so `/go` (B3) classifies it with the existing taxonomy (`commands/go.md` §1): an overridable validation stop `/go` treats as hard and never force-injects past. `/thesis-check` itself never injects an ack; the **build-despite ack** is the human's (via `--force`), while amending or re-scoping the design is drivable in-session by the agent or the human.

**On bounding the amend cycles — the filter bounds them, a counter must not (V-302).** The multi-round amend → re-check thrash this rung was criticised for was driven by **build-surfaceable** non-`sound`s — each amend round chased a missing enumeration item the build would have surfaced. The §1 materiality threshold removes that at its cause: those misses no longer gate, so the amend rounds they triggered never start. There is no machine re-check loop to "cap": `/build` §3.5 is idempotent (a present `## Thesis-check` block is never re-run), this skill runs once and gates, and a re-check happens only when the design is **deliberately amended and re-checked** — the human's call at the gate (the agent may perform the edit and re-run once directed), never an autonomous machine loop. So the bound on amend cycles is the materiality filter — **never a block-count that flips an honest verdict to `sound`**: a `sound` always rests on the reviewer's actual material reasoning (the hard rule below), never on "we've checked this N times." A *material* non-`sound` correctly stops for the human **every** time it stands — that is the rung working, not thrash. The one honest escalation for repeated human re-checks of a still-non-`sound` design lives in `/build` §3.5 as a **surfaced suggestion** ("re-checked N times — consider re-scope vs another amend"), which changes no verdict and no gate decision.

## 5. Worked example (the mechanism, demonstrated)

A representative (illustrative — the paths are hypothetical) design and the catch it earns — the in-repo proof (test-less repo: a worked example is the encoded-proof analog per `commands/scope.md` §3) that the check catches a real `missing-seam` before build.

**Ticket Goal:** Add a 60s in-memory cache to the Linear `get_issue` resolver so repeated lookups in one session don't re-hit the API.
**Acceptance:** (1) repeated `get_issue` for the same id within 60s returns the cached value; (2) **stale data is never served after the issue changes**; (3) cache is per-session, not cross-process.

**Implementation design (as written):**
- *Approach:* wrap `resolveIssue()` in a memoize keyed by issue id with a 60s TTL.
- *Affected seams/files:* `lib/linear/resolve-issue.ts` (the resolver), `lib/linear/cache.ts` (new TTL map).
- *Intended change shape:* new `cache.ts` exporting `getOrFetch(id, ttl, fetcher)`; `resolveIssue` calls it.
- *Alternatives considered:* a process-wide cache — rejected, violates Acceptance 3 (per-session).
- *Risks/premises:* none noted.

**Verdict block the check returns:**
```
VERDICT: missing-seam
BAR: 1:pass 2:pass 3:pass 4:pass 5:fail 6:fail 7:pass
TRIGGER: bar 5 (Acceptance 2 has no design path) + bar 6 (unprobed premise)
REASONING:
- bar 5: Acceptance item 2 ("stale data never served after the issue changes") maps to NO seam in the design — a TTL cache serves data up to 60s stale by construction, and there is no invalidation seam (no hook on the mutation path, e.g. save_issue, to evict). The design addresses items 1 and 3 but leaves item 2 unaddressed.
- bar 6: "Risks/premises: none" is itself the defect — the design rests on the unprobed premise that 60s-staleness satisfies "never served stale," which Acceptance 2 contradicts. A load-bearing premise was neither surfaced nor probed.
TRIGGER: bar 5, bar 6
SUGGESTION: amend-design — add the invalidation seam (evict on the save_issue path) or revise Acceptance 2's staleness contract before building.
```

The check stops with the convention-11 halt (§4) — the `<TICKET-ID>: <goal>` line, the verdict/reasoning, then the `needs input:` line — carrying this block's reasoning. Building straight from the original design would have shipped a cache that silently serves stale data and only "passed" because no test exercised the negative — exactly the class this rung exists to catch. (Mirror cases: a `wrong-approach` verdict when the chosen mechanism can't meet the Goal at all; a `simpler-alternative` when an existing in-repo helper already does the job the design hand-rolls.)

### Reconciled-collision example — `sound`, not a false `wrong-approach` (the V-190 catch)

The encoded proof (test-less repo — a worked example is the proof analog per `commands/scope.md` §3) that reading the parent plan's reconciliation record turns a would-be false `wrong-approach` into the correct `sound` — the CB-212 class this fix closes.

**Ticket Goal:** Have the worker propagate `pending_urls` *rights* columns to the mirror table.
**Acceptance:** the worker writes the rights columns on propagation.
**Implementation design (as written):** approach — extend `propagateRow()` to copy the three `rights_*` columns; seams — `worker/propagate.ts`, the mirror-table schema; change shape — add the columns to the copied projection; alternatives — a DB trigger, rejected (keeps logic in the worker); risks — none load-bearing.

The ticket spec says rights columns live on `pending_urls`; the **current schema** has them on a separate `url_rights` table — an apparent collision a naive reviewer flags as `wrong-approach` ("the design copies from a column that isn't on `pending_urls`"). **But the parent plan's `## Deviations` already reconciled it:**

> ### 2026-06-03 P2 — rights columns moved to `pending_urls`
> Planned: rights on a separate `url_rights` table. Did instead: folded the three `rights_*` columns onto `pending_urls`. Why: the join was hot on every propagate; co-locating removed it.

**Without the record** (pre-V-190): the reviewer reads spec-vs-schema in isolation, sees the collision, returns `wrong-approach` (bar 1/5) — a **false gate** on a build the project already agreed to. **With the record** (this fix): the reviewer is told the collision is reconciled — `pending_urls` *is* the agreed location — so it checks the design against the reconciled decision and returns:

```
VERDICT: sound
BAR: 1:pass 2:pass 3:pass 4:pass 5:pass 6:pass 7:pass
REASONING:
- bar 1/5: the apparent spec↔schema collision (rights on `url_rights` vs `pending_urls`) is reconciled in the parent plan's ## Deviations (2026-06-03 P2 — folded onto `pending_urls`); the design copies from the agreed location, so it serves the Acceptance. Not a wrong-approach.
TRIGGER: none
SUGGESTION: proceed-with-ack — sound; the collision was already resolved upstream.
```

The gate that would have falsely fired now passes — the reconciliation record is the difference between a false `wrong-approach` and the correct `sound`.

### Build-surfaceable-nit example — `sound` at cycle 1, not a multi-round amend (the V-302 catch)

The encoded proof (test-less repo — a worked example is the proof analog per `commands/scope.md` §3) that the materiality threshold (§1) keeps the check from gating on an omission `/build` would surface — the CB-340 class this fix closes (three `/go` amend rounds, each one uncarried render-input: preset/date → widgets → onClose).

**Ticket Goal:** Add a date-range preset bar to the existing `<DatePicker>` so a user can pick "Last 7 days" etc.
**Acceptance:** (1) the preset bar renders above the calendar; (2) selecting a preset sets the range and closes the picker.
**Implementation design (as written):** approach — add a `<PresetBar>` child to `DatePicker`, driven by a `presets` prop, calling the existing `onRangeChange`; seams — `components/DatePicker.tsx` (render the child + thread props), `components/PresetBar.tsx` (new); change shape — `PresetBar` maps `presets[]` to buttons, each calling `onRangeChange(range)`; alternatives — a standalone popover, rejected (duplicates the picker's positioning); risks — none load-bearing.

A reviewer hunting enumeration-completeness would note the design threads `presets` and `onRangeChange` but never names `onClose` (Acceptance 2's "closes the picker") in the prop list — a bar-5 "Acceptance 2 has no design path" objection. **That is the build-surfaceable nit the materiality threshold demotes:** `onClose` is an existing `DatePicker` prop on an already-named seam (`DatePicker.tsx` threads props to its child) — `/build` §4's implement step carries it the moment it wires the close, and tsc flags it if the prop is mis-typed. There is no *design* decision left open: the approach, the seams, and the mechanism (preset → `onRangeChange` + close) are all named. So the check returns:

```
VERDICT: sound
BAR: 1:pass 2:pass 3:pass 4:pass 5:pass 6:pass 7:pass
MATERIALITY: build-surfaceable
REASONING:
- bar 5: Acceptance 2 ("selecting a preset closes the picker") maps to the named `DatePicker.tsx` seam (it already threads props to its child) via the existing `onClose` prop — a build-surfaceable note, not a missing design path: /build wires the close and tsc checks the prop. No design decision is left open.
- bar 2/3/4/6/7: approach, both seams, change shape, the rejected alternative, and the (none) premises are all concrete and refutable.
TRIGGER: none
SUGGESTION: proceed-with-ack — sound; the unnamed `onClose` prop is a build-surfaceable detail, not a design flaw. Build it.
```

**Before the threshold** (the CB-340 behavior): the bar-5 "onClose unnamed" objection gates `missing-seam`, the human amends the design to name `onClose`, re-runs `/thesis-check`, which then notices `widgets` is also unenumerated, gates again — three rounds, each a build-time detail. **With the threshold:** the design is `sound` at the first check; the missing prop is a one-line build-surfaceable note, and `/build`'s implement step carries it. The contrast with the cache-invalidation example above is the whole point — *that* missing seam was **material** (no invalidation mechanism existed anywhere; a *design* decision was genuinely absent), so it correctly gated; *this* one is build-surfaceable, so it correctly does not.

### Product-quality example — the design fails on product, not architecture (the CB-335 / V-281 catch)

The encoded proof (test-less repo — a worked example is the proof analog per `commands/scope.md` §3) that the conditional product sub-bar (P1–P3) catches the CB-335 class — a design that is engineering-`sound` but a product reskin — before it is built. CB-335 shipped a "My Lists" feature engineering-correct but product-0/10; the thesis-check rang `sound` on the architecture because the seven-item bar never asks "is this a good product?". With `designDoctrine` configured and the ticket design-touching, the check now also sees the doctrine and the product sub-bar.

**Ticket Goal:** Let a user organise saved items into named lists ("My Lists"), surfaced in the app-shell LeftNav Folders zone (CB-314).
**Acceptance:** (1) a user can create a named list and add items to it; (2) lists appear in the LeftNav Folders zone; (3) a list opens to a reading surface showing its items.
**Carrier (written by `/scope` §3):** `Design-touching: yes — doctrine: PRODUCT.md, DESIGN.md`
**Implementation design (as written):** approach — a `MyLists` page with a textarea taking a comma-separated list of internal section IDs, persisted to a `lists` table; seams — `pages/MyLists.tsx` (new), `lists` table; change shape — the textarea's parsed IDs become a `lists` row; alternatives — a modal editor, rejected (more code); risks — none load-bearing. (Doctrine: `DESIGN.md` mandates the app-shell LeftNav for navigable collections + the design-system tokens; `PRODUCT.md` defines a list as a reading surface, not an ID editor.)

**Verdict block the check returns** (with the doctrine + P1–P3 in play):
```
VERDICT: wrong-approach
BAR: 1:pass 2:pass 3:pass 4:pass 5:fail 6:pass 7:pass
PRODUCT: P1:fail P2:fail P3:fail — design-touching
MATERIALITY: material
REASONING:
- P3 (→ wrong-approach): the textarea-of-internal-IDs is a backend-verification harness exposed as the UI, not the reading surface the Acceptance (item 3) + PRODUCT.md require. The mechanism can't become a usable product by iterating on it — it's the wrong approach to the surface.
- P2 (→ missing-seam): Acceptance 2 ("lists appear in the LeftNav Folders zone", CB-314) maps to NO seam — the design builds an isolated `MyLists.tsx` page beside the app shell and never integrates the existing LeftNav Folders zone. The established shell zone is the unaddressed integration point. (This is also bar 5: Acceptance 2 has no design path.)
- P1 (→ wrong-approach): the unstyled textarea ignores DESIGN.md's design-system tokens and the LeftNav navigation doctrine — the approach contradicts the configured product/design standard.
- bar 1/2/3/4/6/7: the *engineering* is sound — the approach is concrete, the seams (page + table) are named, the change shape is refutable, an alternative is weighed, no unprobed premise. This is exactly why the seven-item bar alone rang `sound`; the product sub-bar is what catches it.
TRIGGER: P1, P2, P3 (bar 5 via P2) — material product failure
SUGGESTION: amend-design — integrate the LeftNav Folders zone (CB-314) instead of an island page; replace the ID-textarea with the reading surface PRODUCT.md defines; apply DESIGN.md tokens. Re-scope if the surface needs its own design pass.
```

Building straight from the original design would have shipped exactly CB-335 — engineering-correct, product-0/10 — and "passed" because no item asked whether it was a good product. The product sub-bar makes the catch, mapping cleanly onto `wrong-approach` (P1/P3) + `missing-seam` (P2) with no new verdict word. For a non-design-touching ticket the doctrine is "none", P1–P3 are skipped, and this whole dimension is inert (the `~/.claude` repo, `designDoctrine: []`, never reaches it — its proof is this example, not a live firing).

## Hard rules

- Never changes Linear state and never edits source code — the only file it writes is the `## Thesis-check` block appended to the build plan (observed-state record). Design fixes are the human's / a re-run of `/scope`.
- Never edits `commands/go.md` (B3) or `commands/scope.md` / `commands/build.md` (B4). This skill is the check only; it exposes a gate for B3 to wire and reads the design B4 produces.
- Never rubber-stamps: a `sound` verdict requires all seven bar items to pass on the reviewer's actual reasoning, not a default. A non-`sound` verdict always gates — it is surfaced and paused on, never written as a silent note.
- Never fabricates the verdict or its reasoning — it comes from the adversarial subagent's actual returned block (convention 8); surface it whole.
- Stops always emit `result:` or `needs input:` on their own line. One ticket per invocation.
