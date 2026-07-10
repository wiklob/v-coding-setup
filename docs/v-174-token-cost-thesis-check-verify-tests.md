# V-174 — Why /thesis-check and /verify-tests "dominate" token usage

> Status: finding (decision doc) · 2026-06-06 · Ticket: V-174 · Read-only investigation over `~/.claude/projects/**` transcripts (652 sessions) + subagent sidechains (2074).

## TL;DR — the premise was mis-framed

The harness `/usage` breakdown attributes 12% to `/thesis-check` and 7% to `/verify-tests`. The investigation finds that **neither figure reflects expensive work intrinsic to those skills.** Three evidence-backed conclusions:

1. **Pipeline cost is dominated by `cache_read` — re-reading accumulated session context every turn — not by output generation.** Across all 652 sessions, `cache_read` is **76× output token volume** (10.67 B vs 140.6 M). Even at cache-read's ~10×-lower per-token price, that is a ~7–8× cost dominance. Cost concentrates in the long orchestrators: `/go` 25%, `/land-ticket` 20%, `/next-ticket` 10%, `/build` 8.5% of all cache-read.
2. **The `/thesis-check` Opus subagent — the part that "should" be expensive — is cheap.** 76 reviewer runs across 58 sessions: **193 K output total** (~2.5 K each), 17 M cache-read total (~223 K each), median **3** repo-greps. The "bad tickets → expensive thesis-check" hypothesis is **refuted**: a reviewer re-deriving missing context would grep heavily; it doesn't.
3. **`/verify-tests` has no green-path file-reading leak.** Of 22 cleanly-green runs, **2** touched a source file; green runs average **1 Bash call**, ~7.4 K output. The "~0 tokens on green" contract holds *for output*. The 7% is the **cache-read of the host session** (avg **1.25 M** per green run), which the skill's Hard Rules cannot govern.

**So the real lever is not "trim these two skills." It is: the whole pipeline pays a cache-read tax proportional to how much context a long session carries, and sub-skills inherit the full parent context.** `/thesis-check` and `/verify-tests` look expensive only because they execute *inside* a bloated `/go`/`/build` context (see §Reconciliation).

## Method & data

- **Sources:** every assistant message in `~/.claude/projects/**/*.jsonl` carries a per-message `usage` block (`output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`). Parent transcripts (652) attributed by the active-`<command-name>` cursor (the same mechanism `bin/usage-stats.mjs` uses); subagent spend read from the `*/subagents/agent-*.jsonl` sidechains (2074) — the seam `usage-stats.mjs --by-command` does **not** read (its `scan()` streams one primary file). Scripts: `tmp/analyze.mjs`, `tmp/analyze2.mjs` (this branch).
- **N:** `/thesis-check` reviewer subagent — 76 runs / 58 sessions (N≥10 ✓). `/verify-tests` — 96 execution windows, 22 cleanly-green + 6 red/skip (N≥10 ✓).
- **Cost metric:** token *volumes* (output, cache-read, cache-create), not dollars — the harness `/usage` percentage basis is not observable from transcripts. The cache-read dominance is robust to the exact metric (it leads by 76× in volume; even price-weighted it leads ~7–8×).

### Per-command attribution (transcript output + cache-read, all-time)

| Command | Output (M) | Cache-read (B) | % of all cache-read |
|---|---|---|---|
| /go | 19.9 | 2.63 | 24.7% |
| /land-ticket | 14.5 | 2.11 | 19.8% |
| /next-ticket | 13.1 | 1.08 | 10.2% |
| /build | 25.4 | 0.90 | 8.5% |
| (uncommanded) | 30.4 | 0.71 | 6.7% |
| /scope | 7.1 | 0.23 | 2.1% |
| **/thesis-check** | **0.06** | **0.014** | **0.1%** |
| **/verify-tests** | folds into parent (sub-skill, no `<command-name>` tag) | — | — |

The four-bucket split the ticket requested (own-context-load / MCP / subagent / triage), for the two subjects:

- **/thesis-check** (per run): own-context-load = the parent reads the plan + `ticket-flow.json` (a few Read/Bash); MCP = ~1 `get_issue`; **subagent = the Opus red-team, ~2.5 K output / ~220 K cache-read** (cheap); triage = none. Dominant cost = **cache-read of the inherited parent context**, not any of these buckets.
- **/verify-tests** (per green run): own-context-load = `git diff --name-only` + 1 Bash test invocation; MCP = 0; subagent = rare; triage = red path only (6/96 windows). Dominant cost = **cache-read of the inherited parent context** (~1.25 M/run), output ~7.4 K.

## Finding 2 — /thesis-check: intrinsic, modest, not amplified by bad tickets

- **Panel firing rate:** the 3-agent panel fired in **14 of 58 sessions (24%)** — moderate, not constant. Most runs are a single reviewer.
- **Repo-grep frequency:** median **3** greps per reviewer (distribution 0–8). This is the *designed* premise-verification ("you may grep to check premises"), not desperate context re-derivation. A badly-scoped ticket forcing the reviewer to rebuild context would show a heavy-grep tail; it doesn't.
- **Per-run cost:** ~2.5 K output, ~220 K cache-read. **Intrinsic and stable** — the Opus red-team's floor, and a low one.
- **Verdict on the hypothesis:** *refuted with data.* The subagent is not where the 12% lives, and ticket scope quality does not visibly inflate it.

## Finding 3 — /verify-tests: the "~0 on green" contract holds for output; the 7% is cache-read inheritance

- **22 cleanly-green runs:** avg **7.4 K** output, avg **1.25 M** cache-read, avg 10 assistant msgs, and only **2** runs read any source file. Green runs do essentially one `Bash` call (run the suite) and emit a `result:` line — exactly as designed.
- **No Hard-Rules leak of significance:** the forbidden "read files/diffs on green" is near-absent (2/22).
- **The specific cause of the 7%:** **context-inheritance cache-read**, not a leak and not frequent triage. `/verify-tests` runs late inside a `/build`/`/go` session that has already accumulated the plan, the code reads, conventions, and craft — every one of the skill's ~10 turns re-reads that whole context at cache-read price. The skill body governs *output* (don't read files); it cannot govern the cache-read of the session it is embedded in.
- (68 of 96 windows were verdict-undetermined by the heuristic — window ran past the 40-msg cap or phrased the result differently — so they are excluded from the green/red rates rather than guessed. The 22 clean-green sample is the reliable signal.)

## Reconciliation — why the harness shows 12% / 7% while transcript attribution shows ~0

*(Inference, clearly labelled — the harness's `/usage` attribution algorithm is not observable from transcripts.)* The harness bills a turn to the **innermost active skill frame**: when `/build` invokes `Skill(thesis-check)` or `Skill(verify-tests)`, the turns during that sub-skill are billed to the sub-skill. My transcript method instead has no `<command-name>` tag for a `Skill`-invoked sub-skill, so it bills those same turns to the **parent** (`/build`/`/go`). Both views are consistent under that model, and they agree on the substance: the tokens are **cache-read of the large inherited context**, billed to whichever frame is on top. This is also why the ticket's table shows `/build` and `/land-ticket` at ~1% (their work is mostly delegated to sub-skills or runs as uncommanded implementation turns) while my attribution shows them as cache-read giants. And **`linear` MCP at 39%** fits the same model: verbose Linear results sit in context and are re-read at cache-read price on every later turn of a long session — a cache-read cost, not a call-time cost.

## Recommendations (ranked by leverage)

**Cross-cutting (the real win — attacks the 76× cache-read tax):**

1. **Don't make sub-skills inherit the full parent context.** `/thesis-check` already runs its reasoning in a cheap subagent; the expensive part is the *parent* orchestration turns carrying the whole `/go`+`/build` context. Running the sub-skill's glue in a slimmer frame (or, for `/verify-tests`, as a detached check that sees only the diff) collapses most of the 12%+7%. *Rough saving: most of ~19% of skill-attributed usage.* **Dovetails with V-182 (typed /go paths):** a research ticket that skips thesis-check/verify outright removes the inherited-context tax for that whole ticket class.
2. **Shrink resident context in long sessions.** The orchestrators (`/go`, `/land-ticket`, `/next-ticket`) carry 10.67 B cache-read between them. Evict/summarize after use: full file reads, full plan text, and especially **verbose Linear MCP results (the 39%)** — summarize a `get_issue`/`list_issues` result to the fields actually needed, drop the raw JSON from context. *Rough saving: the single largest pool.*
3. **Route the cheap rungs to a cheaper model.** A green `/verify-tests` run generates ~7.4 K output running one Bash call + a summary — no Opus needed (Haiku/Sonnet). Leave the `/thesis-check` *subagent* on Opus (adversarial reasoning, and it's already cheap). *Rough saving: output cost of the verify rung; modest, but free.*

**/thesis-check specific:**
4. Do **not** invest in "tighten ticket scope to make thesis-check cheaper" — refuted by the grep data (it isn't the cost). The panel (24% of runs) multiplies an already-cheap subagent; gating it harder is low-leverage.

**/verify-tests specific:**
5. **Doc honesty fix:** reword the "pass case costs ~0 Claude tokens" claim (`commands/verify-tests.md:9,15-21,163`) to "~0 *output* tokens on green; the cache-read of the host session still applies." The current wording implies a green run is free, which hides the real cost and sent this very ticket hunting a non-existent leak.

## Limitations

- Output-token attribution for `Skill`-invoked sub-skills folds into the parent (no `<command-name>` tag); the sidechain read recovers subagent spend but not the parent-frame split — hence the harness-vs-transcript reconciliation is inference, not observation.
- The `/usage` percentage basis (cost vs tokens) is unknown; conclusions are stated in token volumes.
- 68/96 verify-tests windows were verdict-undetermined and excluded rather than guessed.
