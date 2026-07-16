# Verified 1M context for the routed `gpt-5.6-sol` model

> Status: finding (decision doc) · 2026-07-16 · Ticket: V-383

## Question

GPT-5.6 Sol advertises a 1.05M-token API window, but behind an LLM gateway Claude
Code cannot infer a foreign model's capacity and budgets the routed `gpt-5.6-sol`
session at 200K. Can the pipeline safely run `gpt-5.6-sol` with the 1M window, and
what is the *authoritative* evidence for each link in the chain — the `[1m]`
suffix, the client budget, and the actual upstream route — as opposed to
documentation or a UI display that could be wrong for this route?

## Candidate approaches

- **Trust OpenAI's advertised 1.05M window and flip the model on.** Rejected: the
  advertised number is an *API* capability. The session here does not reach the
  OpenAI API directly — it goes through `claude-model-router` to a CLIProxy
  endpoint authenticated by a **Codex/ChatGPT OAuth subscription**, whose
  per-request context ceiling OpenAI does not document. API capability ≠
  subscription-route capacity; conflating them is exactly the unverified leap the
  ticket forbids.
- **Trust the `/context` display / an env var.** Rejected as *sole* evidence
  (ticket acceptance): a display or `CLAUDE_CODE_*` variable reports intent, not
  what the upstream accepted. A 200K route with a 1M-looking display would pass
  this bar while truncating real requests.
- **Prove each link empirically, record provenance, gate the default on the
  proof.** Chosen. Three independent observations, each stored as non-secret
  evidence, with the canonical metadata carrying its own provenance and the
  extended default refusing to turn on until a route is verified past 200K.

## Relevant standards

**Topic:** machine-readable model capability + route-verification metadata.
**Industry standard(s):** [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12)
for the versioned contract. No established standard unifies model capability,
route-specific empirical verification, and provenance, so the registry is
purpose-built.
**Candidates:**
- [OpenRouter models API](https://openrouter.ai/docs/api/api-reference/models/get-models)
  — **adapt**: its split between a model's general context and a provider
  endpoint's context maps onto our capability-vs-route split; we add provenance
  and a verification status it lacks.
- [LiteLLM model registry](https://github.com/BerriAI/litellm) — **adapt naming
  only** (`max_input_tokens`/`max_output_tokens`); its global cost map is far
  larger than needed and treats provider docs as ground truth.
- [OpenAI Models API object](https://platform.openai.com/docs/api-reference/models/object)
  — **do not use as a capacity source**: it exposes identity/ownership, not
  context-window size, so CLIProxy's `/v1/models` catalog cannot stand in for
  capacity evidence.

## Recommendation

Enable extended (1M) context for `gpt-5.6-sol` **by default**, because all three
links are now empirically verified (below). Represent the capacity, the route,
and the provenance in `models/custom-models.json` (validated by
`bin/custom-model-metadata.mjs`), and keep a one-command/one-session fallback to
the plain window. The extended default is gated in code: the validator refuses
`preferredContextMode: "extended"` unless a route carries a `verified`
context-verification backed by matching evidence.

## Evidence (Claude Code 2.1.204 → `gpt-5.6-sol` via CLIProxy / Codex OAuth)

Raw, non-secret results are committed at
`models/evidence/gpt-5.6-sol.codex-oauth.json`.

| Link | Claim | How it was proven | Result |
|---|---|---|---|
| 1. Suffix stripping | Claude Code strips `[1m]` before the request leaves the client | `probe-custom-model-context.mjs capture` — a disposable loopback Anthropic-API server received the request; the wire `model` field was inspected | Requested `gpt-5.6-sol[1m]` → **wire id `gpt-5.6-sol`** (suffix gone). Matches the documented behavior: "Claude Code strips the suffix before sending the model ID to your provider." |
| 2. Client budget | The `[1m]` session is budgeted at 1M, not 200K | `claude --print --output-format json` → `modelUsage["gpt-5.6-sol[1m]"].contextWindow` (programmatic, **not** the `/context` display) | **`contextWindow: 1000000`** |
| 3. Route acceptance | The Codex OAuth / CLIProxy route accepts a single request past the 200K gateway floor | `probe-custom-model-context.mjs live` — deterministic filler prompt, sentinel reply, returned usage read back | **336,494 input tokens** accepted, sentinel returned, no truncation/context-length error |

Link 3 also settles Link 2 end-to-end: a 200K-budgeted client would auto-compact
the input *before* sending, so the upstream could never report 336K input tokens
in one turn. The route both budgeted and delivered the extended window.

### API limits vs. Codex OAuth/subscription limits

- **OpenAI API (authoritative for the model):** `gpt-5.6-sol` — 1,050,000 input /
  128,000 output tokens ([OpenAI model docs](https://developers.openai.com/api/docs/models/gpt-5.6-sol)).
  This describes the API-key route; it is recorded as the model's `capabilities`
  with `provider-documentation` provenance.
- **Codex OAuth / ChatGPT subscription (the route actually used):** OpenAI
  documents plan-based *usage allowances* that scale with task/context/session
  size, but **no** numeric per-request context ceiling
  ([Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)).
  The route's usable window is therefore established **only** by the live probe —
  a proven lower bound of 336,494 tokens, not the advertised 1.05M. The registry
  records this as the route's `verifiedInputTokensAtLeast`, kept distinct from the
  model's advertised capability.

## Compaction & the usable threshold

- **Provider-advertised window:** 1,050,000 input tokens (OpenAI, the API route).
- **Claude Code client budget for the `[1m]` session:** 1,000,000 tokens
  (observed `contextWindow`).
- **Expected usable before auto-compaction:** ~967,000 tokens — Claude Code's
  documented default for the 1M window ("auto-compact before the window fills, at
  about 967K tokens by default"), configurable via
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW`
  ([model-config docs](https://code.claude.com/docs/en/model-config#extended-context)).
  This is a **documented** default (harness-documentation provenance in the
  metadata), not a per-route measurement; the verified route floor is the
  336,494-token empirical figure above.
- Prompt, tools, system instructions, cache blocks, thinking, and reserved output
  all consume the window. Switching to the plain `gpt-5.6-sol` mid-conversation
  can trigger immediate compaction if the conversation already exceeds 200K.

## Reproduce

```bash
# 1. suffix-strip proof (hermetic; no provider contacted)
node bin/probe-custom-model-context.mjs capture --model gpt-5.6-sol

# 2. client budget (programmatic contextWindow)
printf 'Reply with only: SENTINEL383' | \
  claude --print --no-session-persistence --output-format json --tools "" \
    --model 'gpt-5.6-sol[1m]' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).modelUsage))'

# 3. >200K route acceptance (uses the real subscription route)
node bin/probe-custom-model-context.mjs live --model gpt-5.6-sol --min-input-tokens 200001

# validate the registry gate
node bin/custom-model-metadata.mjs validate
```

## Fallback

If the extended route ever rejects or truncates, drop to the plain window without
touching any global default:

```bash
claude --model 'gpt-5.6-sol'     # one command, new session
/model gpt-5.6-sol               # mid-session, current conversation
```

The fallback is session-scoped by construction (`fallback.scope: "session"` in the
registry); it never rewrites `~/.claude/settings.json`.

## Why not `/context` alone

The `/context` display renders the same `contextWindow` value proven
programmatically in Link 2, but the ticket (rightly) forbids relying on it — or on
`CLAUDE_CODE_*` env vars — as the sole signal. A display can report a window the
route won't honor. The load-bearing proof is Link 3: the upstream *accepted* 336K
input tokens. The interactive `/context` panel is a secondary confirmation of the
same number and was not scriptable in this environment (its TUI does not accept
piped keystrokes); the programmatic `modelUsage.contextWindow` is the authoritative
capture.
