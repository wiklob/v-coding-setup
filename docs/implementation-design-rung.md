# Implementation-design rung — spec + home decision

> Type: Decision doc (records *why* + the artifact spec) · Status: **adopted as spec** in V-82 (project: *Implementation-plan rung — design + thesis-check before /build*) · Consumers: V-83 (B2, adversarial thesis-check), V-84 (B3, /go honors the gate), V-85 (B4, /build reads + follows the design).

## Why this rung exists

`/plan` produces the *what* (ConOps / outcome). `/scope` validates *fit* against current code at build time. Nothing in between produces a **critiqued *how*** — the approach, the seams it touches, the intended change shape — that is adversarially questioned **before** code. With a human driving, the human was that rung. `/go` removed the human and there was nothing underneath, so the chain can execute a wrong thesis without ever questioning it (seed: `errors.jsonl` entry 29, "no technical implementation plan stage").

This doc specs the **implementation-design artifact** (the critiqued *how*), decides **where it lives** in the chain, and defines the **bar B2 (V-83) gates against**. It is spec only — the skill wiring is B4/B3.

---

## 1. The artifact + its required fields

The **implementation design** is the per-ticket statement of *how* a ticket will be built, rich enough to be attacked before any code is written. Required fields:

1. **Approach** — the implementation strategy: which mechanism/seams change and *why this way*. Must name the concrete change, **not restate the goal**. ("Retrofit `site-url.ts`'s `requestUrl()` call sites to read from the new env helper" — not "make URLs correct".)
2. **Affected seams/files** — the concrete integration points the change touches, **named**: files, functions, call sites, schema objects, config keys. A *seam* is where the change meets existing code — the place a wrong approach actually breaks. No "the relevant module"; name it.
3. **Intended change shape** — what the change looks like concretely (add a section here, new helper there, retrofit these N call sites, this migration), specific enough that a reviewer can **refute** it ("that won't work because X is client-imported"). This is the thesis the adversarial check attacks.
4. **Alternatives considered** — **≥1** alternative approach and *why it was rejected*. This is what makes the design *critique-able* rather than a single unexamined path; a design with no alternative considered has not been designed, only asserted.
5. **Risks / unverified premises** — constraints the design must honor, and **any current-system property the design rests on** (a security baseline, "X is the only writer", a provider toggle's behavior). Each such premise is either self-evidently true or carries a probe/citation that confirms it (V-26 / V-17 / convention 8 discipline). An unprobed load-bearing premise is a defect, not a design.

### Location (where the artifact lives)

**The artifact is a first-class `## Implementation design` section inside the per-ticket build plan `docs/plans/<id>-build.md`** — i.e. it *extends `/scope`* (see §2). For tickets `/next-ticket`'s gate routed to *skip* (no `/scope` plan), the same five fields appear in **lightweight inline form** in `/build` §3's inline plan. Either way, every ticket reaching `/build` carries a design, satisfying the project's Validation invariant without a separate always-on command.

---

## 2. Home decision — extend `/scope`, not a new rung

**Decision (adopted): extend `/scope`'s build-plan with a first-class `## Implementation design` section, with a lightweight inline variant in `/build` §3 for skip-gate tickets. A standalone always-on rung is rejected.**

### Options weighed

- **A — Extend `/scope` (chosen).** Add `## Implementation design` (the five fields) to the build-plan schema in `commands/scope.md` §6; `/build` already reads `docs/plans/<id>-build.md` (§1/§2) and follows it; `/go` §5 already drives `/scope`→`/build`. The adversarial check (B2) gates on this section.
- **B — New rung (rejected).** A dedicated `/design` command between `/scope` and `/build`.

### Rationale

- **Extend reuses existing seams; a new rung adds them.** `/scope` already emits `## Approach` / `## Implementation steps` / `## Risks / gotchas` — a *partial, uncritiqued* design. The gap is not "no *how* exists" but "the *how* is never structured as a first-class, alternatives-bearing design **and** never adversarially critiqued." Extending closes that gap on the artifact `/build` already consumes; B4/B3 wire into seams that already exist.
- **A new rung duplicates `/scope`'s context-load.** A `/design` command would re-read ticket + parent plan + affected files — the work `/scope` just did — for marginal separation.
- **A new rung taxes the trivial ticket the skip-gate protects.** `/next-ticket`'s scope-necessity gate exists to keep simple tickets cheap; an always-on design command re-imposes ceremony on exactly those, and adds chain + gate surface for `/go` to classify, drive, and instrument.
- **The universal invariant is preserved without a rung.** Scope-gate tickets get the rich `## Implementation design`; skip-gate tickets get the lightweight inline form in `/build` §3. B2's thesis-check has a design to gate on in both paths — so "no ticket reaches `/build` without a critiqued design" holds.

### Consequences (for B3/B4 — not done here)

- **B4 (V-85)** adds the `## Implementation design` schema to `commands/scope.md` §6 and the lightweight inline form to `commands/build.md` §3, and makes `/build` read + follow it.
- **B3 (V-84)** makes `/go` honor the B2 thesis-check as a gate (classified per `commands/go.md` §1) and instrument it.
- **B2 (V-83)** is the adversarial check that gates a design against the §3 bar before `/build` proceeds — realized as `commands/thesis-check.md`.

---

## 3. The bar — "design sufficient to build from"

A design **passes** (is sufficient to build from, and survives B2's adversarial check) only when **all** hold. B2 (V-83) evaluates a design against exactly this list:

1. **Approach is concrete, not a goal restatement** — it names the mechanism/change, distinguishable from the ticket's Goal sentence.
2. **Every affected seam/file is named** — no "the relevant module"; a reviewer can open each named seam.
3. **Intended change shape is refutable** — specific enough that a reviewer could say "that breaks because X." A shape no one could disagree with is too vague to have been designed.
4. **≥1 alternative considered, with why-not** — the chosen approach is shown to have beaten at least one other.
5. **Every Acceptance item has a design path** — each item maps to a named seam + change; no Acceptance item is left unaddressed by the design.
6. **No unverified load-bearing premise** — every current-system property the design rests on (security baseline, "only writer", provider-toggle behavior) is obvious or carries a probe/citation (V-26 / V-17 / convention 8). An unprobed premise fails the bar.
7. **The thesis is stated explicitly enough to attack** — the design names *the* approach as a claim ("we will do X because Y"), so the adversarial question "is this the right approach?" has a concrete target. A design that hedges across approaches gives B2 nothing to refute and fails.

A design that misses any item is **not** sufficient: B2 returns it for revision (or, where the miss reveals the ticket's premise is wrong, routes to re-scope / a prerequisite ticket — the wrong-approach/missing-seam catch the project's Validation measures).

### Conditional product sub-bar — design-touching tickets only (P1–P3; V-281)

The seven items above validate **engineering** sufficiency. They do not ask whether the design is a good *product* — which is how the CB-335 class slips through: the architecture rang `sound` while the surface was an un-integrated, unstyled reskin (internal IDs exposed as the input, the existing app-shell zone never wired, doctrine ignored). So a **design-touching** ticket — one whose `## Implementation design` carries a `Design-touching: yes — doctrine: <paths>` line (written by `/scope` §3 / `/build` §3 when `designDoctrine` is configured and the ticket touches a user-facing surface) — additionally clears three product items, evaluated against the cited doctrine:

P1. **Doctrine honored** — the design honors the configured product/design doctrine (the `designDoctrine` docs); it does not ignore or contradict a stated product/UX standard.
P2. **Existing shells/zones integrated** — the design integrates the existing app shells/zones the surface belongs in (the established nav / layout / containers), rather than building an isolated island or a parallel surface beside them.
P3. **Full surface, not a reskin/harness** — the design delivers the full end-user surface the Acceptance implies (the actual usable feature), not a minimal reskin or a backend-verification harness with internal mechanics exposed as the UI.

A design-touching design that fails P1–P3 is returned via the **existing verdict vocabulary** — no new verdict word: a doctrine/UX-wrong approach (P1/P3) is `wrong-approach`; an un-integrated existing shell/zone (P2) is `missing-seam`. P1–P3 apply **only** when the carrier line is present; for an engineering-only ticket they are N/A and the seven-item bar stands alone. The materiality threshold (the 2026-06-24 addendum) governs P1–P3 exactly as it governs the seven — a *material* product flaw (a real reskin, a genuinely un-integrated zone) gates; a build-surfaceable cosmetic detail is a note, not a gate.

---

## Relationship to existing conventions

- **Convention 1 (plan before action):** the implementation design is the *technical* layer beneath the plan's Manifest — the Manifest says which parts ship; the design says *how* each part is built and survives critique first.
- **Convention 8 (observed over asserted) / V-26 / V-17:** field 5 + bar item 6 carry the empirical-premise discipline into design time — a security/current-system premise is probed, not asserted.
- **Prior art:** the field set mirrors an **ADR** (context · decision · alternatives · consequences) plus **RFC**-style "approach + affected components + change shape"; B2's pass is a standard **design-review / pre-mortem / red-team** ("is this the right approach? which seam is unaddressed? what breaks?").

---

## Addendum — 2026-06-04: the "both paths" invariant is a rollout, not yet reality (V-84 / V-138)

§2's rationale (above) asserts "**B2's thesis-check has a design to gate on in both paths**." B3 (V-84)'s own thesis-check caught that this is the *intended end-state*, not what the chain does today — and the gap is real, not pedantic:

- **Scope-gate path** — gated now. `/scope` writes the first-class `## Implementation design`; B3 (V-84) wires `/go` to run `/thesis-check` against it before `/build`, and a non-`sound` verdict is a hard stop.
- **Skip-gate path** — design exists, **critique does not yet**. The lightweight inline design lives in `/build §3` (per §1), so it doesn't exist until `/build` runs — there is nothing for `/go` to thesis-check before `/build`. So a skip-gate ticket still reaches `/build`'s implement step with an *uncritiqued* design.

The critique is **owed** on this path too (the project's Validation says *adversarial* check, and a trivial ticket can still carry a wrong thesis — the same "nothing underneath" risk the project closes). Its correct home is **`/build` itself**, self-invoking `/thesis-check` on the §3 inline design before §4 implements, so it fires for any driver (`/go` or a human) — not bolted onto `/go` (which would duplicate `/build`'s §3 logic) and not B3's to add (`thesis-check.md` hard rules forbid B3 editing `build.md`).

Tracked as **V-138** (B5). Until V-138 lands, "both paths" holds only for the scope-gate path; this addendum records the rollout state so the §2 claim is not read as already-true. (Append-only per convention 6 — §2's original text is left intact above; this is the correction of record.)

## Addendum — 2026-06-05: "both paths" now holds in practice (V-138 landed)

V-138 (B5) landed the skip-gate critique, so the rollout above is complete and §2's "**B2's thesis-check has a design to gate on in both paths**" (line 43) is now true of the running chain, not just the intended end-state:

- **Skip-gate path — gated now.** `commands/build.md` §3 materializes its lightweight inline `## Implementation design` into `docs/plans/<id>-build.md`, self-invokes `/thesis-check <ID>` against it **before** §4 writes any code, and gates a non-`sound` verdict as a `needs input:` stop (the ack is the human's). It is intrinsic to `/build`, so it fires for every driver — `/go`-driven or a human running `/build` directly — not bolted onto `/go`. The verdict lands in the plan file's `## Thesis-check` block (the record `/go`'s gate-audit reconciles) and surfaces in `/build` §7's hand-off, the same way the scope-gate path records its design-stage outcome (V-84).
- **Scope-gate path — unchanged**, gated upstream as recorded in the 2026-06-04 addendum.

Both paths now reach `/build`'s implement step only with a design that has passed the adversarial "is this the right approach?" check — closing the "nothing underneath" gap the project exists to close, for trivial and non-trivial tickets alike. (Append-only per convention 6; the 2026-06-04 addendum above is left intact as the rollout's record.)

## Addendum — 2026-06-05: single-owner trigger — `/build` owns the thesis-check on both paths, `/go` step 4 retired (V-140)

V-138 (above) made `/build` §3 self-invoke `/thesis-check` on the **skip-gate** path, but the trigger remained split three ways — skip-gate fired inside `/build`; scope-gate-via-`/go` fired in `/go` step 4; scope-gate-via-a-*direct*-`/build` (a human running `/scope` then `/build`, no `/go`) auto-fired **nowhere**. Two firing sites are a drift surface, and one path had no auto-fire at all.

V-140 unifies this to **single ownership in `/build`**:

- **`/build` is the one owner of the design→build thesis-check, for every path and driver.** `commands/build.md` §3.5 (new) fires `/thesis-check` whenever the build plan lacks a `## Thesis-check` block — on **both** the scope-gate and skip-gate paths. V-138's skip-gate critique (formerly inside §3, which is skipped when a `/scope` plan exists) is generalized: its invoke+gate moved out of the skip-gate-only §3 into the path-agnostic §3.5, which runs just before §4 on every path. §3 keeps only its skip-gate job — materializing the inline design to the plan file so §3.5 has a design to check.
- **Idempotent.** A present `## Thesis-check` block (a human ran `/thesis-check` manually, or a prior `/build` run wrote it) is **not** re-run; §3.5 reads the latest block's verdict and honors it. A non-`sound` verdict still gates before any code is written, for any driver; the ack is the human's via `--force`.
- **`/go` step 4's separate invocation is retired.** `commands/go.md` no longer reads `thesis-check.md` and executes it between `/scope` and `/build`. `/go` still classifies/logs the gate — a non-`sound` verdict reaches it as a `/build` hard stop (logged `forced`) — and still records the design-stage outcome in its gate-audit, now by reading the verdict from the plan's `## Thesis-check` block after `/build` rather than from its own invocation.

Net: one trigger keyed on the durable `## Thesis-check` block, covering every path and driver; the boundary semantics ("no ticket reaches `/build`'s implement step with an uncritiqued design") are unchanged, with no double-run and no path left uncovered. (Append-only per convention 6; the prior addenda above are left intact.)

## Addendum — 2026-06-24: materiality threshold — a non-`sound` verdict requires a *material* failure (V-302)

§3 (above) says "A design that misses any item is **not** sufficient: B2 returns it for revision" (line 65). In practice that read literally made the thesis-check **one of the pipeline's biggest token sinks** (feedback.jsonl 2026-06-23): a bar-2 or bar-5 "fail" on a build-surfaceable omission — a missing render-input/prop in an enumeration, an under-named-but-derivable detail that `/build`'s own compile / type-check / implement step would surface and carry anyway — gated a non-`sound`, costing a human amend → re-`/thesis-check` round for a non-design defect. CB-340 ran three such rounds (preset/date → widgets → onClose), each one uncarried render-input.

V-302 refines line 65 with a **materiality threshold** (the bar list itself is **unchanged** — the refinement governs *verdict emission*, not the definition of a sufficient design):

- A failed bar item drives a non-`sound` verdict **only when the failure is *material*** — a thing the build cannot surface or self-correct: a wrong approach, a missing **integration seam** (a real unaddressed place the change meets existing code, not a missing field in a list), an Acceptance item with **no mechanism at all**, a real regression, or an **unprobed load-bearing premise**.
- A **build-surfaceable** miss — one `/build` §4's compile / type-check / implement step would catch and carry **without a design decision** — is recorded as a `build-surfaceable note` in the verdict's REASONING and does **not** lower the verdict below `sound`. So `BAR: … 5:fail …` with `MATERIALITY: build-surfaceable` is still `sound`.

The test is "can the build catch and carry this without a *design* decision?" — yes → note, not gate. This bounds the amend cycles **at their cause** (the build-surfaceable non-`sound`s that drove the rounds no longer fire), without any cycle counter: there is no machine re-check loop to cap (`/build` §3.5 is idempotent; a re-check is a human deliberately re-running `/thesis-check`), and a counter that flipped an honest verdict to `sound` was rejected as a fabrication of the verdict (convention 8). The residual case — a *material* flaw a human re-checks several times — gets an honest **surfaced suggestion** in `/build` §3.5 ("re-checked N times — consider re-scope vs another amend"), which changes no verdict.

Realized in `commands/thesis-check.md` §1 (the threshold), §2 (reviewer `Discipline:` + `MATERIALITY:` return line), §3 (build-surfaceable miss recorded not gated), §4 (the filter bounds the thrash, a counter must not), §5 (the build-surfaceable-nit worked example), and the `/build` §3.5 escalation note. The §3 bar list and the seven-item definition of a sufficient design are untouched. (Append-only per convention 6; the prior addenda above are left intact.)

## Addendum — 2026-06-24: conditional product sub-bar — the rung can fail on product quality, not only engineering (V-281)

The seven-item §3 bar validates **engineering** sufficiency only. CB-335 (feedback.jsonl #33) exposed the gap: a ticket shipped engineering-correct but product-0/10 (internal section IDs as a comma-separated input, the existing app-shell LeftNav Folders zone never integrated, an unstyled reskin ignoring the product/design doctrine) — and the thesis-check rang **`sound` on the architecture while the product was a reskin**. The rung had nothing that asked "is this a good *product*?"

V-281 adds a **conditional product sub-bar (P1–P3)** to §3 (above) — doctrine honored · existing shells/zones integrated · full surface (not a reskin / backend-verification harness) — that applies **only** to a **design-touching** ticket (one whose `## Implementation design` carries a `Design-touching: yes — doctrine: <paths>` line). The design is route-orthogonal — a **dimension**, not a 5th route (a design ticket still scopes → thesis-checks → builds → lands, so its chain shape is `build`'s; the need is an added validation lens, not a new chain) — and **config-driven**: a repo opts in by setting `designDoctrine` (paths to its `PRODUCT.md` / `DESIGN.md`-class docs) in `ticket-flow.json`; a repo with no user-facing surface omits it (or sets `[]`) and the whole gate is a graceful no-op (the `~/.claude` pipeline repo itself sets `[]`).

Key design decisions (and why):
- **No new verdict word.** CB-335's failures map onto the existing vocabulary — an un-integrated existing zone is `missing-seam`, a doctrine/UX-wrong approach is `wrong-approach` — so P1–P3 reuse them, sparing every verdict consumer (`go.md` gate-audit, `build.md` §3.5, `thesis-check.md` §3) an edit.
- **The signal rides inside `## Implementation design`.** `/thesis-check` §0 already reads that section, so folding the `Design-touching:` carrier there (rather than a separate `## Product validation` block §0 never reads) is what actually wires the doctrine + signal to the §2 reviewer — the seam an earlier design of this ticket missed (its own thesis-check caught it: `missing-seam`).
- **One persistence, copied not referenced.** The signal is persisted once (the carrier), and P1–P3 are **copied** into `thesis-check.md` §1 the same way the seven are (the check is self-contained — §2 feeds the bar inline to the subagent), not given a bespoke reference idiom.

Realized in `.claude/ticket-flow.json` + `commands/ticket-flow-init.md` (the `designDoctrine` config), `commands/scope.md` §1/§3/§6 and `commands/build.md` §3 (detect-and-carry), §3 above + `commands/thesis-check.md` §0/§1/§2/§5 (the sub-bar + its wiring + the CB-335 worked example), and `commands/go.md` (surface the fact). The proof for this test-less, UI-less repo is the CB-335 worked example in `thesis-check.md` §5 (the encoded-proof analog per `scope.md` §3), not a live firing here. (Append-only per convention 6; the prior addenda above are left intact.)
