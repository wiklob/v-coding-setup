# Build plan: V-385 — Treat curl --get analytics queries as reads in guard-sensitive-access
Status: ready
Created: 2026-07-16 by /scope
Ticket: https://linear.app/wiklob/issue/V-385/treat-curl-get-analytics-queries-as-reads-in-guard-secret-access
Parent plan: none — standalone (bugs bucket)

## Goal
A read-only Supabase analytics/logs GET issued as `curl -G --data-urlencode 'sql=…' https://api.supabase.com/v1/projects/<ref>/…` must classify as a read and pass without the mutation ASK-gate, while every genuine mutation path (raw `database/query`, an explicit `-X POST/PUT/PATCH/DELETE`) stays gated. Separately, a command *quoted inside* a `log-feedback.mjs --note` argument must be treated as the inert text it is, not re-parsed as an executable API call. The guard file is `bin/guard-sensitive-access.py` (renamed from `guard-secret-access.py` in oss #10 — the acceptance's old name no longer exists on base).

## Approach
Two narrowing exceptions layered onto the existing allow-broad / block-narrow scanner in `bin/guard-sensitive-access.py` — neither weakens the `/database/query` hard-DENY.

1. **`-G`/`--get` read-awareness on the config ASK gate.** The MGMT_PROJECT ASK branch (L450-451) currently treats *any* `--data*` flag as write-intent. curl's `-G` moves `-d/--data/--data-urlencode` into the URL query string and issues a **GET** (verified against the curl manpage), so a body flag under `-G` is not a body. Add a `CURL_GET` matcher and only count a body flag as write-intent when no forced-GET is present. Keep an explicit `-X POST/…` as write-intent regardless of `-G` (conservative: `-G -X POST` = POST-with-query-string → still gated).

2. **Inert-note redaction on the whole-command DENY scan.** The item-3 false positive comes solely from the *whole-command* raw regex block (L313-343, esp. the L340 `MGMT_DB_QUERY` + `curl`-word search), which matches text inside a quoted `--note` value. The per-segment scans are already verb-keyed (verb of the note segment is `node`, not an HTTP client) and don't fire. Redact a recognized note-logger's literal `--note` value from the string the whole-command block scans — but never redact a value carrying command substitution (`$(…)`/backticks), which the shell *does* execute.

## Implementation design
1. **Approach** — Two additive exceptions on the existing scanner: (a) a `CURL_GET` regex gates the MGMT_PROJECT ASK on *effective write method*, not mere body-flag presence; (b) a `redact_inert_notes(cmd)` helper produces the string the whole-command DENY block scans, dropping a known note-logger's inert `--note` literal. The `/database/query` DENY (L340/L429) and all per-segment logic are untouched, so the mutation floor is preserved by construction.
2. **Affected seams/files** —
   - `bin/guard-sensitive-access.py`:
     - New `CURL_GET` regex beside `CURL_WRITE_METHOD`/`CURL_BODY` (~L115-118): matches `-G`, `--get`, and explicit read method `-X GET` / `--request GET`.
     - MGMT_PROJECT ASK branch (L450-451): condition becomes `CURL_WRITE_METHOD.search(s) or (CURL_BODY.search(s) and not CURL_GET.search(s))`.
     - New `NOTE_LOGGERS = {"log-feedback.mjs", "log-input-request.mjs"}`, `NOTE_FLAGS = ("--note", "--message", "-m")`, and `redact_inert_notes(cmd)` helper (near the other tokenizer helpers, ~L290).
     - `scan_bash` (L305+): compute `scanned = redact_inert_notes(cmd)` once; run the whole-command DENY block (L313-343) and its `expand_assignments` against `scanned`; leave `segments(cmd)` / per-segment scans on the original `cmd`.
   - `bin/guard-sensitive-access.test.sh`: new `expect_allow`/`expect_ask`/`expect_block` cases (item 4).
   - Guidance (item 5): one line in the docstring's "Sanctioned ops MUST pass" paragraph noting the read-only analytics/logs GET should be run as its own discrete call (not buried in a `. ./.envrc && …` mega-chain — convention 7).
3. **Intended change shape** —
   - `CURL_GET = re.compile(r"(?:^|\s)(?:-G|--get)\b|(?:-X\s*|--request[\s=]+)['\"]?GET\b")`.
   - ASK branch: `curl -G --data-urlencode 'sql=…' <project-url>` → `CURL_BODY` matches but `CURL_GET` matches → not write-intent → **allow**; `curl -X POST … -d …` → `CURL_WRITE_METHOD` → **ask**; `curl -G -X POST …` → `CURL_WRITE_METHOD` → **ask**.
   - `redact_inert_notes`: `shlex.split` the cmd; if no token basenames to a `NOTE_LOGGERS` member, return cmd unchanged; else walk tokens, and for a `--note`/`--message`/`-m` value (space- or `=`-form) drop it — **unless** the value contains `$(` or a backtick, in which case return the original cmd untouched (the substitution executes; must still be scanned). Rejoin with `shlex.quote`. Wrapped so a `shlex` `ValueError` returns cmd unchanged (fail-open, consistent with the module).
4. **Alternatives considered** —
   - Drop the whole-command `MGMT_DB_QUERY` check / make it verb-keyed — rejected: it exists to catch cross-segment var-indirection (`U=…query; curl "$U"`, tested at test.sh:258) that per-segment scanning structurally can't see.
   - Broadly exempt every `--note`/`-m`/`--body` value (git commit, gh pr) — rejected: wider blast radius and a bypass risk (arbitrary message args can carry `$(…)`); scope the exemption to recognized note-loggers, gated on no-command-substitution.
   - Suppress the gate whenever any `--data*` is present — rejected: a real config POST with `-d` would then walk through; the exception must stay method-specific (`-G`/GET only).
5. **Risks / unverified premises** —
   - curl `-G` semantics verified against the curl manpage (data → query string, method GET): https://curl.se/docs/manpage.html. The `-G` + `-X POST` precedence is not spelled out in the manpage, so the design treats an explicit write `-X` as write-intent regardless of `-G` — the safe direction (over-gate, never under-gate).
   - **Security-critical:** `redact_inert_notes` must never drop a `--note` value containing `$(…)`/backtick — that would hide a real exfil the shell runs. Item-4 tests must include a `--note "$(curl … database/query)"` case that stays **blocked**.
   - Known limitation, out of scope (convention 9 — genuinely separable): the broader whole-command false-positive class (`git commit -m "…curl…database/query…"`, `gh pr create --body …`) is unchanged; the exemption is scoped to note-loggers per the ticket. Handling it generally needs its own design around the var-indirection backstop — flag, don't fold.

## Pre-build validation
- [x] Acceptance item 1 — implementable · kind: `code`. `curl -G/--get --data-urlencode` against a read-only analytics/logs endpoint classified as GET/read, no mutation gate. Locus: MGMT_PROJECT ASK branch `bin/guard-sensitive-access.py:450-451` (currently `CURL_WRITE_METHOD or CURL_BODY`). **Verified semantics:** `-G/--get` moves `-d/--data/--data-urlencode` into the URL query string and issues a GET, not a POST — https://curl.se/docs/manpage.html. Ticket premise confirmed.
- [x] Acceptance item 2 — implementable · kind: `invariant` ("mutation-capable endpoints **remain gated**; the exception is endpoint- and method-specific"). Met by the **encoded proof of the negative**, not diff-presence: test cases asserting `curl -G … /database/query` → **DENY** (L340/L429 hard-block, deny-before-ask), `curl -X POST <project-config>` → **ASK**, and `curl -G -X POST <project-config>` → **ASK**. No such tests in the diff ⇒ needs-eyes at land, never auto-ticked.
- [x] Acceptance item 3 — implementable · kind: `code`. A quoted command inside `log-feedback.mjs --note` treated as inert. Locus: whole-command DENY `bin/guard-sensitive-access.py:340` matches text inside the quoted note; new `redact_inert_notes` view fixes it. Proof rides item 4's note-quoting test.
- [x] Acceptance item 4 — implementable · kind: `code`. Regression tests in `bin/guard-sensitive-access.test.sh` covering: short/long flags (`-G` / `--get`), reordered arguments, explicit `-X GET`, mutation endpoints (`/database/query` DENY, config `-X POST` ASK, `-G -X POST` ASK), and feedback-note quoting (inert literal → ALLOW; `$(…)` substitution → BLOCK). Harness (`emit`/`expect_allow`/`expect_ask`/`expect_block`) already present; the MGMT_PROJECT ASK path currently has **no** coverage, so these are net-new.
- [x] Acceptance item 5 — implementable · kind: `code`. Guidance line (guard docstring "Sanctioned ops MUST pass" paragraph) steering the read-only analytics/logs GET to a discrete call rather than a secret-loading mega-chain (convention 7). Cheap in-scope doc touch.

(Build-check: skipped — the ticket carries no `## Fix` code block to compile-check; `bin/run-tests.sh` at build time is the real gate.)

## Implementation steps
1. `bin/guard-sensitive-access.py` — add `CURL_GET` regex beside `CURL_WRITE_METHOD`/`CURL_BODY`. Satisfies item 1 (mechanism).
2. `bin/guard-sensitive-access.py` — MGMT_PROJECT ASK branch (L450-451): gate on `CURL_WRITE_METHOD or (CURL_BODY and not CURL_GET)`. Satisfies items 1, 2.
3. `bin/guard-sensitive-access.py` — add `NOTE_LOGGERS`/`NOTE_FLAGS` + `redact_inert_notes(cmd)`; in `scan_bash`, scan the whole-command DENY block against the redacted view, per-segment against the original. Satisfies item 3.
4. `bin/guard-sensitive-access.py` — one guidance line in the docstring. Satisfies item 5.
5. `bin/guard-sensitive-access.test.sh` — add the item-4 cases (including the `$(…)`-in-note stays-blocked case). Satisfies items 2, 3, 4.

## Risks / gotchas
- `segments()` splits on unquoted separators content-blind, but the note segment's verb is `node` (not an HTTP client), so per-segment gates don't fire on it — the whole-command scan is the only leak, which the redaction targets. Keep per-segment scanning on the original `cmd`.
- Do not redact a `--note` value with command substitution — it executes. This is the one way the fix could open a hole; it is explicitly tested.
- Preserve deny-before-ask: the `-G` exception lives only on the MGMT_PROJECT **ASK** branch; the `/database/query` **DENY** (L340 whole-command, L429 per-segment) is untouched, so a `-G` raw-SQL attempt still blocks.
- Keep `redact_inert_notes` fail-open (return cmd on `shlex` `ValueError`), consistent with the module's fail-open contract.

## Verification strategy
- Primary: `bin/run-tests.sh` (runs `guard-sensitive-access.test.sh` among others) — must stay green, with the new cases passing. `/verify-tests` scope = the guard test suite.
- Manual: none required at land (the ticket's own trigger — a real analytics `curl -G` — is exercised by the added allow test; a live prod call is not needed to prove the classification).
- Build check: n/a (no TS/Next build surface; Python guard + bash tests).

## Deviations
(none yet)
