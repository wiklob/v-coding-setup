---
description: Prior-art & industry-standards recon for a net-new solution — find the relevant standard(s) and existing implementations (libraries, OSS, reference architectures), then make an explicit import / adapt / build-fresh call per candidate, with cited sources. Build-time, focused; reuses /deep-research for depth. Output lands in /scope's build plan.
argument-hint: "<solution / topic to research>  (e.g. \"rate limiter for the API\", \"OAuth PKCE callback\")"
allowed-tools: WebSearch, WebFetch, Read, Grep, Agent, Skill
---

# /research — prior-art & industry-standards recon, before/within /scope

For any **completely new solution**, research industry standards and existing implementations we can **import or base off** *before* building — so we don't reinvent. Produces a **prior-art brief**: the relevant standard(s), candidate existing implementations, and an explicit **import / adapt / build-fresh** call per candidate, all with cited sources.

Sits at the component-design rung — before or within `/scope`:

```
/plan (Stack Decision may call) → /next-ticket → [/research →] /scope → /build → /land-ticket
```

Read `~/.claude/workflow-conventions.md` first.

## Wiring decision (settled)

`/research` is a **dedicated command** that `/scope` **auto-invokes** for net-new work (not logic buried only inside `/scope`). Three callers, one engine:

- **Standalone** — a human runs `/research <topic>` directly to scout a space before planning or scoping.
- **From `/scope` §5** — auto-invoked (as a subagent, to keep `/scope`'s context clean) for any Acceptance item touching a net-new solution; the returned brief is pasted into the build plan's `## Prior art & standards` section.
- **From `/plan` §5** — called during Stack Decision when a net-new dependency/seam is in play, so the import/adapt/build-fresh evidence informs the stack pick.

## Trigger — "completely new solution"

Fire when **any** holds:
- No existing in-repo pattern to follow (grep first — see §1).
- A new dependency / library / external service is in play.
- A novel capability, protocol, algorithm, or security/crypto surface.
- Anything `/plan`'s Stack Decision flagged as new.

**Skip** for routine changes that follow an existing in-repo pattern — there the established code *is* the prior art. When auto-invoked by `/scope`, this skip is the same gate `/scope` §5 keys off; state the skip + the in-repo pattern you're following instead, and return without a brief.

## 1. Scope the recon (cheap, local-first)

- Take the topic from `$ARGUMENTS` (a caller passes the specific solution, not the whole ticket — `/research` is focused, one solution at a time).
- **Check the repo first.** Grep for an existing pattern that already solves this (`Grep`/`Glob` for similar features, helpers, deps in lockfile/`package.json`). If one exists → this isn't net-new; print the in-repo precedent and skip per the Trigger rule.
- Otherwise, frame 2–4 concrete questions: what is the accepted standard / best practice here? what are the established implementations? what are their tradeoffs for our context?
- **The §2 source-read inherits this same gate.** It runs only on the net-new path, only for a named external candidate repo, and only after the "check the repo first" grep has *not* found an in-repo pattern — so a routine pattern-following ticket short-circuits to skip before any clone happens. Reading external source is never itself the trigger; it's a deeper look at a candidate the net-new gate already admitted.

## 2. Research — web-first, depth on demand

- **Default: WebSearch + WebFetch** directly — locate the standard(s)/spec and the candidate implementations, fetch the authoritative pages (official docs, the spec, the project's README/docs), capture URLs as you go. This is the common path and is enough for most net-new solutions.
- **Depth on a thorny standard: reuse `/deep-research`.** For a genuinely involved standard (a protocol with subtle correctness/security semantics, conflicting sources, a decision that turns on fine print) **delegate to the existing skill** rather than duplicating its engine: `Skill(skill="deep-research", args="<the specific standards/prior-art question>")`. `/research` is the focused, build-time variant scoped to one solution — `deep-research` is the fan-out, adversarially-verified report; call it only when the depth is warranted, and fold its cited findings into the brief.
- **Graceful degradation:** if `deep-research` is unavailable in this session (e.g. a headless/cron context where the skill isn't loaded), fall back to WebSearch + WebFetch directly — never block on the delegation.
- **Source-read of a named candidate (optional, net-new-gated).** When a candidate is a specific OSS repo and its README alone can't settle the import/adapt/build-fresh call — you need to see how cleanly a component actually vendors/forks — read its **real source**, not just its docs. Fetch it **shallow + ref-pinned + path-scoped**, never an unbounded clone:
  - `git clone --depth 1 --branch <release-tag|branch> --filter=blob:none --sparse <url> "$tmp"` then `git -C "$tmp" sparse-checkout set <path/of/interest>` — shallow (`--depth 1`), pinned (`--branch` to a release tag; tags are the stable pin), path-scoped (`--filter=blob:none --sparse` fetches only the targeted module's blobs, not the whole tree or history — the cost lever). Pin to a **commit SHA** only when no tag fits: `git init` + `git remote add origin <url>` + `git fetch --depth 1 origin <sha>` + `git checkout FETCH_HEAD`; this needs the host's `allowReachableSHA1InWant`, so fall back to a tag/branch pin if it's refused.
  - **Read-only, never execute.** Clone into a throwaway temp dir (`$tmp` under the worktree), `Read`/`Grep` only the scoped paths, then delete it. Never run anything from the clone — no `npm install`, no build, no scripts; `git clone` runs no repo-provided hooks, so reading is the whole interaction. The security surface stays bounded to file reads of a size-capped tree.
- Keep the parent context clean: when invoked standalone with broad search, the heavy fetching can run in a `general-purpose` subagent that returns just the brief.

### Cost bound (source-read)
Source-mining can blow a net-new ticket's token budget if unbounded — so hold the source-read to a documented ceiling: **one repo per candidate**; **shallow + `blob:none` + sparse** so only the relevant module is fetched (never the whole history/tree); and read at most a **handful of targeted files** (~5–10 files / a few hundred KB) — the specific component the import/adapt call turns on, not a directory sweep. If that isn't enough to settle the call, say so in the brief and fall back to the docs/README rather than widening the read.

## 3. The call — import / adapt / build-fresh, per candidate

For each candidate implementation, make **one explicit recommendation** with a one-line why:
- **import** — use as-is (mature, well-maintained, license-compatible, fits our stack). Cite it.
- **adapt** — base off / vendor / fork (good shape, but needs trimming or our-context changes).
- **build-fresh** — write our own (no candidate fits; or the surface is small enough that a dep is net-negative) — say *why* nothing imports cleanly.

The recommendation must be **auditable**: every standard and candidate carries a source URL so the call can be checked later. When a call rests on a §2 source-read, also cite the **source-level evidence** behind it — a real `<path/file.ext:symbol@ref>` from the read (how a component is structured, what it depends on, how tangled it is to vendor), not just the README. This is what sharpens the **adapt** call especially: you can judge how cleanly something forks only from its actual source.

## 4. Output — the prior-art brief

Emit exactly this block. The heading is **byte-identical** to the slot `/scope` §6 reserves in the build plan, so the brief drops straight in:

```markdown
## Prior art & standards
**Topic:** <the solution researched>
**Industry standard(s):** <the accepted standard / best practice> — <source URL>   (or "none established — <why>")
**Candidates:**
- **<name>** (<library | OSS project | reference architecture>) — **import | adapt | build-fresh**: <one-line why>. <source URL>[ · src: `<path/file:symbol@ref>` when a §2 source-read informed the call]
- **<name>** (...) — **import | adapt | build-fresh**: <one-line why>. <source URL>
**Recommendation:** <the chosen call + one line of rationale; name the candidate(s) to import/adapt, or state build-fresh + why nothing fit>
```

- **Standalone invocation** → print the block to the user. Suggest the next step: `/scope <ID>` (which will read it) or `/plan` if still pre-ticket.
- **Invoked by `/scope`** → return the block as the subagent result; `/scope` pastes it into `docs/plans/<ticket-id-lowercased>-build.md`'s `## Prior art & standards` section.
- **Invoked by `/plan`** → return the block; `/plan` folds the call into its `## Stack Decision`.

If the recon found genuinely no standard and no candidate (rare), still emit the block with `none established` + `build-fresh` and the reason — an explicit "nothing to reuse" call is itself the deliverable.

## Hard rules

- **Net-new only.** Routine changes following an existing in-repo pattern get skipped, not researched — the existing code is the prior art (grep first, §1).
- **Reuse, don't reimplement.** Web research is WebSearch + WebFetch; depth delegates to `/deep-research` via the `Skill` tool. `/research` never rebuilds a fan-out research engine of its own.
- **Every call is cited.** No import/adapt/build-fresh recommendation without a source URL behind the standard and each candidate.
- **Focused, not a full report.** One solution per invocation; the brief is short and decision-shaped, not a survey.
- **Read-only.** `/research` produces a brief — it never edits code, changes Linear state, or writes the build plan itself (its caller, `/scope`, owns that file).
- Convention 4: name the next step on exit (`/scope` / `/plan`, per how it was invoked).
