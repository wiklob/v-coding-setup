# Security-review data boundaries

Security reviews test whether controls hold; they do not receive an exemption from those controls.

## Semantic deny inheritance

A denied resource remains denied through every access path. If `Read(path)` is forbidden, the same path must not be obtained through Bash, Python, Node, subprocesses, copies, alternate APIs, subagents, or renamed files. Changing the tool does not change the data boundary.

A permission denial, PreToolUse rejection, or classifier block is evidence that the control worked. Stop at the first block. Do not retry, rephrase, switch tools, request a wildcard allowance, or treat the guard as an obstacle to the review.

## Session transcripts

Raw files below `~/.claude/projects/**/*.jsonl` may contain cleartext secrets and are protected. Never recursively enumerate or directly parse them.

Allowed evidence, in order of preference:

1. synthetic fixtures that contain no live data;
2. source and schema inspection;
3. existing redacted aggregate artifacts and sidecar metadata;
4. the purpose-built `transcript-resolver.mjs` or higher-level `session-review.mjs` interface when the task explicitly requires transcript-derived evidence;
5. a narrowly scoped, user-supplied sanitized export when the existing interfaces cannot answer the question.

The resolver is a narrow carve-out, not permission to recreate its behavior. Never hand-roll transcript discovery or reading with `grep`, `find`, `rg`, shell loops, Python, Node evaluation mode, or another interpreter.

## Delegation

Security-sensitive transcript inspection stays in the parent session. Do not delegate it.

For any other security task delegated to an agent, the prompt must state:

- forbidden paths and data classes;
- that the restriction applies through every tool and indirect path;
- the exact allowed evidence sources;
- the first-denial stop condition;
- the bounded scope of the investigation.

“Read-only” alone is insufficient: a read can still violate confidentiality.

## Reporting blocked attempts

Record both facts separately:

- **Control result:** the guard blocked the attempted access and no protected data was returned.
- **Process defect:** the attempted access should not have been made.

A reliable escalation path is positive security evidence; triggering it unnecessarily remains a defect to fix.

## Known control-layer gap

A synthetic 2026-07-14 probe showed that `guard-secret-access.py` denies a concrete transcript filename passed to Python but does not deny directory-level recursive inventory shaped as `Path("~/.claude/projects").glob("**/*.jsonl")`. The separate auto-mode classifier blocked the corresponding live attempt before execution, so no protected data was returned.

Treat those as two distinct results: classifier escalation is verified; the repository PreToolUse guard still needs a maintainer-applied matcher for transcript-root inventory. Until that lands, do not claim the guard alone enforces this boundary.

## Verification

Guard tests must use temporary or fictional paths only. They should prove that direct reads, interpreter reads, recursive transcript inventories, copies, and carve-out smuggling are denied while the named redacting resolver remains allowed. Never use live transcripts as a test fixture. A recursive-inventory test must remain an explicit acceptance probe for the pending guard fix; do not convert the current allowance into an expected-safe result.
