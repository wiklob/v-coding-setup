# Screenshot recipe — capture the rendered UI without breaking on `playwright`

When verifying an app change visually (a UI tweak, a layout fix), you need a screenshot of the *running* app. This doc is the reliable recipe. It is a reference — **not** auto-loaded; reach for it when a verify/run step needs a screenshot. (A sibling log-reading playbook — where each log surface lives and the exact read commands — is worth writing per product; this one captures what the app renders.)

## The failure this avoids

The recurring break: an agent writes an ad-hoc `shot.mjs` into `$CLAUDE_JOB_DIR/tmp` (`import { chromium } from 'playwright'`) and runs `node "$CLAUDE_JOB_DIR/tmp/shot.mjs"`. It dies:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'playwright' imported from /Users/.../jobs/<id>/tmp/shot.mjs
```

**Root cause:** node resolves `node_modules` by walking up from the *script's own location*, not from your cwd. The job-tmp dir has no `node_modules`, so the `playwright` import fails and the screenshot step silently produces nothing. `playwright` is installed in the **app repo's** `node_modules`, which the job-tmp script can't see.

## Preferred — `mcp__playwright` (no script, no resolution problem)

If the `mcp__playwright` MCP server is available, drive the browser through it: navigate, then capture. There is no ad-hoc file and no module-resolution step, so the failure above can't occur. This is the default — reach for a hand-run script only when the MCP server isn't present.

## Fallback — a hand-run script, **run from where `playwright` resolves**

If you must run a script, the one rule that fixes the break: **run it from a cwd inside the app repo, where `playwright` resolves** — never from `$CLAUDE_JOB_DIR/tmp`.

- Put the script in the app repo (or pass an absolute path) and run it with the app repo as cwd:
  ```bash
  cd /path/to/yourapp && node shot.mjs      # node resolves playwright from the app's node_modules
  ```
- Or invoke playwright's own runner, which resolves from the repo it's installed in:
  ```bash
  cd /path/to/yourapp && npx playwright screenshot http://localhost:3000 shot.png
  ```

Either way the import resolves because the process starts inside a tree that has `playwright` in `node_modules`. Dropping the script in job-tmp and running it there is exactly what fails.

> If the app should expose a first-class screenshot helper (a committed `bin/shot`), that's a fix-upstream **in the app repo** — this repo (`~/.claude`) only owns the recipe, not the app's tooling.
