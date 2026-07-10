---
name: verify-asserted-invariants
description: Acceptance criteria asserting an invariant ("X is denied", "only path", "cannot", "redacted") must be probed empirically, not ticked on artifact-presence.
metadata:
  type: feedback
---

When an acceptance item asserts a **negative/security invariant** — *X is denied*, *this is the only path*, *Y cannot happen*, *prevented*, *redacted*, *must not* — do not tick it because the artifact shipped. Run an adversarial probe (a synthetic guard event, a real deny/allow check) and confirm the invariant actually holds before claiming it met. If it can't be met at close, name it explicitly as deferred in the `/land-ticket §8` Done comment — never a clean "all acceptance met."

**Why:** V-26 closed Done with "where a raw read is still denied" literally false — the secret-guard matches by filename, so transcript `.jsonl` files holding cleartext secrets read freely. The §4.8 gate only checks artifact-presence, so the false invariant sailed through; caught only by an ad-hoc probe during land review.

**How to apply:** also verify a ticket's *rationale-premises* (especially "the system already denies/prevents Z") empirically in `/scope` before building on them — a mistaken security baseline is an unverified premise. This discipline is now encoded as skill-doc edits — the `invariant` artifact-kind in `/scope` §3, `/build` §4.5, and `/land-ticket` §4.8 ([[V-39]]) — so apply it on every `/scope` and `/land-ticket`. Concrete instance + fix: [[V-38]].
