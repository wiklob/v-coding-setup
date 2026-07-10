# Model profiles — one pipeline, per-model posture

The pipeline's procedures are model-independent; its **trust posture** is not. Every gate, ritual, and rail in this repo was originally calibrated to one model generation's failure modes — and a rail that compensates for a weakness one model has degrades the output of a model that doesn't have it (Anthropic, *Prompting Claude Fable 5*: "Skills developed for prior models are often too prescriptive… and can degrade output quality"). Profiles separate the two: commands carry the procedure and the model-independent core; the active profile carries the posture.

## Selection

At the start of any multi-step pipeline skill (convention 12 makes this part of the read-first substrate):

1. Identify the model family you are running as — you know your own model identity.
2. Read the matching profile: `fable-5*` → `fable-5.md` · `opus-4-8` / other Opus 4.x → `opus-4-8.md`.
3. **No match, or unsure → `opus-4-8.md`** (the conservative default: more rails, never fewer).

A subagent uses the profile its dispatching prompt names; if none is named, it applies the same self-identification rule.

## What a profile owns — the named knobs

Commands reference these knobs by name instead of hard-coding one model's posture:

| Knob | The question it answers | Referenced by |
|---|---|---|
| `design-check` | When does the design→build boundary get an adversarial `/thesis-check` (fresh subagent) vs a recorded self-check? | `/build` §3.5 |
| `scope-plan-depth` | Which build-plan sections does `/scope` write beyond the always-required contract? | `/scope` §6 |
| `research-depth` | How deep does `/plan` research before decomposing — and who decides (planner's own call vs recommend-then-gate)? | `/plan` §3 (`/plan-quick` §1 is always own-call — no live user) |
| `re-grounding` | Are planning-time findings re-verified against current code before implementing? | `/build`, plan Discipline sections |
| `autonomy` | Posture prose: when to act vs ask, narration level, overplanning vs underplanning correction | all chain commands |
| `review` | Review-prompt shape (fresh-context is core; filtering posture is per-model) | `/review-pr`, `/land-ticket` §4.5–4.6 |

## What a profile may NOT touch — the model-independent core

These hold under every profile, because they guard against failure modes that persist across model generations (fabricated "verified" claims survived into Fable 5 per its own system card) or against losses no model quality can undo:

- **Hard gates on destructive / irreversible / outward-facing actions**: merge, migration apply, `db push`, worktree/branch teardown, external publishing, live-system mutations, security-HIGH waivers (the `waive HIGH:` token discipline), the manual-test residue rules.
- **Real scope changes stop**: a broken ticket premise, a structurally-wrong Acceptance item, a `needs-eyes` validation verdict — these are scope decisions only the human can make.
- **Input only the human can provide** stops the turn (convention 11 `needs input:` prose, never a modal).
- **The evidence layer**: observed-state over asserted-state (convention 8), artifact-kind acceptance reconciliation, empirical premise probes, never-fabricate-identifiers, never-swallow-error-bodies, `errors.jsonl`/review sinks.
- **Fresh-context review beats self-critique** — for every current model, per Anthropic's own Fable 5 guidance.

## Maintenance

A profile is a living compensation list: when a model behavior changes (new release, new findings), edit the profile — not the commands. Evidence for adding/removing a rail follows the same loop as craft files (`craft/governance.md`): feedback hits and review findings, not vibes. When a new model family arrives, copy the nearest profile and re-derive each knob from its release guidance before first use.
