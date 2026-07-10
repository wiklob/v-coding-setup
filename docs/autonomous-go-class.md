# Finding: the autonomous `/go` class — headless runs that feed self-review

> Status: finding for V-266 (SI: autonomous /go class — headless runs that feed self-review; project "Self-improvement loops — feedback, schedule & report review"). Knowledge deliverable (route:research). Depends-on now discharged: **V-234 (R4)** repaired all four scorecard lenses so a land populates them; **V-257 (W2)** made a post-deploy residue auto-file a monitoring ticket instead of blocking the merge gate. Both dependencies are load-bearing to this finding's mechanism (see Recommendation).

## Question

Define the class of `/go` runs that can execute **end-to-end with no human at the gates** and still **feed the self-review loop** — i.e. every gate the run will hit is either auto-resolvable on a deterministic default (A) or safely deferrable to a monitoring ticket (B), never genuinely human-required (C); the run reaches merge headless; and its results land in the self-review sinks (`gate-audit.md` + the four scorecard lenses) so the pipeline learns from the run at zero human cost.

Three sub-questions, one per Acceptance item:
1. **Criteria** — what precondition set on a ticket/run guarantees zero (C) gates?
2. **Headless execution** — how does `/go` run such a ticket with no human present?
3. **Sink population** — do the self-review sinks actually get written by a fully-headless run?

## Candidate approaches

**A — A fifth `route:autonomous` label / execution route.** *Rejected.* The `route:*` taxonomy classifies by **deliverable** (`build|fast|fix-bug|research` — `docs/research-route-path-design.md`, `craft/planning.md`); autonomy is an orthogonal, cross-cutting property of *route × diff-shape × depth × env*, not a sixth deliverable type. A `route:autonomous` label would collide with the existing route on every ticket and re-introduce the "second routing surface" the research route explicitly absorbed (`research-route-path-design.md` §"Why not"). Autonomy is a **posture over a run**, not a route.

**B — A per-run `--autonomous` posture on `/go`, gated by a two-tier eligibility check.** *Recommended.* A static **candidacy filter** (pre-run, from ticket metadata + config) selects likely-clean runs; a mid-run **fail-closed safety net** converts any (C) gate that surfaces into an *abort-and-log* (or, for a post-deploy-only residue, a V-257 monitoring spin-out), never a silent auto-`p` past it. Extends the pipeline's existing headless idiom (`claude -p "/cmd --yes"` under launchd) rather than inventing a new one.

**C — Reuse the existing `--yes` gate-skip semantics unchanged on `/go`.** *Rejected as unsafe alone.* The pipeline's `--yes` consumers (`/daily-plan`, `/harvest-feedback`) deliberately **never auto-act on an irreversible/judgment gate** — `--yes` skips *confirm* gates but craft/security/thesis judgment is still never auto-resolved unattended (`harvest-feedback.md:15,63,104`). A blanket `--yes` bolted onto `/go` would blow past a §4.6 security HIGH, a non-`sound` thesis-check, or an unbuilt migration — exactly the (C) gates that must *halt*. Autonomy needs the **eligibility guarantee** (approach B), not a gate-skip. (`--yes`-style skipping *is* correct for the (A) gates once eligibility holds — so C is a component of B, not a substitute.)

## Relevant standards

The pipeline already has a **headless-execution idiom** and the conventions that bound it — this finding extends them, it does not invent a mechanism:

- **`claude -p "/cmd --yes"` under a launchd LaunchAgent** is the established unattended-run pattern (`daily-plan.md:2,16`, `harvest-feedback.md:9,63`). `claude --bg` does not exist; headless = `claude -p`, single-shot, scriptable (`pipeline/roadmap.md:93`).
- **Background/dispatched sessions auto-deny any tool call that would prompt** (`roadmap.md:94`, V-4) — so a headless run that *reaches* a human gate does not "wait", it **auto-denies and stalls dead**. This is the hard constraint: the eligibility criteria must guarantee the run reaches **no** prompting gate, or the run stalls with nothing merged.
- **Convention 11 (gate mechanism)** — three gate kinds: confirm (`p`-able), ack (`[HARD STOP]`, un-`p`-able), run-ending hard stop. Autonomy may only ever auto-resolve a **confirm gate on its empty-input default**; ack + hard stops are model-independent and never auto-passable (`workflow-conventions.md:271-289`).
- **Convention 12 (model profile)** — `autonomy` is a *posture knob*; profiles may **never** relax "hard gates on destructive/irreversible/outward-facing actions" (`workflow-conventions.md:300`). The autonomous class lives *within* that floor: it does not lower any gate, it only selects runs that never raise a (C) one.
- **Convention 9 + the V-257 verify-the-fix/monitoring spin-out** — a post-deploy-only outcome is *tracked as a follow-up ticket*, not rubber-stamped at the gate (`workflow-conventions.md:247-257`). This is precisely what makes class (B) possible.
- **Convention 8 (observed over asserted)** — never route-relaxable; an autonomous run's fail-closed abort must log the *observed* halt, never a fabricated success.
- **`/go` hard rules** — never `p` past a hard stop, never inject `--force`, never carry a security-HIGH waiver or manual-test residue in `p` (`go.md` §"Hard rules"). The autonomous posture inherits every one of these unchanged.

## Recommendation

**Define the autonomous `/go` class as a two-tier posture (approach B), invoked as `claude -p "/go <id> --autonomous"`.** The class is the set of runs for which the static filter admits the ticket *and* the mid-run net never trips a (C) gate. Both tiers are needed because the empirical record shows the decisive (C) triggers — non-`sound` thesis-check (48/112 forced halts), scope premise-false / needs-eyes (21/112), a diff that unexpectedly yields a migration or a security HIGH — are **only discoverable mid-run**, not from ticket metadata.

### Tier 1 — static candidacy filter (pre-run, from ticket + config)

Admit a ticket to a headless dispatch iff **all** hold (each is checkable before the run starts):

1. **`--architect` not set** — the architect stage blocks on `AskUserQuestion` and stalls headless (`go.md` §0).
2. **route ∈ {`fast`, `research`}** — the two routes whose gate surface is minimized/collapsed. (route `build`+`skip` *can* qualify but carries the full mid-run thesis-check/verify risk, so treat it as opt-in, not default; route `fix-bug` is excluded — its can't-reproduce close gate is a conditional (C), `go.md` §1.)
3. **`depth-class` ≠ `deep`** — a deep ticket renders `/build §3.5`'s un-`p`-able pre-code architecture ack-gate (V-325, `build.md:90-96`).
4. **No `migration`- or `invariant`-kind Acceptance item declared**, and **no sensitive-path keyword** in the ticket (`\b(auth|migration|crypto|rbac|security|oauth|jwt|session|token|…)\b`, `next-ticket.md:138`) — pre-screens the diff-shape that draws the §4.8 / §4.6 hard gates.
5. **Clean env** — In Progress, worktree clean, no orphan-recoverable crash state, no leftover ticket-named branch, valid binding (`go.md` §1 `/next-ticket` inventory).
6. **Not blocked pre-run** — not a milestone-mode ticket lacking a milestone (~6 historical forced halts: CB-257/279/281/289/362/394), not a parked / "run via /plan not /go" ticket, no duplicate open PR already implementing an Acceptance item (detectable by a PR search on the ticket's reports, cf. V-135).

### Tier 2 — mid-run fail-closed safety net

The static filter is a *hit-rate optimizer*, not a guarantee — so the run carries a **fail-closed** rule for any gate that surfaces mid-run:

- **(A) confirm gate on an empty-input default** → auto-resolve on the stated default (the `p` default): `/land §5` approve-proceeding and `/land §6.7` merge, when the diff has no migration, the security scanner is non-sensitive / surfaces no HIGH, and the §4.9 **check-now** residue is empty. Empirically these are rubber-stamps: `land §5` = **161 p'd / 0 forced** across 332 runs; a docs/config-only, no-migration, no-user-visible-surface diff crosses every gate on `p`.
- **(B) post-deploy-only §4.9 residue** → **do not block**: V-257's §6.7 auto-files a `verify-the-fix` monitoring ticket (`monitor-key`-deduped) and proceeds (`land-ticket.md:300-304`, `workflow-conventions.md:247-257`). This is the *only* non-empty gate input that keeps a run headless-eligible.
- **(C) any genuinely human-required gate** — non-`sound` thesis-check, scope `needs-eyes`, a §4.6 HIGH, an unbuilt migration, a **check-now** §4.9 residue (taste/wording/current real-world/UI/runtime), a verify failure, infra, a live-system-mutation `ask` → **abort headless; never auto-`p`, never `--force`.** Fail-closed means: flush the ledger's `forced` line to `gate-audit.md` (so the self-review loop still learns the gate fired), leave the ticket In Progress for a human, and exit. A stall (auto-deny) is *worse* than an explicit logged abort — the abort is observable in the friction map; the stall looks like a hung job.

### How the three Acceptance items are met

1. **Criteria defined** — the Tier-1 predicate + Tier-2 net above. The load-bearing empirical reframing: **eligibility is diff-shape-gated, not gate-gated.** The moment a diff touches a user-visible runtime surface (UI, ingest, auth, DB migration), `/land §6.7` stops being a rubber-stamp — that is exactly where the **61 §6.7 interventions** and the live-caught bugs live (header/token/scroll-restore/reset-CTA bugs, several spawning follow-up tickets). So the canonical autonomous ticket is a **docs/config/pipeline-markdown ticket with no product-runtime surface and no migration** (the V-133/V-119/V-120 shape) — historically a 0% forced rate at §5 and near-zero at §6.7.

2. **`/go` can run them headless** — via `claude -p "/go <id> --autonomous"`, reusing the proven `claude -p --yes` launchd mechanism (`daily-plan`/`harvest-feedback`). Feasibility is established by construction: a Tier-1-admitted run whose diff is docs/config-only hits only (A) gates, each auto-resolving on its empty-input default; the `auto-deny-on-prompt` constraint (`roadmap.md:94`) is satisfied because the eligibility guarantee means no prompting gate is ever reached. Any surprise (C) aborts cleanly rather than stalling.

3. **Results land in the self-review sinks** — this is the subtle one, and the reason V-266 was **blocked by V-234**. The three §8.6 lenses (`errors.jsonl` via session-review `--emit`, `tool-fit.jsonl`, `produced-review.jsonl`) are written **after the §7 merge**, i.e. *downstream of the §6.7 merge gate* (`land-ticket.md:462-479`). A headless run that stalls at §6.7 never merges and never reaches §8.6 — so **sink population is only achievable for a run whose merge auto-resolves**, which is exactly the autonomous class. When the class holds: §6.7 auto-p → §7 merges → §8.6 auto-fires all three lenses (unconditional-per-land after V-234), and `/go` §6 flushes `gate-audit.md` itself (via `bin/log-gate-audit.mjs`, independent of human presence). Result: **all four scorecard lenses + the gate-audit friction map populate headless.** `feedback.jsonl` is intentionally *not* populated — it is the human's subjective front door (`report-feedback.md`), and a headless run has no subjective impression to report; that is correct, not a gap.

   Even a **Tier-2 abort** feeds the loop: `/go` §6 flushes on a forced halt too, so the `forced` line still lands in `gate-audit.md`. The autonomous class is therefore a **net positive contributor to self-review regardless of outcome** — a completed run populates all four lenses; an aborted run enriches the friction map with a real forced-halt datapoint.

### Why the dependencies were load-bearing (validates the ticket's own blockedBy)

- **V-234 (R4)** — before it, three of four lenses were dead (`tool-fit.jsonl`/`produced-review.jsonl` empty, session-review `session:null` un-joinable). Without it, an autonomous run's merge would populate *nothing useful*, defeating Acceptance #3. V-234 made §8.6 write all four sinks unconditionally-per-land — the precondition for "results land in the sinks."
- **V-257 (W2)** — before it, a post-deploy-only residue *blocked* the §6.7 gate (a human rubber-stamping an un-verifiable-yet outcome). That is a (C) gate that would make otherwise-clean runs ineligible. V-257 reclassified it to (B) — auto-file-and-proceed — which is what lets a run with a legitimate post-deploy monitoring need still run headless.

### Follow-up (implementation is a separate build ticket)

This finding **defines** the class and **proves feasibility by construction** (the mechanism, gate taxonomy, and sink wiring all exist today). The `--autonomous` flag itself is a code/skill change — out of scope for a research deliverable — and is recommended as a follow-up build ticket:

- **`/go --autonomous` posture + the Tier-1 candidacy filter + the Tier-2 fail-closed net** (a `go.md` edit + a small pre-dispatch checker, `bin/autonomous-eligible.mjs`-shaped, reading ticket metadata). Acceptance: the filter admits a V-133-shaped ticket and rejects a deep/migration/sensitive one; a mid-run (C) gate aborts-and-logs rather than stalls; a completed headless run populates all four lenses + gate-audit.
- Optional second slice: a **launchd/`/schedule` dispatcher** that periodically picks the top Tier-1-eligible ticket from a designated bucket and runs `claude -p "/go <id> --autonomous"` — the "runs feed self-review continuously" end-state the parent project envisions.

---

## Appendix — empirical backbone

From `pipeline/audit/gate-audit.md` (332 `/go` run blocks, 1,372 gate lines; 305 `p'd` · 159 `intervened` · 112 `forced`; 101 runs all-`p'd`):

| Gate | p'd | intervened | forced | human-load | class |
|---|--:|--:|--:|--:|---|
| `land §5` approve-proceeding | 161 | 40 | 0 | 20% (info-gathering→yes) | **A** on clean diff |
| `land §6.7` manual-test / merge | 138 | 61 | 7 | 33% (the load-bearing gate) | **A** iff no user-visible surface |
| thesis-check (verdict) | 159 sound (no-touch) | 21 amend→sound | 48 non-sound halt | 100% when non-sound | **C** if non-sound |
| `scope §3` needs-eyes / premise | 0 | 7 | 18 | 100% | **C** |
| `next-ticket` env/premise | 3 | 10 | 17 | ~90% | **C** (pre-screenable) |
| `build §5` verify | 0 | 3 | 4 | 100% | **C** |
| `land §4.6` security HIGH | 0 | 2 | 0 | 100% | **C** |

- **Forced-halt taxonomy (112):** design/thesis 48 · scope 21 · land 21 · next-ticket 17 · build 5. Mostly **mid-run-discoverable** (non-sound thesis, premise-false, verify failure) → *why Tier 2 is required*. A pre-run-detectable subset (milestone-no-milestone, parked, foreign-stop worktree, duplicate open PR) → *what Tier 1 screens*. Infra (Netlify build-quota outage) accounts for 11 of 18 land-stage forced lines — pure infra, not code, and unpredictable.
- **`p'd`-vs-diff correlation:** of 162 pure-`p'd` `land §5` crossings, **122 cite "no migration / DB none / markdown-only"** — no DB push is the single strongest correlate of a clean approve. The all-`p'd` shape: docs/markdown/no-migration diff · no conflict · security non-sensitive/NONE · no needs-eyes · review clean · no manual-test residue. Canonical instances: V-133, V-119, V-120 — pipeline-doc/config-only standalone-bucket tickets touching no product runtime surface.

## Appendix — self-review sink population under a headless run

| Sink | Writer / when | Headless-populated? |
|---|---|---|
| `gate-audit.md` | `/go` §4/§6 via `log-gate-audit.mjs`, at run end (completion **or** forced halt) | **Yes** — the only sink `/go` writes itself; fires on abort too |
| `errors.jsonl` | `/land §8.6(a)` session-review `--emit` (post-merge; conditional on findings) | **Yes iff merge auto-resolves** (the autonomous-class guarantee) |
| `tool-fit.jsonl` | `/land §8.6(b)` `/tool-fit`, unconditional-per-land (post-merge) | **Yes iff merge auto-resolves** |
| `produced-review.jsonl` | `/land §8.6(b)` `/review-produced`, unconditional-per-land (needs merged PR) | **Yes iff merge auto-resolves** |
| `feedback.jsonl` | `/report-feedback` only (human) | **No — by design**; no automated writer exists, and a headless run has no subjective impression |

Consumers: `/scorecard` reads all four lenses + gate-audit; `/periodic-review` consumes `scorecard --aggregate` + `produced-review.jsonl`; `/harvest-pipeline-bugs` reads `errors.jsonl`; `/harvest-feedback` reads `feedback.jsonl`. So a completed autonomous run feeds the entire measurement loop except the human-only feedback front door.
