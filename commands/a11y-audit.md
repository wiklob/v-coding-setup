---
description: WCAG 2.2 AA accessibility audit of a built UI or component diff — emits a per-criterion findings table (Pass/Fail/Needs-review/NA) with evidence, never auto-fixes. Runs standalone or composes into /review-design as its accessibility lens. Reach for it when a ticket touches user-facing UI and you need to know whether it clears WCAG 2.2 AA before it lands.
argument-hint: "<url | built path | component diff>  [--level A|AA (default AA)]  [--lens] (compose into /review-design — suppress own preamble/save prompt)"
allowed-tools: Bash, Read, Grep, Glob, WebFetch
---

# /a11y-audit — WCAG 2.2 AA findings on a built UI, evidence-backed, fix-free

Accessibility is one dimension of design conformance, not a separate project. This lens audits a built UI (a URL, a built path, or a component diff) against WCAG 2.2 AA and emits **findings** — a per-criterion verdict with the evidence behind it — so a reviewer or /review-design can decide. It does not edit code: an a11y fix is a code change with its own acceptance, so this prints findings and stops (the same propose-don't-write discipline /review-pr and /review-claude-md hold).

It earns its keep two ways: **standalone**, when a ticket is UI-heavy enough to want a focused a11y pass; and **as a lens**, called by /review-design with `--lens` so it folds into the design-conformance verdict instead of printing its own report. Keep it lean — it is one axis of design review, so depth lives in on-demand references, not in this body.

Read `~/.claude/workflow-conventions.md` first (the procedure substrate — how this stays inspectable and honest), then `~/.claude/craft/README.md` (the judgment register — the bar a finding is held to). The one craft move that matters here: **report from what you observed, not what you meant** (craft/judgment.md). An a11y finding is a negative claim — "this fails 1.4.3" — and a negative claim needs a probe behind it (the contrast ratio, the missing label in the a11y tree), never an impression. Where evidence is missing, the honest verdict is Needs-review, not a guessed Pass or Fail.

## Why a four-state verdict, not pass/fail

A criterion can be **Pass** (probed, meets it), **Fail** (probed, violates it), **Needs-review** (not mechanically decidable — needs a human or AT check), or **NA** (no applicable content on the page). Collapsing the middle two into a binary is the failure mode: it either fabricates a Pass for something never checked, or floods Fail with heuristics that have a WCAG exception. The middle state is where automation honestly stops — treat it as the manual-review queue, never as noise.

## Procedure

### 1. Resolve the target and scope
- Target is a URL, a built local path, or a component diff (the changed surface from the ticket). For a diff, scope the audit to the changed components, not the whole app.
- Level defaults to WCAG 2.2 AA; `--level A` narrows it.
- Name the limits up front, because they shape every verdict: screen-reader / AT×browser compatibility is out of scope (no AT here), and dynamic runtime behavior is only checked if a browser driver is available (below).

### 2. Mechanical checks (broad coverage first)
- The cheapest broad pass is axe-core, which covers contrast (1.4.3, 1.4.11), names/roles (4.1.2), `lang` (3.1.1), link/label names (2.4.4, 3.3.2), and more in one run. If an axe-core runner is available (see *Tooling* — it is an optional dependency, not assumed), run it and read its `violations` as Fail candidates and its `incomplete` results as Needs-review items.
- Without a runner, fall back to reading the built HTML / a11y-tree snapshot with Read/Grep/WebFetch and judge only what the static markup shows — narrower, and every dynamic criterion drops to Needs-review.
- Map findings to success criteria using `references/criteria-map.md` (which static signal proves or fails which criterion, and the fail rule for each).

### 3. Interactive checks (only where a driver exists)
- Keyboard access, focus visibility (2.4.7/2.4.11), focus order (2.4.3), keyboard trap (2.1.2), reflow (1.4.10), target size (2.5.5/2.5.8) need a live browser. If a Playwright/axe driver is present, run them; if not, mark each affected criterion **Needs-review** rather than guessing. See `references/interactive-checks.md`.

### 4. Manual-judgment items
- Some criteria are not mechanically decidable at all — sensory-only instructions (1.3.3), color-as-sole-cue (1.4.1), media alternatives (1.2.x), timing (2.2.x). List them from `references/manual-checks.md` as Needs-review with the specific thing a human must confirm. Fold in any evidence the user already provided.

### 5. Emit findings
- Standalone: print the report from `references/output-format.md` — a scope/limits header, a per-criterion table (Criterion · Level · Result · Evidence · Rationale), and an issues summary (Severity · Criterion · Location · Recommendation). Print-only; offer to save only if asked.
- `--lens`: suppress the preamble and save prompt; return just the per-criterion table plus the issues summary, for /review-design to merge into its verdict.
- Every Fail cites its evidence — the measured ratio, the CSS selector, the unnamed element from the a11y tree. Every Needs-review names what is still unverified. No verdict without its basis (craft/judgment.md — a negative claim needs a probe).

## Tooling note (optional, not assumed)
The upstream skill ships a Playwright/axe-core CLI (`@a11y-skills/audit`, MIT) that automates the mechanical and interactive checks above and emits an axe-style JSON envelope (`violations` = Fail candidates, `incomplete` = Needs-review). It is a real dependency (Node 18+, a browser download) — so this skill treats it as **optional**: present → richer coverage; absent → static-markup fallback with more Needs-review. Wiring that CLI into the pipeline (vendoring vs. `npx`) is a separate decision, not a precondition for running this lens. Never auto-install it inside a review.

## Hard rules
- **Findings, not fixes.** This lens never edits code; an a11y fix carries its own acceptance and lands as its own change.
- **Needs-review over a guess.** A criterion that can't be probed in the current environment is Needs-review with the gap named — never a fabricated Pass or a heuristic Fail (craft/judgment.md).
- **Every Fail cites a probe** — ratio, selector, a11y-tree node — not an impression (convention 8).
- **Print-only by default**; composes into /review-design under `--lens`. Convention 4: on exit, name the next step — the fix ticket(s) the Fails imply, or /review-design if this ran as a lens.

## References (progressive disclosure — loaded on demand, authored when this skill is installed)
- `references/criteria-map.md` — static/mechanical signal → success criterion, with the fail rule per criterion (adapted from upstream `automated-checks.md`).
- `references/interactive-checks.md` — the browser-driver checks and their criteria.
- `references/manual-checks.md` — non-mechanical criteria and what a human must confirm for each.
- `references/output-format.md` — the report + per-criterion table template.
