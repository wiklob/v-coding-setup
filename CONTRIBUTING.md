# Contributing

## Ground rules

- **Tests green**: `bash bin/run-tests.sh` must pass. New `bin/` helpers ship with a `*.test.mjs`/`*.test.sh` sibling (hermetic — sandbox HOME/tmp, no machine state).
- **Scrub gate clean**: `bash .github/scrub-gate.sh`. Never commit personal identifiers, hostnames, IPs, tokens, or real Linear UUIDs — examples use `myapp`, `alice/myrepo`, `/Users/testuser`, all-zeros UUIDs.
- **Follow the house conventions**: multi-step skills follow `workflow-conventions.md`; skill authoring follows `craft/authoring.md`; `bin/` helpers are stdlib-only (no npm deps) with documented exit codes (`0` success · `1` domain failure · `2` soft/retry · `3` bad args).
- **Don't hand-edit generated/derived regions** (e.g. `pipeline/landscape.md`'s marker block, the derived map in `pipeline/owed.md`) — regenerate them.

## PRs

Small, focused PRs with a clear why. If a change alters skill behavior, say what you ran to see it behave (the repo's own standard: never assert what you didn't observe). macOS is the first-class platform; portability PRs (systemd equivalents of the launchd rituals) are very welcome.
