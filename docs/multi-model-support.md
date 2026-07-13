# Multi-model support — swap the model, keep the pipeline

> Status: Decision doc · 2026-07-13

## The premise

Everything this pipeline depends on is **harness-side**: skills, hook contracts, the
permission engine, the guards, transcripts, the launchd runners invoking `claude -p`.
None of it knows which model is answering. Claude Code natively runs any Claude
model; through a **Claude-API-compatible proxy** (e.g.
[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)) that serves the
Anthropic Messages surface and routes foreign model ids to their providers, it runs
non-Anthropic models too. The pipeline inherits that for free — the safety layer
included, since deny rules, ask gates, and `guard-secret-access.py` are enforced by
the harness on tool calls regardless of the model behind them.

## The mechanism: `bin/claude-via` + `model-routes.json`

`claude-via` is the generalized "model alias": it resolves a named route, composes
the env, and execs `claude --model …`.

```bash
claude-via sol                 # launch the "sol" route
claude-via sol --continue      # extra args pass through to claude
claude-via claude-fable-5      # no route needed for Anthropic-native ids
claude-via --list
```

Routes live in `~/.claude/model-routes.json` (seed from
`model-routes.example.json`). A route names the `model`, an optional `baseUrl`
(→ `ANTHROPIC_BASE_URL`, i.e. the proxy), an optional `subagentModel`, and extra
`env` knobs applied verbatim.

Two defaults are deliberate:

- **Subagents follow the route model.** `CLAUDE_CODE_SUBAGENT_MODEL` defaults to the
  route's `model` — a proxied session whose subagents defaulted elsewhere would send
  a foreign model id straight to Anthropic and fail.
- **Tokens never live in the routes file.** The proxy credential is
  `ANTHROPIC_AUTH_TOKEN`, exported via `~/.claude/.envrc` (direnv) like every other
  credential in this setup — settings and config files hold rules, not secrets. A
  tokenless local proxy needs nothing.

## The posture step (convention 12)

Swapping the model mechanically is the easy half. The pipeline's gates and rails are
calibrated **per model** through `pipeline/profiles/` — that's where multi-model
support becomes real. When you add a route, author
`pipeline/profiles/<model>.md` (copy the nearest profile, re-derive each knob per
`pipeline/profiles/README.md`). Until you do, sessions self-select the conservative
default (`opus-4-8.md` — more rails, never fewer); `claude-via` reminds you at
launch, but never blocks.

## Honest caveats

- **Mechanical ≠ behavioral.** The 46 skills are convention-dense prose written
  against Claude's instruction-following. A different model runs the machinery but
  may honor the constitution differently — validate empirically (the same loop as
  `craft/governance.md`: feedback hits and review findings, not vibes) before
  trusting a foreign model with the autonomous rituals.
- **Terms of service.** Routing subscription-authenticated providers through a
  third-party proxy is gray territory with some providers — know where you stand
  before building on it.
- **The proxy is yours.** This repo ships the integration, not the proxy: any
  endpoint that speaks the Anthropic Messages API works; CLIProxyAPI is one
  well-known option, not a dependency.
