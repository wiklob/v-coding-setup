# Multi-model support — swap the model, keep the pipeline

> Status: Decision doc · 2026-07-13 · reworked 2026-07-14 (launcher superseded by the router)

## The premise

Everything this pipeline depends on is **harness-side**: skills, hook contracts, the
permission engine, the guards, transcripts, the launchd runners invoking `claude -p`.
None of it knows which model is answering. Claude Code natively runs any Claude
model; through a **Claude-API-compatible proxy** (e.g.
[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)) that serves the
Anthropic Messages surface and routes foreign model ids to their providers, it runs
non-Anthropic models too. The pipeline inherits that for free — the safety layer
included, since deny rules, ask gates, and `guard-sensitive-access.py` are enforced by
the harness on tool calls regardless of the model behind them.

## The mechanism: claude-model-router

Routing lives in a standalone sibling tool —
[claude-model-router](https://github.com/wiklob/claude-model-router)
(npm: `@wiklob/claude-model-router`). It is a tiny loopback daemon speaking the
Anthropic API surface: it peeks at each request's `model` id and forwards the
original bytes to the upstream serving it. `claude-*` (and anything unmatched)
passes through to `api.anthropic.com` with the caller's auth untouched; foreign ids
go to the translating proxy named in its routes. Routing only — the hard,
churn-prone API translation stays the proxy's job.

```bash
npm install -g @wiklob/claude-model-router
model-router install-launchd      # KeepAlive daemon on localhost:8399
```

Point every session at it once, in `~/.claude/settings.json`:

```json
"env": { "ANTHROPIC_BASE_URL": "http://localhost:8399" }
```

(A loopback URL is a pointer, not a secret — it commits cleanly; credentials never
go in the `env` block.) Model choice is then **per-conversation, from any
launcher** — terminal, agents view, background jobs: `claude --model <id>` at
launch, or `/model <id>` mid-session; the very next request routes accordingly.
Subagents inherit the conversation's model. Routes hot-reload from
`~/.config/claude-model-router/config.json`; a foreign id whose proxy isn't
running fails fast with a `502` while Claude traffic is unaffected.

Because every request resolves at the router, a foreign model id can *structurally*
never be sent to Anthropic — regardless of what spawned the session.

History: the first-generation mechanism here was `bin/claude-via`, a launcher that
composed `ANTHROPIC_BASE_URL` per session at exec time. Terminal-only and
launch-time-only — the router made it redundant and it was removed (2026-07-14).

## The posture step (convention 12)

Swapping the model mechanically is the easy half. The pipeline's gates and rails are
calibrated **per model** through `pipeline/profiles/` — that's where multi-model
support becomes real. When you route a new model, author
`pipeline/profiles/<model>.md` (copy the nearest profile, re-derive each knob per
`pipeline/profiles/README.md`). Until you do, sessions self-select the conservative
default (`opus-4-8.md` — more rails, never fewer). Nothing warns you at launch;
authoring the profile is on you when you add a route. For pipeline sessions, switch
the model *before* the opening skill (`/model <id>`, then `/go …`) so the posture
self-identification runs as the model that will do the work.

## Honest caveats

- **Mechanical ≠ behavioral.** The 46 skills are convention-dense prose written
  against Claude's instruction-following. A different model runs the machinery but
  may honor the constitution differently — validate empirically (the same loop as
  `craft/governance.md`: feedback hits and review findings, not vibes) before
  trusting a foreign model with the autonomous rituals.
- **The router is on-path for everything.** Once `ANTHROPIC_BASE_URL` points at it,
  every session depends on the daemon. It is deliberately a near-zero-failure-surface
  byte-forwarder under launchd KeepAlive; the escape hatch is deleting the `env`
  line (new sessions go direct again).
- **Terms of service.** Routing subscription-authenticated providers through a
  third-party proxy is gray territory with some providers — know where you stand
  before building on it.
- **The proxy is yours.** This setup ships the routing, not the translation: any
  endpoint that speaks the Anthropic Messages API works; CLIProxyAPI is one
  well-known option, not a dependency.
