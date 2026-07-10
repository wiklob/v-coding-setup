#!/usr/bin/env node
// craft-ab-harness.mjs — deterministic mechanics for the blind before/after craft A/B test (V-125).
//
// What it does (the deterministic half of the harness; the behavioral run + blind scoring are
// agent-driven, see docs/craft-ab-harness.md): given a pipeline command and its *genuine pre-craft*
// git baseline, it extracts both forms of the command, guards that the baseline really is pre-craft
// (the confounded-baseline trap V-125's scope probe found for /review-pr), writes a randomized blind
// A/B labelling so a scorer can't tell before from after, and scaffolds the results doc.
//
// Why a script and not just `git show`: the value is the *baseline guard* (a wrong baseline silently
// invalidates the whole experiment) and the *blind labelling* (the scorer must not know which is which).
// Both are easy to get subtly wrong by hand; encoding them is what makes a future re-run trustworthy.
//
// Usage:
//   node bin/craft-ab-harness.mjs --command review-pr --baseline f35ad76^
//   node bin/craft-ab-harness.mjs --command review-pr --baseline f35ad76^ --seed 7   (reproducible label map)
//
// Output (all under <repo>/tmp/, which is gitignored inside the worktree — convention 5):
//   tmp/<cmd>-before.md      the pre-craft form (git show <baseline>:commands/<cmd>.md)
//   tmp/<cmd>-after.md       the current working-tree form
//   tmp/<cmd>-form-A.md      blind copy (A or B maps to before/after per the key)
//   tmp/<cmd>-form-B.md
//   tmp/<cmd>-ab-map.json    the UNBLINDING KEY — do not show the scorer
//   prints a results-doc skeleton to stdout

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const command = arg('command');
const baseline = arg('baseline');
const seed = Number(arg('seed', '')); // optional; absent → time-seeded
if (!command || !baseline) {
  console.error('usage: node bin/craft-ab-harness.mjs --command <name> --baseline <git-ref> [--seed <n>]');
  process.exit(2);
}

const git = (args) => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' });
const cmdPath = `commands/${command}.md`;

// --- extract both forms ---
let beforeForm;
try {
  beforeForm = git(['show', `${baseline}:${cmdPath}`]);
} catch {
  console.error(`baseline form not found: ${baseline}:${cmdPath} — is the ref or command name right?`);
  process.exit(1);
}
const afterForm = git(['show', `HEAD:${cmdPath}`]);

// --- baseline-validity guard (two INDEPENDENT checks, both enforced) ---
// A genuine pre-craft baseline must satisfy both, so a weakness in one can't pass a confounded ref:
//   (1) CONTENT — the extracted before-form carries none of the craft-marker phrases. (Catches a
//       confounded baseline directly, e.g. a96db7f^ for /review-pr still has the V-117 stance. Its
//       recall is coupled to the regex tokens below — hence guard (2) as an independent backstop.)
//   (2) HISTORY — the baseline strictly precedes the first craft-introducing commit on this command
//       (baseline is an ancestor of that commit). Independent of the regex: catches a baseline that
//       happens to lack the literal marker tokens but already sits at/after the craft change.
// 'diagnostic(ally)?' was dropped (V-159): it false-positives on ordinary pre-craft prose — e.g.
// build.md's conv-9 triage line "repro/diagnostic/PUT-poll" — wrongly failing a genuinely pre-craft
// baseline's CONTENT check. The remaining tokens are craft-specific (low collision), and the
// independent HISTORY check below is the real backstop for a markers-absent confound, so narrowing
// the regex here only removes the false-positive case; it does not weaken real-confound detection.
const CRAFT_MARKERS = /craft\/|default instinct|self-critique|why this feels off|judgment\.md/i;
const beforeHits = beforeForm.split('\n').filter((l) => CRAFT_MARKERS.test(l));
const contentOk = beforeHits.length === 0;

let firstCraftCommit = '';
try {
  firstCraftCommit = git(['log', '--reverse', '--format=%H', '-S', 'craft', '--', cmdPath]).split('\n')[0] || '';
} catch { /* ignore */ }

// HISTORY check: `merge-base --is-ancestor <baseline> <firstCraftCommit>` exits 0 iff baseline is an
// ancestor of (i.e. predates) the first craft commit — the genuine pre-craft position. No craft commit
// found at all → nothing to precede, so this check is vacuously satisfied and content alone governs.
let historyOk = true;
if (firstCraftCommit) {
  try {
    execFileSync('git', ['-C', repoRoot, 'merge-base', '--is-ancestor', baseline, firstCraftCommit], { stdio: 'ignore' });
  } catch {
    historyOk = false;
  }
}

const guardOk = contentOk && historyOk;
if (!guardOk) {
  console.error(`BASELINE GUARD FAILED for ${baseline}:${cmdPath} — this baseline is confounded:`);
  if (!contentOk) {
    console.error(`  content: before-form already carries craft markers:`);
    beforeHits.slice(0, 5).forEach((l) => console.error(`    | ${l.trim().slice(0, 100)}`));
  }
  if (!historyOk) {
    console.error(`  history: baseline is not an ancestor of the first craft commit (${firstCraftCommit.slice(0, 7)}) — it sits at/after the craft change.`);
  }
  console.error(`Pick the parent of the first craft commit (${firstCraftCommit.slice(0, 7) || 'unknown'}^).`);
  process.exit(1);
}

// --- blind A/B labelling (deterministic with --seed; a bin script may use Math.random) ---
let r;
if (Number.isFinite(seed)) {
  let s = seed >>> 0;
  r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); // LCG, reproducible
} else {
  r = Math.random;
}
const beforeIsA = r() < 0.5;
const map = beforeIsA
  ? { A: 'before', B: 'after' }
  : { A: 'after', B: 'before' };

// --- write artifacts ---
const tmp = join(repoRoot, 'tmp');
mkdirSync(tmp, { recursive: true });
writeFileSync(join(tmp, `${command}-before.md`), beforeForm);
writeFileSync(join(tmp, `${command}-after.md`), afterForm);
writeFileSync(join(tmp, `${command}-form-A.md`), map.A === 'before' ? beforeForm : afterForm);
writeFileSync(join(tmp, `${command}-form-B.md`), map.B === 'before' ? beforeForm : afterForm);
writeFileSync(
  join(tmp, `${command}-ab-map.json`),
  JSON.stringify({ command, baseline, firstCraftCommit, seed: Number.isFinite(seed) ? seed : null, map }, null, 2),
);

// --- results-doc skeleton ---
console.log(`baseline guard: OK (${baseline}:${cmdPath} carries 0 craft markers)`);
console.log(`first craft commit on ${cmdPath}: ${firstCraftCommit.slice(0, 7) || 'none found'} (must be a descendant of ${baseline})`);
console.log(`blind map written to tmp/${command}-ab-map.json (do NOT show the scorer)`);
console.log(`forms: tmp/${command}-form-A.md, tmp/${command}-form-B.md`);
console.log('---8<--- results-doc skeleton ---8<---');
console.log(`### Run: /${command} — before(${baseline}) vs after(HEAD)
- Fixture: <pinned input, e.g. PR #N — identical across both forms>
- Form A = tmp/${command}-form-A.md · Form B = tmp/${command}-form-B.md (unblind via tmp/${command}-ab-map.json AFTER scoring)
- Scorer: <neutral blind subagent | reviewer> — given the rubric only, not the craft register, no before/after hint

| marker (V-186 command-shape-aware rubric — see docs/craft-ab-harness.md) | form A | form B |
|---|---|---|
| (a) names + resists a default instinct (structured: named-instinct-resisted in rationale/Risks) | <y/n + evidence> | <y/n + evidence> |
| (b) cites a named craft rail (by-name craft/ register reference only — not a base-model observed-over-asserted paraphrase) | <y/n + evidence> | <y/n + evidence> |
| (c) reaches past the literal letter to the goal (craft/building.md goal-over-letter) | <y/n + evidence> | <y/n + evidence> |

- Unblinded: form <A/B> = after, form <A/B> = before
- Markers present-after / absent-before: <N>/3  → criterion <met (≥2/3) | not met>`);
